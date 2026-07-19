import Foundation

enum AnchorKey: String, Codable, CaseIterable, Identifiable, Sendable {
    case listing
    case established

    var id: String { rawValue }
    var label: String { self == .listing ? "首日上市" : "公司成立" }
}

enum InquiryHorizon: Int, Codable, CaseIterable, Identifiable, Sendable {
    case short = 5
    case standard = 20
    case long = 60

    var id: Int { rawValue }
    var label: String { "D+\(rawValue)" }
}

struct CompanyPayload: Codable, Sendable {
    let company: CompanyIdentity
    let market: MarketSnapshot
    let bars: [PriceBar]
    let anchors: CompanyAnchors
    let sources: CompanySources
}

struct CompanyIdentity: Codable, Sendable {
    let symbol: String
    let shortName: String
    let fullName: String
    let englishName: String
    let establishedDate: String
    let listingDate: String
    let industry: String
    let website: String
    let registryUpdatedAt: String
}

struct MarketSnapshot: Codable, Sendable {
    let exchange: String
    let currency: String
    let timeZone: String
    let latestDate: String
    let latestClose: Double
    let change: Double
    let changePercent: Double
    let basis: String
}

struct PriceBar: Codable, Identifiable, Sendable {
    let date: String
    let open: Double
    let high: Double
    let low: Double
    let close: Double
    let volume: Double

    var id: String { date }
    var chartDate: Date? { PanshiDate.date(date) }
}

struct CompanyAnchors: Codable, Sendable {
    let established: AnchorData
    let listing: AnchorData

    subscript(key: AnchorKey) -> AnchorData {
        key == .listing ? listing : established
    }
}

struct AnchorData: Codable, Sendable {
    let date: String
    let label: String
    let precision: String
    let precisionLabel: String
    let timeLabel: String
    let confidence: String
    let natal: [PlanetPosition]
    let events: [TransitEvent]
    let upcoming: [TransitEvent]
}

struct PlanetPosition: Codable, Identifiable, Sendable {
    let body: String
    let bodyZh: String
    let glyph: String
    let longitude: Double
    let signZh: String
    let degree: Double
    let retrograde: Bool

    var id: String { body }
}

struct TransitEvent: Codable, Identifiable, Sendable {
    let id: String
    let date: String
    let transitBody: String
    let transitBodyZh: String
    let transitGlyph: String
    let natalBody: String
    let natalBodyZh: String
    let natalGlyph: String
    let aspect: String
    let aspectZh: String
    let aspectGlyph: String
    let tone: String
    let orb: Double
    let transitLongitude: Double
    let natalLongitude: Double
    let close: Double?
    let return5: Double?
    let return20: Double?
}

struct CompanySources: Codable, Sendable {
    let company: String
    let price: String
    let fetchedAt: String
}

struct InquiryPayload: Codable, Sendable {
    let company: CompanyBrief
    let question: InquiryQuestion
    let tradingSession: TradingSession
    let symbolic: SymbolicSnapshot
    let evidence: EvidencePayload
    let events: EventPayload
    let boundaries: BoundaryPayload
    let sources: InquirySources
}

struct CompanyBrief: Codable, Sendable {
    let symbol: String
    let shortName: String
}

struct InquiryQuestion: Codable, Sendable {
    let requestedDate: String
    let anchor: AnchorKey
    let horizon: Int
}

struct TradingSession: Codable, Sendable {
    let requestedDate: String
    let effectiveDate: String
    let adjusted: Bool
    let reason: String?
    let calendarBasis: String
}

struct SymbolicSnapshot: Codable, Sendable {
    let activeOrb: Int
    let primary: TransitConfiguration?
    let configurations: [TransitConfiguration]
}

struct TransitConfiguration: Codable, Identifiable, Sendable {
    let id: String
    let signature: String
    let date: String
    let transitBody: String
    let transitBodyZh: String
    let transitGlyph: String
    let natalBody: String
    let natalBodyZh: String
    let natalGlyph: String
    let aspect: String
    let aspectZh: String
    let aspectGlyph: String
    let tone: String
    let orb: Double
    let transitLongitude: Double
    let natalLongitude: Double
}

struct EvidencePayload: Codable, Sendable {
    let study: InquiryStudy?
    let coverage: PriceCoverage
}

struct PriceCoverage: Codable, Sendable {
    let requestedMonths: Int
    let receivedMonths: Int
    let missingMonths: [String]
    let from: String?
    let to: String?
    let sessions: Int
    let complete: Bool
    let basis: String
}

struct InquiryStudy: Codable, Sendable {
    let matchMode: String
    let signature: String
    let configurationLabel: String
    let horizon: Int
    let status: String
    let statusLabel: String
    let minimumDescriptiveSample: Int
    let statistics: StudyStatistics
    let cases: [EvidenceCase]

    var isDescriptive: Bool { status == "descriptive-only" }
}

struct StudyStatistics: Codable, Sendable {
    let sampleSize: Int
    let positiveCount: Int
    let zeroCount: Int
    let medianReturn: Double?
    let q1Return: Double?
    let q3Return: Double?
    let medianAdverseMove: Double?
    let worstAdverseMove: Double?

    var negativeCount: Int { max(0, sampleSize - positiveCount - zeroCount) }
}

struct EvidenceCase: Codable, Identifiable, Sendable {
    let date: String
    let endDate: String
    let startClose: Double
    let endClose: Double
    let returnPercent: Double
    let maxAdverseMove: Double
    let orb: Double

    var id: String { "\(date)-\(endDate)" }
}

struct EventPayload: Codable, Sendable {
    let status: String
    let windowDays: Int
    let items: [CompanyEvent]
    let checks: [EventCheck]
    let checkedAt: String
    let freshnessNote: String
}

struct CompanyEvent: Codable, Identifiable, Sendable {
    let date: String
    let category: String
    let title: String

    var id: String { "\(date)-\(category)-\(title)" }
}

struct EventCheck: Codable, Identifiable, Sendable {
    let label: String
    let state: String
    let detail: String

    var id: String { label }
}

struct BoundaryPayload: Codable, Sendable {
    let chartPrecision: String
    let statements: [String]
}

struct InquirySources: Codable, Sendable {
    let price: String
    let calendar: String
    let events: String
    let generatedAt: String
}

struct APIErrorEnvelope: Codable, Sendable {
    let error: String
}

struct DailyResearchPayload: Codable, Sendable {
    let date: String
    let title: String
    let selectionPolicy: String
    let items: [DailyResearchItem]
    let boundary: String
    let videoURL: String?
}

struct DailyResearchItem: Codable, Identifiable, Sendable {
    let symbol: String
    let shortName: String
    let category: String
    let industry: String
    let market: String
    let close: Double
    let dailyChangePercent: Double
    let configuration: DailyConfiguration
    let study: DailyStudySummary

    var id: String { symbol }
}

struct DailyConfiguration: Codable, Sendable {
    let label: String
    let orb: Double
}

struct DailyStudySummary: Codable, Sendable {
    let horizon: Int
    let sampleSize: Int
    let positiveCount: Int
    let negativeCount: Int
    let zeroCount: Int
    let medianReturn: Double?
    let q1Return: Double?
    let q3Return: Double?
}

enum PanshiDate {
    private static func formatter(_ format: String, locale: String = "en_US_POSIX") -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: locale)
        formatter.timeZone = TimeZone(identifier: "Asia/Taipei")
        formatter.dateFormat = format
        return formatter
    }

    static func date(_ isoDate: String) -> Date? {
        formatter("yyyy-MM-dd").date(from: isoDate)
    }

    static func iso(_ date: Date) -> String {
        formatter("yyyy-MM-dd").string(from: date)
    }

    static func text(_ isoDate: String?) -> String {
        guard let isoDate, let date = date(isoDate) else { return "尚無資料" }
        return formatter("yyyy.MM.dd", locale: "zh_Hant_TW").string(from: date)
    }
}
