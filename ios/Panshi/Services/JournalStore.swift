import Foundation
import Observation

@MainActor
@Observable
final class JournalStore {
    private enum Key {
        static let companies = "panshi.ios.saved-companies.v1"
        static let entries = "panshi.ios.journal.v1"
    }

    private let defaults: UserDefaults
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    var savedCompanies: [SavedCompany]
    var entries: [JournalEntry]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.savedCompanies = Self.decode([SavedCompany].self, key: Key.companies, defaults: defaults) ?? []
        self.entries = Self.decode([JournalEntry].self, key: Key.entries, defaults: defaults) ?? []
    }

    func isSaved(symbol: String) -> Bool {
        savedCompanies.contains { $0.symbol == symbol }
    }

    func toggleCompany(_ company: CompanyIdentity) {
        if let index = savedCompanies.firstIndex(where: { $0.symbol == company.symbol }) {
            savedCompanies.remove(at: index)
        } else {
            savedCompanies.insert(
                SavedCompany(symbol: company.symbol, shortName: company.shortName, savedAt: .now),
                at: 0
            )
            savedCompanies = Array(savedCompanies.prefix(30))
        }
        persist(savedCompanies, key: Key.companies)
    }

    func save(_ entry: JournalEntry) {
        entries.removeAll { $0.id == entry.id }
        entries.insert(entry, at: 0)
        entries = Array(entries.prefix(50))
        persist(entries, key: Key.entries)
    }

    func toggleReviewed(id: UUID) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[index].reviewedAt = entries[index].reviewedAt == nil ? .now : nil
        persist(entries, key: Key.entries)
    }

    func delete(id: UUID) {
        entries.removeAll { $0.id == id }
        persist(entries, key: Key.entries)
    }

    func removeCompany(symbol: String) {
        savedCompanies.removeAll { $0.symbol == symbol }
        persist(savedCompanies, key: Key.companies)
    }

    private func persist<Value: Encodable>(_ value: Value, key: String) {
        guard let data = try? encoder.encode(value) else { return }
        defaults.set(data, forKey: key)
    }

    private static func decode<Value: Decodable>(
        _ type: Value.Type,
        key: String,
        defaults: UserDefaults
    ) -> Value? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
