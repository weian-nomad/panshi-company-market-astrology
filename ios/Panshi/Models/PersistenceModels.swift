import Foundation

struct SavedCompany: Codable, Identifiable, Hashable, Sendable {
    let symbol: String
    let shortName: String
    let savedAt: Date

    var id: String { symbol }
}

struct JournalEntry: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let savedAt: Date
    let symbol: String
    let shortName: String
    let anchor: AnchorKey
    let targetDate: String
    let effectiveDate: String
    let horizon: Int
    let observationStatus: String
    let dataAsOf: String?
    let reason: String
    let disconfirmingEvidence: String
    let reviewDate: String
    var reviewedAt: Date?
}
