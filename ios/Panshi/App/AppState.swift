import Foundation
import Observation

enum AppTab: Hashable {
    case daily
    case observe
    case inquiry
    case journal
    case about
}

enum LoadState: Equatable {
    case idle
    case loading
    case ready
    case failed(String)
}

@MainActor
@Observable
final class AppState {
    var selectedTab: AppTab = .daily
    var searchText = "2330"
    var selectedSymbol = "2330"
    var selectedAnchor: AnchorKey = .listing
    var company: CompanyPayload?
    var companyState: LoadState = .idle
    var queryUsage: QueryUsage?
    var reachedFreeDailyLimit = false
    var isShowingPaywall = false

    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    func search() async {
        let symbol = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard symbol.range(of: #"^\d{4,6}$"#, options: .regularExpression) != nil else {
            companyState = .failed("請輸入 4 至 6 碼臺灣上市櫃股票代號。")
            return
        }
        await loadCompany(symbol: symbol)
    }

    func loadCompany(symbol: String) async {
        companyState = .loading
        reachedFreeDailyLimit = false
        do {
            let payload = try await api.company(symbol: symbol)
            selectedSymbol = payload.company.symbol
            searchText = payload.company.symbol
            company = payload
            queryUsage = payload.usage
            companyState = .ready
        } catch APIClientError.freeDailyLimit(let usage) {
            queryUsage = usage
            reachedFreeDailyLimit = true
            companyState = .failed(APIClientError.freeDailyLimit(usage).errorDescription ?? "今日額度已用完。")
        } catch {
            companyState = .failed(error.panshiUserFacingMessage)
        }
    }

    func selectCompany(symbol: String, open tab: AppTab = .observe) {
        selectedSymbol = symbol
        searchText = symbol
        selectedTab = tab
        Task { await loadCompany(symbol: symbol) }
    }

    func handle(url: URL) {
        guard url.scheme == "panshi" else { return }
        let parts = url.pathComponents.filter { $0 != "/" }
        switch url.host {
        case "company", "inquiry":
            guard let symbol = parts.first,
                  symbol.range(of: #"^\d{4,6}$"#, options: .regularExpression) != nil else { return }
            selectCompany(symbol: symbol, open: url.host == "inquiry" ? .inquiry : .observe)
        case "daily":
            selectedTab = .daily
        case "pro":
            isShowingPaywall = true
        default:
            return
        }
    }
}

extension Error {
    var panshiUserFacingMessage: String {
        if let localized = self as? LocalizedError, let description = localized.errorDescription {
            return description
        }
        return "目前無法讀取盤勢資料。連線恢復後再試一次。"
    }
}
