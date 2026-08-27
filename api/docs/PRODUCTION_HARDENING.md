# Servix — Phase E: Production Hardening, Administration & Launch Readiness

> Written BEFORE implementation, after inspecting the complete A+B+C+D
> baseline: schema (24 models, 9 enums), 4 migrations, double-entry
> ledger, CAS booking state machine, HMAC-verified webhook pipeline,
> scrypt/JWT/rotating-refresh auth, `requireProfessional` DB-verified
> authorization, the review-key operational bridge, the frontend API
> facade (`api.js` → demo/http providers) and all existing docs
> (BOOKINGS/PAYMENTS/PROFESSIONALS).
>
> Locked decisions unchanged: Paystack · 3-day confirmation · 3-day
> payout release unless disputed · PostgreSQL. No redesign of the public
> site. No subscriptions. No regression of A–D behaviour.

## 1. Admin system (replaces the `X-Servix-Review-Key` bridge)

### Model
- `users.role` gains `admin` (enum extension, additive migration).
- **Server-side truth only:** a new `requireAdmin` guard re-reads the
  user from the DATABASE on every request. The JWT's role claim is never
  sufficient — a forged `role:admin` token or a suspended admin token
  must be rejected. This mirrors the existing `requireProfessional`
  pattern.
- **Bootstrap:** `bootstrapAdmin()` runs at server start — idempotent,
  creates/promotes the `ADMIN_EMAIL` account; refuses to create one with
  a password shorter than 12 characters. No client path can ever set a
  role.

### Surface (`/api/v1/admin/*`, all `requireAdmin`, all rate-limited)
| Endpoint | Purpose |
|---|---|
| `GET /admin/stats` | users, professionals, pending applications, active services, bookings, open disputes, failed payouts, dead jobs |
| `GET /admin/applications?status=` | review queue |
| `POST /admin/applications/:id/approve` | transactional: application→approved + role promotion + profile creation + audit |
| `POST /admin/applications/:id/reject` | reason stored + audit |
| `GET /admin/services?status=` | includes drafts/paused |
| `POST /admin/services/:slug/pause` / `unpause` | moderation, CAS `active↔paused` + audit |
| `GET /admin/users?q=` | search |
| `POST /admin/users/:id/suspend` | sets `suspended`, revokes ALL refresh tokens + audit; refuses self and admin targets |
| `POST /admin/users/:id/reinstate` | + audit |
| `GET /admin/bookings?status=` · `GET /admin/bookings/:id` | monitoring + full event timeline + payments |
| `POST /admin/bookings/:id/resolve` | dispute resolution `{decision: release\|refund}` — the same CAS + ledger transactions Phase D used, now admin-authenticated + audited; refunds route through here too |
| `GET /admin/payouts?status=` · `POST /admin/payouts/:id/retry` | payout monitoring + failed-payout recovery |
| `GET /admin/audit?entity=` | read-only audit viewer |

The Phase C/D review-key endpoints (`POST /applications/:id/review`,
`POST /bookings/:id/resolve`) are **removed**, not deprecated. The
A–D test suites are migrated to authenticate as a real admin.

### Audit log
New `audit_log` table: `id, actor_id→users, action, entity, entity_id,
data jsonb, ip, created_at`, indexed by `(entity, entity_id)` and
`(actor_id, created_at)`. Audit rows are written **inside the same DB
transaction** as the mutation they record. Upload presigns are also
audited (feeds orphan cleanup, §2).

### Frontend
One new route `/admin` (lazy chunk): tabs Overview / Applications /
Services / Users / Bookings & Disputes / Payouts / Audit Log — built
exclusively from the existing design system (Tabs, Field, Button,
Badge, Modal, cards, States). Navbar shows an "Admin" destination for
admins. No other page changes. The UI is a convenience; every decision
is enforced server-side.

## 2. Cloudflare R2 (real S3-compatible storage)

- Keep the Phase C `StorageProvider` contract
  (`presign(kind,fileName,contentType,size)` →
  `{enabled, key, publicUrl, uploadUrl}`); add `presignDelete(key)`.
- **R2Provider** activates when `STORAGE_PROVIDER=r2` +
  `R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET/`
  `R2_PUBLIC_BASE_URL` are configured. It generates AWS **SigV4
  presigned URLs** (PUT for upload, DELETE for removal) against
  `{accountId}.r2.cloudflarestorage.com`, region `auto`,
  `UNSIGNED-PAYLOAD`, 300s expiry. The signer is hand-rolled (no AWS
  SDK dependency) and must be verified against the official AWS
  documentation test vector before use.
- **Validation stays server-side:** content-type whitelist
  (jpeg/png/webp), 5 MB cap, and object keys are
  `{kind}/{uuid}.{ext-from-content-type}` — the client's filename never
  reaches the key (no traversal, no injection).
- **Upload completion:** clients PUT directly to R2 with the presigned
  URL and then attach `publicUrl` via the existing profile/portfolio/
  service endpoints. Completion = the URL being referenced in the DB.
- **Orphan cleanup:** every presign writes an `upload.presigned` audit
  row. A daily job deletes objects presigned >24h ago whose publicUrl is
  referenced by no profile image, portfolio item or service media row.
- Without credentials the honest **stub** stays: `enabled:false`,
  `uploadUrl:null`, explanatory note — never a fake upload.
- Binary media never enters PostgreSQL; R2 secrets never leave the
  server (only short-lived presigned URLs do).

## 3. Email (production provider abstraction)

- `deliverMail(mail)` with three transports selected by `EMAIL_MODE`:
  `console` (dev), `noop` (tests), `resend` (production —
  `POST https://api.resend.com/emails`, Bearer `RESEND_API_KEY`).
- **Honesty rule:** the resend transport resolves ONLY on a 2xx +
  message id; anything else throws, which makes the email **job** retry
  and eventually dead-letter. Nothing anywhere reports "sent" unless the
  provider accepted the message.
- Templates: verify-email, reset-password (existing), plus booking
  confirmed, payment received, booking cancelled, dispute opened,
  dispute resolved, payout sent.
- All notification email moves OFF the request path: producers call
  `enqueueMail(mail, idempotencyKey)`; the worker delivers.
- `validateProductionConfig` refuses `EMAIL_MODE=console` in production.

## 4. Background jobs (queue + workers)

- **Driver decision:** the target production driver is BullMQ on Redis;
  this environment has no Redis, so BullMQ cannot be honestly verified
  here. Phase E therefore implements a **PgQueue** driver with identical
  semantics on a new `jobs` table, and documents the BullMQ swap behind
  the same `enqueue/runOneJob/startWorker` seam (activated by
  `REDIS_URL` at deploy time, with its own verification pass then).
- `jobs`: `queue, name, payload jsonb, idempotency_key
  (UNIQUE(queue,idempotency_key)), status pending|running|done|dead,
  attempts, max_attempts (5), run_at, locked_at, last_error`.
- **Claim = `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1`** inside a
  transaction → duplicate workers can never run one job twice.
- **Retry/backoff:** failure reschedules at `30s × 2^(attempts−1)`;
  after `max_attempts` the job goes `dead` (dead-letter) and is surfaced
  on `/admin/stats`.
- Handlers (all idempotent):
  - `email.send` — throws unless provider accepts (§3)
  - `bookings.autoconfirm` — runs the existing sweep; CAS makes replays no-ops
  - `webhooks.retry` — reprocess a stored, errored webhook event; skips if already processed
  - `payouts.retry` — re-attempt a failed payout via the recovery path (§8/§9); CAS prevents double money
  - `cleanup.orphans` — R2 orphan sweep (§2)
- Repeatables are scheduled with deterministic idempotency keys
  (auto-confirm per 10-minute bucket, cleanup per day) so restarts never
  duplicate them.
- Worker runs inline with the API by default; `WORKER_MODE=external` +
  `src/worker.ts` runs it as a separate process in production.
- **Financial rule:** no job handler moves money directly; they all call
  the same CAS-guarded domain functions the HTTP paths use, so a retry
  can never duplicate a financial operation.

## 5. Security hardening (audit checklist → enforcement)

| Area | Status / action |
|---|---|
| Passwords | scrypt N=2^17 (OWASP), timing-safe — keep |
| Access tokens | JWT HS256 15 min, memory-only client — keep |
| Refresh rotation | httpOnly SameSite=Lax path-scoped cookie, sha256-hashed at rest, family reuse detection — keep; suspension revokes families (new) |
| CSRF | No cookie-authenticated state-changing endpoint exists outside `/auth/*`; those are protected by SameSite=Lax + rotation; Bearer-token endpoints are CSRF-immune. Documented. |
| CORS | Explicit allowlist + `servix*.vercel.app` previews, credentials on — keep |
| Rate limiting | Global 300/min + strict per-route auth limits; admin mutations get their own bucket (new) |
| Security headers | NEW: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS in production, on every response |
| Body limits | NEW: 512 KB global `bodyLimit` |
| Upload validation | Server-side type/size/key rules (§2) |
| SQL access | Prisma ORM; the few raw queries use tagged templates (parameterised). No string SQL. |
| AuthZ boundaries | requireAuth / requireProfessional / requireAdmin all DB-verified; ownership scoping + 404 masking unchanged |
| Webhooks | HMAC-SHA512 over raw body, timing-safe compare, then server-to-server verify + amount match — keep |
| Secrets | Env-only; `.env` gitignored; **`validateProductionConfig()` makes production REFUSE TO BOOT** on: missing/short `AUTH_JWT_SECRET` (<32), missing `DATABASE_URL`, missing `PAYSTACK_SECRET_KEY`, non-https `APP_BASE_URL`, `EMAIL_MODE=console`, missing `RESEND_API_KEY`, missing `R2_*` when r2 enabled, leftover dev review key, missing `ADMIN_EMAIL` |
| Dependency audit | `npm audit` run on both packages; findings triaged in LAUNCH_AUDIT.md |

## 6. Observability

- Structured pino logs (already Fastify-native): add UUID request ids
  (`genReqId`), echo as `X-Request-Id`; route/status/latency are logged
  per request.
- **Redaction:** `req.headers.authorization`, `req.headers.cookie`,
  `*.password`, `*.passwordHash`, `*.accessToken`, `*.token`,
  `*.secret` are redacted. Paystack/R2/Resend secrets are only ever read
  from env inside their providers and never logged.
- `/healthz` = liveness (process up). `/readyz` = readiness: DB
  (`SELECT 1`), queue (jobs table reachable), storage (config
  consistency) — 503 with per-check detail when degraded.

## 7. Database / deployment

- Migrations: additive only; new `20260827000000_phase_e` migration adds
  `audit_log`, `jobs`, and the `admin` role value. Existing migration
  history untouched. The offline runner remains checksum-compatible with
  `prisma migrate deploy`.
- Indexes: audit `(entity,entity_id)`, `(actor_id,created_at)`; jobs
  `(status, run_at)` + unique `(queue, idempotency_key)`. Existing hot
  paths already indexed (verified in Phase D).
- Pooling: `PG_POOL_MAX` env (default 10) on the pg adapter.
- Backups/restore: runbook documented (managed Postgres daily snapshots
  + PITR; restore drill into a scratch instance; `db:migrate` is
  idempotent on an already-migrated restore). Cannot be executed from
  this environment — recorded as infrastructure-verification work in the
  launch audit.
- Migration failure handling: each migration applies inside a
  transaction; failure rolls back and leaves `_prisma_migrations`
  unrecorded, so re-running resumes cleanly.

## 8. Paystack production

- Provider interface unchanged; `PaystackProvider` activates on
  `PAYSTACK_SECRET_KEY`, all calls get a 15s `AbortSignal.timeout`.
- Webhook secret = the live secret key (Paystack convention); sandbox
  keeps signature parity so the domain pipeline is identical.
- Payment lifecycle (init idempotency, signature verification, server
  verification with amount/currency match, duplicate webhook no-op,
  failed payments, refunds, transfers, payout idempotency) is already
  CAS/unique-constraint enforced from Phase D and re-verified in the
  Phase E suite; the browser redirect stays non-authoritative.
- NEW payout failure recovery: a failed transfer CAS-marks the payout
  `failed` and reverses the ledger hold exactly once
  (`payoutReversalLegs`); retry (`/admin/payouts/:id/retry` or job)
  requests a fresh payout; a replayed retry returns the successor payout
  instead of moving money again.
- Live-key verification is impossible from this sandbox (egress
  blocked) → BLOCKED item in the launch audit with an explicit
  deployment checklist.

## 9. Reliability

- Graceful shutdown on SIGTERM/SIGINT: stop accepting HTTP → let the
  worker finish its in-flight job → disconnect Prisma → exit (10s hard
  deadline). Worker process mirrors this.
- Drills to execute (not simulate): API restart mid-booking-payment
  (expect: no phantom ledger rows, payment retryable, orphaned sandbox
  session honestly errors), worker restart during an email job (job
  re-claimed, idempotency key prevents duplication), duplicate worker
  execution (SKIP LOCKED), webhook replay (idempotent), DB interruption
  (`/readyz` degrades, self-heal after recovery), Paystack timeout
  (15s abort → payment stays `initiated`), failed payout (exactly-once
  reversal), failed email (retry → dead-letter). After every drill: full
  ledger balance audit.
- Redis interruption: N/A for PgQueue (queue durability = DB
  durability); documented as part of the BullMQ deploy-time
  verification.

## 10. Testing plan

- Re-run the entire A+B+C+D suite, migrated from the review-key bridge
  to real admin authentication (the only intended behavioural change).
- New suites: `admin.test.ts` (authz matrix incl. forged JWT role +
  suspended admin, stats, review + audit rows, moderation CAS, user
  management + session revocation, audit viewer) and `phase-e.test.ts`
  (job lifecycle: done/backoff/dead-letter/duplicate-enqueue/concurrent
  claims; SigV4 AWS test vector; safe keys; stub honesty + presign
  audit; webhook replay ×3; payout failure recovery with balance
  conservation and ledger audit; `validateProductionConfig` matrix;
  security headers; `/readyz`; body limit).
- Browser E2E (single context, real sign-out/sign-in between roles):
  1. Admin → Application → Approve → Professional
  2. Admin → Dispute → Resolution
  3. Customer → Booking → Payment → Completion → Payout
- Reliability drills per §9, then `npm audit` on both packages.

## 11. Deliverables & exit criteria

- All code + migrations + tests green (`tsc --noEmit`, full vitest
  suite, frontend build).
- Browser E2E passing across the three journeys.
- `api/docs/LAUNCH_AUDIT.md`: PASS/FAIL/BLOCKED/DEFERRED per production
  requirement, each labelled Code verified / Infrastructure verified /
  Third-party integration verified / Not yet verified. **"Production
  ready" is not claimed merely because tests pass** — live Paystack, R2,
  Resend, Redis and managed-Postgres verification are expected BLOCKED/
  DEFERRED items with a pre-launch runbook.
- Stop after Phase E. No subscriptions or unrelated features.
