import Foundation
import Observation

protocol AdServing: Sendable {
    var isConfigured: Bool { get }
    func presentRewarded() async -> Bool
    func presentInterstitial() async
}

struct UnavailableAdService: AdServing {
    let isConfigured = false
    func presentRewarded() async -> Bool { false }
    func presentInterstitial() async {}
}

@MainActor
@Observable
final class AdExperience {
    private let service: any AdServing
    private var completedResearchCount = 0

    var isPresenting = false
    var message: String?

    init(service: any AdServing = UnavailableAdService()) {
        self.service = service
    }

    var isConfigured: Bool { service.isConfigured }

    /// Interstitials are capped and only considered after a completed research action.
    func noteResearchCompleted(isPro: Bool) async {
        guard !isPro, service.isConfigured else { return }
        completedResearchCount += 1
        guard completedResearchCount.isMultiple(of: 3) else { return }
        await service.presentInterstitial()
    }

    func watchRewardedVideo() async -> Bool {
        guard service.isConfigured else {
            message = "獎勵式廣告尚未完成營運設定。免費查盤不受影響。"
            return false
        }
        isPresenting = true
        defer { isPresenting = false }
        return await service.presentRewarded()
    }
}

@MainActor
@Observable
final class RewardUnlockStore {
    private enum Key {
        static let unlocks = "panshi.ios.reward-unlocks.v1"
    }

    private let defaults: UserDefaults
    private var expirations: [String: Date]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.expirations = (defaults.dictionary(forKey: Key.unlocks) as? [String: Date]) ?? [:]
        removeExpired()
    }

    func isUnlocked(symbol: String, date: String) -> Bool {
        removeExpired()
        return expirations[unlockKey(symbol: symbol, date: date), default: .distantPast] > .now
    }

    func unlock(symbol: String, date: String, for duration: TimeInterval = 24 * 60 * 60) {
        expirations[unlockKey(symbol: symbol, date: date)] = .now.addingTimeInterval(duration)
        persist()
    }

    private func unlockKey(symbol: String, date: String) -> String {
        "history:\(symbol):\(date)"
    }

    private func removeExpired() {
        let now = Date.now
        expirations = expirations.filter { $0.value > now }
        persist()
    }

    private func persist() {
        defaults.set(expirations, forKey: Key.unlocks)
    }
}
