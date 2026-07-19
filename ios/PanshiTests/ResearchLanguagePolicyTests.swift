import XCTest
@testable import Panshi

final class ResearchLanguagePolicyTests: XCTestCase {
    func testRejectsRecommendationCopy() {
        XCTAssertFalse(ResearchLanguagePolicy.isSafe("這是買進訊號"))
        XCTAssertFalse(ResearchLanguagePolicy.isSafe("目標價 300 元"))
        XCTAssertFalse(ResearchLanguagePolicy.isSafe("此星盤出現，大事會發生"))
    }

    func testAcceptsDescriptiveResearchCopy() {
        XCTAssertTrue(ResearchLanguagePolicy.isSafe("同組態過去共有九筆，正負案例都保留。"))
        XCTAssertTrue(ResearchLanguagePolicy.isSafe("今天進入研究範圍，不預告價格方向。"))
    }
}
