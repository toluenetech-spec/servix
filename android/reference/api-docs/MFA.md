# Restricted MFA increment — local implementation, default off

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


## Implemented

- Registration: password + confirmation UI (one email field), email OTP, choose
  and prove TOTP or passkey, save recovery codes, then receive a full session.
- Password login: password, email OTP, existing enrolled factor or recovery code.
  A client cannot change a stored method to bypass it.
- Reset: email OTP, existing factor/recovery code, strong new password. Email alone
  cannot reset an enrolled factor. Existing access and refresh sessions are revoked.
- Existing unenrolled users: password and email proof allow restricted enrollment.
  Unenrolled users without their password require support; email-only recovery is
  intentionally unavailable under this policy. Approve that rollout policy first.
- Recovery codes: eight random 96-bit codes, keyed digests in the database,
  single-use under a user row lock; redemption revokes prior sessions. Enrollment,
  recovery use and password reset have transactional audit records and queued
  owner notifications. Delivery has not been verified with a real provider.
- Guided `/security-check` screen: status restoration, local QR generation, manual
  setup key, passkey cancellation/errors, resend countdown, recovery download and
  acknowledgement, success/error/busy states and confirmed-password reset.

## New-device sign-in alerts (2026-10-04)

`src/lib/loginAlerts.ts` (+ pure helpers in `src/lib/deviceInfo.ts`), wired into `issueSession` in `src/routes/auth.ts`.

- **Trigger**: every completed sign-in that starts a *new* refresh-token family — password login, Google sign-in, and the
  security-check flow (`/auth/security/finish`). `/auth/refresh` passes the existing `familyId` and therefore never alerts.
- **"New device"** = the account already has at least one earlier `refresh_tokens` row and none of them came from the
  same browser family + operating system (`describeDevice`: e.g. "Chrome on Android", "Safari on iPhone",
  "Microsoft Edge on Windows"). Two different Android phones on Chrome are the *same kind* of device (no alert);
  Android → iPhone alerts. The first session of a brand-new account (registration) never alerts.
- **What happens**: in-app notification `security.new_device` (link `/dashboard/settings`), audit row
  `security.new_device`, and the email `newDeviceSignInMail` — subject *"New sign-in to your Servix account from
  <device>"* with device, Lagos time, forwarded client address (display only; first `X-Forwarded-For` hop, validated),
  and a **Secure my account** button to `/forgot-password`. A password reset bumps `authVersion`, which signs every
  device out, so that single action is the containment step. The email contains no sign-in links, tokens or codes.
- **Never blocks sign-in**: the whole check is try/caught and logged; the email is enqueued through the existing
  PgQueue (`email.send`, idempotency key `new-device-<sessionId>`), so a Brevo outage cannot fail a login.
- **Switch**: `LOGIN_ALERTS=false` disables the email only (notification + audit still written). No new tables, no
  migration, no new required env vars.
- **Tests**: `tests/login-alerts-local.test.ts` — UA/IP helpers run always; the end-to-end flow (register → same-kind
  device → new device → refresh → repeat device → second new device, plus the `LOGIN_ALERTS=false` variant) runs with
  `RUN_LOCAL_SECURITY_TESTS=1` on an embedded PostgreSQL.

## Security boundaries

Restricted random cookie: HttpOnly, SameSite=Lax, Secure in production, auth-only
path, 15-minute expiry, hashed server-side. No app token before all required steps.
Server tracks purpose/stage; Origin guards protect credential-entry and restricted
cookie actions. API responses are no-store. Full sessions carry MFA and auth-version
claims; activation rejects old non-MFA sessions. Reset/recovery invalidate sessions.

Email OTP: six digits, 10-minute expiry, purpose-bound HMAC, encrypted queue payload,
60-second cooldown, five sends/hour/account. Shared persistent verification-failure
budget: ten/hour/account, in addition to route/IP limiting. Reset responses hide
account/method details before email proof; cooldown/budget responses are generic.
This is response-shape protection, not a claim of constant-time account lookup.

TOTP: standard SHA-1 / six digits / 30 seconds, +/- one time window, last-step replay
protection, AES-GCM encrypted secret. Google Authenticator branding cannot enforce
which compatible app a person uses. Keep server/device clocks synchronized.

Passkeys use SimpleWebAuthn: exact origin and RP checks, signed challenge, user
verification required, credential ownership, single-use challenges and counter
handling. Device biometrics never reach Servix. Test on real devices before rollout.
Recovery envelopes/temporary enrollment secrets are encrypted and removed on normal
completion. There is not yet a retention sweep for expired abandoned security flows.

## Configuration and deployment gates — do NOT enable yet

`AUTH_MFA_ENABLED=false` is the default. When enabled, it takes precedence over the
standalone `EMAIL_VERIFICATION_OTP` feature. New registration/reset passwords must
be 12–200 characters with upper/lowercase, number and symbol; existing passwords
remain accepted at login to avoid silently locking out legacy users.

Required in production before activation:
- `AUTH_SECURITY_SECRET`: independently generated random secret, at least 32 chars.
  Back it up securely. No key-rotation/versioning tooling exists yet; changing or
  losing it makes stored authenticators and pending encrypted mail unreadable.
- `AUTH_WEBAUTHN_RP_ID=servix.name.ng`.
- `AUTH_WEBAUTHN_ORIGINS=https://servix.name.ng,https://www.servix.name.ng`.
  CORS must also permit the actual frontend. Do not add wildcard origins. Preview
  domains cannot use a production-domain passkey; use an isolated test RP/database.
- Real Brevo transport, verified sender, queue worker and end-to-end email checks.

Two additive migrations exist: `20260926000000_email_verification_otp` and
`20260926100000_security_flows`. They have run ONLY in disposable loopback test DBs.
After explicit approval, take an appropriate backup and run `npm run db:migrate`
once from a controlled machine. Never at server startup/predeploy. No reseeding,
new Neon database, Redis, paid auth service or separate worker is required.
The schema must be migrated before running this API build, even with flags off.

Reconcile this branch's older deployment baseline against main before any proposed
release. Do not revert the production deployment fixes. Do not casually toggle MFA
off as rollback: that reopens legacy password-only paths and recovery behavior.

## Tests and remaining work

From repository root:
```
node --test tests/registrationValidation.test.js
npm run build
cd api
npm run typecheck
npx vitest run tests/security-crypto.test.ts tests/email-otp-crypto.test.ts
RUN_LOCAL_SECURITY_TESTS=1 npx vitest run tests/security-local.test.ts
RUN_LOCAL_OTP_TESTS=1 npx vitest run tests/email-otp-local.test.ts
```
Local integration suites override DATABASE_URL before importing the app and create
then remove private PostgreSQL clusters on loopback ports 55440/55439. They do not
use configured Neon. If installed with scripts disabled, the embedded-postgres
package may need its native hydration script before tests can run.

Tests cover restricted sessions, skipped steps, origin denial, TOTP proof/replay,
recovery acknowledgement/single-use and revocation, persistent budgets, expiry,
resend, concurrent step consumption, suspension, generic reset metadata, old-session
and legacy-reset denial, and virtual ES256 WebAuthn registration/authentication,
origin/UV/counter rejection. A virtual credential is not a real-browser/device test.

Still pending before the full agreed policy is complete:
- Google/GitHub OAuth is now implemented locally (see OAUTH.md); live provider testing is pending.
- Credential replacement and recovery-code regeneration after strong proof;
  current password reset preserves the enrolled method. No email-only replacement.
- Eleven local browser UI/virtual-passkey tests now pass (see LOCAL_VERIFICATION.md); actual device passkey testing is still pending.
- Live email delivery and owner notifications; no third-party verification yet.
- Retention cleanup, key rotation procedure, operational recovery review, staged
  rollout and legacy/admin enrollment plan. No claim of production readiness.

No push, PR, merge, production migration, deployment or certificate purchase has
been authorized/performed for this increment.

## Subsequent adversarial review

See [SECURITY_TEST_REPORT.md](SECURITY_TEST_REPORT.md) for reproduced session/replay
findings, fixes and limitations. Latest verification: 64 API + 7 registration +
11 browser tests passed (82 total). Earlier counts above describe the prior checkpoint.
