import SwiftUI

struct JournalView: View {
    @Environment(JournalStore.self) private var journal
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            PanshiBackdrop()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    BrandHeader(
                        eyebrow: "LOCAL OBSERVATION LEDGER",
                        title: "把當時的想法，\n留給後來的資料。",
                        subtitle: "收藏、假說與反證條件只存在這支 iPhone，不會同步成你的投資側寫。"
                    )

                    savedCompanies
                    entries
                }
                .padding(.horizontal, 18)
                .padding(.top, 18)
                .padding(.bottom, 36)
            }
        }
        .navigationTitle("觀察簿")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var savedCompanies: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("收藏公司")
                .panshiSectionTitle()
            if journal.savedCompanies.isEmpty {
                BoundaryNote(title: "還沒有收藏", text: "在公司盤右上角按下書籤，常看的公司就會留在這裡。")
            } else {
                ForEach(journal.savedCompanies) { company in
                    PanshiCard {
                        HStack {
                            Button {
                                appState.selectCompany(symbol: company.symbol, open: .observe)
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(company.symbol)・\(company.shortName)")
                                        .font(.headline)
                                        .foregroundStyle(PanshiTheme.paper)
                                    Text("收藏於 \(company.savedAt.formatted(date: .abbreviated, time: .omitted))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                            Button {
                                journal.removeCompany(symbol: company.symbol)
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                            .foregroundStyle(.secondary)
                            .accessibilityLabel("移除 \(company.shortName) 收藏")
                        }
                    }
                }
            }
        }
    }

    private var entries: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("研究筆記")
                .panshiSectionTitle()
            if journal.entries.isEmpty {
                BoundaryNote(title: "還沒有研究筆記", text: "完成一次日期問盤後，記下假說、反證條件與回看日期。")
            } else {
                ForEach(journal.entries) { entry in
                    PanshiCard {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(entry.symbol)・\(entry.shortName)")
                                        .font(.headline)
                                        .foregroundStyle(PanshiTheme.paper)
                                    Text("觀測 \(PanshiDate.text(entry.effectiveDate))・\(entry.horizon) 個交易日")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(entry.reviewedAt == nil ? "待回看" : "已回看")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(entry.reviewedAt == nil ? PanshiTheme.brass : PanshiTheme.negative)
                            }

                            VStack(alignment: .leading, spacing: 5) {
                                Text("當時假說").font(.caption.weight(.semibold)).foregroundStyle(PanshiTheme.brass)
                                Text(entry.reason).font(.subheadline).foregroundStyle(PanshiTheme.paper)
                            }
                            VStack(alignment: .leading, spacing: 5) {
                                Text("改變看法的條件").font(.caption.weight(.semibold)).foregroundStyle(PanshiTheme.brass)
                                Text(entry.disconfirmingEvidence).font(.subheadline).foregroundStyle(PanshiTheme.paper)
                            }

                            Text("回看日 \(PanshiDate.text(entry.reviewDate))・資料截至 \(PanshiDate.text(entry.dataAsOf))")
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            HStack {
                                Button(entry.reviewedAt == nil ? "標為已回看" : "改回待回看") {
                                    journal.toggleReviewed(id: entry.id)
                                }
                                .buttonStyle(.bordered)
                                Spacer()
                                Button("刪除", role: .destructive) {
                                    ReviewNotificationService.cancel(id: entry.id)
                                    journal.delete(id: entry.id)
                                }
                                .buttonStyle(.borderless)
                            }
                        }
                    }
                }
            }
        }
    }
}
