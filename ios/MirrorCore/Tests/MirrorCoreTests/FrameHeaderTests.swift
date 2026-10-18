import XCTest
import MirrorCore

final class FrameHeaderTests: XCTestCase {
    func testGoldenHeader() {
        let golden: [UInt8] = [0x01, 0x01, 0, 0, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        XCTAssertEqual(FrameHeader.encode(isKey: true, ptsUs: 1_000_000), golden)
        let decoded = FrameHeader.decode(golden)
        XCTAssertEqual(decoded?.isKey, true)
        XCTAssertEqual(decoded?.ptsUs, 1_000_000)
        XCTAssertNil(FrameHeader.decode(Array(golden.prefix(15))))
        var v2 = golden
        v2[0] = 2
        XCTAssertNil(FrameHeader.decode(v2))
    }
}
