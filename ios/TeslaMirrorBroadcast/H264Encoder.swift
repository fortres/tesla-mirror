import CoreMedia
import Foundation
import CoreVideo
import MirrorCore
import VideoToolbox

final class H264Encoder {
    private var session: VTCompressionSession?
    private var forceKey = true
    private let onFrame: (_ isKey: Bool, _ ptsUs: UInt64, _ annexB: [UInt8]) -> Void

    init(
        width: Int, height: Int,
        onFailure: () -> Void,
        onFrame: @escaping (_ isKey: Bool, _ ptsUs: UInt64, _ annexB: [UInt8]) -> Void
    ) {
        self.onFrame = onFrame
        var created: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: nil, width: Int32(width), height: Int32(height),
            codecType: kCMVideoCodecType_H264, encoderSpecification: nil,
            imageBufferAttributes: nil, compressedDataAllocator: nil,
            outputCallback: nil, refcon: nil, compressionSessionOut: &created)
        guard status == noErr, let session = created else {
            broadcastLog.error("VTCompressionSessionCreate failed: \(status)")
            onFailure()
            return
        }
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
            props = [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue!] as CFDictionary
        }
        let status = VTCompressionSessionEncodeFrame(
            session, imageBuffer: buffer, presentationTimeStamp: pts, duration: .invalid,
            frameProperties: props, infoFlagsOut: nil
        ) { [onFrame] status, _, sample in
            guard status == noErr, let sample, let frame = Self.annexB(from: sample) else { return }
            let us = UInt64(max(0, CMTimeGetSeconds(sample.presentationTimeStamp)) * 1_000_000)
            onFrame(frame.isKey, us, frame.bytes)
        }
        if status != noErr { broadcastLog.error("VTCompressionSessionEncodeFrame failed: \(status)") }
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
        guard let block = CMSampleBufferGetDataBuffer(sample),
              let format = CMSampleBufferGetFormatDescription(sample),
              let sets = parameterSets(format)
        else { return nil }
        var data = [UInt8](repeating: 0, count: CMBlockBufferGetDataLength(block))
        guard CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: data.count, destination: &data) == noErr,
              let body = AnnexB.fromLengthPrefixed(data, lengthSize: sets.lengthSize)
        else { return nil }

        // createIfNecessary: a key frame may carry no attachment dictionary at all
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true)
            as? [[CFString: Any]]
        guard let first = attachments?.first else {
            if !warnedAttachments.exchange() { broadcastLog.error("Sample attachments unreadable; treating frames as non-key") }
            return (false, body)
        }
        guard !((first[kCMSampleAttachmentKey_NotSync] as? Bool) ?? false) else { return (false, body) }
        return (true, AnnexB.keyframe(sps: sets.sps, pps: sets.pps, body: body))
    }

    private static func parameterSets(_ format: CMFormatDescription) -> (sps: [UInt8], pps: [UInt8], lengthSize: Int)? {
        guard let sps = parameterSet(format, 0), let pps = parameterSet(format, 1) else { return nil }
        return (sps.bytes, pps.bytes, sps.lengthSize)
    }

    private static func parameterSet(_ format: CMFormatDescription, _ index: Int) -> (bytes: [UInt8], lengthSize: Int)? {
        var pointer: UnsafePointer<UInt8>?
        var size = 0
        var lengthSize: Int32 = 0
        let status = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            format, parameterSetIndex: index, parameterSetPointerOut: &pointer,
            parameterSetSizeOut: &size, parameterSetCountOut: nil, nalUnitHeaderLengthOut: &lengthSize)
        guard status == noErr, let pointer else { return nil }
        return (Array(UnsafeBufferPointer(start: pointer, count: size)), Int(lengthSize))
    }

    private static let warnedAttachments = OnceFlag()
}

private final class OnceFlag {
    private let lock = NSLock()
    private var done = false

    /// Returns whether it was already set, and sets it.
    func exchange() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        let was = done
        done = true
        return was
    }
}
