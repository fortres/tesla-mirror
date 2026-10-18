public enum AnnexB {
    public static let startCode: [UInt8] = [0, 0, 0, 1]

    /// Converts length-prefixed (AVCC/HVCC) NAL units; nil on overrun or a zero-size NAL.
    public static func fromLengthPrefixed(_ data: [UInt8], lengthSize: Int = 4) -> [UInt8]? {
        guard (1...4).contains(lengthSize), !data.isEmpty else { return nil }
        var out = [UInt8]()
        out.reserveCapacity(data.count)
        var i = 0
        while i < data.count {
            guard i + lengthSize <= data.count else { return nil }
            var len = 0
            for k in 0..<lengthSize { len = (len << 8) | Int(data[i + k]) }
            i += lengthSize
            guard len > 0, len <= data.count - i else { return nil }
            out += startCode
            out += data[i..<(i + len)]
            i += len
        }
        return out
    }

    public static func keyframe(sps: [UInt8], pps: [UInt8], body: [UInt8]) -> [UInt8] {
        startCode + sps + startCode + pps + body
    }
}
