import Foundation

enum QueryIdentity {
    private static let storageKey = "panshi.installation-id.v1"

    static let installationID: UUID = {
        let defaults = UserDefaults.standard
        if let stored = defaults.string(forKey: storageKey),
           let identifier = UUID(uuidString: stored) {
            return identifier
        }
        let identifier = UUID()
        defaults.set(identifier.uuidString.lowercased(), forKey: storageKey)
        return identifier
    }()
}

actor EntitlementCredentialStore {
    static let shared = EntitlementCredentialStore()

    private var signedTransaction: String?

    func update(_ value: String?) {
        signedTransaction = value
    }

    func current() -> String? {
        signedTransaction
    }
}
