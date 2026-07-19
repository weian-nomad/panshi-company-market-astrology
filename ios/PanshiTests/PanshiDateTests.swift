import XCTest
@testable import Panshi

final class PanshiDateTests: XCTestCase {
    func testDateRoundTripUsesTaipeiCalendarDate() throws {
        let date = try XCTUnwrap(PanshiDate.date("2026-07-20"))
        XCTAssertEqual(PanshiDate.iso(date), "2026-07-20")
        XCTAssertEqual(PanshiDate.text("2026-07-20"), "2026.07.20")
    }
}
