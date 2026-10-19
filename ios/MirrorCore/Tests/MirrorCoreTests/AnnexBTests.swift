import XCTest
import MirrorCore

final class AnnexBTests: XCTestCase {
    func testLengthPrefixedToAnnexB() {
        XCTAssertEqual(
            AnnexB.fromLengthPrefixed([0, 0, 0, 2, 0x65, 0x88, 0, 0, 0, 1, 0x41]),
            [0, 0, 0, 1, 0x65, 0x88, 0, 0, 0, 1, 0x41])
        XCTAssertNil(AnnexB.fromLengthPrefixed([0, 0, 0, 9, 0x65]))
        XCTAssertNil(AnnexB.fromLengthPrefixed([0, 0, 0, 0]))
        XCTAssertNil(AnnexB.fromLengthPrefixed([]))
    }

    func testKeyframePrependsParameterSets() {
        XCTAssertEqual(
            AnnexB.keyframe(sps: [0x67, 1], pps: [0x68, 2], body: [0, 0, 0, 1, 0x65]),
            [0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68, 2, 0, 0, 0, 1, 0x65])
    }
}
