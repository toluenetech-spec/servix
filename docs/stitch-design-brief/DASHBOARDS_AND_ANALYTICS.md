# Dashboards and Analytics

The Android app has exactly **one dashboard: the Home tab** (owner rule "Home must be the
dashboard"; `docs/ANDROID_DESIGN_PLAN.md` §1–2; `ui/home/HomeViewModel.kt` header comment). A
separate "Dashboard" tab was removed before 1.0.0 — its strings (`dashboard_*`, `nav_dashboard`)
remain in `strings.xml` but are unused.

## 1. Home dashboard — blocks, data and rules

| # | Block | Shown to | Data | Rule / derivation | Source |
| --- | --- | --- | --- | --- | --- |
| 1 | Greeting + (date **or** city) | all | `UserDto.firstName`, device clock, stored city | "Good morning" 0–11 h, "Good afternoon" 12–16 h, else "Good evening"; signed in → second line is the date; guest → "Welcome" + city (fallback "Nigeria"); initials avatar only | `HomeTabScreen.kt:259-327` |
| 2 | Bell with unread count | signed in | `GET account/notifications/unread` | refetched on every destination change | `ServixAppShell.kt:285-291` |
| 3 | Search field | all | — | opens Explore | `:119` |
| 4 | Sign-in card | guest | — | — | `:462` |
| 5 | **Needs your attention** | signed in | `GET bookings` | ≤3 cards: pending_payment → Pay now; delivered → Confirm; completed without review → Review | `HomeViewModel.kt:58-80` |
| 6 | **Your bookings** carousel | signed in | `GET bookings` | active statuses (`pending_payment, requested, accepted, in_progress`), sorted by `scheduledAt`, ≤3; `UpcomingBookingCard` shows service, pro, slot, status | `HomeViewModel.kt:51-56`; `HomeTabScreen.kt:329` |
| 7 | Browse by category | all | `GET categories` (cached) | first 8 chips | `:193` |
| 8 | Recommended for you | all | `GET professionals?sort=rating&page=1&pageSize=6` | first 4 rows; **not personalised** despite the label | `HomeUiState.recommended` (`HomeViewModel.kt:45`) |
| 9 | Servix AI card | all | — | CTA "Ask Servix AI" | `:381` |
| 10 | Plan line | signed in | `GET account/overview.plan`, `GET ai/usage` | "{Plan} plan · AI {used} / {allowed} words this month · Manage plan" | `:429` |

Loading: skeleton rows under "Recommended for you" until catalogue data arrives; refresh keeps
old data and sets `refreshing`. Error: `ErrorCard` with retry only when **both** categories and
professionals fail; account errors show inline (`HomeViewModel.kt:122-140`).

Renders: `screenshots/app-renders/03_home_signed_in.png` (no bookings),
`05_home_bookings.png` (with attention + carousel), `04_home_guest.png`, `05b_home_loading.png`,
`03c_home_fontscale130.png`; Play `play-listing/01_home.png`.

## 2. Analytics-type data the app fetches or models but does **not** display (🟠)

| Data | Endpoint / model | Where it is used | Not shown |
| --- | --- | --- | --- |
| `AccountOverviewDto.kind, emailVerified, canManageServices, needsChoice, applicationStatus, kycStatus` | `GET account/overview` | only `plan` → plan name | professional application / KYC state |
| `AccountInsightsDto.statusCounts, monthly[{month,spent,refunded}], upcoming[], pendingReviews, totalSpentNaira, totalRefundedNaira` | `GET account/insights` (`AccountRepository.kt:50`) | nothing on `main` | **12-month spend chart, status counts, "Spent" stat** (the old Dashboard strings `dashboard_stat_*` were for these) |
| `AccountPaymentsResponse.records[{reference, amount, status, createdAt, booking}]` | `GET account/payments` (`:72`) | `AccountPaymentsSheetContent` (unreachable) | payment history |
| `StatsDto.verifiedProfessionals, activeServices, serviceCategories, averageRating` | `GET stats` (`CatalogueRepository.kt:54`) | nothing on `main` (`home_stats_live_note` string unused) | platform stats strip |
| `TrustSummaryDto` metrics | `GET professionals/{slug}` | ✅ shown on profile About tab ("Trust & performance") | — |
| `AiUsage` / `AiMeter` (`enabled, used, reserved, allowed, remaining, percent, level, resetAt`) | `GET ai/usage` | usage line (words used/allowed) and `enabled` gate | percent/level/reset date |

## 3. Professional-side dashboards

None in the app. The web workspace provides `/dashboard`, `/dashboard/analytics`,
`/dashboard/earnings`, `/dashboard/work`, `/dashboard/reviews` etc. (`src/App.jsx` in the servix
repo). The in-app message for pros, "Your professional and admin workspaces live on the Servix
website…" (`pro_tools_on_web_body`), is only rendered by the unreachable `Stage1AccountTab`, so a
professional signing into the app today sees the **customer dashboard** with their own role badge.

🟡 PR #4's `ia_05_home_professional_after.png` is a **prototype** of a professional Home — a
proposal, not shipped and not yet signed off.

## 4. Admin dashboards

None in the app; `/admin` on the web only.
