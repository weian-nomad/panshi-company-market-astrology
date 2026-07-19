import SwiftUI

struct PaywallView: View {
    @Environment(SubscriptionStore.self) private var subscription
    @Environment(\.dismiss) private var dismiss

    private let privacyURL = URL(string: "https://panshi.nomadsustaintech.com/privacy")!
    private let termsURL = URL(string: "https://panshi.nomadsustaintech.com/terms")!

    var body: some View {
        NavigationStack {
            ZStack {
                PanshiBackdrop()
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("PANSHI PRO")
                                .font(.caption.weight(.bold))
                                .tracking(2.4)
                                .foregroundStyle(PanshiTheme.brass)
                            Text("把一張盤，\n追到歷史深處。")
                                .font(PanshiFont.display(40, weight: .semibold))
                                .foregroundStyle(PanshiTheme.paper)
                            Text("免費版不是試看版：公司盤、基本解讀、今日五盤與觀察簿都能一直使用。Pro 把歷史檔案展開，並移除廣告。")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        PanshiCard {
                            VStack(alignment: .leading, spacing: 13) {
                                Text("不訂閱，仍然可以")
                                    .panshiSectionTitle()
                                freeBenefit("查每一間已收錄公司的公司盤與基本解讀")
                                freeBenefit("每天看今日五盤與公開市場異動")
                                freeBenefit("問日期、看樣本摘要、正負案例數與中位數")
                                freeBenefit("把假說、反證條件與回看日留在觀察簿")
                                Text("免費版會在自然段落顯示廣告；不看自願式長廣告，也不影響以上功能。")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        PanshiCard {
                            VStack(alignment: .leading, spacing: 15) {
                                benefit("無廣告閱讀", "試用與有效訂閱期間都不顯示廣告。", icon: "rectangle.slash")
                                benefit("完整歷史案例", "展開每筆日期、區間結果、分布與反例。", icon: "clock.arrow.circlepath")
                                benefit("不中斷的研究工作流", "自由切換 D+5、D+20、D+60，不必逐份解鎖。", icon: "point.3.connected.trianglepath.dotted")
                            }
                        }

                        PanshiCard {
                            VStack(alignment: .leading, spacing: 12) {
                                Text(offerTitle)
                                    .font(.title3.weight(.semibold))
                                    .foregroundStyle(PanshiTheme.paper)
                                Text(offerDetail)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                Button {
                                    Task { await subscription.purchase() }
                                } label: {
                                    HStack {
                                        Spacer()
                                        if subscription.isLoading {
                                            ProgressView().tint(PanshiTheme.midnight)
                                        } else {
                                            Text(subscription.isEligibleForTrial ? "開始 7 天免費試用" : "訂閱盤勢 Pro")
                                        }
                                        Spacer()
                                    }
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(PanshiTheme.brass)
                                .foregroundStyle(PanshiTheme.midnight)
                                .disabled(subscription.product == nil || subscription.isLoading)

                                Text("訂閱會自動續訂；你可以在 Apple 帳號的訂閱設定中取消。取消或到期後，完整歷史檔案會收起，其他免費功能照常使用。")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        if let message = subscription.message {
                            Text(message)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .center)
                        }

                        Button("恢復購買項目") { Task { await subscription.restore() } }
                            .frame(maxWidth: .infinity)
                            .disabled(subscription.isLoading)

                        HStack {
                            Link("使用條款", destination: termsURL)
                            Spacer()
                            Link("隱私權政策", destination: privacyURL)
                        }
                        .font(.footnote)

                        Button("先用免費版") { dismiss() }
                            .frame(maxWidth: .infinity)
                            .buttonStyle(.borderless)
                    }
                    .padding(20)
                    .padding(.bottom, 24)
                }
            }
            .navigationTitle("盤勢 Pro")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
            .onChange(of: subscription.isPro) { _, isPro in
                if isPro { dismiss() }
            }
        }
    }

    private var offerTitle: String {
        guard let product = subscription.product else { return "正在讀取 App Store 方案" }
        return subscription.isEligibleForTrial
            ? "前 7 天免費，之後每月 \(product.displayPrice)"
            : "每月 \(product.displayPrice)"
    }

    private var offerDetail: String {
        subscription.isEligibleForTrial
            ? "符合資格的新訂閱者在試用期內不會被收費；第 8 天起自動按月續訂，除非提前取消。"
            : "這個 Apple 帳號目前不符合首次試用資格；確認後立即開始按月訂閱。"
    }

    private func benefit(_ title: String, _ detail: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(PanshiTheme.brass)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(PanshiTheme.paper)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func freeBenefit(_ text: String) -> some View {
        Label(text, systemImage: "checkmark.circle.fill")
            .font(.subheadline)
            .foregroundStyle(PanshiTheme.paper)
            .tint(PanshiTheme.brass)
    }
}
