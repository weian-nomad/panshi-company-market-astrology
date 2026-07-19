import SwiftUI

struct NatalInstrumentView: View {
    let anchor: AnchorData

    var body: some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(anchor.label)
                            .panshiSectionTitle()
                        Text("\(PanshiDate.text(anchor.date))・\(anchor.precisionLabel)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(anchor.confidence)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(PanshiTheme.brass)
                }

                GeometryReader { proxy in
                    let size = min(proxy.size.width, proxy.size.height)
                    let center = CGPoint(x: proxy.size.width / 2, y: proxy.size.height / 2)
                    ZStack {
                        Circle().stroke(PanshiTheme.brass.opacity(0.42), lineWidth: 1)
                        Circle()
                            .stroke(PanshiTheme.brass.opacity(0.15), lineWidth: 1)
                            .padding(size * 0.16)
                        ForEach(0..<12, id: \.self) { index in
                            Rectangle()
                                .fill(PanshiTheme.brass.opacity(0.2))
                                .frame(width: 1, height: size * 0.48)
                                .offset(y: -size * 0.24)
                                .rotationEffect(.degrees(Double(index) * 30))
                        }
                        ForEach(anchor.natal) { planet in
                            Text(planet.glyph)
                                .font(.system(size: 18, weight: .semibold, design: .serif))
                                .foregroundStyle(planet.retrograde ? PanshiTheme.vermilion : PanshiTheme.paper)
                                .position(point(for: planet.longitude, radius: size * 0.34, center: center))
                                .accessibilityLabel("\(planet.bodyZh)，\(planet.signZh) \(planet.degree.formatted(.number.precision(.fractionLength(1)))) 度")
                        }
                        VStack(spacing: 2) {
                            Text("NATAL")
                                .font(.caption2.weight(.bold))
                                .tracking(2)
                                .foregroundStyle(PanshiTheme.brass)
                            Text("本命基準")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(width: size, height: size)
                    .position(x: center.x, y: center.y)
                }
                .frame(height: 260)

                Text(anchor.timeLabel)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func point(for longitude: Double, radius: Double, center: CGPoint) -> CGPoint {
        let radians = (180 - longitude) * .pi / 180
        return CGPoint(
            x: center.x + radius * cos(radians),
            y: center.y - radius * sin(radians)
        )
    }
}
