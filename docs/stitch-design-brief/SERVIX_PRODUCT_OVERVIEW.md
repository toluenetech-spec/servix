# Servix — Product Overview (as implemented in the Android app)

Source basis: `toluenetech-spec/servix-android@61a1c83` (Play build 1.0.0 / versionCode 100),
`docs/play/LISTING.md`, `docs/ANDROID_DESIGN_PLAN.md`, `app/src/main/res/values/strings.xml`.

## 1. What Servix is

Servix is a Nigerian marketplace for professional services. Customers discover verified
professionals, compare their services with upfront pricing, book a time slot, pay through Servix
(Paystack), and release the payment only after confirming the work is done. The store listing's own
one-liner is: **"Professional services, simplified — discover, compare and book."**
(`docs/play/LISTING.md` §2). The in-app tagline is "Services, delivered professionally."
(`strings.xml` → `tagline`).

The Android app is a **client of the live production API** (`https://api.servix.name.ng/api/v1/`,
`app/build.gradle.kts:19`) and never talks to a local or mock backend. Web links go to
`https://www.servix.name.ng` (`app/build.gradle.kts:20`).

## 2. Who the app is for

| Audience | In the app today | Evidence |
| --- | --- | --- |
| **Guest** (not signed in) | Browse Home, Explore, professional profiles, service details; must sign in to book, save, see bookings, use AI | `ui/navigation/ServixAppShell.kt` — same five tabs for guests; sign-in cards on Home/Bookings/AI/Account |
| **Customer** (signed in) | Full booking lifecycle, payments via Paystack Custom Tab, reviews, saved professionals, notifications, Servix AI, profile name/photo, plan & security *read-only* | Stage 1–3 screens; `ui/account/AccountHubScreen.kt` |
| **Professional** | Treated like a customer. The role appears only as a badge on the Account header (`AccountHubScreen.kt:212`). No pro tools exist in the app; the web "/pro" workspace is where they work | `ui/components/ServixComponents.kt:377-416` (`ProfessionalToolsWebCard`, only used from unreachable `Stage1AccountTab`) |
| **Admin** | Same as professional: badge only; "/admin" lives on the web | same |

See `USER_ROLES_AND_PERMISSIONS.md`.

## 3. Core value proposition surfaced in the UI

1. **Locked price + protected payment.** Repeated copy: "The price is locked when you book. Payment
   is held securely and only released after you confirm completion." (`escrow_copy`,
   `booking_sheet_held_copy`, `modal_confirm_body`).
2. **Verified professionals.** `verified_badge = Verified`; trust strip on profiles
   (`ProfessionalProfileScreen.kt` → `TrustTabSection`).
3. **Servix AI.** An assistant that "looks things up in real Servix data before I answer" and a
   budget guide clamped to real Servix prices (`ui/ai/AiScreen.kt`).
4. **Nigeria-first.** Naira formatting (`util/ServixFormatters.kt`), `Africa/Lagos` grouping in
   bookings (`ui/bookings/BookingsScreen.kt`), Nigerian city picker
   (`location/NigerianCities.kt`), headline "Hire trusted Nigerian professionals."

## 4. Business rules visible in the app

| Rule | Where it is enforced / shown |
| --- | --- |
| Booking statuses: `pending_payment, requested, accepted, in_progress, delivered, completed, cancelled, declined, disputed, refunded` | `ui/bookings/BookingStatusMeta.kt`; status strings in `strings.xml` |
| Customer can cancel while `pending_payment / requested / accepted`; dispute while `in_progress / delivered`; confirm when `delivered`; review once when `completed`; re-book after `completed / cancelled / declined` | `BookingDetailScreen.kt:1186-1218` (`bookingActionsFor`) |
| Delivered bookings auto-complete after 3 days if not confirmed | `booking_delivered_notice_body` |
| Payment happens on Paystack in a Chrome Custom Tab; the app polls the booking every 2 s afterwards | `BookingDetailScreen.kt:200-250`, `util/CustomTabLauncher.kt` |
| Password policy: ≥ 8 chars, upper, lower, number, symbol, ≤ 200 | `ui/auth/AuthViewModel.kt:102-116` |
| Must accept Terms + acknowledge Privacy at registration; must be 18+ | `register_terms_note`, `RegisterScreen` |
| Email verification by 6-digit OTP (or link, server-decided) | `GET auth/verification-method`; `VerifyEmailScreen` |
| Production MFA "security check" after sign-in: email code → optional TOTP enrolment → recovery codes | `SecurityCheckScreen`; `auth/security/*` routes |
| AI: quota per plan; "never moves money or changes your bookings" | `ai_disclaimer`, `ai_quota_exceeded`; error codes `AI_QUOTA_EXCEEDED`, `PLAN_FEATURE` |
| Plan, security settings, password change, professional application, payments management — **website only** | Account panels: "Read-only in the app", "Manage on the website"; `register_pro_apply_prompt` |

## 5. What the app deliberately does *not* do (today)

Stated in code comments, strings and the Play listing (`docs/play/LISTING.md` §"Deliberately absent"):

- No professional/admin workspace (gig management, earnings, availability, team, analytics).
- No in-app chat/messages, connections ("Network"), job requests or proposals — these exist on
  the web platform behind feature flags (`⚪ Platform-only`, see `FEATURE_CATALOG.md`).
- No push notifications via FCM — the app polls `account/notifications/unread` every 15 minutes
  with WorkManager (`notifications/NotificationsWorker.kt:50`).
- No dark theme (`ui/theme/Theme.kt` — "v1 is light only").
- No plan upgrade or payment-method management in the app.

## 6. Release facts

| Item | Value | Source |
| --- | --- | --- |
| Package | `ng.name.servix.app` | `app/build.gradle.kts` |
| Version | 1.0.0 (100) on `main`; PR #4 bumps to 1.0.1 (101) | `app/build.gradle.kts:17-18`; PR #4 diff |
| minSdk / target / compile | 26 / 36 / 36 | `app/build.gradle.kts:10-16` |
| UI toolkit | Jetpack Compose + Material 3, light theme only | `ui/theme/*` |
| Distribution | Google Play internal testing (owner uploads .aab); GitHub Releases APKs with in-app self-update for the test channel | `updates/Updates.kt`, `docs/play/RELEASE_CHECKLIST.md` |
