import Foundation

enum APIClientError: LocalizedError, Sendable {
    case invalidRequest
    case server(String)
    case unavailable
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .invalidRequest:
            "查詢條件不完整，請重新選擇公司與日期。"
        case .server(let message):
            message
        case .unavailable:
            "目前連不上盤勢資料。連線恢復後再試一次。"
        case .invalidResponse:
            "資料格式已更新，這個版本暫時無法顯示。"
        }
    }
}

actor APIClient {
    static let shared = APIClient()

    private let baseURL: URL
    private let session: URLSession
    private let decoder = JSONDecoder()

    init(
        baseURL: URL = URL(string: "https://panshi.nomadsustaintech.com")!,
        session: URLSession? = nil
    ) {
        self.baseURL = baseURL
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 25
            configuration.timeoutIntervalForResource = 35
            configuration.waitsForConnectivity = true
            configuration.requestCachePolicy = .returnCacheDataElseLoad
            self.session = URLSession(configuration: configuration)
        }
    }

    func company(symbol: String) async throws -> CompanyPayload {
        try await request(
            path: "/api/company",
            query: [
                URLQueryItem(name: "symbol", value: symbol),
                URLQueryItem(name: "months", value: "13"),
            ]
        )
    }

    func inquiry(
        symbol: String,
        date: String,
        anchor: AnchorKey,
        horizon: InquiryHorizon
    ) async throws -> InquiryPayload {
        try await request(
            path: "/api/inquiry",
            query: [
                URLQueryItem(name: "symbol", value: symbol),
                URLQueryItem(name: "date", value: date),
                URLQueryItem(name: "anchor", value: anchor.rawValue),
                URLQueryItem(name: "horizon", value: String(horizon.rawValue)),
            ]
        )
    }

    func dailyResearch() async throws -> DailyResearchPayload {
        try await request(path: "/api/daily-research", query: [])
    }

    private func request<Response: Decodable & Sendable>(
        path: String,
        query: [URLQueryItem]
    ) async throws -> Response {
        guard var components = URLComponents(
            url: baseURL.appending(path: path),
            resolvingAgainstBaseURL: false
        ) else { throw APIClientError.invalidRequest }
        components.queryItems = query
        guard let url = components.url else { throw APIClientError.invalidRequest }

        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Panshi-iOS/1.0", forHTTPHeaderField: "User-Agent")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw APIClientError.unavailable
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data),
               !envelope.error.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                throw APIClientError.server(envelope.error)
            }
            throw APIClientError.unavailable
        }
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIClientError.invalidResponse
        }
    }
}
