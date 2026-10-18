import CoreMedia
import CoreVideo
import VideoToolbox

/// Throttles to 30 fps and scales to half size into a 3-buffer pool. Pipeline queue only.
final class FrameSource {
    private(set) var outputSize: (w: Int, h: Int) = (0, 0)

    // slightly under 1/30 s so 60 Hz input alternates cleanly despite timestamp jitter
    private let minInterval = 1.0 / 30 - 0.002
    private let onFrame: (CVPixelBuffer, CMTime) -> Void
    private var transfer: VTPixelTransferSession?
    private var pool: CVPixelBufferPool?
    private var basePts: CMTime?
    private var lastSeconds = -Double.infinity

    init(onFrame: @escaping (CVPixelBuffer, CMTime) -> Void) {
        self.onFrame = onFrame
        VTPixelTransferSessionCreate(allocator: nil, pixelTransferSessionOut: &transfer)
    }

    func handle(_ sample: CMSampleBuffer) {
        guard let input = CMSampleBufferGetImageBuffer(sample), let transfer else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
        let base = basePts ?? pts
        basePts = base
        let relative = CMTimeSubtract(pts, base)
        let seconds = CMTimeGetSeconds(relative)
        guard seconds - lastSeconds >= minInterval else { return }

        let size = (w: even(CVPixelBufferGetWidth(input) / 2), h: even(CVPixelBufferGetHeight(input) / 2))
        if size != outputSize || pool == nil { makePool(size) }
        guard let pool else { return }

        var output: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &output) == kCVReturnSuccess, let output,
              VTPixelTransferSessionTransferImage(transfer, from: input, to: output) == noErr
        else { return }
        lastSeconds = seconds
        onFrame(output, relative)
    }

    func invalidate() {
        if let transfer { VTPixelTransferSessionInvalidate(transfer) }
        transfer = nil
        pool = nil
    }

    private func even(_ value: Int) -> Int { max(2, value & ~1) }

    private func makePool(_ size: (w: Int, h: Int)) {
        let poolAttributes = [kCVPixelBufferPoolMinimumBufferCountKey: 3] as CFDictionary
        let bufferAttributes = [
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
            kCVPixelBufferWidthKey: size.w,
            kCVPixelBufferHeightKey: size.h,
            kCVPixelBufferIOSurfacePropertiesKey: [String: Any]()
        ] as CFDictionary
        var created: CVPixelBufferPool?
        CVPixelBufferPoolCreate(nil, poolAttributes, bufferAttributes, &created)
        pool = created
        outputSize = size
    }
}
