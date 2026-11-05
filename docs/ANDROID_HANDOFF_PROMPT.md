# Servix Android — handoff prompt for a new Arena agent session

> Open the new Arena chat **on the repository `toluenetech-spec/servix-android`** (not `servix`), so the agent
> can push to it. Then paste everything below the line.

---

You are continuing the **Servix Android app** (customer app for https://www.servix.name.ng — a Nigerian
marketplace for verified professionals). The app is a **client of the live API only** at
`https://api.servix.name.ng/api/v1/`. You never rewrite the backend, never touch the production web repo
`toluenetech-spec/servix`, never add secrets, and never present mocks as verification.

## 0. Setup — install these skills first (from https://skills.sh)

Run each line from the repo root (`-y` skips prompts). If one repo name has changed, run
`npx skills find "<name>"` and install the top result with the same name — do not skip silently.

```bash
npx skills add emilkowalski/skills -y                                  # Emil Kowalski design skills (emil-design-eng, mobile-native, animations)
npx skills add pbakaus/impeccable -y                                   # Impeccable design skills
npx skills add nextlevelbuilder/ui-ux-pro-max-skill -y                 # UI UX Pro Max
npx skills add anthropics/skills --skill frontend-design -y            # Anthropic Frontend Design
npx skills add designed-by-ai/skills -y                                # Visual app design (design-mobile-apps)
npx skills add skydoves/android-testing-skills -y                      # Android Testing skills (Compose/Robolectric/adb)
npx skills add obra/superpowers -y                                     # Superpowers (brainstorming, planning, TDD, debugging, verification)
npx skills add vercel-labs/agent-skills -y                             # Vercel agent skills
npx skills add anhvt52/jetpack-compose-skills -y                       # Modern Jetpack Compose (Material 3, UDF)
```

Use them like this: Superpowers for planning/verification discipline; Emil Kowalski + Impeccable + UI UX Pro
Max + Frontend Design + design-mobile-apps for the look and motion of every screen (always within the Servix
brand in §3 — no gradients, no colour changes); Android Testing for test structure; Jetpack Compose for
correct state handling. The design skills advise — the Servix brand and the website's wording decide.

Then read, in this order: `AGENTS.md`, `SPEC.md` (note: the backend source wins over SPEC.md whenever they
disagree — corrections are listed in §3), `reference/api-routes/*.ts` (real backend routes),
`reference/web/src/pages/*.jsx` (the website pages the app mirrors), `.github/workflows/android-apk.yml`.

## 1. How building works here (important)

- There is probably **no Android SDK / Gradle in your sandbox** and no access to Google's Maven. Try
  `gradle --version` / `sdkmanager` once; if absent, **do not keep trying to build locally**.
- The compiler is **GitHub Actions**: every push to `main` runs `.github/workflows/android-apk.yml`
  (JDK 17, Gradle 8.9, AGP 8.7.3, `assembleDebug`) and publishes a pre-release
  **"Servix test build N (vX.Y.Z)"** with the APK attached. Use it as your build loop:
  `git push origin main` → `gh run list --limit 1` → `gh run watch <id>` → on failure
  `gh run view <id> --log-failed`, fix, push again. Keep commits small so failures are easy to read.
- Bump `versionCode` (+1) and `versionName` on every push that should become a test build.
- Your sandbox may also be unable to reach `api.servix.name.ng`. If so, say so plainly; the owner tests on a
  real phone from the Releases page and reports back. Never claim a live check you could not run.
- `app/src/test/.../Stage*VerificationTest.kt` and `V031VerificationTest.kt` call the **live production API
  and create real accounts/bookings**. Do not run them in CI and do not add more of them; if you need a live
  check, make it a small, clearly named test the owner can run on purpose.
- The owner may still open this project in Google AI Studio (it is linked to this repo's `main`). After
  you push, AI Studio must "Pull" before it edits again; mention this in your reports.

## 2. Current state (where the previous session stopped)

Repo `main` = commit `6b0d3b2` = **v0.3.1 (versionCode 4)** = GitHub release **"Servix test build 2 (v0.3.1)"**.
Package `ng.name.servix.app`, single module, Kotlin + Jetpack Compose + Material 3, Retrofit/OkHttp +
kotlinx-serialization, Coil, EncryptedSharedPreferences token store, persistent cookie jar, DataStore.

Done and accepted (verified against the live API by the previous agent):
- **Stage 1 Auth**: Welcome screen → Create account (Terms checkbox required; Terms/Privacy open in a Custom
  Tab) / Sign in → full `SecurityCheckScreen` (email code → TOTP enrol or verify → recovery codes → finish)
  → Dashboard. Refresh on launch via `servix_refresh` cookie; single-flight refresh; logout.
- **Stage 2 Catalogue**: Home (categories, `GET /stats`, top-rated), Search (debounced `q`, filter sheet,
  sort, pagination, empty state), Professional profile (tabs, trust panel, save/unsave, `POST /views`),
  Service detail (gallery, included/requirements, 14-day slots, FAQs, reviews). Guests can browse.
- **Stage 3 Bookings**: booking sheet (slot picker Africa/Lagos, notes, "Book & Pay ₦…", `Idempotency-Key`),
  `POST /bookings/:id/pay` → Paystack page in a Chrome Custom Tab, polling `GET /bookings/:id` 2 s / 90 s,
  Bookings Active/Past tabs, Booking detail with state-gated actions (Pay, Cancel, Dispute, Confirm, Review,
  Book again). **Untested on a device: completing a Paystack TEST payment and seeing status → `requested`.**
- **v0.3.1**: Dashboard tab mirroring `DashboardPage.jsx` (stats from `GET /bookings` + `GET /account/insights`,
  cards for bookings / Servix AI placeholder / security summary / payments, recent bookings).

Files: `ui/auth/AuthScreens.kt`, `ui/auth/AuthViewModel.kt`, `ui/dashboard/DashboardScreen.kt`,
`ui/catalogue/{HomeScreen,SearchScreen,ProfessionalProfileScreen,ServiceDetailScreen,CatalogueComponents}.kt`,
`ui/bookings/{BookingsScreen,BookingDetailScreen,BookingStatusMeta}.kt`, `ui/navigation/{ServixAppShell,ServixRoutes}.kt`,
`data/network/{ServixApiService,ServixNetworkModule,PersistentCookieJar,ApiErrorParser}.kt`,
`data/repository/{Auth,Catalogue,Booking,Account}Repository.kt`, `data/model/*.kt`, `data/local/{TokenStore,TermsAcceptanceStore}.kt`,
`di/AppContainer.kt`, `util/{ConnectivityObserver,CustomTabLauncher,ServixFormatters}.kt`.

Not yet built: **v0.3.2 (updates + device info — the task below, it was never delivered to the previous
agent)**, **Stage 4 Servix AI**, **Stage 5 Account (profile, saved, notifications, plan, security)**, then
Play internal testing. Out of scope for v1: Community, Messages, Network, professional/admin tools.

## 3. Backend facts (verified against the real source — trust these over SPEC.md)

- Base `https://api.servix.name.ng/api/v1/`. Errors `{ error: { code, message, status } }`; 422 = zod
  validation; 401 expired token → refresh once and retry; 403 `ORIGIN_REJECTED` means the headers below are missing.
- **Every request**: `X-Servix-Client: ng.name.servix.app` and **no `Origin` header**. Cookies must persist
  across launches (`servix_refresh`, `servix_security` on path `/api/v1/auth`). Authenticated routes:
  `Authorization: Bearer <accessToken>`.
- **Security flow** (production MFA is ON): `POST /auth/register {email,password,fullName}`, `POST /auth/login`,
  `POST /auth/forgot-password` → `{ security: { next, purpose, method, email, expiresAt } }`.
  `next` ∈ `email` → (`factor` if enrolled else `enroll`) → `recovery` → `finish`; reset purpose ends in
  `reset_password` (`POST /auth/security/reset-password {password ≥ 8}`). Endpoints under `/auth/security/`:
  `status`, `cancel`, `email/resend`, `email/verify {code 6 digits}`, `totp/setup → {secret, uri}`,
  `totp/enroll {code}`, `totp/verify {code}`, `recovery/codes → {recoveryCodes[8]}`, `recovery/verify {code}`,
  `finish {savedRecovery} → {user, accessToken}` + `servix_refresh` cookie. `POST /auth/refresh → {user, accessToken}`,
  `GET /me → {user}`, `POST /auth/logout → {ok:true}`. User = `{id,email,fullName,avatarUrl,role,status,kycStatus,emailVerified,createdAt}`.
- **Catalogue**: `GET /categories → [{id(slug),name,description,serviceCount,icon}]`; `GET /stats`;
  `GET /professionals?q&category&location&minRating&maxPrice&availability&available&sort&page&pageSize → {items,total,page,pageSize}`
  (sort ∈ recommended|rating|reviews|price-asc|price-desc; item `{id(slug),name,title,location,categoryId,rating,reviewCount,startingPrice,verified,…,image}`);
  `GET /professionals/:slug[/services|/reviews|/availability/summary]`; `GET /services/:slug[/reviews]`;
  `GET /services/:slug/availability?days≤30 → { slots: string[] }`. Reviews `{id,serviceId,professionalId,author,rating,date,text}`.
  Seeded images are root-relative (`/images/...`) on `https://www.servix.name.ng`; uploads are absolute.
- **Bookings** (Bearer): `POST /bookings {serviceId:<slug>, scheduledAt, notes?, rebookedFrom?}` (+ optional
  `Idempotency-Key`) → booking `{id,reference,status,scheduledAt,amount(naira),currency,serviceTitle,priceUnit,serviceId,professionalId,professionalName,customerName,notes,cancelledBy,cancelReason,disputeReason,deliveredAt,completedAt,autoConfirmed,hasReview,createdAt}`;
  `GET /bookings` (array), `GET /bookings/:id`, `POST /bookings/:id/pay → {authorizationUrl, reference}` (only
  `pending_payment`, else 409), `/cancel {reason?}`, `/confirm`, `/dispute {reason 10–2000}`, `/review {rating 1–5, text?}`,
  `GET /bookings/:id/rebook` (prefill). States: pending_payment, requested, accepted, in_progress, delivered,
  completed, cancelled, declined, disputed, refunded — server-controlled. Paystack is TEST (card 4084 0840 8408 4081,
  CVV 408, OTP 123456); after payment Paystack redirects to `https://www.servix.name.ng/bookings/<id>`.
- **Account**: `GET /account/overview → {kind,intent,applicationStatus,canManageServices,emailVerified,kycStatus,plan,needsChoice}`,
  `/account/insights → {statusCounts,monthly[{month,spent,refunded}],upcoming,pendingReviews}`,
  `/account/security-summary → {method,recoveryCodesRemaining,passkeys}`, `/account/payments → {mode,records[]}`,
  `/account/saved`, `POST /account/saved {profileSlug}`, `DELETE /account/saved/:slug`, `/account/notifications`,
  `/account/notifications/unread`, `POST /account/notifications/read {ids?|all}`, `PATCH /account/profile {fullName?,avatarUrl?}`.
  **New in API 0.9.4:** `GET /account/device → {ip, device, os, client, userAgent, seenAt}` (read-only, nothing stored).
- **Billing**: `GET /me/entitlements`, `GET /billing/plan`, `GET /plans` (bare array), `POST /billing/checkout|verify|downgrade`.
- **Servix AI** (Bearer, plan quotas): `POST /ai/assistant {messages}`; `POST /ai/assistant/stream` (SSE);
  `POST /ai/explain[/stream]`; `POST /ai/drafts`; `POST /ai/search/intent`; `POST /ai/pricing/guidance {categorySlug, brief?, deliveryDays?}`;
  `GET /ai/usage`; `POST /ai/feedback {rating:'up'|'down', comment?, prompt?, answer?}`. Errors 403
  `AI_QUOTA_EXCEEDED` / `PLAN_FEATURE`, 503 `AI_UNAVAILABLE`. Mirror `reference/web/src/pages/dashboard/AiPage.jsx` and `reference/web/src/lib/aiApi.js`.
- Brand: Deep Forest `#12372A`, Forest Green `#1F5C45`, Warm Ivory `#F7F4EC`, Soft Sand `#EDE8DC`, Coral `#E56B5D`,
  Charcoal `#202622`, Muted Gray `#68716B`; Inter; radius 3/6/10; no gradients.

## 4. Rules

- Backend code in `reference/api-routes/` is the source of truth; when SPEC.md disagrees, follow the code and
  log the correction in your report. Never invent fields or endpoints; cite `file:line` for every binding.
- Customer app only; website handles professionals/admin. Guests may browse; booking requires sign-in.
- No secrets in the repo, no third-party analytics/telemetry SDKs, no device identifiers (IMEI/Android ID),
  no background location, no READ_PHONE_STATE.
- Honest reporting: say exactly what was run and observed (status codes), what was not, and why. Stop after
  each task and wait for "go".
- Work on `main` only; commit in small steps; never force-push.

## 5. YOUR FIRST TASK — v0.3.2 (versionCode 5): in-app updates + device information

A. **In-app updates for test builds (GitHub Releases channel)**
- Add `BuildConfig.SELF_UPDATE_CHANNEL`: `"github"` in the debug build type, `"none"` in release. When
  `"none"`, none of this code runs (Play Store builds must never self-update — Play policy).
- On launch (max once per 6 h, cached in DataStore) GET
  `https://api.github.com/repos/toluenetech-spec/servix-android/releases/latest` (no auth,
  `Accept: application/vnd.github+json`). Parse `{tag_name, name, html_url, body, assets[]{name, browser_download_url, size}}`.
  Version = the `vX.Y.Z` inside `name`; compare semver with `BuildConfig.VERSION_NAME`; asset = first `.apk`.
- If newer: "Update available — Servix vX.Y.Z" card on Dashboard and Account + a one-time dialog per
  version. "Update" downloads with `DownloadManager` to `getExternalFilesDir(DIRECTORY_DOWNLOADS)`, shows
  progress, then opens it via `FileProvider` + `ACTION_VIEW` (`application/vnd.android.package-archive`,
  `FLAG_GRANT_READ_URI_PERMISSION`), prompting for "install unknown apps" (`REQUEST_INSTALL_PACKAGES`) when
  needed. Fallback "Open download page" → `html_url` in a Custom Tab. Account shows current version +
  "Check for updates". Network failures are silent (log only); never block the app.

B. **Device information (minimal, consented)**
1. Send on EVERY request, replacing OkHttp's default, exactly:
   `User-Agent: ServixAndroid/<versionName> (Android <Build.VERSION.RELEASE>; <Build.MANUFACTURER> <Build.MODEL>)`
   (API 0.9.4 turns this into "Servix app on Android (<maker> <model>)" in new-device sign-in alerts).
2. Bind a DTO to `GET /account/device` → `{ip, device, os, client, userAgent, seenAt}`.
3. Account → section **"This device"**: device name (`Settings.Global "device_name"` if readable, else
   `MANUFACTURER MODEL`), model, Android version, app version + build, network type (Wi-Fi / mobile / offline),
   local IP (from `NetworkInterface`, IPv4 preferred), public IP + device label from `GET /account/device`,
   approximate location (see 4). Include the sentence: "Servix uses your device name and address only to
   alert you about sign-ins from new devices."
4. Approximate location, **opt-in only**: a "Use my location" button in Search filters and in "This device".
   Request `ACCESS_COARSE_LOCATION` only, with the rationale "Servix uses your approximate location to show
   professionals near you. It stays on your phone." On grant: coarse fix → `Geocoder` → city; prefill the
   location filter (e.g. "Lagos"), show "Near <city>" on Home; store only the city name locally. Never send
   coordinates or city to any API; no background location; everything works if denied.
5. Manifest permissions: INTERNET, ACCESS_NETWORK_STATE, ACCESS_COARSE_LOCATION, REQUEST_INSTALL_PACKAGES only.

C. Bump `versionCode = 5`, `versionName = "0.3.2"`, push, make the Actions build green, confirm the release
"Servix test build 3 (v0.3.2)" exists, and report (files changed, what was verified and how). Then stop.

## 6. After that (wait for "go" between each)

- **Stage 4 — Servix AI tab**: chat with streaming (`/ai/assistant/stream`), Budget Guide
  (`/ai/pricing/guidance`), usage meter (`/ai/usage`), 👍/👎 feedback, quota/plan errors shown honestly.
- **Stage 5 — Account**: profile edit (name, avatar via existing upload route in `reference/api-routes/account.ts`),
  Saved professionals, Notifications (+ unread badge), Plan (read-only + "Manage on the website"), Security
  (summary, recovery codes remaining, sign out everywhere if the API has it — check, don't assume), delete-account link to the website.
- **Release prep**: app icon/splash from `public/brand`, Data Safety notes, Play internal testing via AI Studio Publish.
