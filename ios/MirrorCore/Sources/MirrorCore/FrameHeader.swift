public enum FrameHeader {
    public static let size = 16

    public static func encode(isKey: Bool, ptsUs: UInt64) -> [UInt8] {
        var out = [UInt8](repeating: 0, count: size)
        out[0] = 1
        out[1] = isKey ? 1 : 0
        for i in 0..<8 { out[4 + i] = UInt8(truncatingIfNeeded: ptsUs >> (8 * UInt64(i))) }
        return out
    }

    /// nil for truncated input or a version other than 1.
    public static func decode(_ bytes: [UInt8]) -> (isKey: Bool, ptsUs: UInt64)? {
        guard bytes.count >= size, bytes[0] == 1 else { return nil }
        var pts: UInt64 = 0
        for i in 0..<8 { pts |= UInt64(bytes[4 + i]) << (8 * UInt64(i)) }
        return (bytes[1] & 1 != 0, pts)
    }
}
