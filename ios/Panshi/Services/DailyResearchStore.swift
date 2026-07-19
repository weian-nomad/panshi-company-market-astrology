import Foundation
import Observation

@MainActor
@Observable
final class DailyResearchStore {
    var payload: DailyResearchPayload?
    var state: LoadState = .idle

    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    func loadIfNeeded() async {
        guard payload == nil, state != .loading else { return }
        await reload()
    }

    func reload() async {
        state = .loading
        do {
            payload = try await api.dailyResearch()
            state = .ready
        } catch {
            state = .failed(error.panshiUserFacingMessage)
        }
    }
}
