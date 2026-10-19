import Foundation
import Telegraph

/// HTTP + WebSocket server on the hotspot. One WebSocket client at a time, the newest wins.
/// All sends and client changes run on `queue`; call the send methods from it.
final class WebServer: ServerWebSocketDelegate {
    static let backlogLimit = 1_048_576

    /// Called on `queue`, after the state message was sent.
    var onClientConnected: (() -> Void)?
    /// Called on `queue` when the backlog falls back under the limit.
    var onDrained: (() -> Void)?

    private let port: Int
    private let publicDir: URL
    private let queue: DispatchQueue
    private let server = Server()
    private let lock = NSLock()
    private var client: WebSocket?
    private var keepAlive: DispatchSourceTimer?
    private var _capturing = true
    private var _captureSize: (w: Int, h: Int) = (0, 0)
    private var sent: UInt64 = 0
    private var acked: UInt64 = 0

    init(port: Int = 8080, publicDir: URL, queue: DispatchQueue) {
        self.port = port
        self.publicDir = publicDir
        self.queue = queue
    }

    var capturing: Bool {
        get { locked { _capturing } }
        set { locked { _capturing = newValue } }
    }

    var captureSize: (w: Int, h: Int) {
        get { locked { _captureSize } }
        set { locked { _captureSize = newValue } }
    }

    var hasClient: Bool { locked { client != nil } }

    /// Bytes sent that the browser has not yet acknowledged with a pong.
    var backlogBytes: Int { locked { sent > acked ? Int(sent - acked) : 0 } }

    func start() throws {
        // Telegraph's own ping timer would send from another thread
        server.webSocketConfig.pingInterval = 0
        server.webSocketDelegate = self
        server.route(.GET, "/health") { [weak self] _ in
            let body = "{\"capturing\":\(self?.capturing ?? false)}"
            return HTTPResponse(.ok, headers: [.contentType: "application/json"], content: body)
        }
        server.serveDirectory(publicDir, "/", index: "index.html")
        try server.start(port: port)

        // keeps the 300 s read timeout from closing an idle socket
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 30, repeating: 30)
        timer.setEventHandler { [weak self] in self?.sendPing() }
        timer.resume()
        keepAlive = timer
    }

    func stop() {
        keepAlive?.cancel()
        keepAlive = nil
        server.stop(immediately: true)
        locked { client = nil }
    }

    func sendState() {
        let size = captureSize
        let json = "{\"t\":\"state\",\"capturing\":\(capturing),\"accessibility\":false,"
            + "\"capture\":{\"w\":\(size.w),\"h\":\(size.h)},\"transport\":\"h264ws\",\"touch\":false}"
        locked { client }?.send(text: json)
    }

    /// Sends the frame, then a ping carrying the running byte total; the pong echoes it back.
    func sendBinary(_ bytes: [UInt8]) {
        guard let socket = locked({ client }) else { return }
        locked { sent += UInt64(bytes.count) }
        socket.send(data: Data(bytes))
        sendPing()
    }

    private func sendPing() {
        guard let socket = locked({ client }) else { return }
        var total = locked { sent }.littleEndian
        let payload = withUnsafeBytes(of: &total) { Data($0) }
        socket.send(message: WebSocketMessage(opcode: .ping, payload: .binary(payload)))
    }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    // MARK: ServerWebSocketDelegate (Telegraph's delegate queue; hop to `queue`)

    func server(_ server: Server, webSocketDidConnect webSocket: WebSocket, handshake: HTTPRequest) {
        queue.async { [self] in
            let previous: WebSocket? = locked {
                let old = client
                client = webSocket
                sent = 0
                acked = 0
                return old
            }
            previous?.close(immediately: true)
            sendState()
            onClientConnected?()
        }
    }

    func server(_ server: Server, webSocketDidDisconnect webSocket: WebSocket, error: Error?) {
        queue.async { [self] in
            locked {
                guard client === webSocket else { return }
                client = nil
                sent = 0
                acked = 0
            }
        }
    }

    func server(_ server: Server, webSocket: WebSocket, didReceiveMessage message: WebSocketMessage) {
        guard message.opcode == .pong, case .binary(let data) = message.payload, data.count == 8 else { return }
        let value = data.enumerated().reduce(UInt64(0)) { $0 | UInt64($1.element) << (8 * UInt64($1.offset)) }
        queue.async { [self] in
            let drained: Bool = locked {
                guard client === webSocket else { return false }
                let before = sent > acked ? sent - acked : 0
                acked = max(acked, value)
                let after = sent > acked ? sent - acked : 0
                return before > UInt64(Self.backlogLimit) && after <= UInt64(Self.backlogLimit)
            }
            if drained { onDrained?() }
        }
    }
}
