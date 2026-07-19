import SwiftUI

struct BrandHeader: View {
    let eyebrow: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(eyebrow.uppercased())
                .font(.caption.weight(.semibold))
                .tracking(2.2)
                .foregroundStyle(PanshiTheme.brass)
            Text(title)
                .font(PanshiFont.display(38, weight: .semibold))
                .foregroundStyle(PanshiTheme.paper)
                .fixedSize(horizontal: false, vertical: true)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct BoundaryNote: View {
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "circle.lefthalf.filled")
                .foregroundStyle(PanshiTheme.brass)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PanshiTheme.paper)
                Text(text)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .background(PanshiTheme.brass.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
    }
}

struct MetricCell: View {
    let label: String
    let value: String
    var color: Color = PanshiTheme.paper

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(.title3, design: .rounded, weight: .semibold))
                .foregroundStyle(color)
                .contentTransition(.numericText())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct LoadingCard: View {
    let message: String

    var body: some View {
        PanshiCard {
            HStack(spacing: 13) {
                ProgressView()
                    .tint(PanshiTheme.brass)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct FailureCard: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        PanshiCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("資料還沒對齊", systemImage: "exclamationmark.triangle")
                    .font(.headline)
                    .foregroundStyle(PanshiTheme.paper)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("重新讀取", action: retry)
                    .buttonStyle(.borderedProminent)
                    .tint(PanshiTheme.brass)
                    .foregroundStyle(PanshiTheme.midnight)
            }
        }
    }
}
