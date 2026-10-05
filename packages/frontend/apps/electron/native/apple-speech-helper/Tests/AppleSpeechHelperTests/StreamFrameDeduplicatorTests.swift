import XCTest

@testable import AppleSpeechHelper

final class StreamFrameDeduplicatorTests: XCTestCase {
  func testIgnoresRepeatedStableFrameId() async {
    let deduplicator = StreamFrameDeduplicator()

    let first = await deduplicator.shouldProcess("mic:0:4096")
    let repeated = await deduplicator.shouldProcess("mic:0:4096")
    let next = await deduplicator.shouldProcess("mic:4096:8192")

    XCTAssertTrue(first)
    XCTAssertFalse(repeated)
    XCTAssertTrue(next)
  }

  func testProcessesLegacyFramesWithoutIds() async {
    let deduplicator = StreamFrameDeduplicator()

    let first = await deduplicator.shouldProcess(nil)
    let second = await deduplicator.shouldProcess(nil)

    XCTAssertTrue(first)
    XCTAssertTrue(second)
  }
}
