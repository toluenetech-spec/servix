# Authentication release handoff — 2026-09-27

> **Current rollout update — 2026-09-28:** The production schema upgrade is already
> complete (8/8 migrations, owner-confirmed). Do NOT rerun migrations or reseed.
> Railway follows `arena/01a0dc4c-servix`; the auth baseline and branded emails
> have been deployed, with live readiness and owner-tested email delivery/login.
> The owner now approves password-policy deployment and staged MFA/OAuth activation.
> MFA/OAuth are still off until the hosted flags are changed and verified.
> Password creation/reset now follows PASSWORD_POLICY.md (8–200; admin reset
> composition exemption). This update supersedes the historical deployment status
> below, not the listed security limitations. Live provider/device testing and
> authenticated frontend promotion still require owner participation.


The owner has now authorized pushing and deploying the authentication work. This
supersedes the earlier no-push/no-deploy authorization notes in checkpoint reports,
but does NOT mean deployment or production migration has occurred.

## Prepared release

- Work remains on `arena/01a0dc4c-servix`; no PR, merge, or push to main.
- Current fetched main: `80674544b9df8352c571a4ac9d0a86ceb1759e23`.
- Preserved main's Dockerfile, dockerignore, example production configuration,
  deployment documentation and existing CI workflow verbatim. No container rebuild
  was performed; these deployment files were previously verified upstream.
- Fresh verification: frontend build, API typecheck/build, 64 targeted API tests,
  7 registration tests, both npm audits (zero reported vulnerabilities) and diff
  whitespace checks passed. Eleven browser tests passed in the prior checkpoint;
  they were not rerun in this release-preparation step.
- No real secrets were read, received, or added to the repository. The owner reports
  staging provider/MFA settings in Railway, with both feature flags false.

## Production is blocked pending authenticated operator steps

This workspace has GitHub access but no Railway/Vercel/Neon credentials or production
DATABASE_URL. Do not claim that a GitHub push deploys the production service: Railway
is configured to follow main, whereas this session can push only its assigned branch.

Before any new API deployment, a controlled operator must:

1. Confirm the correct Neon database and an appropriate backup/restore option.
2. Inspect `_prisma_migrations`: confirm existing baseline migrations, no unfinished
   or failed migration, and matching checksums. The current runner skips completed
   names, so this review must happen separately; never blindly rerun or reseed.
3. From this release checkout's `api/` folder on a controlled machine, run the
   approved `npm run db:migrate` manually once using the production connection in
   that machine's environment. Do not send it to chat. Expected new migrations:
   - `20260926000000_email_verification_otp`
   - `20260926100000_security_flows`
   - `20260926200000_oauth`
4. Verify migration records and schema, then deploy the intended commit with the
   preserved production Docker configuration. Coordinate both frontend and API.
   The frontend requires Node ^20.19.0 or >=22.12.0; use supported Node 22.
5. Verify `/healthz`, `/readyz`, existing sign-in, and session refresh before enabling
   new authentication. Keep `AUTH_MFA_ENABLED=false`, `AUTH_OAUTH_ENABLED=false` during
   the initial deployment. Configure no startup/predeploy migration or separate worker.

Do not change Railway's source branch or apply its staged variables before the
schema step: those dashboard actions can trigger a premature deployment. The new
Prisma client requires the additive schema even with features disabled.

## Activation is separate from deployment

Real Google/GitHub consent and callback cookies, email delivery, physical passkeys,
and existing-user/admin enrollment need controlled verification before activation.
Security-method replacement/recovery-code regeneration and operational cleanup/key
rotation remain unfinished; see MFA.md, OAUTH.md and SECURITY_TEST_REPORT.md. Do not
claim the complete agreed policy is delivered merely because dormant code deploys.
Keep the current database, Brevo, R2, PostgreSQL-backed inline queue and existing
payment mode; no reseed, new database, Redis, or paid auth service is required.
