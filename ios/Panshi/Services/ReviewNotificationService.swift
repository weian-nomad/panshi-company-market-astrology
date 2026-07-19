import Foundation
import UserNotifications

enum ReviewNotificationService {
    static func schedule(for entry: JournalEntry) async throws -> Bool {
        let center = UNUserNotificationCenter.current()
        let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        guard granted, let date = PanshiDate.date(entry.reviewDate) else { return false }

        var components = Calendar(identifier: .gregorian).dateComponents(
            [.year, .month, .day],
            from: date
        )
        components.hour = 9
        components.minute = 0

        let content = UNMutableNotificationContent()
        content.title = "回看 \(entry.symbol) \(entry.shortName)"
        content.body = "當時的理由還站得住腳嗎？打開盤勢，對照新資料。"
        content.sound = .default
        content.userInfo = ["symbol": entry.symbol]

        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(
            identifier: "panshi-review-\(entry.id.uuidString)",
            content: content,
            trigger: trigger
        )
        try await center.add(request)
        return true
    }

    static func cancel(id: UUID) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(
            withIdentifiers: ["panshi-review-\(id.uuidString)"]
        )
    }
}
