# App Store release packet

## Product

- Display name: `盤勢`
- Bundle ID: `com.nomadsustaintech.panshi`
- Subscription: `com.nomadsustaintech.panshi.pro.monthly`
- Primary category: Reference
- Secondary category: Finance, only if App Review accepts the cultural research positioning
- Locale: Traditional Chinese (`zh-Hant`)

## Monetization contract

- Core free experience remains usable indefinitely and contains ads.
- Eligible new subscribers receive a 7-day introductory trial.
- Pro opens complete historical dossiers and removes ads.
- Trial cancellation or subscription expiry falls back to free; it does not lock the app or delete the journal.

Apple introductory-offer setup must match the in-app wording exactly: [Set up introductory offers for auto-renewable subscriptions](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-introductory-offers-for-auto-renewable-subscriptions).

`StoreKit/Panshi.storekit` uses NT$190/month only as a local simulator fixture. App Store Connect remains the source of truth for the launch price; store screenshots must be regenerated if the approved launch price differs.

## Release gates

- [ ] Taiwan product-law review has approved the actual individual-company and Daily Five experience.
- [ ] Production ad provider IDs, privacy manifest additions, App Privacy answers, close/skip flow, and inappropriate-ad reporting are verified.
- [ ] Subscription group, monthly product, 7-day free trial, price, and localized terms are active in App Store Connect.
- [ ] Paid Applications agreement, tax, and banking status are active.
- [ ] Production API `/app/api/daily-research` returns the latest public five-item edition.
- [ ] Physical-device purchase, restore, expiry-to-free, no-fill ads, offline, and notification-denied paths pass.
- [ ] Screenshots and review notes reflect the submitted binary, not a mock entitlement.
