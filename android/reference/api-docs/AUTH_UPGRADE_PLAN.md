# Authentication upgrade — agreed scope and implementation status

## Status

Implemented locally, default OFF: confirmed-password registration UI, email OTP,
restricted registration/login/reset flows, Google Authenticator-compatible TOTP,
passkey enrollment/verification, recovery codes, session revocation, and a guided
security-check screen. Strong new-password rules are enforced when MFA is enabled.
See [MFA.md](MFA.md) for implementation, tests, limitations and rollout gates.

Google/GitHub OAuth and explicit MFA-protected linking are implemented locally; see [OAUTH.md](OAUTH.md). Live Brevo delivery and real-device/browser
WebAuthn are NOT verified. Factor replacement/recovery-code regeneration UI is NOT
implemented. This is not the completed or deployed agreed authentication policy.
Both additive migrations were exercised only on disposable local PostgreSQL,
never Neon. No push, PR, merge, deployment, or production migration was performed.

The Arena checkout began at bbe090718e9e199c2206bdccd2a0f1e83fedb3e4;
production main was verified earlier at 80674544b9df8352c571a4ac9d0a86ceb1759e23.
Auth route/mailer/queue/schema and verification client files were compared with
fetched main and matched before OTP edits. Deployment files have not been merged.
Reconcile remaining upstream changes before any deployment PR;
never overwrite the production Dockerfile/deployment fixes with this older base.

## Agreed flows

- Email registration: confirm password, email OTP, then mandatory
  enrollment and proof of either TOTP or passkey before issuing a full session.
- Password login: password, email OTP, then proof of the enrolled TOTP/passkey.
- Google/GitHub login: provider authentication, then enrolled TOTP/passkey.
  First-time accounts require enrollment before full access.
- Password reset: email OTP plus existing enrolled factor (or recovery code),
  then change password. Email alone must never replace an existing factor.
- Persist enrolled method; never let the client claim a different factor as a bypass.
- TOTP setup guides Google Authenticator; the standard cannot enforce app brand.
- Passkey in this policy is a second step, not a passwordless bypass.

## Security acceptance checklist (implemented and pending; see MFA.md)

- Server-enforce new password rules on registration/reset, not existing login.
- Durable restricted challenges: purpose, stage, expiry, attempt budget, resend
  budget, user and browser binding. No usable access/refresh tokens before MFA.
- Email OTP: cryptographically random six digits, short expiry, keyed digest,
  constant-time checks, atomic one-use consume and rate limits across instances.
- TOTP: authenticated encryption of secrets with managed env key, confirm setup,
  narrow clock tolerance, atomic replay prevention; never log secret/QR payload.
- WebAuthn: vetted library, RP ID servix.name.ng, exact HTTPS origin allowlist,
  user verification required, single-use challenges, credential ownership checks,
  proper handling of backup/synced authenticators and signature counters.
- OAuth: state, PKCE where supported, Google OIDC nonce/issuer/audience/signature
  validation, GitHub server-side exchange and verified email handling. Identify
  by immutable provider ID. Never silently link existing/admin accounts by email.
- Recovery codes: strong random values, hash at rest, reveal once, single-use
  atomic redemption. Recovery revokes sessions and notifies the account owner.
- Existing users/admin bootstrap need restricted enrollment on next login;
  old access/refresh paths must not bypass new stages. Preserve suspension guards.
- No Redis/new database. Keep Fastify + Prisma/Neon + inline PgQueue/Brevo.
- No credential values in repository, chat, logs, query strings or browser storage.

## UX acceptance

Accessible guided steps, resumable restricted flow, paste/autofill-friendly OTP,
resend countdown with server enforcement, wrong/expired/locked code states,
passkey cancellation and unsupported-browser recovery, enrollment proof,
recovery-code save confirmation, durable success/error states. Never show a
success screen before the server confirms the step. Email comparison is trimmed
and case-normalized; passwords compare exactly. Allow password-manager paste.

## Deployment and verification

Prepare an additive migration but run manually once from a controlled machine
only after explicit approval. Never startup/pre-deploy migrations or reseeding.
Provider consoles require owner clicks; secrets entered directly into Railway.
Test challenge expiry/replay/races, rate limits, factor substitution, OAuth
linking takeover, partial enrollment, recovery, old sessions, suspended users,
real browser WebAuthn and real email delivery. Stage before production rollout.
No merges during this Arena session. Remain on arena/01a0dc4c-servix.

Separate unresolved incident: old admin account remains active with an exposed
password; owner declined suspension. Do not mistake new MFA work for remediation.
