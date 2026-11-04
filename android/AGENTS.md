# AGENTS.md — Servix Android

You are reconstructing **Servix** (https://www.servix.name.ng) as a **native Android app** (Kotlin + Jetpack Compose,
Material 3). This repository is the Android project. It is *not* a generic marketplace template: every screen,
label, flow and rule must come from the real Servix product, whose complete frontend source is included here
for reference.

## Read first, in this order
1. `SPEC.md` — screens, API contract, brand, rules (the production API spec is live at
   `https://api.servix.name.ng/api/v1/docs/json`).
2. `reference/web/PROJECT_PROGRESS.md` — §2 brand guidelines, §11 feature inventory.
3. `reference/web/src/` — the real React frontend. Mirror its pages and copy:
   - `src/pages/HomePage.jsx`, `ProfessionalsPage.jsx`, `ProfessionalDetailPage.jsx`, `ServiceDetailPage.jsx`
     (booking sheet lives here), `pages/bookings/*`, `pages/dashboard/AiPage.jsx`, `pages/dashboard/*`
   - `src/components/cards/ProfessionalCard.jsx`, `components/ai/*`, `components/ui/*`
   - `src/lib/api.js`, `authApi.js`, `bookingApi.js`, `aiApi.js` — exact request/response usage
   - `src/styles/tokens.css` — colours, radii, spacing
4. `reference/api-docs/*.md` and `reference/api-routes/*.ts` — backend behaviour and validation (read-only).

## What "reconstruct" means
- Same information architecture and wording as the web app, adapted to Android conventions (bottom navigation,
  bottom sheets, Material 3 components) — not a WebView and not a pixel copy of desktop layouts.
- Reuse the web app's user-facing strings verbatim (hero copy, booking sheet copy, AI disclaimer, empty states,
  error messages). Put them in `res/values/strings.xml`.
- Same business rules: price locked at booking, payment held until the customer confirms, 10 % platform fee is a
  backend concern (never computed client-side), booking statuses rendered as the API returns them, actions only
  when the API permits.
- Same brand: palette in `ui/theme/Color.kt`, radii 3/6/10 dp, no gradients, Inter font (bundle it under
  `res/font/` and update `Type.kt`).

## Hard rules
- **Backend = the live Servix API only.** `BuildConfig.API_BASE_URL` = `https://api.servix.name.ng/api/v1/`.
  Do not add Firebase/Firestore, do not mock data in release builds, do not invent endpoints or fields.
- **No secrets in the repo or APK.** The API requires none from a client.
- **Customer app in v1.** Professional and admin workspaces remain on the website; link to them.
- **Disabled features stay out:** Community, Messages, Network.
- **Never claim an unfinished feature works.** If an endpoint is missing or returns an error, surface the server's
  message; do not fake success.
- `reference/` is read-only context. Never edit it, never ship it inside the APK (it is outside `app/`).
- Keep the single-activity, single-module structure (`:app`).

## Build & verify
- Project: AGP 8.7, Kotlin 2.0, Compose BOM 2024.12, minSdk 26, targetSdk 35 (see `app/build.gradle.kts`).
- There is no Gradle wrapper committed; use the environment's Gradle or add the wrapper if your runtime needs it.
- After each stage: build, run in the emulator against the live API, sign in with a test account created in
  the app, and fix mismatches against the OpenAPI spec before moving on.

## Delivery order
1. Theme + Navigation graph + auth (register, login, OTP, refresh, logout) — wired to the real API.
2. Catalogue: Home, Search/filters, Professional profile, Service detail.
3. Booking sheet → Paystack checkout in a Chrome Custom Tab → booking detail with actions.
4. Servix AI chat with SSE streaming, Copy, Helpful? feedback, usage limits.
5. Account: overview, saved professionals, payments, notifications, plan (read-only), sign out.
6. Polish: loading skeletons, error/empty states, offline banner, accessibility, release config.
