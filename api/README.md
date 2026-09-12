# Servix API — Phases A–E

Fastify + TypeScript + Prisma + PostgreSQL backend for the Servix
marketplace. Phase A: public read-only catalogue. Phase B: real accounts
and authentication. Phase C: professional onboarding. Phase D: bookings,
payments, escrow, payouts, reviews. Phase E: admin system, audit logging,
R2 storage, production email, background jobs, hardening.

## Requirements

- Node.js ≥ 20
- PostgreSQL 16/17 (own server, or the embedded dev instance below)

## Quick start

```bash
cd api
npm install
cp .env.example .env

# 1. PostgreSQL — embedded dev instance (skip if you run your own):
./node_modules/@embedded-postgres/linux-x64/native/bin/initdb -D .pgdata -U servix --pwfile=<(echo servix) -A password
./node_modules/@embedded-postgres/linux-x64/native/bin/postgres -D .pgdata -p 5432 -k /tmp &
node -e "const{Client}=require('pg');const c=new Client({host:'127.0.0.1',port:5432,user:'servix',password:'servix',database:'postgres'});c.connect().then(async()=>{const r=await c.query(\"SELECT 1 FROM pg_database WHERE datname='servix'\");if(!r.rowCount)await c.query('CREATE DATABASE servix');await c.end();})"

# 2. Migrations (offline-compatible runner; `prisma migrate deploy` also works)
npm run db:migrate

# 3. Seed catalogue with the frontend demo data
npm run db:seed

# 4. Run
npm run dev            # http://localhost:8080  · docs at /api/v1/docs
```

## Environment variables (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | local servix DB | PostgreSQL connection string |
| `PORT` / `HOST` | 8080 / 0.0.0.0 | HTTP bind |
| `CORS_ORIGINS` | Vercel prod + localhost | Allowed origins (`servix*.vercel.app` previews always allowed) |
| `AUTH_JWT_SECRET` | dev value | **Required in production** (≥32 chars) |
| `AUTH_ACCESS_TTL_MIN` / `AUTH_REFRESH_TTL_DAYS` | 15 / 30 | Token lifetimes |
| `APP_BASE_URL` | http://localhost:5173 | Base URL for links in emails / redirects |
| `API_BASE_URL` | http://localhost:8080 | Base URL for provider callbacks |
| `EMAIL_MODE` | console | `console` (dev) / `resend` (production) / `noop` (tests) |
| `RESEND_API_KEY` / `EMAIL_FROM` | — | Required when `EMAIL_MODE=resend` |
| `PAYSTACK_SECRET_KEY` | — | Live Paystack; sandbox provider used when unset |
| `PLATFORM_FEE_PCT` / `CONFIRM_WINDOW_DAYS` / `REFUND_BEFORE_WORK_PCT` | 10 / 3 / 100 | Business policy |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Idempotent admin bootstrap (password ≥12 chars) |
| `STORAGE_PROVIDER` + `R2_*` | stub | `r2` enables Cloudflare R2 uploads |
| `WORKER_MODE` | inline | `external` disables the in-process worker (`npx tsx src/worker.ts`) |
| `PG_POOL_MAX` | 10 | DB pool size |

`validateProductionConfig()` refuses to boot `NODE_ENV=production` with
missing/weak values — see `src/lib/config.ts`.

## Endpoints

### Catalogue & content (Phase A)
`GET /categories · /services[/:slug[/reviews|/availability]] · /professionals[/:slug[/reviews|/services]] · /testimonials · /plans · /faqs · /stats` and `POST /contact`

### Auth (Phase B) — `/api/v1/auth/*` + `GET /me`
register, login, refresh (rotating cookie + family reuse detection),
logout, verify-email (+resend), forgot-password, reset-password.

### Professional (Phase C) — `/api/v1/applications*`, `/api/v1/pro/*`
Application lifecycle (draft → submit → admin review), profile, skills,
portfolio, uploads (presigned), service CRUD + publish lifecycle.

### Bookings & payments (Phase D)
Booking creation (Idempotency-Key), pay (provider checkout), signed
webhook capture, accept/start/deliver/confirm/cancel/dispute/review,
earnings + payouts.

### Admin (Phase E) — `/api/v1/admin/*` (DB-verified admin role, fully audited)

| Method | Path | Description |
|---|---|---|
| GET | `/admin/stats` | Operational counters |
| GET | `/admin/applications?status=` | List applications |
| POST | `/admin/applications/:id/approve` | Approve (transactional role promotion + profile) |
| POST | `/admin/applications/:id/reject` | Reject with optional feedback |
| GET | `/admin/services?status=` | List services incl. drafts/paused |
| POST | `/admin/services/:slug/pause` / `unpause` | Moderation (CAS) |
| GET | `/admin/users?q=` | Search users |
| POST | `/admin/users/:id/suspend` / `reinstate` | Suspend revokes sessions; no self/admin targets |
| GET | `/admin/bookings[?status=]` · `/admin/bookings/:id` | Monitoring + event timeline |
| POST | `/admin/bookings/:id/resolve` | Dispute resolution `{decision: release\|refund}` |
| GET | `/admin/payouts?status=` · POST `/admin/payouts/:id/retry` | Payout monitoring + retry |
| GET | `/admin/audit?entity=` | Read-only audit log |

Error envelope everywhere: `{error:{code,message,status[,errors]}}`.

### Meta
`/healthz` (liveness) · `/readyz` (readiness: db + queue + storage, 503
when degraded) · `/api/v1/docs` (OpenAPI).

## Tests

```bash
npm test        # 128 integration tests (catalogue + auth + professional + bookings + admin + hardening)
```

## Production notes

- See `docs/PRODUCTION_HARDENING.md` (design) and `docs/LAUNCH_AUDIT.md`
  (honest launch-readiness audit — what is code-verified vs. what still
  needs infrastructure/third-party verification).
- The server refuses to boot in production with missing/weak config.
- Cookies get `secure: true` automatically in production; HTTPS required.
- Run the worker as a separate process in production
  (`WORKER_MODE=external` + `npx tsx src/worker.ts`); point `REDIS_URL`
  at Redis to swap PgQueue for BullMQ (documented driver seam in
  `src/lib/jobs.ts`).
