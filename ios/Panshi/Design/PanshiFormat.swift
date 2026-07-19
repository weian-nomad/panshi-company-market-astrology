import Foundation

enum PanshiFormat {
    static func price(_ value: Double) -> String {
        value.formatted(
            .number
                .locale(Locale(identifier: "zh_Hant_TW"))
                .precision(.fractionLength(value >= 100 ? 0...0 : 0...2))
        )
    }

    static func percent(_ value: Double?, digits: Int = 1) -> String {
        guard let value, value.isFinite else { return "樣本不足" }
        let sign = value > 0 ? "+" : ""
        return "\(sign)\(value.formatted(.number.precision(.fractionLength(digits))))%"
    }

    static func count(_ value: Int) -> String {
        value.formatted(.number.locale(Locale(identifier: "zh_Hant_TW")))
    }

    static func shareURL(symbol: String) -> URL {
        URL(string: "https://panshi.nomadsustaintech.com/?symbol=\(symbol)")!
    }
}
