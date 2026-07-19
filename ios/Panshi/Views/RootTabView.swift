import SwiftUI

struct RootTabView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var state = appState

        TabView(selection: $state.selectedTab) {
            NavigationStack {
                DailyResearchView()
            }
            .tag(AppTab.daily)
            .tabItem {
                Label("今日", systemImage: "sparkles.rectangle.stack")
            }

            NavigationStack {
                ExploreView()
            }
            .tag(AppTab.observe)
            .tabItem {
                Label("觀盤", systemImage: "scope")
            }

            NavigationStack {
                InquiryView()
            }
            .tag(AppTab.inquiry)
            .tabItem {
                Label("問盤", systemImage: "calendar.badge.clock")
            }

            NavigationStack {
                JournalView()
            }
            .tag(AppTab.journal)
            .tabItem {
                Label("觀察簿", systemImage: "bookmark.square")
            }

            NavigationStack {
                AboutView()
            }
            .tag(AppTab.about)
            .tabItem {
                Label("關於", systemImage: "info.circle")
            }
        }
        .toolbarBackground(PanshiTheme.midnight.opacity(0.96), for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .sheet(isPresented: $state.isShowingPaywall) {
            PaywallView()
        }
    }
}
