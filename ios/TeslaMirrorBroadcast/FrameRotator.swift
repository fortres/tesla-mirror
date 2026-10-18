import CoreVideo
import ImageIO
import VideoToolbox

/// Rotates landscape ReplayKit frames upright. The CW/CCW mapping must be confirmed on a device.
final class FrameRotator {
    private var session: VTPixelRotationSession?
    private var pool: PixelBufferPool?
    private var current: CGImagePropertyOrientation?

    init() {
        let status = VTPixelRotationSessionCreate(allocator: nil, pixelRotationSessionOut: &session)
        if status != noErr { broadcastLog.error("VTPixelRotationSessionCreate failed: \(status)") }
    }

    func rotate(_ buffer: CVPixelBuffer, orientation: CGImagePropertyOrientation) -> CVPixelBuffer? {
        guard let session else { return nil }
        let size = (w: CVPixelBufferGetHeight(buffer), h: CVPixelBufferGetWidth(buffer))
        if pool?.size != size { pool = PixelBufferPool(size: size) }
        if current != orientation {
            let rotation = orientation == .left ? kVTRotation_CW90 : kVTRotation_CCW90
            VTSessionSetProperty(session, key: kVTPixelRotationPropertyKey_Rotation, value: rotation)
            current = orientation
        }
        guard let output = pool?.makeBuffer() else { return nil }
        let status = VTPixelRotationSessionRotateImage(session, buffer, output)
        if status != noErr {
            broadcastLog.error("VTPixelRotationSessionRotateImage failed: \(status)")
            return nil
        }
        return output
    }

    func invalidate() {
        if let session { VTPixelRotationSessionInvalidate(session) }
        session = nil
        pool = nil
    }
}
