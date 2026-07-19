import SwiftUI
import StoreKit

struct AboutView: View {
    @Environment(SubscriptionStore.self) private var subscription
    @Environment(AdExperience.self) private var ads
    @State private var showPaywall = false

    private let privacyURL = URL(string: "https://panshi.nomadsustaintech.com/privacy")!
    private let termsURL = URL(string: "https://panshi.nomadsustaintech.com/terms")!
    private let sourceURL = URL(string: "https://github.com/weian-nomad/panshi-company-market-astrology")!
    private let adReportURL = URL(string: "https://github.com/weian-nomad/panshi-company-market-astrology/issues/new?labels=ad-report")!

    var body: some View {
        ZStack {
            PanshiBackdrop()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    BrandHeader(
                        eyebrow: "Panshi・Nomad Sustaintech",
                        title: "象徵留給想像，\n資料留給檢查。",
                        subtitle: "盤勢把企業命盤當成時間索引，並排公開市場資料、公司事件與反例。"
                    )

                    membershipCard
                    methodCard
                    privacyCard
                    legalCard
                }
                .padding(.horizontal, 18)
                .padding(.top, 18)
                .padding(.bottom, 36)
            }
        }
        .navigationTitle("關於盤勢")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showPaywall) { PaywallView() }
    }

    private var membershipCard: some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 13) {
                HStack {
                    Text(subscription.isPro ? "盤勢 Pro" : "盤勢免費版")
                        .panshiSectionTitle()
                    Spacer()
                    Text(subscription.isPro ? "無廣告" : "含廣告")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(PanshiTheme.brass)
                }
                Text(subscription.isPro
                     ? "完整歷史研究已開啟；有效訂閱與試用期間不顯示廣告。"
                     : "公司盤、基本解讀、今日五盤、日期問盤與觀察簿都能持續免費使用；訂閱不是使用 App 的前提。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                if subscription.isPro {
                    Button("管理 Apple 訂閱") {
                        Task {
                            guard let scene = UIApplication.shared.connectedScenes
                                .compactMap({ $0 as? UIWindowScene })
                                .first else { return }
                            try? await AppStore.showManageSubscriptions(in: scene)
                        }
                    }
                    .buttonStyle(.bordered)
                } else {
                    Button("查看 7 天免費試用") { showPaywall = true }
                        .buttonStyle(.borderedProminent)
                        .tint(PanshiTheme.brass)
                        .foregroundStyle(PanshiTheme.midnight)
                }

                Button("恢復購買項目") { Task { await subscription.restore() } }
                    .buttonStyle(.borderless)
            }
        }
    }

    private var methodCard: some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("研究方法")
                    .panshiSectionTitle()
                methodRow("象", "用公司成立或首日交易建立文化性的時間索引。")
                methodRow("證", "同組態歷史保留正、負、持平與樣本不足。")
                methodRow("事", "把公開公司事件放回同一個日期窗口核對。")
                methodRow("界", "標示時間精度、未還原價格、資料缺口與非因果。")
                Link("查看公開原始碼與方法文件", destination: sourceURL)
                    .font(.footnote.weight(.semibold))
            }
        }
    }

    private var privacyCard: some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("廣告與隱私")
                    .panshiSectionTitle()
                Text("免費版只在完成一段研究後的自然斷點顯示廣告，不放在啟動畫面、搜尋輸入或命盤閱讀途中。較長影片一律自願觀看；關閉按鈕、廣告標示與不當內容回報都必須清楚可見。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("預設不使用你的查詢、收藏或筆記建立跨 App 廣告側寫。若未來啟用追蹤，會先顯示 Apple 的系統同意視窗。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if ads.isConfigured {
                    Link("回報不適當的廣告", destination: adReportURL)
                }
                Link("隱私權政策", destination: privacyURL)
            }
        }
    }

    private var legalCard: some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("使用界線")
                    .panshiSectionTitle()
                Text("盤勢不提供個股價值判斷、投資推薦、買賣持有意見、目標價、停損、槓桿或部位配置。歷史重合不代表因果，也不能預測未來。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("任何交易決定都不應只依賴本 App。需要個人化意見時，請洽依法執業的專業人士。")
                    .font(.subheadline)
                    .foregroundStyle(PanshiTheme.paper)
                Link("使用條款", destination: termsURL)
            }
        }
    }

    private func methodRow(_ mark: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(mark)
                .font(.headline)
                .foregroundStyle(PanshiTheme.brass)
                .frame(width: 30, height: 30)
                .background(PanshiTheme.brass.opacity(0.1), in: Circle())
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}
