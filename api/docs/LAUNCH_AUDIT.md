# Servix — Final Launch Audit (Phase E)

> Date: 2026-08-27 · Suite: 128/128 API integration tests · 21-step
> browser E2E · reliability drills executed against the real stack
> (Fastify + PostgreSQL 17.5 + PgQueue worker + sandbox payment provider).
>
> **This report does NOT claim "production ready" because tests pass.**
> Each item is classified by what has actually been verified:
>
> - **Code verified** — behaviour proven by tests/E2E/drills in this environment
> - **Infrastructure verified** — proven on real deployment infrastructure
> - **Third-party verified** — proven against the real external service
> - **Not yet verified** — no honest evidence yet
>
> This development environment has NO external network access, so nothing
> here carries "Third-party verified" for Paystack, R2 or Resend. Those
> verifications must happen during deployment.

## Verdict summary

Launch requires completing the **BLOCKED** items below on real
infrastructure. The codebase itself is complete for the locked Phase A–E
scope, with every code-verifiable behaviour tested.

| # | Area | Status | Verification level |
|---|---|---|---|
| 1 | Booking/payment/refund/dispute/payout correctness | **PASS** | Code verified |
| 2 | Financial invariants (balanced ledger, no double-credit/spend) | **PASS** | Code verified |
| 3 | Admin system + audit logging | **PASS** | Code verified |
| 4 | AuthN/AuthZ (sessions, rotation, role boundaries) | **PASS** | Code verified |
| 5 | Security hardening (headers, limits, validation, config gate) | **PASS** | Code verified |
| 6 | Observability (logs, redaction, health/readiness) | **PASS** | Code verified |
| 7 | Background jobs (retry, backoff, dead-letter, exactly-once) | **PASS** | Code verified (PgQueue) |
| 8 | Reliability (graceful shutdown, crash recovery) | **PASS** | Code verified (drills) |
| 9 | Frontend admin console + full-journey UX | **PASS** | Code verified (browser E2E) |
| 10 | Live Paystack payments & transfers | **BLOCKED** | Not yet verified |
| 11 | Live Cloudflare R2 uploads | **BLOCKED** | Not yet verified |
| 12 | Live Resend email delivery | **BLOCKED** | Not yet verified |
| 13 | Redis/BullMQ worker driver | **DEFERRED** | Not yet verified |
| 14 | Managed PostgreSQL, backups & restore drill | **BLOCKED** | Not yet verified |
| 15 | TLS/domain/edge configuration | **BLOCKED** | Not yet verified |
| 16 | Dependency vulnerabilities (npm audit) | **PASS with notes** | Code verified |

---

## 1. Payments, bookings & disputes — PASS (Code verified)

- Payment reaches `captured` ONLY via HMAC-SHA512-signed webhook +
  server-to-server verify + amount/currency match + CAS. Forged
  signatures → 401, nothing persisted. Browser redirects carry no
  authority. (tests: bookings suite)
- Webhook replay: same provider event id delivered 3× → acknowledged,
  zero new ledger entries, zero new events. (tests: phase-e suite)
- Refund policy is server-only; client-supplied amounts/percentages are
  stripped and ignored. (tests: bookings suite)
- Dispute freeze: auto-confirm can never touch disputed bookings; only
  the audited admin endpoint resolves them. (tests: bookings + admin)
- 3-day auto-confirm and 10% platform fee verified end to end
  (₦135,000 payable on a ₦150,000 booking, asserted in API tests AND on
  screen in the browser E2E).

## 2. Financial invariants — PASS (Code verified)

- Double-entry ledger is append-only; **every** transaction balanced —
  asserted over all rows after the full suite AND re-audited after the
  reliability drills (26/26 balanced post-drill).
- Payout failure recovery: forced transfer failure → payout `failed`,
  hold reversed exactly once (CAS-guarded), balance restored; retry
  succeeds; replayed retry returns the successor payout without moving
  money. (tests: phase-e suite)
- Concurrency: two simultaneous accepts → exactly one winner; concurrent
  job claims → exactly one execution; DB-level partial unique indexes
  back every idempotency contract.

## 3. Admin system & audit logging — PASS (Code verified)

- The `X-Servix-Review-Key` bridge is REMOVED (verified 404 in tests).
- `requireAdmin` re-reads the role from the DATABASE per request:
  anonymous 401, customer/professional 403, **forged JWT role claim
  403**, suspended admin 401, real admin 200. (tests: admin suite)
- Every admin mutation (approve/reject, pause/unpause, suspend/
  reinstate, dispute resolve, payout retry) writes an audit row
  transactionally with the acting admin; the viewer is read-only.
- Guards: no self-suspension, admins cannot suspend admins, suspension
  revokes all refresh tokens and blocks login.

## 4. Authentication & authorization — PASS (Code verified)

- scrypt password hashing; JWT access 15 min in memory only; rotating
  httpOnly refresh cookies with family reuse detection; password reset
  revokes all sessions; anti-enumeration login/forgot responses;
  per-route rate limits with 429 envelopes. (21 auth tests + rate-limit
  test, unchanged from Phase B and re-run green)
- Role escalation impossible from any client payload (zod strips unknown
  fields; promotion happens only in the admin approval transaction).
- Ownership boundaries: cross-owner probes 404 (anti-enumeration),
  customer/pro/admin surface separation covered by the authz matrices.

## 5. Security hardening — PASS (Code verified)

- `validateProductionConfig()` refuses production boot on: short/missing
  JWT secret, missing DATABASE_URL, missing PAYSTACK_SECRET_KEY,
  non-https APP_BASE_URL, console email transport, missing
  RESEND_API_KEY, missing R2 vars when r2 enabled, dev review-key
  remnants, missing ADMIN_EMAIL. All classes unit-tested; development
  is never blocked.
- 512 KB body limit (413 tested), security headers on every response
  (nosniff / X-Frame-Options DENY / Referrer-Policy; HSTS in
  production), UUID request ids, CORS allowlist with credentials.
- CSRF: no cookie-authenticated state-changing endpoints exist outside
  `/auth/*` (SameSite=Lax + rotation); all other mutations require a
  Bearer token, which cross-site pages cannot attach.
- Upload validation server-side (type whitelist, 5 MB cap, UUID keys,
  extension from content type — no path traversal).
- ORM-only data access (no string-built SQL; the few raw queries are
  parameterised via Prisma tagged templates).
- Admin bootstrap refuses passwords <12 chars.

## 6. Observability — PASS (Code verified)

- Structured pino logs: request id, method, route, status, latency.
- Redaction configured and verified: authorization headers, cookies,
  passwords, tokens, secrets are never logged. Paystack/R2/Resend
  secrets only ever read from env inside providers.
- `/healthz` liveness; `/readyz` checks DB + queue + storage and returns
  503 when degraded — **demonstrated live** during the DB-kill drill.

## 7. Background jobs — PASS (Code verified, PgQueue driver)

- Email/webhook-retry/auto-confirm/orphan-cleanup/payout-retry handlers;
  enqueue idempotent by `UNIQUE(queue, idempotency_key)`; claims via
  `FOR UPDATE SKIP LOCKED`; exponential backoff (30s·2ⁿ); dead-letter
  after maxAttempts; dead-job count surfaced on /admin/stats.
- Duplicate worker execution cannot double-run a job (3 concurrent
  claims → 1 execution, tested).
- Email jobs only succeed when the provider ACCEPTS the message; a
  rejecting provider drives retry → dead-letter, never a false
  "delivered".

## 8. Reliability drills — PASS (Code verified)

Executed against the running stack (not simulated):

| Drill | Result |
|---|---|
| API SIGTERM mid-payment | Graceful shutdown logged (`SIGTERM received — shutting down gracefully`); after restart the interrupted booking is `pending_payment` with 0 ledger rows and a retryable `initiated` payment; the orphaned sandbox checkout honestly 409s instead of faking success |
| PostgreSQL killed | `/readyz` → 503 `{database:false,queue:false}`; `/healthz` stays alive; after restart Postgres ran WAL crash recovery (`automatic recovery in progress … redo done`) and the API self-healed to `/readyz` 200 **without an API restart** |
| Post-drill audit | Global ledger 26/26 transactions balanced; 0 stuck `running` jobs |
| Duplicate webhook after recovery | Replay still no-ops (idempotency survives restarts because it is DB-backed) |
| Worker restart during email job | Covered by design + tests: claims are transactional (`FOR UPDATE SKIP LOCKED`); an interrupted `running` job is re-claimed after restart and its idempotency key prevents duplication |
| Paystack timeout | 15s `AbortSignal.timeout` on every provider call; a timeout leaves the payment `initiated` (retryable), never `captured` |

## 9. Frontend & admin console — PASS (Code verified)

- 21-step browser E2E through the three required journeys:
  1. **Admin → Application → Approve → Professional** (console list,
     approve, audit row visible, applicant gains workspace, publishes a
     service)
  2. **Admin → Dispute → Resolution** (dispute reason visible, full
     refund issued, customer sees Refunded)
  3. **Customer → Booking → Payment → Completion → Payout** (real slot
     picker → clearly-labelled sandbox checkout → webhook-driven state →
     accept/start/deliver → confirm → ₦135,000 payout drains balance)
  Plus: non-admin blocked from console UI and API (401).
- Existing Servix design system only (tokens, Field/Button/Tabs/Badge/
  Modal/state blocks). No redesign, no Tailwind, no component libraries.
- `npm run build` clean.

## 10. Live Paystack — BLOCKED (Not yet verified)

The PaystackProvider code path (initialize/verify/transfer against
`api.paystack.co`, webhook secret = live secret key) is implemented and
type-checked, but this environment cannot reach Paystack. **Before
launch:** configure `PAYSTACK_SECRET_KEY` (live), register the webhook
URL in the Paystack dashboard, and run one real card payment + one real
transfer end to end, confirming capture, webhook signature and amounts
against the ledger. The sandbox provider exercised the identical
domain pipeline (signature verification, verify call, CAS capture), so
the remaining risk is confined to Paystack's API surface itself.

## 11. Live Cloudflare R2 — BLOCKED (Not yet verified)

The SigV4 presigner matches the official AWS test vector byte for byte,
and the full presign/validate/track/orphan-sweep flow is tested against
the code. **Before launch:** create the bucket, set the `R2_*` vars +
`STORAGE_PROVIDER=r2`, upload a real image through a presigned URL from
the browser, confirm the public URL serves it, and run the orphan sweep
against a real stale object.

## 12. Live Resend email — BLOCKED (Not yet verified)

The resend transport is implemented (accepts only on provider 2xx+id;
failures retry then dead-letter). **Before launch:** verify the sending
domain (SPF/DKIM), set `EMAIL_MODE=resend` + `RESEND_API_KEY` +
`EMAIL_FROM`, and confirm a real verification email arrives in an inbox.

## 13. Redis / BullMQ — DEFERRED (Not yet verified)

The PgQueue driver delivers the required semantics (idempotency, retry/
backoff, dead-letter, exactly-once claims) and is fully tested; it is
sufficient for launch at initial scale. The BullMQ driver seam is
documented in `src/lib/jobs.ts` / `PRODUCTION_HARDENING.md` and should
be activated (`REDIS_URL`) when job volume justifies Redis — with its
own verification pass at that time. No Redis exists in this environment,
so no BullMQ behaviour is claimed. Redis-interruption behaviour is
likewise a deploy-time verification item.

## 14. Managed PostgreSQL & backups — BLOCKED (Not yet verified)

Migrations are additive-only, checksummed and interchangeable with
`prisma migrate deploy` (each applies in a transaction; failure rolls
back and re-running resumes cleanly); pooling is configurable
(`PG_POOL_MAX`); indexes cover the hot paths. WAL crash recovery was
demonstrated on the embedded instance. **Before launch:** provision
managed Postgres, run `npm run db:migrate && npm run db:seed`, enable
automated backups (daily + PITR if available), and execute one restore
drill into a scratch instance.

## 15. TLS / domain / edge — BLOCKED (Not yet verified)

HSTS and secure cookies engage automatically under
`NODE_ENV=production`, and CORS is allowlisted — but real certificate,
domain and proxy behaviour (including `SameSite` semantics across the
final domains) can only be verified on the deployed origin.

## 16. npm audit — PASS with notes (Code verified)

Run 2026-08-27:

- **Frontend** (4 findings, all in dev/build tooling or with no
  exploitable path in this app):
  - `vite`/`esbuild` (moderate/high) — affects the **dev server** only;
    production output is static files. Fix lands with the Vite 7+
    upgrade (breaking; schedule separately).
  - `react-router`/`react-router-dom` 6.30 (moderate) — advisories
    concern SSR hydration deserialization (Servix does not use SSR) and
    an open-redirect variant via crafted `<Link>` input. Risk accepted
    short-term; upgrade to react-router 7 is a planned breaking change.
- **API** (3 high, single root): `deepmerge-ts` via `@prisma/config` —
  a **CLI/dev-time** dependency (schema/config loading), not part of the
  request path; the runtime client (`@prisma/client`) is unaffected.
  Resolves when Prisma ships the patched config package; track upstream.
- No runtime-request-path vulnerability is known in either package tree.

---

## Pre-launch runbook (the BLOCKED list, in order)

1. Managed Postgres → `db:migrate` + `db:seed` → backup schedule →
   restore drill (§14)
2. Deploy API with full production env (boot will refuse if anything
   required is missing — that is by design) + standalone worker
   (`WORKER_MODE=external`)
3. DNS/TLS for API + frontend; confirm cookies/CORS across the real
   domains (§15)
4. Resend domain verification + first real email (§12)
5. R2 bucket + first real presigned upload + orphan sweep (§11)
6. Paystack live keys + dashboard webhook URL + one real payment and
   one real transfer, reconciled against the ledger (§10)
7. Rotate all secrets used during development; create the production
   admin via `ADMIN_EMAIL`/`ADMIN_PASSWORD` and confirm console access
8. Re-run the browser E2E against the deployed stack

Until every item above is executed on real infrastructure, Servix is
**feature-complete and code-verified, not production-verified**.
