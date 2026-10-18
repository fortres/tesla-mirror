import Foundation
import MirrorCore

/// Applies the drop policy and packs encoded frames for the socket. Pipeline queue only.
final class FramePump {
    var encoder: H264Encoder
    /// Called after a drop forced a keyframe request.
    var onKeyframeRequested: (() -> Void)?

    private let server: WebServer
    private var policy = DropPolicy()
    private var awaitingKey = true

    init(server: WebServer, encoder: H264Encoder) {
        self.server = server
        self.encoder = encoder
    }

    /// A new client must start on a keyframe.
    func clientConnected() {
        awaitingKey = true
        encoder.requestKeyframe()
    }

    func push(isKey: Bool, ptsUs: UInt64, annexB: [UInt8]) {
        if isKey { awaitingKey = false }
        switch policy.decide(isKey: isKey, backlogBytes: server.backlogBytes) {
        case .drop:
            return
        case .dropAndRequestKey:
            encoder.requestKeyframe()
            onKeyframeRequested?()
            return
        case .send:
            if awaitingKey { return }
            server.sendBinary(FrameHeader.encode(isKey: isKey, ptsUs: ptsUs) + annexB)
        }
    }
}
