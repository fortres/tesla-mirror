import CoreMedia
import CoreVideo
import ImageIO
import ReplayKit
import VideoToolbox

/// Throttles to 30 fps, scales to half size and uprights landscape frames. Pipeline queue only.
final class FrameSource {
    private(set) var outputSize = PixelSize(w: 0, h: 0)
    private(set) var inputCount = 0

    // slightly under 1/30 s so 60 Hz input alternates cleanly despite timestamp jitter
    private let minInterval = 1.0 / 30 - 0.002
    private let onFrame: (CVPixelBuffer, CMTime) -> Void
    private let rotator = FrameRotator()
    private var transfer: VTPixelTransferSession?
    private var scaledPool = PixelPoolSlot()
    private var basePts: CMTime?
    private var last: (buffer: CVPixelBuffer, pts: CMTime)?
    private var lastEmitHost = CMTime.invalid
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

        let half = PixelSize(w: even(CVPixelBufferGetWidth(input) / 2), h: even(CVPixelBufferGetHeight(input) / 2))
        guard let scaled = scaledPool.pool(for: half)?.makeBuffer() else { return }
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
        guard let last else { return }
        let step = CMTimeMaximum(CMTime(value: 1, timescale: 30), CMTimeSubtract(Self.hostNow(), lastEmitHost))
        emit(last.buffer, CMTimeAdd(last.pts, step))
    }

    func invalidate() {
        if let transfer { VTPixelTransferSessionInvalidate(transfer) }
        transfer = nil
        scaledPool = PixelPoolSlot()
        last = nil
        rotator.invalidate()
    }

    private func emit(_ buffer: CVPixelBuffer, _ pts: CMTime) {
        last = (buffer, pts)
        lastEmitHost = Self.hostNow()
        lastSeconds = CMTimeGetSeconds(pts)
        outputSize = PixelSize(w: CVPixelBufferGetWidth(buffer), h: CVPixelBufferGetHeight(buffer))
        onFrame(buffer, pts)
    }

    private static func hostNow() -> CMTime { CMClockGetTime(CMClockGetHostTimeClock()) }

    private func even(_ value: Int) -> Int { max(2, value & ~1) }

    private static func orientation(of sample: CMSampleBuffer) -> CGImagePropertyOrientation? {
        let value = CMGetAttachment(sample, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil)
        guard let number = value as? NSNumber else { return nil }
        return CGImagePropertyOrientation(rawValue: number.uint32Value)
    }
}
