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
                .task { await subscription.prepare() }
                .onOpenURL { url in
                    appState.handle(url: url)
                }
        }
    }
}
