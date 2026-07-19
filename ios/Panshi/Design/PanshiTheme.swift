import SwiftUI

enum PanshiTheme {
    static let midnight = Color(red: 0.025, green: 0.055, blue: 0.08)
    static let ink = Color(red: 0.045, green: 0.075, blue: 0.10)
    static let brass = Color(red: 0.79, green: 0.63, blue: 0.35)
    static let paper = Color(red: 0.95, green: 0.91, blue: 0.82)
    static let blue = Color(red: 0.32, green: 0.61, blue: 0.88)
    static let vermilion = Color(red: 0.72, green: 0.19, blue: 0.13)
    static let positive = Color(red: 0.91, green: 0.34, blue: 0.29)
    static let negative = Color(red: 0.24, green: 0.70, blue: 0.55)

    static func movement(_ value: Double) -> Color {
        if value > 0 { return positive }
        if value < 0 { return negative }
        return .secondary
    }
}

enum PanshiFont {
    private static let displayName = "ChironSungHKVF-ExtraLight"

    static func display(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom(displayName, size: size, relativeTo: .title).weight(weight)
    }
}

struct PanshiBackdrop: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [PanshiTheme.midnight, PanshiTheme.ink, .black],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            GeometryReader { proxy in
                let size = min(proxy.size.width, proxy.size.height)
                ZStack {
                    Circle()
                        .stroke(PanshiTheme.brass.opacity(0.12), lineWidth: 1)
                        .frame(width: size * 0.9, height: size * 0.9)
                    Circle()
                        .stroke(PanshiTheme.brass.opacity(0.08), lineWidth: 1)
                        .frame(width: size * 0.62, height: size * 0.62)
                    ForEach(0..<6, id: \.self) { index in
                        Capsule()
                            .fill(PanshiTheme.brass.opacity(0.05))
                            .frame(width: size * 0.95, height: 1)
                            .rotationEffect(.degrees(Double(index) * 30))
                    }
                }
                .position(x: proxy.size.width * 0.78, y: proxy.size.height * 0.08)
                .accessibilityHidden(true)
            }
        }
        .ignoresSafeArea()
    }
}

struct PanshiCard<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .stroke(PanshiTheme.brass.opacity(0.2), lineWidth: 0.8)
                    )
            )
    }
}

extension View {
    func panshiSectionTitle() -> some View {
        self
            .font(PanshiFont.display(24, weight: .semibold))
            .foregroundStyle(PanshiTheme.paper)
    }
}
