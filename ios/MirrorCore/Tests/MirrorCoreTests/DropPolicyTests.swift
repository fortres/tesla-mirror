import XCTest
import MirrorCore

final class DropPolicyTests: XCTestCase {
    func testDropPolicySequence() {
        var p = DropPolicy(limitBytes: 100)
        XCTAssertEqual(p.decide(isKey: false, backlogBytes: 10), .send)
        XCTAssertEqual(p.decide(isKey: false, backlogBytes: 200), .dropAndRequestKey)
        XCTAssertEqual(p.decide(isKey: false, backlogBytes: 0), .drop)
        XCTAssertEqual(p.decide(isKey: true, backlogBytes: 200), .drop)
        XCTAssertEqual(p.decide(isKey: false, backlogBytes: 0), .drop)
        XCTAssertEqual(p.decide(isKey: true, backlogBytes: 0), .send)
        XCTAssertEqual(p.decide(isKey: false, backlogBytes: 0), .send)
    }
}
