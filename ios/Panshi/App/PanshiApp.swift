import SwiftUI

@main
struct PanshiApp: App {
    @State private var appState = AppState()
    @State private var journal = JournalStore()
    @State private var dailyResearch = DailyResearchStore()
    @State private var subscription = SubscriptionStore()
    @State private var ads = AdExperience()
    @State private var rewardUnlocks = RewardUnlockStore()

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(appState)
                .environment(journal)
                .environment(dailyResearch)
                .environment(subscription)
                .environment(ads)
                .environment(rewardUnlocks)
                .tint(PanshiTheme.brass)
                .preferredColorScheme(.dark)
                .task {
                    await subscription.prepare()
                    if let route = launchRoute {
                        appState.handle(url: route)
                    }
                }
                .onOpenURL { url in
                    appState.handle(url: url)
                }
        }
    }

    private var launchRoute: URL? {
        guard let marker = CommandLine.arguments.firstIndex(of: "--panshi-route"),
              CommandLine.arguments.indices.contains(marker + 1) else { return nil }
        return URL(string: CommandLine.arguments[marker + 1])
    }
}
