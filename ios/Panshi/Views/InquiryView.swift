import SwiftUI

struct InquiryView: View {
    @Environment(AppState.self) private var appState
    @Environment(JournalStore.self) private var journal
    @Environment(SubscriptionStore.self) private var subscription
    @Environment(AdExperience.self) private var ads
    @Environment(RewardUnlockStore.self) private var rewardUnlocks

    @State private var targetDate = InquiryView.nextWeekday(after: .now)
    @State private var horizon: InquiryHorizon = .standard
    @State private var result: InquiryPayload?
    @State private var state: LoadState = .idle
    @State private var showPaywall = false
    @State private var reason = ""
    @State private var disconfirmingEvidence = ""
    @State private var reviewDate = Calendar.current.date(byAdding: .day, value: 30, to: .now) ?? .now
    @State private var saveMessage: String?

    var body: some View {
        @Bindable var app = appState

        ZStack {
            PanshiBackdrop()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    BrandHeader(
                        eyebrow: "DATE INQUIRY・SYMBOL / EVIDENCE / EVENT",
                        title: "問一個日期，\n不討一個答案。",
                        subtitle: "先校正交易日，再把象徵、同組態歷史、現實事件與資料界線拆開。"
                    )

                    inquiryForm(app: app)

                    switch state {
                    case .idle:
                        BoundaryNote(
                            title: "這裡不產生交易指令",
                            text: "你會看到可查驗的過去案例與反例，不會看到評級、目標價、進出場點或未來方向。"
                        )
                    case .loading:
                        LoadingCard(message: "正在對齊交易日與同組態歷史…")
                    case .failed(let message):
                        FailureCard(message: message) { Task { await runInquiry() } }
                    case .ready:
                        if let result { resultContent(result) }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 18)
                .padding(.bottom, 36)
            }
        }
        .navigationTitle("日期問盤")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showPaywall) { PaywallView() }
    }

    private func inquiryForm(app: AppState) -> some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("目前公司")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(app.company.map { "\($0.company.symbol)・\($0.company.shortName)" } ?? app.selectedSymbol)
                            .font(.headline)
                            .foregroundStyle(PanshiTheme.paper)
                    }
                    Spacer()
                    Button("換公司") { app.selectedTab = .observe }
                        .buttonStyle(.bordered)
                }

                DatePicker(
                    "觀測日期",
                    selection: $targetDate,
                    in: Date.now...Calendar.current.date(byAdding: .year, value: 1, to: .now)!,
                    displayedComponents: .date
                )
                .datePickerStyle(.compact)

                Picker("命盤基準", selection: Bindable(app).selectedAnchor) {
                    ForEach(AnchorKey.allCases) { anchor in
                        Text(anchor.label).tag(anchor)
                    }
                }
                .pickerStyle(.segmented)

                VStack(alignment: .leading, spacing: 8) {
                    Text("歷史對照期")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Picker("歷史對照期", selection: $horizon) {
                        ForEach(InquiryHorizon.allCases) { item in
                            Text(item.label).tag(item)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Button {
                    Task { await runInquiry() }
                } label: {
                    Label("整理這一天的研究檔案", systemImage: "scope")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(PanshiTheme.brass)
                .foregroundStyle(PanshiTheme.midnight)
                .disabled(state == .loading)

                Text("觀測期只改變歷史比較範圍，不會產生方向建議。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func resultContent(_ payload: InquiryPayload) -> some View {
        sessionCard(payload)
        symbolicCard(payload)
        evidenceSummaryCard(payload)

        if hasDeepAccess(payload) {
            deepHistoryCard(payload)
        } else {
            deepHistoryGate(payload)
        }

        eventCard(payload)
        researchJournal(payload)

        PanshiCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("這次不能回答什麼")
                    .panshiSectionTitle()
                Text(payload.boundaries.chartPrecision)
                    .font(.subheadline)
                    .foregroundStyle(PanshiTheme.paper)
                ForEach(payload.boundaries.statements, id: \.self) { statement in
                    Label(statement, systemImage: "minus")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Text("盤勢不提供個股價值判斷、推薦、評級、目標價或任何交易指令。")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(PanshiTheme.brass)
            }
        }
    }

    private func sessionCard(_ payload: InquiryPayload) -> some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 10) {
                Text(payload.tradingSession.adjusted ? "觀測日已校正" : "交易日已核對")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(PanshiTheme.brass)
                Text(PanshiDate.text(payload.tradingSession.effectiveDate))
                    .font(.system(.title, design: .rounded, weight: .semibold))
                    .foregroundStyle(PanshiTheme.paper)
                if payload.tradingSession.adjusted, let reason = payload.tradingSession.reason {
                    Text("原日期不是交易日：\(reason)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Text(payload.tradingSession.calendarBasis == "official" ? "依交易所公告日曆" : "目前依平日規則推定，仍需重查臨時休市")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func symbolicCard(_ payload: InquiryPayload) -> some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 14) {
                Text("象・時間質地")
                    .panshiSectionTitle()
                if let primary = payload.symbolic.primary {
                    HStack(alignment: .top, spacing: 14) {
                        Text("\(primary.transitGlyph)\(primary.aspectGlyph)\(primary.natalGlyph)")
                            .font(.system(size: 34, design: .serif))
                            .foregroundStyle(PanshiTheme.brass)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 6) {
                            Text("\(primary.transitBodyZh)\(primary.aspectZh)本命\(primary.natalBodyZh)")
                                .font(.headline)
                                .foregroundStyle(PanshiTheme.paper)
                            Text(symbolicReading(primary))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text("orb \(primary.orb.formatted(.number.precision(.fractionLength(2))))°・只描述結構，不判斷價格方向")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(PanshiTheme.brass)
                        }
                    }
                } else {
                    Text("3° 門檻內沒有主要相位。這次不放大門檻，也不把普通日包裝成訊號。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func evidenceSummaryCard(_ payload: InquiryPayload) -> some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 14) {
                Text("證・同組態摘要")
                    .panshiSectionTitle()
                if let study = payload.evidence.study {
                    Text("只比對「\(study.configurationLabel)」的完整歷史窗口，再向後看 \(study.horizon) 個交易日。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    HStack(spacing: 10) {
                        MetricCell(label: "完整樣本", value: "\(study.statistics.sampleSize) 筆")
                        MetricCell(label: "正／負變動", value: "\(study.statistics.positiveCount)／\(study.statistics.negativeCount)")
                        MetricCell(label: "中位數", value: PanshiFormat.percent(study.statistics.medianReturn))
                    }
                    Text(study.isDescriptive
                         ? "樣本達介面描述門檻，仍不代表統計有效或未來會重演。"
                         : "樣本少於 \(study.minimumDescriptiveSample) 筆，只列案例，不做方向歸納。")
                        .font(.caption)
                        .foregroundStyle(PanshiTheme.brass)
                } else {
                    Text("目標日沒有可比的精確組態，因此不拼湊歷史案例。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Text("價格基準：\(payload.evidence.coverage.basis)・資料截至 \(PanshiDate.text(payload.evidence.coverage.to))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func deepHistoryCard(_ payload: InquiryPayload) -> some View {
        if let study = payload.evidence.study {
            PanshiCard {
                VStack(alignment: .leading, spacing: 15) {
                    HStack {
                        Text("完整歷史檔案")
                            .panshiSectionTitle()
                        Spacer()
                        Text(subscription.isPro ? "PRO" : "已解鎖")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(PanshiTheme.brass)
                    }
                    HStack(spacing: 10) {
                        MetricCell(label: "中間 50%", value: range(study.statistics.q1Return, study.statistics.q3Return))
                        MetricCell(label: "期間最低偏離中位", value: PanshiFormat.percent(study.statistics.medianAdverseMove))
                    }
                    ForEach(study.cases) { item in
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Text("\(PanshiDate.text(item.date)) → \(PanshiDate.text(item.endDate))")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text(PanshiFormat.percent(item.returnPercent))
                                    .font(.subheadline.monospacedDigit().weight(.semibold))
                                    .foregroundStyle(PanshiTheme.movement(item.returnPercent))
                            }
                            Text("收盤 \(PanshiFormat.price(item.startClose)) → \(PanshiFormat.price(item.endClose))・期間最低偏離 \(PanshiFormat.percent(item.maxAdverseMove))・orb \(item.orb.formatted(.number.precision(.fractionLength(2))))°")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 5)
                        if item.id != study.cases.last?.id {
                            Divider().overlay(.white.opacity(0.08))
                        }
                    }
                }
            }
        }
    }

    private func deepHistoryGate(_ payload: InquiryPayload) -> some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 14) {
                Label("完整歷史檔案", systemImage: "lock.circle")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(PanshiTheme.paper)
                Text("免費查盤已保留時間解讀、樣本數、正負案例與中位數。完整案例日期、分布與區間細節可用 Pro 開啟。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Button("查看 Pro 方案") { showPaywall = true }
                    .buttonStyle(.borderedProminent)
                    .tint(PanshiTheme.brass)
                    .foregroundStyle(PanshiTheme.midnight)

                if ads.isConfigured {
                    Button {
                        Task {
                            guard await ads.watchRewardedVideo() else { return }
                            rewardUnlocks.unlock(
                                symbol: payload.company.symbol,
                                date: payload.tradingSession.effectiveDate
                            )
                        }
                    } label: {
                        Label("看一段約 30–60 秒廣告，解鎖 24 小時", systemImage: "play.rectangle")
                    }
                    .buttonStyle(.bordered)
                    .disabled(ads.isPresenting)
                    Text("廣告完全自願；不觀看也能繼續使用基本查盤。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func eventCard(_ payload: InquiryPayload) -> some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 13) {
                Text("事・公開事件核對")
                    .panshiSectionTitle()
                if payload.events.items.isEmpty {
                    Text("這個窗口目前沒有讀到已接入的公司事件；沒有資料不等於沒有事件。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(payload.events.items) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(PanshiDate.text(item.date))・\(item.category)")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(PanshiTheme.brass)
                            Text(item.title)
                                .font(.subheadline)
                                .foregroundStyle(PanshiTheme.paper)
                        }
                    }
                }
                ForEach(payload.events.checks) { check in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: check.state == "found" ? "checkmark.circle.fill" : "circle.dotted")
                            .foregroundStyle(check.state == "found" ? PanshiTheme.negative : .secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(check.label).font(.caption.weight(.semibold))
                            Text(check.detail).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                Text(payload.events.freshnessNote)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func researchJournal(_ payload: InquiryPayload) -> some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 13) {
                Text("記・留一個可回看的假說")
                    .panshiSectionTitle()

                VStack(alignment: .leading, spacing: 6) {
                    Text("我正在觀察什麼？").font(.caption).foregroundStyle(.secondary)
                    TextEditor(text: $reason)
                        .frame(minHeight: 82)
                        .padding(8)
                        .scrollContentBackground(.hidden)
                        .background(.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("哪個事實出現時，我會改變看法？").font(.caption).foregroundStyle(.secondary)
                    TextEditor(text: $disconfirmingEvidence)
                        .frame(minHeight: 82)
                        .padding(8)
                        .scrollContentBackground(.hidden)
                        .background(.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
                }

                DatePicker("回看日期", selection: $reviewDate, in: Date.now..., displayedComponents: .date)

                Button("存進觀察簿") {
                    Task { await saveJournal(payload) }
                }
                .buttonStyle(.borderedProminent)
                .tint(PanshiTheme.brass)
                .foregroundStyle(PanshiTheme.midnight)
                .disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                          || disconfirmingEvidence.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                if let saveMessage {
                    Text(saveMessage).font(.caption).foregroundStyle(.secondary)
                }
                Text("筆記只存在這支 iPhone。提醒會先徵求系統通知權限。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func runInquiry() async {
        state = .loading
        saveMessage = nil
        do {
            let payload = try await APIClient.shared.inquiry(
                symbol: appState.selectedSymbol,
                date: PanshiDate.iso(targetDate),
                anchor: appState.selectedAnchor,
                horizon: horizon
            )
            result = payload
            reviewDate = Calendar.current.date(
                byAdding: .day,
                value: Int(ceil(Double(horizon.rawValue) * 7 / 5)) + 2,
                to: targetDate
            ) ?? targetDate
            state = .ready
            await ads.noteResearchCompleted(isPro: subscription.isPro)
        } catch {
            state = .failed(error.panshiUserFacingMessage)
        }
    }

    private func saveJournal(_ payload: InquiryPayload) async {
        let entry = JournalEntry(
            id: UUID(),
            savedAt: .now,
            symbol: payload.company.symbol,
            shortName: payload.company.shortName,
            anchor: payload.question.anchor,
            targetDate: payload.question.requestedDate,
            effectiveDate: payload.tradingSession.effectiveDate,
            horizon: payload.question.horizon,
            observationStatus: payload.evidence.study?.statusLabel ?? "無可比組態",
            dataAsOf: payload.evidence.coverage.to,
            reason: reason.trimmingCharacters(in: .whitespacesAndNewlines),
            disconfirmingEvidence: disconfirmingEvidence.trimmingCharacters(in: .whitespacesAndNewlines),
            reviewDate: PanshiDate.iso(reviewDate),
            reviewedAt: nil
        )
        journal.save(entry)
        do {
            let scheduled = try await ReviewNotificationService.schedule(for: entry)
            saveMessage = scheduled ? "已保存，並安排回看提醒。" : "已保存；系統未開放通知提醒。"
        } catch {
            saveMessage = "已保存；提醒目前無法建立。"
        }
    }

    private func hasDeepAccess(_ payload: InquiryPayload) -> Bool {
        subscription.isPro || rewardUnlocks.isUnlocked(
            symbol: payload.company.symbol,
            date: payload.tradingSession.effectiveDate
        )
    }

    private func symbolicReading(_ configuration: TransitConfiguration) -> String {
        switch configuration.tone {
        case "flow": "符號上呈現較順的連結，適合拿來觀察事件如何展開；它不代表價格上漲。"
        case "tension": "符號上呈現結構摩擦與調整主題；它不代表價格下跌。"
        default: "符號上把同一主題集中放大；它不指定價格方向。"
        }
    }

    private func range(_ lower: Double?, _ upper: Double?) -> String {
        guard let lower, let upper else { return "樣本不足" }
        return "\(PanshiFormat.percent(lower)) 至 \(PanshiFormat.percent(upper))"
    }

    private static func nextWeekday(after date: Date) -> Date {
        var candidate = Calendar.current.date(byAdding: .day, value: 1, to: date) ?? date
        while Calendar.current.isDateInWeekend(candidate) {
            candidate = Calendar.current.date(byAdding: .day, value: 1, to: candidate) ?? candidate
        }
        return candidate
    }
}
