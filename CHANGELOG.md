# Changelog

All notable changes to the Servix public website.

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
