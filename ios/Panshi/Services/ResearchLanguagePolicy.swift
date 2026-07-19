import Foundation

enum ResearchLanguagePolicy {
    /// Product-authored recommendation patterns that must never appear as output or calls to action.
    static let forbiddenRecommendationPatterns = [
        "建議買進", "立即買進", "適合買進", "買進訊號", "建議賣出", "立即賣出",
        "賣出訊號", "目標價", "停損價", "保證獲利", "必定上漲", "必定下跌",
        "勝率", "大事會發生", "值得關注股票", "今日最旺股票",
    ]

    static func violations(in text: String) -> [String] {
        forbiddenRecommendationPatterns.filter { text.localizedStandardContains($0) }
    }

    static func isSafe(_ text: String) -> Bool {
        violations(in: text).isEmpty
    }
}
