# Email verification OTP — staged implementation, not deployed

This increment implements registration email ownership confirmation only. It does
not enforce the agreed MFA login/enrollment/reset policy yet. Do not enable in
production until that integration and existing-account transition are tested.
No Neon migration, seed, provider send, PR, push or deployment was performed.

## Configuration (names/placeholders only)

- `EMAIL_VERIFICATION_OTP=false` (default). Set true only for staged OTP testing.
- `EMAIL_OTP_SECRET=REPLACE_WITH_32_PLUS_RANDOM_CHARACTERS`. Dedicated server-only
  key for HMAC digests and AES-256-GCM queue envelopes using separate derived keys.
  Keep it stable while codes/jobs are pending. Rotation invalidates pending codes
  and queued messages; plan a purge/reissue rather than silent retry storms.
- `EMAIL_LOGO_URL=https://www.servix.name.ng/brand/servix-email-logo.png` (optional;
  defaults to APP_BASE_URL plus this path). Use a public HTTPS PNG, no private URL.
- Existing Brevo sender, key and transport remain unchanged. Codes are never
  printed through the console transport. Tests use noop, not external mail.

The additive `20260926000000_email_verification_otp` migration is prepared, not
applied to production. An approved operator must run migration manually once
from a controlled machine before enabling. Never run at startup/pre-deploy.
Frontend should be deployed before backend enablement. Old frontends cannot
submit OTPs. Old verification links are refused while the flag is on.

## API / security

- GET `/api/v1/auth/verification-method`: `otp` or `link`.
- Existing registration and authenticated resend issue OTPs when enabled.
- POST `/api/v1/auth/verify-email/code`: authenticated `{ code: "123456" }`.
  The user ID comes only from the session, never an arbitrary posted email.
- Six random digits, 10-minute expiry, one-use, user/nonce/purpose-bound HMAC.
- User-row locks serialize issue/verify, including first issue. Five guesses per
  hourly issuance window, five sends per hour, minimum 60 seconds between sends.
  Resends rotate the nonce and preserve the window's consumed attempt budget.
- Challenge and encrypted email job written in one transaction. Old queued codes
  are skipped if expired, consumed or superseded. A mail already in flight may
  still arrive after a resend; only the latest code will verify.
- Wrong attempts commit before returning an error. Successful consumption and
  user update are atomic. Suspended/deactivated/deleted accounts are rejected.
- OTP queue plaintext is decrypted only at delivery. Completed OTP job payloads
  are erased. Provider error bodies are not stored because they may reflect codes.
- UI says queued, not delivered. It supports paste, autofill, cooldown, errors,
  expired sessions and actual server-confirmed success. No mock success states.

## Tests

`node --test tests/registrationValidation.test.js` (repository root)

From api:
- `npm run typecheck`
- `npx vitest run tests/email-otp-crypto.test.ts`
- `RUN_LOCAL_OTP_TESTS=1 npx vitest run tests/email-otp-local.test.ts`

Local integration tests create a fresh temporary PostgreSQL cluster bound only
on loopback port 55439, override DATABASE_URL BEFORE imports, load fixture schema,
and remove the cluster afterward. They never use an existing or remote database.
On Linux, embedded-postgres requires its packaged library symlinks hydrated (npm
postinstall); minimal systems may also need the test's C locale override.
Prisma generation in this sandbox used `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true`
only to avoid a blocked binary download; generation itself uses Prisma's WASM.
Never use that override for migrations.

Still needed: full route/browser regression suite, actual Brevo delivery, full
MFA implementation, staged rollout/backout review, upstream deployment reconcile.
Rollback flag to false restores link verification; retain additive table and key
until pending jobs are drained. Do not remove the table beneath a running worker.

## Sender profile image vs email body logo

The supplied PNG and HTML template brand the EMAIL BODY only. They do not set
Gmail/Outlook's sender avatar. Inbox avatars are controlled by mailbox providers.
Google's official BIMI instructions require a VMC/CMC and enforcing DMARC policy:
https://support.google.com/a/answer/10911320
Do not promise a universal free avatar, purchase certificates, or change DMARC
from p=none until all legitimate senders have been audited and owner approves.
