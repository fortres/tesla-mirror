import CoreMedia
import CoreVideo
import ImageIO
import ReplayKit
import VideoToolbox

/// Throttles to 30 fps, scales to half size and uprights landscape frames. Pipeline queue only.
final class FrameSource {
    private(set) var outputSize: (w: Int, h: Int) = (0, 0)
    private(set) var inputCount = 0

    // slightly under 1/30 s so 60 Hz input alternates cleanly despite timestamp jitter
    private let minInterval = 1.0 / 30 - 0.002
    private let onFrame: (CVPixelBuffer, CMTime) -> Void
    private let rotator = FrameRotator()
    private var transfer: VTPixelTransferSession?
    private var scaledPool: PixelBufferPool?
    private var basePts: CMTime?
    private var last: (buffer: CVPixelBuffer, pts: CMTime)?
    private var lastSeconds = -Double.infinity

    init(onFrame: @escaping (CVPixelBuffer, CMTime) -> Void) {
        self.onFrame = onFrame
        let status = VTPixelTransferSessionCreate(allocator: nil, pixelTransferSessionOut: &transfer)
        if status != noErr { broadcastLog.error("VTPixelTransferSessionCreate failed: \(status)") }
    }

    func handle(_ sample: CMSampleBuffer) {
        guard let input = CMSampleBufferGetImageBuffer(sample), let transfer else { return }
        inputCount += 1
        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
        let base = basePts ?? pts
        basePts = base
        let relative = CMTimeSubtract(pts, base)
        guard CMTimeGetSeconds(relative) - lastSeconds >= minInterval else { return }

        let half = (w: even(CVPixelBufferGetWidth(input) / 2), h: even(CVPixelBufferGetHeight(input) / 2))
        if scaledPool?.size != half { scaledPool = PixelBufferPool(size: half) }
        guard let scaled = scaledPool?.makeBuffer() else { return }
        let status = VTPixelTransferSessionTransferImage(transfer, from: input, to: scaled)
        guard status == noErr else {
            broadcastLog.error("VTPixelTransferSessionTransferImage failed: \(status)")
            return
        }

        var output = scaled
        if let orientation = Self.orientation(of: sample), orientation == .left || orientation == .right {
            guard let rotated = rotator.rotate(scaled, orientation: orientation) else { return }
            output = rotated
        }
        emit(output, relative)
    }

    /// Re-emits the last picture; ReplayKit sends nothing while the screen is static.
    func repeatLast() {
        guard let last, let base = basePts else { return }
        let now = CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), base)
        let next = CMTimeAdd(last.pts, CMTime(value: 1, timescale: 30))
        emit(last.buffer, CMTimeMaximum(now, next))
    }

    func invalidate() {
        if let transfer { VTPixelTransferSessionInvalidate(transfer) }
        transfer = nil
        scaledPool = nil
        last = nil
        rotator.invalidate()
    }

    private func emit(_ buffer: CVPixelBuffer, _ pts: CMTime) {
        last = (buffer, pts)
        lastSeconds = CMTimeGetSeconds(pts)
        outputSize = (w: CVPixelBufferGetWidth(buffer), h: CVPixelBufferGetHeight(buffer))
        onFrame(buffer, pts)
    }

    private func even(_ value: Int) -> Int { max(2, value & ~1) }

    private static func orientation(of sample: CMSampleBuffer) -> CGImagePropertyOrientation? {
        let value = CMGetAttachment(sample, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil)
        guard let number = value as? NSNumber else { return nil }
        return CGImagePropertyOrientation(rawValue: number.uint32Value)
    }
}
