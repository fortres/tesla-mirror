import CoreMedia
import Foundation
import os
import ReplayKit

class SampleHandler: RPBroadcastSampleHandler {
    private static let maxPendingBuffers = 2

    private let queue = DispatchQueue(label: "app.teslamirror.ios.pipeline")
    private let log = Logger(subsystem: "app.teslamirror.ios", category: "broadcast")
    private let pendingLock = NSLock()
    private var pending = 0
    private var memoryPressure: DispatchSourceMemoryPressure?

    // pipeline queue only
    private var server: WebServer?
    private var source: FrameSource?
    private var pump: FramePump?
    private var encoderSize = (w: 0, h: 0)

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        guard let publicDir = Bundle.main.url(forResource: "public", withExtension: nil) else {
            finishBroadcastWithError(NSError(domain: "app.teslamirror.ios", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Bundled page is missing"
            ]))
            return
        }
        let server = WebServer(publicDir: publicDir)
        server.onClientConnected = { [weak self] in
            self?.queue.async { self?.pump?.clientConnected() }
        }
        do {
            try server.start()
        } catch {
            finishBroadcastWithError(error)
            return
        }
        queue.sync {
            self.server = server
            self.source = FrameSource { [weak self] buffer, pts in self?.encode(buffer, pts) }
        }
        let pressure = DispatchSource.makeMemoryPressureSource(eventMask: [.warning, .critical], queue: queue)
        pressure.setEventHandler { [log] in log.warning("Memory pressure on broadcast extension") }
        pressure.resume()
        memoryPressure = pressure
    }

    override func broadcastPaused() {
        queue.async {
            self.server?.capturing = false
            self.server?.sendState()
        }
    }

    override func broadcastResumed() {
        queue.async {
            self.server?.capturing = true
            self.server?.sendState()
            self.pump?.encoder.requestKeyframe()
        }
    }

    override func broadcastFinished() {
        memoryPressure?.cancel()
        memoryPressure = nil
        queue.sync {
            server?.stop()
            pump?.encoder.invalidate()
            source?.invalidate()
            server = nil
            source = nil
            pump = nil
        }
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard sampleBufferType == .video else { return }
        pendingLock.lock()
        let busy = pending >= Self.maxPendingBuffers
        if !busy { pending += 1 }
        pendingLock.unlock()
        guard !busy else { return }
        queue.async {
            self.source?.handle(sampleBuffer)
            self.pendingLock.lock()
            self.pending -= 1
            self.pendingLock.unlock()
        }
    }

    private func encode(_ buffer: CVPixelBuffer, _ pts: CMTime) {
        guard let server, let source else { return }
        if source.outputSize != encoderSize || pump == nil {
            pump?.encoder.invalidate()
            let size = source.outputSize
            let encoder = H264Encoder(width: size.w, height: size.h) { [weak self] isKey, ptsUs, bytes in
                self?.queue.async { self?.pump?.push(isKey: isKey, ptsUs: ptsUs, annexB: bytes) }
            }
            if let pump {
                pump.encoder = encoder
            } else {
                pump = FramePump(server: server, encoder: encoder)
            }
            encoderSize = size
            server.captureSize = size
            server.sendState()
        }
        pump?.encoder.encode(buffer, pts: pts)
    }
}
