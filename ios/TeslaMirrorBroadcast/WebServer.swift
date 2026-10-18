import Foundation
import Telegraph

/// HTTP + WebSocket server on the hotspot. One WebSocket client at a time, the newest wins.
final class WebServer: ServerWebSocketDelegate {
    var onClientConnected: (() -> Void)?

    private let port: Int
    private let publicDir: URL
    private let server = Server()
    private let lock = NSLock()
    private var client: WebSocket?
    private var _capturing = true
    private var _captureSize: (w: Int, h: Int) = (0, 0)
    private var _backlogBytes = 0

    init(port: Int = 8080, publicDir: URL) {
        self.port = port
        self.publicDir = publicDir
    }

    var capturing: Bool {
        get { locked { _capturing } }
        set { locked { _capturing = newValue } }
    }

    var captureSize: (w: Int, h: Int) {
        get { locked { _captureSize } }
        set { locked { _captureSize = newValue } }
    }

    /// Bytes handed to the socket and not yet reported written by Telegraph.
    var backlogBytes: Int { locked { _backlogBytes } }

    func start() throws {
        server.webSocketDelegate = self
        server.route(.GET, "/health") { [weak self] _ in
            let body = "{\"capturing\":\(self?.capturing ?? false)}"
            return HTTPResponse(.ok, headers: [.contentType: "application/json"], content: body)
        }
        server.serveDirectory(publicDir, "/", index: "index.html")
        try server.start(port: port)
    }

    func stop() {
        server.stop(immediately: true)
        locked {
            client = nil
            _backlogBytes = 0
        }
    }

    func sendState() {
        let size = captureSize
        let json = "{\"t\":\"state\",\"capturing\":\(capturing),\"accessibility\":false,"
            + "\"capture\":{\"w\":\(size.w),\"h\":\(size.h)},\"transport\":\"h264ws\",\"touch\":false}"
        current()?.send(text: json)
    }

    func sendBinary(_ bytes: [UInt8]) {
        guard let socket = current() else { return }
        locked { _backlogBytes += bytes.count }
        socket.send(data: Data(bytes))
    }

    private func current() -> WebSocket? { locked { client } }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    // MARK: ServerWebSocketDelegate

    func server(_ server: Server, webSocketDidConnect webSocket: WebSocket, handshake: HTTPRequest) {
        let previous: WebSocket? = locked {
            let old = client
            client = webSocket
            _backlogBytes = 0
            return old
        }
        previous?.close(immediately: true)
        sendState()
        onClientConnected?()
    }

    func server(_ server: Server, webSocketDidDisconnect webSocket: WebSocket, error: Error?) {
        locked {
            guard client === webSocket else { return }
            client = nil
            _backlogBytes = 0
        }
    }

    func server(_ server: Server, webSocket: WebSocket, didReceiveMessage message: WebSocketMessage) {}

    func server(_ server: Server, webSocket: WebSocket, didSendMessage message: WebSocketMessage) {
        guard case .binary(let data) = message.payload else { return }
        locked {
            guard client === webSocket else { return }
            _backlogBytes = max(0, _backlogBytes - data.count)
        }
    }
}
