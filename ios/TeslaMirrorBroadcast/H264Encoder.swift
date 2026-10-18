import CoreMedia
import CoreVideo
import MirrorCore
import VideoToolbox

final class H264Encoder {
    private var session: VTCompressionSession?
    private var forceKey = true
    private let onFrame: (_ isKey: Bool, _ ptsUs: UInt64, _ annexB: [UInt8]) -> Void

    init(width: Int, height: Int, onFrame: @escaping (_ isKey: Bool, _ ptsUs: UInt64, _ annexB: [UInt8]) -> Void) {
        self.onFrame = onFrame
        var created: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: nil, width: Int32(width), height: Int32(height),
            codecType: kCMVideoCodecType_H264, encoderSpecification: nil,
            imageBufferAttributes: nil, compressedDataAllocator: nil,
            outputCallback: nil, refcon: nil, compressionSessionOut: &created)
        guard status == noErr, let session = created else { return }
        self.session = session
        set(session, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue)
        set(session, kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_Main_AutoLevel)
        set(session, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse)
        set(session, kVTCompressionPropertyKey_MaxKeyFrameInterval, NSNumber(value: 60))
        set(session, kVTCompressionPropertyKey_ExpectedFrameRate, NSNumber(value: 30))
        set(session, kVTCompressionPropertyKey_AverageBitRate, NSNumber(value: 4_000_000))
        set(session, kVTCompressionPropertyKey_DataRateLimits,
            [NSNumber(value: 500_000), NSNumber(value: 1)] as CFArray)
        VTCompressionSessionPrepareToEncodeFrames(session)
    }

    func requestKeyframe() { forceKey = true }

    func encode(_ buffer: CVPixelBuffer, pts: CMTime) {
        guard let session else { return }
        var props: CFDictionary?
        if forceKey {
            forceKey = false
            props = [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue] as CFDictionary
        }
        VTCompressionSessionEncodeFrame(
            session, imageBuffer: buffer, presentationTimeStamp: pts, duration: .invalid,
            frameProperties: props, infoFlagsOut: nil
        ) { [onFrame] status, _, sample in
            guard status == noErr, let sample, let frame = Self.annexB(from: sample) else { return }
            let us = UInt64(max(0, CMTimeGetSeconds(sample.presentationTimeStamp)) * 1_000_000)
            onFrame(frame.isKey, us, frame.bytes)
        }
    }

    func invalidate() {
        guard let session else { return }
        VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
        VTCompressionSessionInvalidate(session)
        self.session = nil
    }

    private func set(_ session: VTCompressionSession, _ key: CFString, _ value: CFTypeRef) {
        VTSessionSetProperty(session, key: key, value: value)
    }

    private static func annexB(from sample: CMSampleBuffer) -> (isKey: Bool, bytes: [UInt8])? {
        guard let block = CMSampleBufferGetDataBuffer(sample) else { return nil }
        var data = [UInt8](repeating: 0, count: CMBlockBufferGetDataLength(block))
        guard CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: data.count, destination: &data) == noErr
        else { return nil }

        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false)
            as? [[CFString: Any]]
        let notSync = (attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool) ?? false
        let isKey = !notSync

        guard let body = AnnexB.fromLengthPrefixed(data) else { return nil }
        guard isKey else { return (false, body) }
        guard let format = CMSampleBufferGetFormatDescription(sample),
              let sps = parameterSet(format, 0), let pps = parameterSet(format, 1)
        else { return nil }
        return (true, AnnexB.keyframe(sps: sps, pps: pps, body: body))
    }

    private static func parameterSet(_ format: CMFormatDescription, _ index: Int) -> [UInt8]? {
        var pointer: UnsafePointer<UInt8>?
        var size = 0
        let status = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            format, parameterSetIndex: index, parameterSetPointerOut: &pointer,
            parameterSetSizeOut: &size, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil)
        guard status == noErr, let pointer else { return nil }
        return Array(UnsafeBufferPointer(start: pointer, count: size))
    }
}
