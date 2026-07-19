import Foundation
import Observation
import StoreKit

enum PanshiProducts {
    static let proMonthly = "com.nomadsustaintech.panshi.pro.monthly"
    static let all: Set<String> = [proMonthly]
}

@MainActor
@Observable
final class SubscriptionStore {
    var product: Product?
    var isPro = false
    var isEligibleForTrial = false
    var isLoading = false
    var message: String?

    @ObservationIgnored private var updatesTask: Task<Void, Never>?

    init() {
        updatesTask = Task { [weak self] in
            for await _ in Transaction.updates {
                guard !Task.isCancelled else { return }
                await self?.refreshEntitlements()
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    func prepare() async {
        isLoading = true
        defer { isLoading = false }
        do {
            product = try await Product.products(for: PanshiProducts.all).first
            if let subscription = product?.subscription {
                isEligibleForTrial = await subscription.isEligibleForIntroOffer
            }
            await refreshEntitlements()
        } catch {
            message = "目前無法讀取訂閱方案。免費功能仍可繼續使用。"
        }
    }

    func purchase() async {
        guard let product else {
            message = "訂閱方案尚未由 App Store 回傳，請稍後再試。"
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            switch try await product.purchase(options: [
                .appAccountToken(QueryIdentity.installationID)
            ]) {
            case .success(let verification):
                let transaction = try verified(verification)
                await transaction.finish()
                await refreshEntitlements()
                message = isPro ? "盤勢 Pro 已啟用。" : "交易已完成，權限正在同步。"
            case .pending:
                message = "這筆訂閱正在等待 App Store 確認。"
            case .userCancelled:
                break
            @unknown default:
                message = "App Store 回傳了目前版本無法辨識的狀態。"
            }
        } catch {
            message = "訂閱沒有完成。你仍可繼續使用免費版。"
        }
    }

    func restore() async {
        isLoading = true
        defer { isLoading = false }
        do {
            try await AppStore.sync()
            await refreshEntitlements()
            message = isPro ? "購買項目已恢復。" : "這個 Apple 帳號目前沒有有效的盤勢 Pro。"
        } catch {
            message = "目前無法恢復購買項目，請稍後再試。"
        }
    }

    func refreshEntitlements() async {
        var active = false
        var activeSignedTransaction: String?
        for await result in Transaction.currentEntitlements {
            guard let transaction = try? verified(result) else { continue }
            guard PanshiProducts.all.contains(transaction.productID),
                  transaction.revocationDate == nil else { continue }
            if let expiration = transaction.expirationDate, expiration <= .now { continue }
            active = true
            activeSignedTransaction = result.jwsRepresentation
        }
        isPro = active
        await EntitlementCredentialStore.shared.update(activeSignedTransaction)
    }

    private func verified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .verified(let value): value
        case .unverified: throw StoreError.failedVerification
        }
    }

    private enum StoreError: Error {
        case failedVerification
    }
}
