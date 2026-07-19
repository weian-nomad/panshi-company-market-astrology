import Charts
import SwiftUI

struct PriceChartView: View {
    let bars: [PriceBar]

    private var visibleBars: [PriceBar] {
        Array(bars.suffix(132))
    }

    var body: some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline) {
                    Text("近半年收盤")
                        .panshiSectionTitle()
                    Spacer()
                    Text("未還原")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(PanshiTheme.brass.opacity(0.13), in: Capsule())
                        .foregroundStyle(PanshiTheme.brass)
                }

                Chart(visibleBars) { bar in
                    if let date = bar.chartDate {
                        AreaMark(
                            x: .value("交易日", date),
                            y: .value("收盤價", bar.close)
                        )
                        .foregroundStyle(
                            LinearGradient(
                                colors: [PanshiTheme.blue.opacity(0.3), .clear],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        LineMark(
                            x: .value("交易日", date),
                            y: .value("收盤價", bar.close)
                        )
                        .foregroundStyle(PanshiTheme.blue)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    }
                }
                .frame(height: 190)
                .chartYAxis {
                    AxisMarks(position: .leading) { value in
                        AxisGridLine().foregroundStyle(.white.opacity(0.08))
                        AxisValueLabel {
                            if let price = value.as(Double.self) {
                                Text(PanshiFormat.price(price))
                            }
                        }
                        .foregroundStyle(.secondary)
                    }
                }
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 3)) { value in
                        AxisGridLine().foregroundStyle(.white.opacity(0.05))
                        AxisValueLabel(format: .dateTime.month().day())
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityLabel("近半年未還原收盤價折線圖")
            }
        }
    }
}
