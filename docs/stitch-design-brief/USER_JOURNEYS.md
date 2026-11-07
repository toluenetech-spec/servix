# User Journeys

All journeys below are implemented on `main` (`61a1c83`) unless marked. Screen IDs (S1…S16) refer
to `SCREEN_SPECIFICATIONS.md`.

## J1 · First run → account → dashboard

```mermaid
flowchart TD
  A[Launch] --> B{Token valid?}
  B -- yes --> H[S8 Home]
  B -- no --> W[S2 Welcome]
  W -->|Browse first| H
  W -->|Create account| R[S4 Register]
  W -->|Sign in| L[S3 Login]
  W -->|Continue with Google/GitHub| CT[Custom Tab → provider]
  CT -->|ng.name.servix.app://oauth/callback?ticket| X[POST auth/oauth/native/exchange]
  R -->|POST auth/register| D{Response}
  L -->|POST auth/login| D
  X --> D
  D -- security object --> S[S6 Security check]
  D -- user + token, email unverified --> V[S5 Verify email]
  D -- user + token --> H
  S -->|email code → enrol TOTP → recovery codes → finish| H
  V -->|6-digit code| H
```
Evidence: `ServixAppShell.kt:464-640`, `AuthViewModel.kt`, `AndroidManifest.xml` intent filters.

## J2 · Find a professional and book (customer)

```mermaid
flowchart TD
  H[S8 Home] -->|search field / category chip / See all| E[S9 Explore]
  H -->|Recommended row| P[S10 Professional profile]
  E -->|Professionals mode row| P
  E -->|Services mode card| SD[S11 Service detail]
  P -->|Services tab or Book → Choose a service| SD
  SD -->|Book this service| BS[Booking sheet]
  BS -->|guest| L[S3/S4 auth] --> BS
  BS -->|choose slot + notes → Book & Pay| C[POST bookings]
  C --> Pay[POST bookings/id/pay]
  Pay -->|authorizationUrl| PT[Paystack in Custom Tab]
  PT -->|user returns to app| BD[S13 Booking detail · pollingAfterPay]
  BD -->|GET bookings/id every 2 s, up to 90 s| ok{paid?}
  ok -- yes --> Req[Status: Requested · 'Payment received — request sent to pro']
  ok -- timeout --> Still['We're still confirming your payment' + Refresh]
```
Evidence: `ServiceDetailScreen.kt:980-1240`, `BookingDetailScreen.kt:200-300`,
`util/CustomTabLauncher.kt`.

## J3 · Booking lifecycle from the customer's seat

```mermaid
stateDiagram-v2
  [*] --> pending_payment : Book & Pay
  pending_payment --> requested : Paystack success
  pending_payment --> cancelled : Cancel Booking
  requested --> accepted : pro accepts (web)
  requested --> declined : pro declines (web)
  requested --> cancelled : Cancel Booking
  accepted --> in_progress : pro starts (web)
  accepted --> cancelled : Cancel Booking
  in_progress --> delivered : pro marks delivered (web)
  in_progress --> disputed : Report a problem
  delivered --> completed : Confirm work is done (or auto after 3 days)
  delivered --> disputed : Report a problem
  completed --> completed : Leave a review (once)
  disputed --> refunded : Servix team (web)
  completed --> [*]
  cancelled --> [*]
  declined --> [*]
  refunded --> [*]
```
App-side actions: `bookingActionsFor` (`BookingDetailScreen.kt:1186-1218`). Transitions marked
"(web)" happen on the professional's web workspace; the app only observes them.

## J4 · Needs-attention loop on Home

```mermaid
flowchart LR
  GB[GET bookings] --> F{status}
  F -- pending_payment --> A1['Payment due for X' · Pay now]
  F -- delivered --> A2['X was delivered' · Confirm]
  F -- completed & !hasReview --> A3['How was X?' · Review]
  A1 & A2 & A3 --> BD[S13 Booking detail → primary action]
```
Evidence: `HomeViewModel.kt:58-80`; max three cards.

## J5 · Re-book a past booking

S13 (completed / cancelled / declined) → **Book again** → `GET bookings/{id}/rebook` → Re-book
modal (professional, services with "was booked" marker, previous notes) → S11 with
`rebookedFrom`, `initialNotes`, `openBookingSheet=true` → sheet titled "Book again" → J2 from
"Book & Pay". Evidence: `BookingDetailScreen.kt:1557`, `ServixRoutes.kt` `ServiceDetail` params.

## J6 · Servix AI

```mermaid
flowchart TD
  T[Servix AI tab or Home 'Ask Servix AI'] --> G{signed in & entitled?}
  G -- guest --> SI[Sign in prompt]
  G -- not entitled --> NE['Servix AI helpers are not enabled on this account yet.']
  G -- yes --> AS[Assistant]
  AS -->|type or tap suggestion → Send| ST[POST ai/assistant/stream · SSE deltas]
  ST --> ANS[Answer bubble · Copy · Helpful · Not helpful]
  ANS -->|Not helpful| FB[Dialog 'What was wrong?' → POST ai/feedback]
  T --> BG[Budget guide tab]
  BG -->|category + days + brief → Get guidance| PG[POST ai/pricing/guidance]
  PG --> RES[summary · ₦low–₦high · basis · stats · tips]
  ST & PG -->|AI_QUOTA_EXCEEDED| Q[quota message · Manage plan on website]
```
Evidence: `AiScreen.kt`, `AiViewModel.kt`, `AiRepository.kt`.

## J7 · Notifications

Sign-in → `NotificationsWorker.schedule` (15 min) → `GET account/notifications/unread` → local
notification (channel "Bookings & account") → tap → `servix://booking/{id}` or
`servix://notifications` → `AppLinkBus` → S13 or S15. In-app: bell badge on Home → S15 → tap row
→ mark read → booking. Evidence: `notifications/*`, `ServixAppShell.kt:338-345, 989-1005`.

## J8 · Account maintenance

S16 → Profile (name, photo) · Saved (remove) · Plan (read) · Security (read) · This device
(device/IP/location) · Updates · Legal → **Sign out** (`POST auth/logout`, clears tokens, back to
Welcome). Anything else → "Manage account on the website" (Custom Tab).

## J9 · Password recovery

S3 → **Forgot password?** → S7 → `POST auth/forgot-password` → "Check your inbox" (link, 30 min).
If the API answers with a security flow the app enters S6 `reset_password` with the live password
checklist. Evidence: `ServixAppShell.kt:619-640`, `AuthScreens.kt:1661`.

## J10 · Self-update (test channel only)

Shell `rememberUpdateUiState()` → on resume, at most once per 6 hours unless forced (`Updates.kt:87`), `GET
api.github.com/repos/toluenetech-spec/servix-android/releases` → if a newer `v<semver>-b<n>` with an
`.apk` asset exists → `UpdateCard` "Update available — Servix v{x}" → **Update** → DownloadManager
→ `FileProvider` install ("Allow installs from Servix…") → installs over the old version.
Play builds have `SELF_UPDATE_CHANNEL = "none"`. Evidence: `updates/Updates.kt`,
`updates/UpdateUi.kt`, `app/build.gradle.kts:60-67`.

## Journeys that do **not** exist in the app (⚪ platform-only)

Professional accepting/declining/delivering a job; creating or editing gigs; availability
management; earnings/payouts; chat with a professional; posting a job request; sending proposals;
connections; plan upgrade/checkout; password/MFA management; admin moderation. All are web-only
(`USER_ROLES_AND_PERMISSIONS.md`, `FEATURE_CATALOG.md`).
