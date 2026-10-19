import CoreVideo

/// NV12 buffer pool capped at 3 buffers; `makeBuffer` returns nil when all are in use.
final class PixelBufferPool {
    let size: PixelSize
    private let pool: CVPixelBufferPool

    init?(size: PixelSize) {
        let poolAttributes = [kCVPixelBufferPoolMinimumBufferCountKey: 3] as CFDictionary
        let bufferAttributes = [
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
            kCVPixelBufferWidthKey: size.w,
            kCVPixelBufferHeightKey: size.h,
            kCVPixelBufferIOSurfacePropertiesKey: [String: Any]()
        ] as CFDictionary
        var created: CVPixelBufferPool?
        let status = CVPixelBufferPoolCreate(nil, poolAttributes, bufferAttributes, &created)
        guard status == kCVReturnSuccess, let created else {
            broadcastLog.error("CVPixelBufferPoolCreate failed: \(status)")
            return nil
        }
        self.size = size
        self.pool = created
    }

    func makeBuffer() -> CVPixelBuffer? {
        let aux = [kCVPixelBufferPoolAllocationThresholdKey: 3] as CFDictionary
        var buffer: CVPixelBuffer?
        let status = CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(nil, pool, aux, &buffer)
        return status == kCVReturnSuccess ? buffer : nil
    }
}

struct PixelSize: Equatable {
    let w: Int
    let h: Int
}

/// Holds one pool; a failed size is not retried until the size changes.
struct PixelPoolSlot {
    private var current: PixelBufferPool?
    private var failed: PixelSize?

    mutating func pool(for size: PixelSize) -> PixelBufferPool? {
        if let current, current.size == size { return current }
        if failed == size { return nil }
        current = PixelBufferPool(size: size)
        failed = current == nil ? size : nil
        return current
    }
}
