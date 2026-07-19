import SwiftUI

struct ExploreView: View {
    @Environment(AppState.self) private var appState
    @Environment(JournalStore.self) private var journal
    @FocusState private var searchFocused: Bool
    @State private var savePulse = 0

    private let quickSymbols = [
        ("2330", "台積電"),
        ("2317", "鴻海"),
        ("2454", "聯發科"),
        ("2881", "富邦金"),
    ]

    var body: some View {
        @Bindable var state = appState

        ZStack {
            PanshiBackdrop()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    BrandHeader(
                        eyebrow: "PANSHI・MARKET OBSERVATORY",
                        title: "把公司的時間，\n放回股價裡看。",
                        subtitle: "先看今天發生什麼，再把相同組態與反例攤開。"
                    )

                    searchPanel(state: state)

                    switch state.companyState {
                    case .idle:
                        LoadingCard(message: "正在準備第一張公司盤…")
                    case .loading:
                        LoadingCard(message: "正在對齊公司資料與市場時間…")
                    case .failed(let message):
                        FailureCard(message: message) {
                            Task { await state.search() }
                        }
                    case .ready:
                        if let payload = state.company {
                            companyContent(payload, state: state)
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 18)
                .padding(.bottom, 36)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .navigationTitle("觀盤")
        .navigationBarTitleDisplayMode(.inline)
        .task { await state.loadInitialCompanyIfNeeded() }
        .sensoryFeedback(.success, trigger: savePulse)
    }

    @ViewBuilder
    private func searchPanel(state: AppState) -> some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 13) {
                Text("公司代號")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PanshiTheme.paper)
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(PanshiTheme.brass)
                        .accessibilityHidden(true)
                    TextField("例如 2330", text: Bindable(state).searchText)
                        .keyboardType(.numberPad)
                        .textContentType(.none)
                        .focused($searchFocused)
                        .accessibilityLabel("臺灣上市櫃股票代號")
                    Button("查看") {
                        searchFocused = false
                        Task { await state.search() }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(PanshiTheme.brass)
                    .foregroundStyle(PanshiTheme.midnight)
                }
                .padding(12)
                .background(.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 14))

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(quickSymbols, id: \.0) { item in
                            Button("\(item.0) \(item.1)") {
                                state.searchText = item.0
                                Task { await state.search() }
                            }
                            .buttonStyle(.bordered)
                            .tint(PanshiTheme.paper.opacity(0.8))
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func companyContent(_ payload: CompanyPayload, state: AppState) -> some View {
        let market = payload.market
        let anchor = payload.anchors[state.selectedAnchor]

        PanshiCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("\(payload.company.symbol)・\(payload.company.shortName)")
                            .font(PanshiFont.display(30, weight: .semibold))
                            .foregroundStyle(PanshiTheme.paper)
                        Text("\(payload.company.industry)・\(market.exchange)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        journal.toggleCompany(payload.company)
                        savePulse += 1
                    } label: {
                        Image(systemName: journal.isSaved(symbol: payload.company.symbol) ? "bookmark.fill" : "bookmark")
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel(journal.isSaved(symbol: payload.company.symbol) ? "移除收藏" : "收藏公司")
                }

                HStack(alignment: .lastTextBaseline, spacing: 10) {
                    Text("NT$ \(PanshiFormat.price(market.latestClose))")
                        .font(.system(size: 32, weight: .semibold, design: .rounded))
                        .foregroundStyle(PanshiTheme.paper)
                    Text(PanshiFormat.percent(market.changePercent, digits: 2))
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(PanshiTheme.movement(market.changePercent))
                }
                Text("資料截至 \(PanshiDate.text(market.latestDate))・\(market.basis)")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 10) {
                    Button("問這個盤") {
                        state.selectedTab = .inquiry
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(PanshiTheme.brass)
                    .foregroundStyle(PanshiTheme.midnight)

                    ShareLink(item: PanshiFormat.shareURL(symbol: payload.company.symbol)) {
                        Label("分享", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.bordered)
                }
            }
        }

        PriceChartView(bars: payload.bars)

        VStack(alignment: .leading, spacing: 12) {
            Text("命盤基準")
                .panshiSectionTitle()
            Picker("命盤基準", selection: Bindable(state).selectedAnchor) {
                ForEach(AnchorKey.allCases) { key in
                    Text(key.label).tag(key)
                }
            }
            .pickerStyle(.segmented)
        }

        NatalInstrumentView(anchor: anchor)

        if !anchor.upcoming.isEmpty {
            PanshiCard {
                VStack(alignment: .leading, spacing: 14) {
                    Text("接下來的精確窗口")
                        .panshiSectionTitle()
                    ForEach(anchor.upcoming.prefix(4)) { event in
                        HStack(alignment: .top, spacing: 12) {
                            Text(event.aspectGlyph)
                                .font(.title2)
                                .foregroundStyle(PanshiTheme.brass)
                                .frame(width: 30)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 3) {
                                Text("\(event.transitBodyZh)\(event.aspectZh)本命\(event.natalBodyZh)")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(PanshiTheme.paper)
                                Text("\(PanshiDate.text(event.date))・orb \(event.orb.formatted(.number.precision(.fractionLength(2))))°")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }

        BoundaryNote(
            title: "先標記何時看，不先決定方向",
            text: "星象是文化研究的時間索引。歷史價格與相位重合不代表因果，也不是買賣訊號。"
        )
    }
}
