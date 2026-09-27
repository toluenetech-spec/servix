# SERVIX API — blitz.cloud handoff

Session handoff for moving the backend API from Render to blitz.cloud.
Last updated: 2026-09-25. Preparation and verification only — nothing here
deploys anything by itself.

## 1. Project overview

Servix is a professional services marketplace. Monorepo with two deployables:

- **Frontend:** Vite + React SPA. Deploys to Vercel from the `main` branch.
  Live at https://servix-two.vercel.app (custom domain `servix.name.ng`
  still being connected — see Open items).
- **Backend:** Fastify 5 + TypeScript API in `api/` (backend phases A–E,
  version 0.6.x). Currently on Render at
  https://servix-api-ugfs.onrender.com — it works but has slow free-tier
  cold starts, which is why it is moving to blitz.cloud. Frontend stays
  on Vercel.

External services stay exactly as they are — do not migrate or restructure:

- **Neon PostgreSQL.** Already migrated AND already seeded. Do NOT
  re-migrate or re-seed.
- **Cloudflare R2** (S3-compatible) for object storage, bucket
  `servix-storage`.
- **Brevo** for transactional email. Sender domain not verified yet.
- **Paystack** for payments — still on TEST keys.
- **Background jobs: PgQueue**, a Postgres-backed queue. There is NO
  Redis in this deployment. (`src/lib/jobs.ts` can optionally activate
  BullMQ if `REDIS_URL` is set — leave it unset on Blitz so PgQueue
  is used. Do not add Redis.)

## 2. `api/` file map

Entry point and app:

- `src/server.ts` — entry point. Runs the production boot gate, builds
  the app, bootstraps the admin account (idempotent), starts the
  background worker inline (unless `WORKER_MODE=external`), calls
  `listen()`, and handles `SIGTERM`/`SIGINT` graceful shutdown
  (HTTP close → finish in-flight job → DB disconnect).
- `src/app.ts` — Fastify app factory. Serves `GET /healthz` (liveness,
  returns `{ ok: true }`), `GET /readyz` (readiness, returns
  `{ ready, checks: { database, queue, storage } }` with HTTP 200 when
  ready and 503 when not), OpenAPI docs at `/api/v1/docs`, and all
  `/api/v1/*` routes (catalogue, auth, onboarding, bookings, payments,
  webhooks, admin).
- `src/worker.ts` — standalone worker entry for `WORKER_MODE=external`
  deployments. Not used on Blitz (Blitz runs one container; the worker
  runs inline).

Configuration and data:

- `src/lib/config.ts` — env parsing (`loadConfig`,
  `resolveEmailMode`, `resolveStorageEnv`) and the production boot
  gate `validateProductionConfig()` (see section 5).
- `src/lib/db.ts` — Prisma client via `@prisma/adapter-pg`. Imports
  the generated client from `../generated/prisma/client.js` and reads
  `DATABASE_URL` / `PG_POOL_MAX`.
- `prisma/schema.prisma` — Prisma 7 schema. The generator writes to
  `../src/generated/prisma`, which is git-ignored and produced only by
  `prisma generate`.
- `prisma.config.ts` — Prisma config (schema path, migrations path,
  seed script, pg adapter).
- `scripts/migrate.ts` — minimal migration runner, interchangeable
  with `prisma migrate deploy` (exists for environments that block
  binaries.prisma.sh). Run MANUALLY from a controlled machine —
  never at container startup.
- `src/lib/password.ts` — scrypt password hashing (Node built-in, no
  native deps). Hashes are self-describing
  (`scrypt$N$r$p$salt$hash`); `verifyPassword` reads the parameters
  from the stored hash, so old hashes keep verifying. `SCRYPT_LOG2_N`
  makes the cost factor configurable (default 2^17, the OWASP
  interactive default; 2^15 is ~4x faster on low-CPU free-tier hosts).
- `src/lib/jobs.ts` — PgQueue background worker plus `queueHealthy()`
  (used by `/readyz`).
- `src/routes/auth.ts` — auth routes plus `bootstrapAdmin()`: if
  `ADMIN_EMAIL` exists it only ensures the admin role; the password
  (`ADMIN_PASSWORD`, minimum 12 characters) is used only when the
  account does not exist yet.
- `package.json` — `build` is `tsc`, `start` is `node dist/server.js`.
  Note `prisma` and `typescript` are devDependencies.

Container and deployment files:

- `Dockerfile` — multi-stage linux/amd64 build for blitz.cloud
  (see section 4).
- `.dockerignore` — keeps `node_modules`, `dist`, local `.env` files,
  `src/generated`, and patches out of the build context.
- `.env.production.example` — template of every Blitz env var. Names
  only, `REPLACE_…` placeholders, never real credentials.
- `.github/workflows/blitz-image.yml` (repo root) — builds the image
  on PR/push (build-only) and publishes to Docker Hub only on a
  manual run with `publish` ticked.

## 3. The blitz.cloud container contract

From Blitz's docs and their examples repo
(https://github.com/blitzworks-io/blitz-cloud-examples). The image
must obey all of these:

- Blitz hosts PUBLIC Docker Hub images. It does not build from GitHub.
- Image platform must be `linux/amd64`.
- The container runs as UID/GID `1000:1000` with all Linux
  capabilities dropped.
- Exactly ONE HTTP port, declared with `EXPOSE`. Servix uses `8080`.
- All configuration arrives through environment variables.

## 4. What was changed and why

1. **Merged `phases-full` into `main`.** `main` was missing two
   `phases-full` commits: `api/Dockerfile` + `api/.dockerignore`
   (added) and the `SCRYPT_LOG2_N` change in
   `api/src/lib/password.ts`. The merge was content-verified as a
   clean one-way gap (no conflicts); `main` is now the complete
   branch.
2. **Replaced `api/Dockerfile`** with a multi-stage build:
   - Build stage on `node:22-slim` (NOT alpine — Prisma needs glibc):
     `npm ci`, `prisma generate`, `tsc`, then `npm prune --omit=dev`.
     Dev dependencies are NOT pruned before generate/build because
     `prisma` and `typescript` are devDependencies.
   - `src/generated` is copied into `dist/generated` explicitly
     (non-`.ts` files deleted from the copy: `find … -name '*.ts'
     -delete`). Reason: the Prisma generator writes to the
     git-ignored `src/generated/prisma`, `tsc` compiles only `.ts`
     files, and `src/lib/db.ts` imports `../generated/prisma/client.js`
     — without this step any non-TypeScript asset the generator emits
     would be missing from `dist/` and the container would crash on
     boot. Do not remove it.
   - Runtime stage on `node:22-slim` with `USER node` (the image's
     built-in UID 1000 user, which is what Blitz requires), a single
     `EXPOSE 8080`, `STOPSIGNAL SIGTERM` (matches the `SIGTERM`
     handler in `src/server.ts`), and `CMD ["node", "dist/server.js"]`.
   - The old Dockerfile ran the server via `tsx` at runtime as root
     and shipped the whole dev toolchain. That is not acceptable for
     Blitz and is gone.
   - `HEALTHCHECK` probes `/healthz` (liveness only; `/readyz` remains
     for operational checks) with `--start-period=20s` so a slow cold
     start (Neon wake-up, Prisma initialisation) is not counted as a
     failed probe. `--start-period` is valid Docker syntax; the
     unmaintained `dockerfilelint` package flags it as a stale false
     positive — do not "fix" it.
3. **Added `api/.env.production.example`** — the Blitz env-var
   template. Every name was cross-checked against what the code
   actually reads. One note: `PAYSTACK_PUBLIC_KEY` is included for
   completeness (keys are issued as a pair) but the API code only
   reads `PAYSTACK_SECRET_KEY`.
4. **Added `.github/workflows/blitz-image.yml`** — PR/push builds are
   build-only (nothing published, nothing deploys); publishing
   happens only on a manual run with `publish` ticked. The publish
   flag is computed at JOB level from the `github`/`inputs` contexts
   because the `secrets` context cannot be referenced from an `if:`
   condition and is not dependable in a workflow-level `env:` block —
   secrets are read only in a step's `env:` and an action's `with:`.
   Keep it that way.

## 5. The production boot gate (do not weaken)

With `NODE_ENV=production`, `src/server.ts` calls
`validateProductionConfig()` and exits with status 1 unless ALL of
these hold:

- `AUTH_JWT_SECRET` set and at least 32 characters
  (`loadConfig()` also throws on this independently)
- `DATABASE_URL` set
- `PAYSTACK_SECRET_KEY` set
- `APP_BASE_URL` starts with `https://`
- `EMAIL_MODE` is not `console`/`noop`, and its API key is present
  (`brevo` requires `BREVO_API_KEY` and `EMAIL_FROM_EMAIL`;
  `resend` requires `RESEND_API_KEY`)
- if storage is enabled (`STORAGE_PROVIDER=r2` or `STORAGE_DRIVER=s3`):
  account id (or a valid `STORAGE_S3_ENDPOINT`), access key, secret
  key, bucket, AND public base URL must all be present
- `ADMIN_EMAIL` set
- `SERVIX_REVIEW_KEY` is not left on its dev default

A container that exits immediately is almost always this gate working
correctly, not a bug in the image. Read the `FATAL:` log lines — they
name the missing variable.

## 6. Verification levels (as of 2026-09-25)

Reported honestly, never blurred:

- **CODE VERIFIED** — static checks passed on this branch:
  every `COPY` source in the Dockerfile exists; env names in
  `.env.production.example` cross-checked against what the code reads;
  no real `.env` files tracked (template carries `REPLACE_…`
  placeholders only); workflow YAML parses; Prisma generator output
  path matches the `db.ts` import and the `dist/generated` copy step;
  `prisma`/`typescript` run before the dev-dependency prune;
  `node:22-slim` (glibc), `USER node` (UID 1000), single
  `EXPOSE 8080`, `STOPSIGNAL SIGTERM` matching the server's shutdown
  handler; healthcheck target `/healthz` exists and `/readyz` returns
  `{ ready, checks }`; template covers every boot-gate requirement.
- **INFRASTRUCTURE NOT VERIFIED** — the image has not been built and
  no container has served `/healthz`/`/readyz` yet. The sandbox used
  for preparation has no Docker engine. Proof is pending from (a) the
  GitHub Actions build once the workflow reaches `main`, and (b) a
  local `docker build` + `docker run` under Blitz's constraints
  (see `BLITZ_DEPLOYMENT.md` step 0).
- **THIRD-PARTY NOT VERIFIED** — nothing has been deployed to
  blitz.cloud, and Neon, R2, Brevo, and Paystack have not been reached
  from any new host.

Do not describe anything as "production ready" unless `/readyz`
genuinely returned `ready: true` from a running host.

## 7. Open items

1. Merge the preparation branch into `main` (this triggers the Actions
   build that proves the image compiles).
2. Create the PUBLIC Docker Hub repo `servix-api`, add the
   `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` repository secrets, and run
   the workflow manually with `publish` ticked.
3. blitz.cloud setup (image + immutable SHA tag, port 8080, NO managed
   database — Servix stays on Neon — plus the env vars from
   `.env.production.example` with real values).
4. After Blitz assigns an HTTPS host: set `API_BASE_URL` and restart;
   set Vercel's `VITE_API_URL` and redeploy the frontend; point the
   Paystack TEST webhook at
   `https://<blitz-host>/api/v1/webhooks/paystack`; update UptimeRobot
   to `https://<blitz-host>/readyz`.
5. Unfinished side tasks: connect `servix.name.ng` to Vercel; verify
   the sending domain in Brevo; Paystack still on TEST keys until
   end-to-end verification passes.

## 8. Rules for future sessions

- Never commit real secrets. Only `*.example` files are committed.
- Migrations run manually from a controlled machine. NEVER at
  container startup, and never re-migrate/re-seed Neon blindly.
- No Redis. PgQueue is the queue; `REDIS_URL` stays unset on Blitz.
- Keep `node:22-slim` (Prisma needs glibc), keep the
  `dist/generated` copy step, keep `prisma generate` + `tsc` BEFORE
  the dev-dependency prune, keep `USER node` and the single
  `EXPOSE 8080`.
- In the workflow, never reference `secrets` from `if:` or
  workflow-level `env:`. Keep the job-level publish flag as is.
- Do not "fix" `--start-period` on the `HEALTHCHECK` line.
- Do not weaken the production boot gate.
- Verification honesty: report code / infrastructure / third-party
  levels explicitly, and never claim "production ready" without a
  genuine `ready: true` from `/readyz` on a running host.
- The Actions workflow only runs from `main`. Changes that must be
  build-proven have to reach `main` (direct push or merged PR).
