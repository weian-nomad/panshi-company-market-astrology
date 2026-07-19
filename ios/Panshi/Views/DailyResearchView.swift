import SwiftUI

struct DailyResearchView: View {
    @Environment(DailyResearchStore.self) private var store
    @Environment(AppState.self) private var appState
    @Environment(SubscriptionStore.self) private var subscription

    var body: some View {
        ZStack {
            PanshiBackdrop()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    BrandHeader(
                        eyebrow: "TODAY'S FIVE・RESEARCH MARKERS",
                        title: "今天，哪五張盤\n值得回看？",
                        subtitle: "依公開市場異動與同組態樣本固定選出；不是排行，也不預告方向。"
                    )

                    switch store.state {
                    case .idle, .loading:
                        LoadingCard(message: "正在讀取最近一個已發布交易日…")
                    case .failed(let message):
                        FailureCard(message: message) { Task { await store.reload() } }
                    case .ready:
                        if let payload = store.payload {
                            dailyContent(payload)
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 18)
                .padding(.bottom, 36)
            }
            .refreshable { await store.reload() }
        }
        .navigationTitle("今日五盤")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadIfNeeded() }
    }

    @ViewBuilder
    private func dailyContent(_ payload: DailyResearchPayload) -> some View {
        PanshiCard {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "calendar.badge.checkmark")
                    .font(.title2)
                    .foregroundStyle(PanshiTheme.brass)
                VStack(alignment: .leading, spacing: 4) {
                    Text(PanshiDate.text(payload.date))
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(PanshiTheme.paper)
                    Text("最近一個通過資料與樣本檢核的交易日")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if subscription.isPro {
                    Text("PRO")
                        .font(.caption2.weight(.black))
                        .tracking(1.2)
                        .foregroundStyle(PanshiTheme.midnight)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(PanshiTheme.brass, in: Capsule())
                }
            }
        }

        ForEach(Array(payload.items.enumerated()), id: \.element.id) { index, item in
            dailyCard(item, index: index + 1, date: payload.date)
        }

        BoundaryNote(
            title: "入選只回答：今天為什麼值得回看",
            text: payload.boundary
        )

        if let videoURL = payload.videoURL, let url = URL(string: videoURL) {
            Link(destination: url) {
                Label("看今日五盤短片", systemImage: "play.rectangle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(PanshiTheme.brass)
            .foregroundStyle(PanshiTheme.midnight)
        }
    }

    private func dailyCard(_ item: DailyResearchItem, index: Int, date: String) -> some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 15) {
                HStack(alignment: .top, spacing: 12) {
                    Text(String(format: "%02d", index))
                        .font(.caption.monospacedDigit().weight(.bold))
                        .foregroundStyle(PanshiTheme.brass)
                        .frame(width: 28, height: 28)
                        .background(PanshiTheme.brass.opacity(0.12), in: Circle())
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.category)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(PanshiTheme.brass)
                        Text("\(item.symbol)・\(item.shortName)")
                            .font(PanshiFont.display(25, weight: .semibold))
                            .foregroundStyle(PanshiTheme.paper)
                        Text("\(item.industry)・\(item.market)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(PanshiFormat.percent(item.dailyChangePercent, digits: 2))
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(PanshiTheme.movement(item.dailyChangePercent))
                }

                Divider().overlay(PanshiTheme.brass.opacity(0.15))

                VStack(alignment: .leading, spacing: 7) {
                    Text(item.configuration.label)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(PanshiTheme.paper)
                    Text("精確度 orb \(item.configuration.orb.formatted(.number.precision(.fractionLength(2))))°")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 10) {
                    MetricCell(label: "D+\(item.study.horizon) 樣本", value: "\(item.study.sampleSize) 筆")
                    MetricCell(label: "正／負變動", value: "\(item.study.positiveCount)／\(item.study.negativeCount)")
                    MetricCell(label: "中位數", value: PanshiFormat.percent(item.study.medianReturn))
                }

                Text("正、負與持平案例都保留。這些是過去收盤價變動，不是機率。")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 10) {
                    Button("打開公司盤") {
                        appState.selectCompany(symbol: item.symbol, open: .observe)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(PanshiTheme.brass)
                    .foregroundStyle(PanshiTheme.midnight)

                    Button("看歷史檔案") {
                        appState.selectedSymbol = item.symbol
                        appState.searchText = item.symbol
                        appState.selectedTab = .inquiry
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }
}
