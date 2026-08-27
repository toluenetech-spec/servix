# Servix API — Phase A (catalogue) + Phase B (accounts & authentication)

Fastify + TypeScript + Prisma + PostgreSQL backend for the Servix
marketplace. Phase A: public read-only catalogue. Phase B: real accounts
and authentication for the existing frontend auth UI.

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
| `AUTH_JWT_SECRET` | dev value | **Required in production** (≥32 chars, `openssl rand -hex 64`) |
| `AUTH_ACCESS_TTL_MIN` | 15 | Access-token lifetime (minutes) |
| `AUTH_REFRESH_TTL_DAYS` | 30 | Refresh-token lifetime (days) |
| `APP_BASE_URL` | http://localhost:5173 | Base URL for links in emails |
| `EMAIL_MODE` | console | `console` logs emails to stdout; real provider is a deploy-time swap in `src/lib/mailer.ts` |

## Authentication design (Phase B)

- **Passwords:** scrypt (N=2^17, r=8, p=1, OWASP), timing-safe compare,
  self-describing hash format (`scrypt$N$r$p$salt$hash`)
- **Access token:** JWT HS256, 15 min, returned in the response body —
  the frontend keeps it in memory only (never localStorage)
- **Refresh token:** 256-bit opaque value in an httpOnly SameSite=Lax
  cookie scoped to `/api/v1/auth`, stored sha256-hashed, **rotating** with
  family reuse detection — replaying a rotated token revokes the family
- **Email verify / password reset:** single-use sha256-hashed tokens
  (24 h / 30 min TTL); issuing a new token invalidates prior unused ones;
  password reset revokes **all** active sessions
- **Anti-enumeration:** identical responses for forgot-password on known
  and unknown emails; generic "Incorrect email or password."
- **Rate limits:** global 300/min; login/register/verify/reset 10/min;
  forgot-password 5/15 min; resend-verification 3/5 min → 429 envelope

## Endpoints

### Catalogue & content (Phase A) — unchanged
`GET /categories · /services[/:slug[/reviews]] · /professionals[/:slug[/reviews|/services]] · /testimonials · /plans · /faqs · /stats` and `POST /contact`

### Auth (Phase B) — under `/api/v1`

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create account → `{user, accessToken}` + refresh cookie |
| POST | `/auth/login` | Sign in → same shape |
| POST | `/auth/refresh` | Rotate refresh cookie → new access token |
| POST | `/auth/logout` | Revoke session family, clear cookie |
| POST | `/auth/verify-email` | `{token}` → activates account (single-use) |
| POST | `/auth/verify-email/resend` | Bearer required |
| POST | `/auth/forgot-password` | `{email}` → uniform `{ok:true}` |
| POST | `/auth/reset-password` | `{token, password}` → revokes all sessions |
| GET | `/me` | Bearer required → current user |

Error envelope everywhere: `{error:{code,message,status[,errors]}}`.

## Tests

```bash
npm test        # 61 integration tests (catalogue + auth + rate limiting)
```

Auth coverage: register (happy/duplicate/validation/roles), login
(valid/wrong password/unknown email parity), `/me` (valid/missing/garbage
token), refresh rotation + family reuse detection, logout revocation,
email verification (valid/single-use/unknown/expired), password reset
(full flow, session revocation, token single-use, strength), CORS with
credentials, and 429 rate-limit envelope.

## Production notes

- Set a real `AUTH_JWT_SECRET`; the server refuses to boot in production
  without one.
- `secure: true` is applied to cookies automatically when
  `NODE_ENV=production` — the API must be served over HTTPS.
- Cross-site deployments (frontend on Vercel, API elsewhere) work because
  the refresh cookie is scoped to the API origin and requests use
  `credentials: 'include'` with the CORS allowlist above. If the API is
  hosted on a different registrable domain, browsers require HTTPS +
  `SameSite=None; Secure` — flip `sameSite` in `src/routes/auth.ts` at
  deploy time.
