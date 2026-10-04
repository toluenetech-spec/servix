# Changelog

All notable changes to the Servix public website.

## 0.9.1 — 2026-10-04 (Sign-in alerts and iOS fixes)

### Added
- **New-device sign-in alerts**: when an account is signed in from a browser/operating system it has not used
  before (password, Google or security-check sign-in — never token refresh, never the very first session of a new
  account), the owner gets an in-app notification and an email "New sign-in to your Servix account from
  <device>" with device, Lagos time, network address and a *Secure my account* button (password reset, which signs
  every device out). Non-blocking, queued through the existing email jobs; `LOGIN_ALERTS=false` turns the email off.
  No migration.

### Fixed
- **Older iPhone/iPad Safari crash** ("Something went wrong on this page … Invalid regular expression: invalid
  group specifier name"): removed a regex lookbehind from AI markdown rendering and `Object.hasOwn` from page
  metadata so Safari < 16.4 can load every page again.

## 0.9.0 — 2026-10-03 (Subscriptions, entitlements and feature access)

### Added
- **Five plans for every account**: Free ₦0 · Go ₦5,000 · Pro ₦15,000 · Team ₦35,000 · Enterprise (custom,
  admin-assigned). Plans now live on the user (`users.plan_slug`), so customers, professionals and teams
  all have one. Legacy `professional`/`business` slugs become `pro`/`team` with data preserved.
- **Central entitlement catalogue + engine** (`api/src/lib/entitlements/`): typed features, limits and AI
  departments per plan; `canAccess / getLimit / canUseAI / assertWithinLimit / requireEntitlement`;
  per-plan operator overrides and Enterprise custom limits without a deploy. Plan errors carry `meta`
  (limit, plan, upgrade target, reset date) so the UI explains instead of guessing.
- **Existing features mapped to plans**: listings, portfolio, proposals (monthly + live), requests,
  saved professionals, analytics depth; new Go+ productivity: advanced request filters, saved searches,
  proposal labels/private notes, profile versions, CSV exports; Pro+: proposal pipeline, advanced
  analytics, profile badge, priority AI routing.
- **Servix AI usage metering**: monthly token allowances (20k / 100k / 300k / 1M pool / 3M default),
  atomic reservation so concurrent calls cannot overshoot, failures never billed, warnings at 75 % and
  90 %, hard stop at 100 % with calm upgrade copy; `GET /ai/usage`, live `ai.quota` on every answer;
  `ai_usage_events` (never prompts, answers or keys).
- **Team workspace** (Team/Enterprise): create team, e-mail invitations (`/join-team`), roles
  owner/admin/member, seats, shared view of requests/proposals, activity, pooled AI tokens with optional
  per-member caps, Enterprise audit log + CSV.
- **Admin console**: *Plans & organisations* (catalogue, overrides, organisations, grant any plan) and
  *AI usage* (totals, by plan/tool/model, errors, trends, top users/teams, recent events, filters).
- Web: `/dashboard/plan` redesigned (meters, 5-plan grid, comparison table, downgrade confirmation),
  `/dashboard/team`, `/join-team`, plan tags and upgrade notices across the AI hub, proposals and
  analytics; public pricing page and FAQs updated to the five plans.
- Migration `20261004000000_subscriptions_entitlements` + guarded Neon script
  `api/docs/manual-subscriptions-upgrade.sql`. Docs: `docs/SUBSCRIPTION_ENTITLEMENT_PLAN.md`,
  `api/docs/ENTITLEMENTS.md`.

### Changed
- Downgrades never delete data: items above the new limit stay; only new items are blocked, with an
  explanation and a path back.
- Seed upserts plans (no `deleteMany`) and marks unknown slugs inactive.
- Error envelope now forwards `meta` for plan/quota errors.
- Schema-gap safety: a newer API image on an older database no longer crashes at boot — `/healthz` stays
  up, `/readyz` reports `pendingMigration`, affected requests answer 503 `SCHEMA_PENDING`, and readiness
  recovers automatically once the manual migration has run (`api/src/lib/schemaCheck.ts`).

### Tests
- New: `api/tests/entitlements-local.test.ts` (13), `api/tests/manual-subscriptions-sql-local.test.ts` (2),
  `tests/browser/plans.spec.js` (8). Regression: API `tsc` clean, all local suites green, root 23/23,
  Playwright 100/100.

## 0.8.2 — 2026-10-03 (Servix AI: faster answers, proper formatting, brand mark, premium hub)

### Added
- **Streaming answers.** `POST /api/v1/ai/assistant/stream` and `POST /api/v1/ai/explain/stream` (server-sent
  events: `start` / `delta` / `done` / `error`). The assistant and “What does this mean?” now show words as they
  are written instead of waiting for the full reply; Stop/closing the panel aborts the provider call. Plain
  endpoints unchanged; the client falls back to them if a stream is unavailable.
- **Hedged fallback** (`AI_HEDGE_AFTER_MS`, default 6 s): a model that has produced nothing after the window gets
  the next chain model started in parallel; first usable answer wins, the rest are cancelled. `0` disables.
- `AI_EXTRA_BODY_JSON` for provider-specific request fields (e.g. switching a model's thinking mode off).
- `ThinkFilter`: reasoning scratchpads (`<think>…</think>`) never reach the stream, even split across chunks.
- Safe light-Markdown rendering for every AI text (bold, italics, inline code, bullet/numbered lists) as React
  elements — never HTML. Drafts inserted into forms or copied are converted to plain text first.
- Brand-matched **Servix AI mark** (the “S” of the wordmark + coral spark) with a slow idle halo, an orbiting
  “thinking” state, and a launcher that scales away as the panel springs in / eases out. All motion is disabled
  under `prefers-reduced-motion`.

### Changed
- `/dashboard/ai` redesigned: deep-forest hero with the mark, personal greeting, segmented tool switcher, main
  column + side rail (“What it can do”, “What it never does”, role-aware shortcuts).
- Assistant prompt asks for short answers first (≤120 words unless detail is requested) and simple formatting;
  assistant `maxTokens` 1200 → 700.
- Tests: `api/tests/ai-router.test.ts` 23 → 31, `api/tests/ai-local.test.ts` 12 → 13, root `aiHelpers` 6 → 9;
  Playwright `ai.spec.js` now exercises the SSE path and Markdown rendering.

## 0.8.1 — 2026-10-03 (Servix AI user interface — follows the `ai` flag)

### Added
- Frontend AI surfaces, all hidden unless `GET /api/v1/features` reports `ai: true`:
  - **Smart search** on `/professionals` (no account needed): a sentence becomes validated directory filters
    (real category slugs, naira cap, availability window) applied to the URL; chips show what was understood.
  - **Assistant** launcher on every workspace page + `/dashboard/ai` hub (tabs: Assistant, Opportunities,
    Profile coach, Pricing/Budget guide — professional tabs only for approved professionals).
  - **Request editor**: “Describe it in your own words” → structured draft → fills the form (nothing posted).
  - **Proposal page**: “Draft with Servix AI” → price/days/cover/milestones placed in the form (nothing sent).
  - **Gig editor** and **Profile → About**: “Draft with Servix AI” text drafts inserted only on “Use this text”.
  - **Booking page**: “What does this mean?” next to the status and a “Where does this project stand?” panel
    (status badge computed by the backend; only wording is AI-written).
  - Dashboard card and sidebar link “Servix AI”.
- `src/lib/aiApi.js` (abortable client, 75 s client cap), `src/lib/aiHelpers.js` (pure mappers + plain-language
  error copy that never exposes provider details), `src/components/ai/*`, `src/pages/dashboard/AiPage.jsx`.
- API: `/ai/opportunities/match` and `/ai/opportunities/radar` now attach real request facts (`request.title`,
  category, budget, deadline, proposal count — read from the database) to each item so the UI can link to them.
  Text answers strip any echoed internal “untrusted data” markers.

### Tests
- `tests/aiHelpers.test.js` (6 node tests) and `tests/browser/ai.spec.js` (6 Playwright journeys with a mocked
  API: flag-off hides everything, smart search → filters, brief → form, assistant + booking health/explain,
  professional hub + proposal draft, provider outage copy). Full browser suite 92/92.

## 0.8.0 — 2026-10-03 (Servix AI model routing layer — flag-gated, OFF)

### Added
- `api/src/ai/*` + `api/src/routes/ai.ts`: provider-agnostic AI routing layer. Eleven departments
  (assistant, search intent, job matching, opportunity radar, profile analysis/improvement, pricing
  guidance, project health, explanations, proposal generation, background drafting) mapped by
  configuration to model aliases (DeepSeek V4 Flash primary; MiniMax M2.7 for drafting; GLM 5.3 Flash
  fallback). Bounded retries, one repair round for invalid structured output, task deadline,
  controlled errors (`AI_UNAVAILABLE`, `AI_INVALID_OUTPUT`, `AI_TIMEOUT`).
- Strict schemas + normalisation of categories, dates, naira, enums and ids before anything reaches the
  app; drafts validated with the real `requestBody`/`proposalBody` schemas. No department writes.
- Read-only, allow-listed tools over real rows; payments/payouts/ledger/refunds/KYC/admin unreachable
  (statically enforced by tests). API key server-side only, scrubbed from errors, never logged.
- Internal telemetry (model, department, duration, success, fallback, tokens, error codes) at
  `GET /api/v1/admin/ai/status` and `/admin/ai/telemetry/recent`.
- Feature flag `AI_ENABLED` (shown in `GET /api/v1/features` as `ai`), env documented in `api/.env.example`;
  docs in `api/docs/AI_ROUTING.md`; evaluation report `docs/ai-eval/DAHL_EVALUATION_REPORT.md`.

### Changed
- `routes/professionals.ts` exports `buildWhere`/`buildOrderBy`; `routes/requests.ts` exports
  `requestBody`/`proposalBody` (reuse only — behaviour unchanged).

### Tests
- `api/tests/ai-router.test.ts` (23 unit tests) and `api/tests/ai-local.test.ts` (12 integration tests on an
  isolated PostgreSQL with a scripted provider). Existing suites unchanged and green.

## 0.7.0 — 2026-10-02 (Next-generation marketplace, block 1 — flag-gated)

### Added
- **Feature flags** (`api/src/lib/features.ts`, `GET /api/v1/features`):
  `REQUESTS_ENABLED, COMPARE_ENABLED, TRUST_ENABLED, ACHIEVEMENTS_ENABLED,
  PROJECTS_ENABLED, CRM_ENABLED, BUSINESS_ENABLED, PACKAGES_ENABLED,
  PRICING_INSIGHTS_ENABLED` (all default off). Gated routes answer
  `503 FEATURE_DISABLED`; the UI hides gated navigation/sections until the
  snapshot says otherwise.
- **Trust & Performance** (`api/src/lib/trust.ts`, docs `api/docs/TRUST.md`):
  delivery reliability (from a deadline snapshotted at payment capture —
  customer-caused delays never count against the professional), response rate
  on paid requests, repeat-customer rate, completed/verified jobs, time on
  Servix, Servix-verified + identity-verified facts. Every figure is computed
  from real bookings/events/reviews; below the minimum sample the API returns
  `null` and the UI shows "Not enough data". New "Trust & performance" tab on
  profiles; `GET /professionals/:slug/trust`; admin **Trust & achievements**
  tab with metric breakdown, badge history and audited recompute.
- **Achievements** (`api/src/lib/achievements.ts`, `api/docs/ACHIEVEMENTS.md`):
  central rules registry (10 rules), evaluated server-side after completions /
  on view / on admin recompute, stored with evidence, revocable, notified via
  the existing notification system, criteria shown to users
  (`GET /achievements/catalog`).
- **Verified Servix Projects**: professionals turn their own *completed*
  bookings into portfolio items (`POST /pro/portfolio/from-booking/:id`, one per
  booking). Profile portfolio shows a "Verified Servix Project" badge with
  completion date, duration and customer rating derived from the booking.
- **Service request marketplace + proposals** (`api/src/routes/requests.ts`,
  docs `api/docs/MARKETPLACE_REQUESTS.md`, `api/docs/PROPOSALS.md`): customers
  draft/publish/pause/close/cancel requests with budget, deadline, remote/on-site,
  skills; professionals browse with filters and sorts and keep **one live
  proposal per request** (database partial unique index); accepting a proposal
  atomically awards the request, rejects the others and creates a normal
  booking in `pending_payment` with the proposal price as the immutable amount
  (attached to the professional's chosen gig or an archived "Custom work"
  service). Payment, escrow, delivery, disputes and payouts are the existing
  pipeline. Customer pages `/dashboard/requests*`, professional pages
  `/dashboard/proposals*`, admin **Requests & proposals** tab (read-only).
- **Comparison** (`/compare`, `GET /compare`): compare up to four professionals
  with real trust data, achievements, next availability, skills, languages,
  services, verified projects; best value per row highlighted; tray on the
  professionals list and profile page.
- **Availability discovery**: `available=today|tomorrow|week` on
  `/professionals` and `/services` (computed from real working hours, days off
  and bookings), "Free today/tomorrow/this week" filters and chips,
  `GET /professionals/:slug/availability/summary`.
- **Book again**: `GET /bookings/:id/rebook` returns a sanitised prefill
  (current gigs, previous notes offered opt-in, date left open); booking detail
  gets a "Book again" button; `bookings.rebooked_from_id` links the new booking.
- **Preferred professionals**: `PATCH /account/saved/:slug {preferred, note}` —
  preferred pins to the top of Saved; the private note is visible only to the
  customer.
- **Pro analytics**: profile/gig views (privacy-safe daily counters, no visitor
  identity), delivery reliability, repeat customers, verified projects,
  achievements with locked criteria, and a "turn completed bookings into
  verified projects" panel.
- Migration `20261003000000_nextgen_marketplace` (additive) + guarded Neon
  script `api/docs/manual-nextgen-upgrade.sql` (verified on a fresh PostgreSQL:
  applies once, idempotent on re-run).

### Fixed
- Blank page after a deployment: a tab that still had the previous build open
  could fail to download a page file (new build = new file names) and React
  unmounted everything. Added `src/components/ui/ErrorBoundary.jsx` (root and
  per-route): a stale-build failure reloads once; any other render error shows
  a recovery panel (reload / back / home + the error text) instead of a blank
  screen. Also handles Vite's `vite:preloadError`.

### Tests
- `api/tests/nextgen-local.test.ts` — 7 isolated-PostgreSQL suites (flags,
  request validation/ownership/transitions, proposals incl. duplicate + race +
  award snapshot + notifications + admin, trust + achievements + analytics +
  views, verified portfolio, compare/availability/rebook/preferred, flag off).
- `tests/browser/nextgen.spec.js` — 8 Playwright journeys (profile trust tab,
  compare tray/page, flag off, customer request → proposals → accept,
  professional browse → propose with inline validation, preferred + note,
  admin tabs, mobile overflow). Full browser suite 86/86.

### Not in this block
Projects & milestones, professional CRM, business workspace, price
intelligence and optional packages are flagged but not yet built.

## 0.6.0 — 2026-08-27 (Phase E: production hardening, administration & launch readiness)

### Added
- **Admin system replacing the `X-Servix-Review-Key` bridge** (removed):
  DB-verified `admin` role (`requireAdmin` re-reads the role from the
  database on every request — a forged JWT role claim is rejected),
  idempotent server-side admin bootstrap from `ADMIN_EMAIL`/`ADMIN_PASSWORD`
  (refuses weak credentials), and a full `/api/v1/admin/*` surface:
  stats, application review (approve/reject with transactional role
  promotion), service moderation (pause/unpause with CAS), user
  management (search, suspend with session revocation, reinstate;
  self-action and admin-target protection), booking monitoring with
  event timelines, dispute resolution (release/refund), payout
  monitoring + retry, and a read-only audit-log viewer.
- **Audit log** (`audit_log` table): every admin mutation and upload
  presign is recorded transactionally with actor, action, entity and IP.
- **Admin console UI** at `/admin` — Overview / Applications / Services /
  Users / Bookings & Disputes / Payouts / Audit Log tabs, built entirely
  from the existing Servix design system (Tabs, Field, Button, Badge,
  Modal, cards, state blocks). Navbar shows an Admin link for admins.
- **Cloudflare R2 storage provider** behind the storage abstraction:
  hand-rolled AWS SigV4 presigned PUT/DELETE URLs (verified against the
  official AWS documentation test vector), server-side content-type and
  5 MB size validation, UUID object keys with extension derived from
  content type only, deletion presign, and 24h orphan-upload sweeping
  driven by presign audit rows. The stub provider still honestly reports
  `enabled:false` with no upload URL when R2 is not configured. No file
  bytes ever touch PostgreSQL; no storage secrets ever reach the browser.
- **Production email abstraction**: `console` (dev), `noop` (tests) and
  `resend` (production HTTPS API) transports. A send only resolves when
  the provider ACCEPTS the message — no fake delivery claims. Templates:
  verify email, password reset, booking confirmed, payment received,
  booking cancelled, dispute opened, dispute resolved, payout sent.
  All notification mail flows through the job queue, off the request path.
- **Background job system** (`jobs` table, PgQueue driver): claim via
  `FOR UPDATE SKIP LOCKED` (duplicate workers can never run a job twice),
  exponential backoff (30s base, doubling), dead-letter state after
  maxAttempts, idempotent enqueue via `UNIQUE(queue, idempotency_key)`,
  repeatable scheduling (auto-confirm sweep, daily orphan cleanup),
  webhook reprocessing and payout-retry jobs. Financial job handlers act
  through CAS transitions so retries can never duplicate money. Inline
  worker in the API process by default; standalone `worker.ts` for
  production (`WORKER_MODE=external`). BullMQ/Redis documented as the
  deploy-time driver swap in `api/docs/PRODUCTION_HARDENING.md`.
- **Payout failure recovery**: failed provider transfers mark the payout
  `failed` and reverse the ledger hold EXACTLY once (CAS-guarded);
  admin/job retry creates a fresh attempt; replayed retries return the
  successor payout instead of moving money twice.
- **Security hardening**: production boot refuses to start with
  missing/weak configuration (`validateProductionConfig`: JWT secret
  length, DATABASE_URL, PAYSTACK_SECRET_KEY, https APP_BASE_URL, real
  email transport, R2 vars when enabled, no dev review key, admin
  bootstrap); 512 KB body limit; security headers on every response
  (nosniff, X-Frame-Options DENY, Referrer-Policy, HSTS in production);
  request IDs (UUID) echoed as `X-Request-Id`.
- **Observability**: structured pino logging with request id / route /
  status / latency and redaction of authorization headers, cookies,
  passwords and tokens (secrets are never logged); `/healthz` liveness
  and `/readyz` readiness (database + queue + storage checks, 503 when
  degraded).
- **Reliability**: graceful shutdown (SIGTERM/SIGINT → close HTTP, finish
  the in-flight job, disconnect DB, 10s deadline); Paystack HTTP calls
  carry a 15s timeout; webhook processing errors enqueue a retry job.
- 32 new integration tests (suite: **128**) covering the admin authz
  matrix (incl. forged-JWT and suspended-admin cases), audit rows, job
  lifecycle (backoff → dead-letter, duplicate-enqueue no-op, concurrent
  claim safety), SigV4 test vector, storage-stub honesty, webhook replay
  (3× same event id → zero new ledger rows), payout failure recovery
  with balance conservation, production config validation, security
  headers, `/readyz` and the body limit.
- 21-step browser E2E across three journeys: Admin → Application →
  Approve → Professional; Admin → Dispute → Resolution (refund);
  Customer → Booking → Payment → Completion → Payout (₦135,000 payable
  on a ₦150,000 booking = 10% fee verified in the UI).
- Reliability drills: API SIGTERM mid-payment (booking stayed
  `pending_payment`, zero ledger rows, payment re-initiable), PostgreSQL
  kill + WAL crash recovery (readyz 503 → 200, API self-healed without
  restart), post-drill global ledger audit (all transactions balanced).

### Changed
- `POST /applications/:id/review` and `POST /bookings/:id/resolve`
  (review-key guarded) are **removed**; the admin endpoints replace them.
- Uploads (`POST /pro/uploads`) now go through the storage provider and
  record presign audit rows for orphan cleanup.
- Frontend live-API provider now maps the demo `query` filter param to
  the API's `q` (BUG-012).

### Fixed
- BUG-012: live catalogue search sent `query` but the API expects `q`,
  so searches silently returned the full list when the API was attached.

### Deliberately not claimed
- Live Paystack, live R2, live Resend, Redis/BullMQ and managed-Postgres
  backups are **not verified** from this environment (no external
  network). See `api/docs/LAUNCH_AUDIT.md` for the honest breakdown of
  Code verified / Infrastructure verified / Third-party verified.


## 0.5.0 — 2026-08-26 (Phase D: bookings + payments)

### Added
- **Real bookings** with immutable price snapshots (kobo integers), a
  10-state server-controlled state machine (CAS transitions, immutable
  event log), availability (weekly rules + exceptions + DB-level
  double-booking prevention via partial unique index) and real bookable
  slots at `GET /services/:slug/availability`.
- **Payments** behind a provider abstraction: Paystack (live when
  credentials exist) / sandbox with signature parity. Payment is only
  confirmed by the HMAC-SHA512-verified webhook + server-to-server
  verification with amount matching — never by browser redirects.
  Idempotent init, idempotent webhooks (UNIQUE provider event id),
  duplicate deliveries no-op.
- **Escrow + double-entry ledger** (append-only, every txn balanced,
  balances always ledger-derived): capture → escrow; confirm/3-day
  auto-confirm → payable + 10% platform fee; policy-controlled refunds
  (full before work; dispute-only after work begins) — client never
  supplies amounts.
- **Disputes** freeze funds; auto-confirm can never touch disputed
  bookings; internal key-guarded resolution (release/refund).
- **Payouts** via provider transfers: ledger-derived balance, in-flight
  uniqueness (DB partial index), provider references stored.
- **Reviews from real bookings**: customer-only, completed-only,
  once-only (DB unique on booking_id), aggregates recomputed
  transactionally.
- **Frontend**: booking modal with live slots, provider-hosted checkout
  redirect, booking detail with payment polling + lifecycle actions +
  dispute + review modals, My Bookings list, workspace Bookings/Earnings
  tabs with accept/start/deliver and payout request.
- Migration `20260826200000_bookings_payments` (8 tables, 4 enums).
- 24 new integration tests (suite: 96) + 11-step dual-journey browser E2E.

### Fixed
- BUG-011: `useEffect` import missing after ServiceDetail booking-form
  integration (caught by browser E2E).


## 0.4.0 — 2026-08-26 (Phase C: professional onboarding)

### Added
- **Professional application workflow** with server-controlled approval:
  pending → under_review → approved/rejected. Role promotion happens ONLY
  inside the transactional approval. Duplicate active applications
  blocked; rejected applicants can re-apply; locked once submitted.
- **Professional management API** (`/pro/*`): profile, skills, portfolio,
  service CRUD with draft → publish → unpublish → archive lifecycle,
  startingPrice aggregate maintenance, presigned-upload boundary
  (honest stub — no fake uploads).
- **Authorization**: `requireProfessional` re-reads role from the DB per
  request; queries owner-scoped; cross-owner access 404s; zod strips
  role-escalation payloads.
- **Frontend**: `/professionals/apply` + `/pro` workspace built from the
  existing design system; navbar Workspace link.
- DB migration `20260826100000_professional_onboarding`.
- 31 new integration tests (suite: 72) + 9-step browser E2E.

### Fixed
- BUG-009: `/pro/services/:id` actions 404ed for slugs — route params now
  accept UUID or public slug.
- BUG-010: parallel session resumes (React StrictMode) tripped refresh
  reuse detection — resume is now single-flight.


## 0.3.0 — 2026-08-26 (Phase B: accounts & authentication)

### Added
- **Real authentication system** (`api/`): register, login, logout,
  refresh (rotating httpOnly cookie with family reuse detection),
  email verification and password reset under `/api/v1/auth`, plus
  `GET /me`. scrypt hashing, JWT HS256 access tokens (15 min,
  memory-only), single-use hashed email tokens, anti-enumeration,
  per-route rate limits with 429 envelopes.
- `users`, `refresh_tokens`, `one_time_tokens` tables (migration
  `20260826000000_auth_accounts`).
- Frontend: `AuthProvider`/`useAuth` context with session resume; the
  auth pages perform real authentication when `VITE_API_URL` is set.
  Navbar shows the signed-in user + Sign Out.
- Email delivery abstraction with console transport for development.
- 21 new auth integration tests + rate-limit test (API suite now 61).

### Unchanged (honest fallback)
- With no `VITE_API_URL`, the auth pages keep their pre-launch messaging
  and make **zero** network calls — no fake authentication anywhere.

### Fixed
- BUG-007: rate limiter returned malformed 500s instead of 429 envelopes.
- BUG-008: auth client no longer sends `Content-Type: application/json`
  on body-less POSTs (Fastify rejects empty JSON bodies).


## 0.1.1 — 2026-08-22

### Changed
- Installed the official SERVIX brand identity: SX monogram ligature +
  SERVIX wordmark, vectorised as outlined-path SVGs from the supplied
  reference images. Replaced the temporary stand-in logo, dark-background
  variant and favicon in `public/brand/` (1:1 swap, no code changes).
- Regenerated the favicon with correct clear space around the monogram.
- Verified logo rendering in navbar (light), footer (dark) and favicon at
  1440/768/390/375 px with zero layout overflow.

## 0.1.0 — 2026-08-22

### Added
- Project setup: React 18 + Vite 5 + React Router 6, Inter Variable typeface
- Servix design system: full token set in `src/styles/tokens.css`
- Public navigation (desktop + mobile menu) and corporate footer
- Homepage, service discovery/detail, professional directory/profile,
  join page, how-it-works, pricing, about, contact, auth UI shells,
  legal placeholders and 404
- Reusable UI system (Button, Field, Icon, Rating, Badge, Modal, Drawer,
  Toast, Tabs, Breadcrumb, Pagination, Skeletons, states, Accordion,
  SectionHeader, Gallery, cards)
- Data layer (`src/lib/api.js`) mirroring future REST endpoints with
  structured demo data
- Per-route SEO metadata; accessibility (skip link, focus management,
  keyboard navigation, aria-wired forms, reduced-motion)
- Automated headless-browser test pass across 18 routes × 6 viewports
