# SERVIX API — blitz.cloud deployment runbook

How to build, publish, and run the Servix API container on blitz.cloud.
Companion to `BLITZ_HANDOFF.md` (project context) — this file is the
procedure.

## 1. The blitz contract (what the platform expects)

- Blitz hosts PUBLIC Docker Hub images. It does not build from GitHub,
  so the image is built by GitHub Actions and published to Docker Hub
  first.
- Image platform must be `linux/amd64`.
- The container runs as UID/GID `1000:1000` with all Linux capabilities
  dropped — the image must work unprivileged (it does: it runs as the
  `node` user and installs nothing at runtime).
- Exactly ONE HTTP port, declared with `EXPOSE`. Servix uses `8080`;
  Blitz reads it from the image.
- All configuration arrives through environment variables (section 6).

## 2. Prerequisites

- A Docker Hub account (for the public `servix-api` repository).
- A blitz.cloud account.
- Real values for every variable in `api/.env.production.example`
  (Neon connection string, R2 keys, Brevo key, Paystack TEST keys,
  a fresh `AUTH_JWT_SECRET` of at least 32 characters —
  generate with `openssl rand -hex 32`).
- The preparation branch merged into `main` (the Actions workflow only
  runs from `main`).

## 3. Step 0 — verify locally with Docker

Do this on any machine with a Docker engine before publishing. It runs
the exact image Blitz will run, under Blitz's constraints
(unprivileged user, no capabilities):

```sh
docker build --platform linux/amd64 -t servix-api:blitz-test ./api

docker run --rm --user 1000:1000 --cap-drop ALL \
  --security-opt no-new-privileges --env-file api/.env \
  -e NODE_ENV=development -e HOST=0.0.0.0 -e PORT=8080 \
  -p 8080:8080 servix-api:blitz-test
```

(`api/.env` is your LOCAL dev values file — it is git-ignored and never
committed. `NODE_ENV=development` keeps the production boot gate out of
the way for this local check; Blitz itself runs `NODE_ENV=production`.)

In another terminal, probe it:

```sh
curl --fail http://localhost:8080/healthz
curl --fail http://localhost:8080/readyz
```

Success looks like:

- `/healthz` → HTTP 200, `{ "ok": true }`
- `/readyz` → HTTP 200, `{ "ready": true, "checks": { "database": true,
  "queue": true, "storage": true } }`

If `/readyz` returns 503, the `checks` object names the failing piece
(`database` = Neon unreachable from this machine, `queue` = PgQueue
unhealthy, `storage` = R2 fields incomplete). Fix the values, not the
image. If the container exits immediately under
`NODE_ENV=production`, that is the boot gate working correctly — read
the `FATAL:` log lines for the missing variable (see
`BLITZ_HANDOFF.md` section 5).

## 4. Publish the image to Docker Hub

1. On Docker Hub, create a PUBLIC repository named `servix-api`.
   (Blitz can only pull public images.)
2. In the GitHub repo, add two repository secrets
   (Settings → Secrets and variables → Actions):
   `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a Docker Hub access
   token, not the account password).
3. In GitHub, open Actions → "Blitz container image" → Run workflow →
   tick `publish` → Run. Ordinary PR/push builds never publish; only
   this manual ticked run does.
4. The run pushes two tags: `:latest` and `:<commit-SHA>`.
   **Deploy the SHA tag** (e.g. `username/servix-api:2228c40…`) — it is
   immutable and is what makes rollbacks safe. Note the full SHA tag
   somewhere; `:latest` moves on every publish and must never be what
   production points at.

## 5. blitz.cloud setup

1. "Host something new" → the option for an app already packaged up
   (existing/public image).
2. Select the public Docker Hub image `username/servix-api` at the
   immutable SHA tag from step 4 — not `:latest`.
3. Port `8080` (Blitz reads it from the image's `EXPOSE`).
4. Do NOT enable Blitz's managed database. Servix stays on Neon
   PostgreSQL, which is already migrated and seeded.
5. Paste the variables from `api/.env.production.example` with real
   values (no quotes in dashboard values). Required vs optional is
   listed in section 6.
6. Start the container and check `/readyz` on the assigned host. Only
   `ready: true` counts as a successful deploy.

## 6. Environment variables — required vs optional

Template: `api/.env.production.example`. With `NODE_ENV=production`
the boot gate refuses to start unless every REQUIRED item holds.

REQUIRED (gate-enforced — container exits without them):

| Variable | Requirement |
|---|---|
| `AUTH_JWT_SECRET` | set, at least 32 characters (fresh random value) |
| `DATABASE_URL` | set (Neon URL, keep `sslmode=require`) |
| `PAYSTACK_SECRET_KEY` | set (TEST key until end-to-end verification) |
| `APP_BASE_URL` | must start with `https://` |
| `EMAIL_MODE` | `brevo` (console/noop are refused in production) |
| `BREVO_API_KEY` | required with `EMAIL_MODE=brevo` |
| `EMAIL_FROM_EMAIL` | required with `EMAIL_MODE=brevo` (must be a Brevo-verified sender) |
| `ADMIN_EMAIL` | required (admin bootstrap) |
| Storage, when enabled via `STORAGE_DRIVER=s3` (all five) | `STORAGE_S3_ENDPOINT` (or `R2_ACCOUNT_ID`), `STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_BASE_URL` |

REQUIRED IN PRACTICE (not gate-enforced, but production misbehaves
without them):

| Variable | Why |
|---|---|
| `CORS_ORIGINS` | exact browser origins allowed to call the API (defaults to localhost only) |
| `API_BASE_URL` | public API address; used in payment redirect/verification URLs — set to the Blitz host once assigned |
| `ADMIN_PASSWORD` | strong (12+) password; used only if the admin account does not exist yet (otherwise existing account is kept and just ensured admin) |

OPTIONAL (sane defaults in code; the template's values are the
recommendations):

| Variable | Default / note |
|---|---|
| `HOST` / `PORT` | `0.0.0.0` / `8080` |
| `PG_POOL_MAX` | `10` in code; template recommends `5` for a small container + Neon pooler |
| `AUTH_ACCESS_TTL_MIN` / `AUTH_REFRESH_TTL_DAYS` | `15` / `30` |
| `SCRYPT_LOG2_N` | `17` (strongest); `15` is ~4x faster on low-CPU hosts; existing hashes stay valid |
| `PAYSTACK_PUBLIC_KEY` | informational only (keys are issued as a pair); the API reads the secret key |
| `PLATFORM_FEE_PCT` / `CONFIRM_WINDOW_DAYS` / `REFUND_BEFORE_WORK_PCT` | marketplace policy knobs (`10` / `3` / `100`) |
| `EMAIL_FROM_NAME` | sender display name (`Servix`) |
| `STORAGE_S3_REGION` | `auto` for R2 |
| `WORKER_MODE` | leave `inline` on Blitz so the API container also processes queued jobs |
| `REDIS_URL` | INTENTIONALLY OMITTED — Servix ships PgQueue |

## 7. Post-deploy wiring (after Blitz assigns an HTTPS host)

1. Set `API_BASE_URL` to the assigned Blitz address and restart the
   container.
2. Set Vercel's `VITE_API_URL` to that address and redeploy the
   frontend.
3. Point the Paystack TEST webhook at
   `https://<blitz-host>/api/v1/webhooks/paystack`.
4. Update UptimeRobot to `https://<blitz-host>/readyz`.
5. Keep Paystack on TEST keys until end-to-end verification passes.

## 8. Migrations policy — READ THIS

**Migrations run manually from a controlled machine. NEVER at container
startup.** The image contains no migrate-on-boot step, and none must be
added: concurrent boots would race, and a failed auto-migration can
wedge every replica at once.

When a migration is genuinely needed (Neon is already migrated and
seeded — this is for future schema changes only):

```sh
# from a controlled machine with DATABASE_URL pointed at Neon:
cd api
npm run db:migrate   # equivalent to: npx prisma migrate deploy
```

Verify against a backup-safe copy first when the change is destructive,
and deploy the matching image only after the migration succeeds.

## 9. Rollback

Every publish pushes an immutable `:<commit-SHA>` tag that never moves.
To roll back: in Blitz, re-point the service at the previous SHA tag
and restart. That is why production must always run a SHA tag, never
`:latest`. Keep a short log of which SHA is/was live (date + SHA +
reason) so the previous-good tag is always one lookup away.

## 10. Troubleshooting

- **Container exits immediately** → almost always the boot gate, not a
  broken image. Read the `FATAL:` log lines; they name the missing or
  invalid variable. Compare against section 6.
- **`/readyz` returns 503** → the `checks` object says which piece
  failed: `database` (can the host reach Neon?), `queue` (PgQueue
  healthy?), `storage` (R2 fields complete?). The process is fine;
  its dependencies or values are not.
- **Slow first boot / cold start** → Neon wake-up plus Prisma
  initialisation can take seconds. The `HEALTHCHECK --start-period=20s`
  grace window exists for exactly this; do not remove it.
- **Logins feel slow on the free tier** → lower `SCRYPT_LOG2_N` to
  `15` (existing password hashes keep verifying; only newly created
  hashes use the cheaper cost).
- **CORS errors in the browser** → `CORS_ORIGINS` must list the exact
  frontend origin(s); the API also allows `servix*.vercel.app`
  preview hosts automatically.
