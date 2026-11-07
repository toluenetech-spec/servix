# Feature Catalog

Status legend: ✅ Implemented · 🟠 Partial · 🟡 In flight (PR #4) · ⚪ Platform-only (web/API, not
in app) · ⛔ Not implemented. Evidence paths are relative to
`app/src/main/java/ng/name/servix/app/` unless otherwise stated. Screenshots live in
`screenshots/app-renders/` unless prefixed `play/` or `pr4/`.

## 1. Authentication & account security

| Feature | Status | Evidence | Screenshot |
| --- | --- | --- | --- |
| Welcome screen with Create account / Sign in / Browse first | ✅ | `ui/auth/AuthScreens.kt:215` | `01_welcome.png` |
| Email + password sign-in | ✅ | `AuthScreens.kt:356`; `POST auth/login` | `02_sign_in.png` |
| Registration with full name, confirm password, live 6-rule password checklist, Terms/Privacy checkbox, 18+ note | ✅ | `AuthScreens.kt:499-770`; `AuthViewModel.kt:102` | — |
| Google / GitHub sign-in via Custom Tab + native ticket exchange | ✅ | `AuthScreens.kt:100`; `GET auth/oauth/config`, `POST auth/oauth/native/exchange`; manifest `ng.name.servix.app://oauth/callback` | `01b_welcome_providers.png`, `02b_sign_in_providers.png` |
| Email verification: OTP (6 digits, paste, resend cooldown) or link mode | ✅ | `AuthScreens.kt:799-1110` | — |
| Security check (server-driven MFA): email code, TOTP enrolment with setup key, factor verify, recovery codes, finish | ✅ | `AuthScreens.kt:1159-1655`; `auth/security/*` | `18_security_check_step.png` |
| Password reset inside the security flow (new + confirm, policy-aware checklist) | ✅ | `AuthScreens.kt` `reset_password` stage | — |
| Forgot password (email link) | ✅ | `AuthScreens.kt:1661`; `POST auth/forgot-password` | — |
| Silent token refresh + session expiry handling | ✅ | `data/network/ServixNetworkModule.kt`; `di/AppContainer.kt:30-38` | — |
| Encrypted token storage | ✅ | `data/local/TokenStore.kt` (`EncryptedSharedPreferences`) | — |
| Sign out | ✅ | `AccountHubScreen.kt`; `POST auth/logout` | `15_account.png` |
| Change password / manage MFA / passkeys in-app | ⚪ | `SecurityPanel` → "Manage on the website" | `15_account.png` |
| Biometric unlock | ⛔ | no code | — |

## 2. Discovery (catalogue)

| Feature | Status | Evidence | Screenshot |
| --- | --- | --- | --- |
| Home dashboard: greeting, date, city, search, categories (8), recommended pros (4), AI card | ✅ | `ui/home/HomeTabScreen.kt` | `03_home_signed_in.png`, `04_home_guest.png` |
| Explore with Professionals/Services toggle, debounced search, infinite scroll, pull-to-refresh | ✅ | `ui/explore/ExploreScreen.kt`; `SearchViewModel` in `ui/catalogue/SearchScreen.kt` | `06_explore_results.png` |
| Filters: category, city, rating (4.5+/4.8+), price slider ≤₦500k, availability (6 options) | ✅ | `ExploreScreen.kt:227-340`; `SearchScreen.kt:106-146` | `06_explore_results.png` |
| Sort: recommended, rating, reviews, price asc/desc | ✅ | `SearchScreen.kt:98-104` | — |
| Professional profile: header, stats, About/Services/Portfolio/Reviews tabs, trust & performance, website link | ✅ | `ui/catalogue/ProfessionalProfileScreen.kt` | `08_professional_profile.png` |
| Service detail: image gallery pager, price/meta, included, needs, availability preview, reviews, FAQ accordion | ✅ | `ui/catalogue/ServiceDetailScreen.kt` | `09_service_detail.png` |
| In-app video / PDF playback in gallery | 🟠 | shown as links to the website / "Download document (PDF)" (`ServiceDetailScreen.kt:480-560`) | — |
| Save / unsave professionals; Saved list in Account | ✅ | `account/saved` routes; `SavedPanel` | — |
| View counting | ✅ | `POST views` (`CatalogueRepository.kt:189`) | — |
| Compare professionals | ⚪ | web `/compare` only | — |
| City from device location (coarse) → nearest Nigerian city | ✅ | `location/LocationButton.kt`, `location/NigerianCities.kt` | — |

## 3. Bookings & payments

| Feature | Status | Evidence | Screenshot |
| --- | --- | --- | --- |
| Booking sheet: slot picker (14 days), notes, Book & Pay, idempotency key | ✅ | `ServiceDetailScreen.kt:980-1240`; `BookingRepository.kt:34` | — |
| Guest → auth → return to sheet | ✅ | `ServixAppShell.kt:212-234, 837-858` | — |
| Paystack checkout in Chrome Custom Tab | ✅ | `POST bookings/{id}/pay` → `authorizationUrl`; `util/CustomTabLauncher.kt` | — |
| Post-payment polling (2 s) with success/still-confirming banners | ✅ | `BookingDetailScreen.kt:200-300` | `11_booking_pending_payment.png` |
| Bookings list: Active (incl. disputed) / Past, grouped Today/This week/Later | ✅ | `ui/bookings/BookingsScreen.kt` | `10_bookings_grouped.png` |
| Booking detail with status chip, next-step sentence, notices | ✅ | `BookingDetailScreen.kt:510-1160` | `12_booking_requested.png`, `13_booking_completed.png` |
| Cancel (reason optional), Confirm completion, Dispute (reason required), Review (stars + text), Book again | ✅ | `BookingDetailScreen.kt:1263-1600` | — |
| Needs-attention cards on Home | ✅ | `HomeViewModel.kt:58-80` | `05_home_bookings.png` |
| Payment history list | 🟠 | data `AccountRepository.kt:72` + `AccountPaymentsSheetContent` (`AccountSheets.kt:157`) exist, **no entry point** | — |
| Spend insights (monthly, totals) | 🟠 | `GET account/insights` fetched by repo; not rendered | — |
| Receipts / refunds management, plan checkout | ⚪ | web | — |

## 4. Servix AI

| Feature | Status | Evidence | Screenshot |
| --- | --- | --- | --- |
| Streaming assistant chat (SSE `ai/assistant/stream`, fallback `ai/assistant`), stop, suggestions, light markdown | ✅ | `ui/ai/AiScreen.kt:206-340`; `AiRepository.kt:32-60`; `data/network/AiStream.kt` | `14_ai_chat.png`, `14b_ai_empty.png` |
| Copy answer; Helpful / Not helpful feedback with comment | ✅ | `AiScreen.kt:373-418`; `POST ai/feedback` | — |
| Budget guide (category, days, brief → price range) | ✅ | `AiScreen.kt:431-503`; `POST ai/pricing/guidance` | — |
| Usage meter per plan | ✅ | `GET ai/usage`; `AiTopBar`, Home `PlanLine` | `03_home_signed_in.png` |
| Entitlement / quota gating with website hand-off | ✅ | `ai/usage.enabled == false` → "not enabled" (`AiScreen.kt:130`); `AI_QUOTA_EXCEEDED`, `PLAN_FEATURE` handling | — |
| Conversation persistence across sessions | ⛔ | turns kept in memory only (`AiViewModel`, last 20) | — |
| AI inside chat threads ("Servix AI in Messages") | ⚪ | web `MessagesPage.jsx` only | — |

## 5. Notifications

| Feature | Status | Evidence | Screenshot |
| --- | --- | --- | --- |
| Notification centre, unread styling, mark all read, tap-through to booking | ✅ | `ui/notifications/*` | `16_notifications.png` |
| Bell + unread badge on Home | ✅ | `HomeTopBar` | `03_home_signed_in.png` |
| Background polling every 15 min + local notifications + deep links | ✅ | `notifications/NotificationsWorker.kt`, `ServixNotifier.kt` | — |
| Android 13 permission rationale dialog | ✅ | `ServixAppShell.kt:348-366` | — |
| Push (FCM) | ⛔ | deferred; no Firebase dependency in `app/build.gradle.kts` | — |

## 6. Account & device

| Feature | Status | Evidence | Screenshot |
| --- | --- | --- | --- |
| Account hub with grouped rows and in-place panels | ✅ | `AccountHubScreen.kt:77-197` | `15_account.png` |
| Edit display name | ✅ | `ProfilePanel`; `PATCH account/profile` | — |
| Change profile photo (≤5 MB JPEG/PNG/WebP) | ✅ (bug-fixed in 🟡 PR #4 1.0.1) | `AccountRepository.uploadAvatar`; `POST uploads?kind=avatar` | — |
| Plan card (read-only) | ✅ | `PlanPanel`, `GET billing/plan` | `17_plan.png` |
| Security summary (method, recovery codes left, passkeys) | ✅ | `SecurityPanel`, `GET account/security-summary` | — |
| This device: name, model, OS, app version, network, local/public IP, server-seen device, approximate location | ✅ | `ui/account/DeviceCard.kt`; `GET account/device` | — |
| In-app self-update from GitHub Releases (test builds; check throttled to once per 6 h unless forced) | ✅ | `updates/Updates.kt:87` | — |
| Legal links + version line | ✅ | `AccountLegalCard` | — |
| Delete account in-app | ⛔ | website/email only (`docs/play/LISTING.md` §6) | — |
| Offline banner | ✅ | `ServixComponents.kt:342` | — |

## 7. Professional / admin tooling

| Feature | Status | Evidence |
| --- | --- | --- |
| Role badge on Account | ✅ | `AccountHubScreen.kt:212` |
| Any professional workflow (accept/decline/deliver jobs, gigs, availability, earnings, team, analytics, KYC) | ⚪ | web `/dashboard/*`, `/pro`; app card text "Professional tools are on www.servix.name.ng" (`strings.xml`, only on dead screen) |
| Admin console | ⚪ | web `/admin` |
| Role-aware Home/Account | 🟡 | PR #4 prototypes `pr4/ia_04…ia_08` |

## 8. Community / marketplace (platform features absent from the app)

| Feature | Status | Platform evidence (servix repo) |
| --- | --- | --- |
| Chats (threads, realtime SSE, ticks, typing, presence, photos, documents, voice notes, replies, reactions, delete) | ⚪ (🟡 planned as Release 1.1 Stage 1–2) | `api/src/routes/community.ts`, `api/docs/CHAT.md`; web `src/pages/dashboard/MessagesPage.jsx` |
| Connections / Network | ⚪ (planned Stage 3) | `GET/POST community/connections` |
| Job requests + proposals | ⚪ (planned Stage 3; gated by `features.requests`) | `api/src/routes/requests.ts`; web `/dashboard/requests*`, `/dashboard/proposals*` |
| Feature flags `GET /features` | ⛔ in app (never called) | Stage 0 audit F1 |

## 9. Platform / quality features

| Feature | Status | Evidence |
| --- | --- | --- |
| Light theme only, Inter font, brand tokens | ✅ | `ui/theme/*` |
| Motion system (shared-axis push, press feedback, success haptic tick) | ✅ | `ui/motion/Motion.kt` |
| Font-scale 1.3 verified renders | ✅ | `*_fontscale130.png` |
| Touch-target test, release smoke test, stage verification tests | ✅ | `app/src/test/java/ng/name/servix/app/**` (14 files) |
| CI screenshot harness (Robolectric) | ✅ | `app/src/test/.../screenshots/*`, `docs/screenshots/` |
| Dark theme, tablet layout, RTL-specific layout, localisation beyond English | ⛔ | `Theme.kt` comment; single `values/` folder |
