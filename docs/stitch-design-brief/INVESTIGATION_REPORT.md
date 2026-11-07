# Investigation Report — Servix Android reverse engineering

Date: 2026-11-07. Prepared from a sandbox with read access to GitHub only (no device, no
emulator, no access to the production API or website).

## 1. Scope examined

| Source | Ref | What was read |
| --- | --- | --- |
| `toluenetech-spec/servix-android` | `main` @ `61a1c83` (Play 1.0.0 / vc 100) | all 76 Kotlin files under `app/src/main` and `app/src/test` (structure, composables, strings, routes, endpoints; large screens read via structured extraction), `AndroidManifest.xml`, `res/values/{strings,colors,themes}.xml`, `res/xml/*`, `res/drawable/*`, `app/build.gradle.kts`, `docs/ANDROID_DESIGN_PLAN.md`, `docs/play/LISTING.md`, `docs/play/RELEASE_CHECKLIST.md` (headers), 27 CI renders, 8 Play images |
| same repo, PR #4 | `arena/58792043-servix-android` @ `3e48a0e` | changed-file list, `docs/ia/IA_AUDIT.md`, 9 IA renders, `ui/navigation/ServixBottomBar.kt` (existence) |
| `toluenetech-spec/servix` (web + API) | `arena/01a0dc4c-servix` @ `63c1546` | `src/App.jsx` route list, `api/src/routes/{community,requests}.ts`, `api/docs/CHAT.md`, `api/src/lib/features.ts`, `docs/android/PROMPT_CHAT_RELEASE_1.1.md` — only to state which platform features the app lacks |
| Skipped | `.agents/skills/**`, `agent/skills/**`, `skills-lock.json`, `licenses/`, `docs/passes/`, `docs/release/`, `reference/api-docs/*` | third-party skill text, historical pass logs, licence files; not product behaviour |

Method: `gh repo clone --depth 1` of `main` into an ignored scratch folder; `grep`/`sed`
extraction of composables, string keys, routes, endpoints, enums and literals; direct reading of
navigation, ViewModel, repository, theme and model files; visual inspection of renders. PR #4
assets fetched with `gh api`. No application code or configuration was changed; nothing was
committed or pushed.

## 2. Deliverables produced (all uncommitted, in `docs/stitch-design-brief/`)

14 required documents + `DESIGN.md` + `screenshots/` (44 PNG + `SCREENSHOT_INDEX.md`) + this
report = 17 markdown files. Mermaid diagrams: architecture layers, auth state machine, Home data
sequence, navigation graph, journeys J1/J2/J4/J6, booking lifecycle, class diagram.

## 3. Summary of findings

### Shape of the app
- 16 full screens, 7 Account panels, 9 sheets/dialogs, 5 bottom tabs; type-safe Compose
  navigation; one hand-rolled DI container; Retrofit + OkHttp + kotlinx-serialization; light theme
  only; Inter; brand tokens applied consistently.
- 63 routes declared in `ServixApiService` (59 reached from screens; `me/entitlements`, `stats`, `account/insights`, `account/payments` are not), all under the production API; Paystack and web hand-offs in Chrome
  Custom Tabs; provider sign-in via native ticket exchange; MFA security flow fully in-app.
- Quality tooling: 14 test files / 67 tests, CI screenshot harness incl. font-scale 1.3,
  touch-target test, release smoke test.

### Gaps and partials (must not be presented as working)
1. **Role-blind UI.** `role` is only a badge; professionals/admins get the customer experience
   with no pointer to their web tools (the pointer card is on an unreachable screen).
2. **Dead code reachable by nothing:** `Stage1AccountTab`, `ProfessionalToolsWebCard`,
   `AccountPaymentsSheetContent`, `AccountSecuritySheetContent`, older `SearchScreen`.
3. **Fetched but not shown:** `account/insights`, `account/payments`, `stats`, most of
   `account/overview`.
4. **Feature flags never read** (`GET /features`).
5. **Platform features absent:** chats, connections, job requests/proposals, compare, plan
   checkout, password/MFA management, professional and admin workspaces, FCM push.
6. **Copy debts:** "escrow" wording (against the owner's rule), website-residue phrasing, many
   inline literals, unused landing/dashboard strings, Muted Gray hex mismatch.
7. **In flight on PR #4 (unmerged):** 1.0.1 photo-upload fix, new centre-Chats bottom bar, role-aware
   Home/Account prototypes, Stage 0 IA audit.

### What is solid and should be preserved by any redesign
Welcome → auth → security → Home flow; the needs-attention/upcoming-bookings dashboard logic; the
booking state machine and single-primary-action bar; the streaming AI assistant with feedback and
budget guide; the empty/loading/error/offline patterns; the device panel and self-update.

## 4. Limitations and uncertainties

- **No runtime verification.** Behaviour is inferred from code; live API responses were not
  observed from this sandbox. Where a field list is inferred from usage (e.g. `ServiceDetailDto`,
  `BookingDto`), the reference says so.
- **No new screenshots.** Several states have no image (Register, Verify email, Forgot password,
  sheets/modals, Budget guide, most Account panels, offline banner). They are fully specified in
  text instead.
- **Line numbers** are accurate for `61a1c83`; PR #4 moves some of them.
- **Platform flag values in production** (`requests`) were not confirmed from here; `community` and
  `ai` are known live-true from the web app's behaviour.

## 5. Recommended next steps (process, not design)

1. Owner reviews this folder; on approval it can be committed to the servix repo (or copied into
   the Android repo by its agent). Nothing has been committed.
2. Hand `DESIGN.md` (which links the rest) to Google Stitch together with the `screenshots/` folder.
3. When PR #4 merges and Release 1.1 stages land, refresh `SCREEN_INVENTORY.md`,
   `NAVIGATION_MAP.md` and the in-flight sections; regenerate renders from the CI harness so the
   redesign is compared against real frames rather than prototypes.

## 6. Independent quality audit (2026-11-07, before any commit)

Re-verified every document against a fresh clone of `servix-android@61a1c83`; parsed all 12
Mermaid blocks with Mermaid 11 (`mermaid.parse`, 12/12 valid); re-ran a secret scan (no tokens,
keys, keystores, passwords or private env values present — only public hostnames and the public
GitHub repo path appear).

Corrections applied during the audit:

| # | Was | Now (evidence) |
| --- | --- | --- |
| A1 | Home top bar "date + city" and "avatar image or initials" | signed-in → date; guest → city; initials-only avatar on `main` (`HomeTabScreen.kt:259-327`) |
| A2 | Bookings "Past" included `disputed` | `disputed` is **Active**; Past = completed/cancelled/declined/refunded (`BookingStatusMeta.kt:17-31`) |
| A3 | Profile Save icon "heart" | bookmark icon (`ProfessionalProfileScreen.kt:625`) |
| A4 | `GET me/entitlements` listed as used by Account/AI | declared in `ServixApiService` but **never called**; AI gating uses `ai/usage.enabled` (`AiScreen.kt:130`) |
| A5 | AI stream route `POST ai/assistant` | `POST ai/assistant/stream` (raw OkHttp SSE) with fallback to `ai/assistant` (`AiRepository.kt:32-60`) |
| A6 | "~45 endpoints" | 63 declared, 59 reached from screens (`stats`, `account/insights`, `account/payments`, `me/entitlements` not) |
| A7 | 68 tests | 67 `@Test` methods in 12 test classes (+2 helper files) |
| A8 | Payment polling "bounded by maxAttempts" | every 2 s for up to 90 s (`BookingDetailScreen.kt:199-206`) |
| A9 | Self-update "once per interval" | throttled to once per 6 h unless forced (`Updates.kt:87`) |
| A10 | Several line references drifted (HomeViewModel, AuthViewModel password rules, Color.kt MutedGray, shell `pendingPostAuthRoute`/unread fetch) | corrected to `61a1c83` line numbers |
| A11 | Requirements R4/R7/R13 cited "Stage 0 decision" generically | restricted to items written in `PROMPT_CHAT_RELEASE_1.1.md` (cited by line); three owner decisions that exist only in chat (guest bar composition, Payments as an Account row, professional-Home block list) were **removed from the brief** at the owner's instruction pending written sign-off |
| A12 | `DESIGN.md` lacked an explicit existing-vs-proposed instruction and a five-category status section | added §0 and §0.1 |
| A13 | Account "Notifications" row detail | shows "{n} unread" when there are unread items (`AccountHubScreen.kt:142-147`) |

Items checked and found accurate (sample): five-tab bar and selection rules; auth routing to
SecurityCheck; `Stage1AccountTab` has no caller; `ProfessionalToolsWebCard` only on that screen;
payments/security sheets have no caller; needs-attention rules; Explore filter/sort tables;
service-detail section order; booking action gates and modal copy; notification deep-link regex
(`/bookings/([^/?#]+)`); WorkManager 15-min period; `EncryptedSharedPreferences` token store;
Muted Gray hex mismatch; "escrow" occurrences (`strings.xml:75, 98`, `BookingDetailScreen.kt:1163, 1165`).

Location of this package at audit time: repository `toluenetech-spec/servix`, branch
`arena/01a0dc4c-servix` (HEAD `63c1546`), path `docs/stitch-design-brief/`, **untracked and
uncommitted**. It is not in the Android repository.
