# Google / GitHub sign-in — local implementation, not activated

## Current evidence

Google/GitHub code, restricted MFA handoff, explicit linking, guided provider buttons
and connected-sign-in page are implemented locally. No real credentials have been
read or used; no live provider sign-in/email delivery has been tested. Flags remain
OFF. No push, PR, merge, deployment, or Neon migration has occurred.

Automated tests use locally signed Google ID tokens, simulated provider responses,
and disposable loopback PostgreSQL on port 55441. The OAuth migration is tested
there, not on Neon. The complete targeted API suite plus registration validation
currently contains 60 passing tests (19 new OAuth tests).

Eleven Playwright browser tests now PASS in local Chromium, including a virtual
WebAuthn registration, recovery-code acknowledgement and explicit linking completion.
API responses are intercepted fixtures, not a live backend/provider round trip.
The normal browser CDN download failed; Chromium 153 was obtained via the npm
registry with temporary runtime libraries outside Git. Real device, consent and
production-cookie round-trip testing remain rollout gates. See LOCAL_VERIFICATION.md.

## Flow and account linking

- POST `/api/v1/auth/{google|github}/start` requires an allowed Origin and enabled
  provider. Returns a fixed provider authorization URL and sets a 10-minute
  HttpOnly, SameSite=Lax, Secure-in-production browser-binding cookie.
- Provider callback is GET `/api/v1/auth/{google|github}/callback`. Exact callback
  addresses match the owner's provider-console setup. State is random, hashed,
  provider/browser-bound, expiring and atomically single-use across API instances.
  PKCE S256 is used for both providers. Verifier/Google nonce are encrypted at rest;
  the envelope is cleared on consumption, even if the provider denies access.
- Google ID token verification uses jose + Google's JWKS and verifies RS256
  signature, issuer, audience/authorized party, nonce, age/expiry and verified email.
- GitHub uses the newly exchanged token to fetch `/user` and `/user/emails` from
  fixed HTTPS endpoints. Only verified primary email is accepted. Mutable handles
  and arbitrary public-profile emails are not trusted as identity.
- Bindings are keyed by immutable `(provider, subject)`, not email. Known identities
  reuse the stored user even if provider email changes. New identities whose email
  matches ANY existing account (including admin) are refused and instructed to
  sign in first. Roles are never taken from a provider; new accounts are customers.
- New social users have a deliberately non-password marker (`!oauth-only`), cannot
  sign in with that marker, and must enroll/prove a factor and save recovery codes.
  They may establish a password later through email + existing-factor recovery.
- Returning social users go directly to their saved factor. No extra email OTP is
  requested after verified provider identity. Full app sessions are issued only
  after completion of the restricted flow. Suspended/deleted users are rejected.
- Explicit linking: sign in normally, visit `/connected-sign-in`, choose a provider.
  POST `/auth/{provider}/link` requires a full MFA-authenticated access token and
  allowed Origin. The attempt binds the user and auth-version. Callback checks that
  version, verifies provider identity, then requires a fresh existing factor or
  recovery code. The pending provider is saved only in the final user-locked finish
  transaction. Unique constraints prevent reassigning identities from other users.
  An audit event and owner notification are queued. No provider unlink/switch UI yet.
- Provider access/refresh tokens are not persisted or sent to the browser. API
  callback logs omit query strings; no raw provider errors/tokens are logged.
  Review upstream proxy/access logging separately before activation. Frontend
  redirects are fixed to the configured app origin, never a client-supplied URL.

## Configuration — server only

Never put provider secrets in `VITE_*`, chat, screenshots or Git. Enter them in
Railway's API-service variables only after approving the rollout/configuration step.
Changing hosted variables may trigger a deployment; this document does not authorize it.

| Variable | Value/source |
| --- | --- |
| `AUTH_OAUTH_ENABLED` | `false` until rollout approved |
| `AUTH_MFA_ENABLED` | Must be `true` when OAuth is activated |
| `AUTH_SECURITY_SECRET` | Stable securely generated MFA encryption secret, >=32 chars |
| `AUTH_OAUTH_APP_ORIGIN` | `https://www.servix.name.ng` |
| `AUTH_GOOGLE_CLIENT_ID` | Google OAuth Web client ID |
| `AUTH_GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `AUTH_GOOGLE_REDIRECT_URI` | `https://api.servix.name.ng/api/v1/auth/google/callback` |
| `AUTH_GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `AUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `AUTH_GITHUB_REDIRECT_URI` | `https://api.servix.name.ng/api/v1/auth/github/callback` |

CORS must include the frontend origin. Use the same frontend origin for starting
and returning from OAuth. Production startup rejects partial provider credentials,
OAuth without MFA, non-HTTPS/malformed callbacks and untrusted frontend origins.
To enable only one provider, omit all three variables for the other provider.
`VITE_API_URL` remains the existing API base; the frontend discovers enabled
providers from `/api/v1/auth/oauth/config` and receives no client secrets.

Provider console setup remains separate: Google is in Testing with the owner's test
user; do not publish until consent branding/domain/privacy requirements are reviewed.
GitHub must be an OAuth App (not a personal access token). Scopes request identity
only: Google `openid email profile`; GitHub `read:user user:email`, no repositories.

## Schema, tests and rollout gates

Additive migration `20260926200000_oauth` adds OAuth identities/attempts and a pending
identity field on restricted flows. Requires the previous OTP/MFA migrations first.
All must be applied manually ONCE from a controlled machine after explicit approval,
never startup or predeploy. No reseeding/new Neon database/Redis is needed. The new
schema is required before this API build runs, even with feature flags off.

```
# api/ — disposable local DB; no live provider requests
RUN_LOCAL_OAUTH_TESTS=1 npx vitest run tests/oauth-local.test.ts tests/oauth-provider.test.ts
# root — UI fixtures, no live API/provider calls; browser install required
npx playwright install chromium
npx playwright test
```

Still required: real consent/callback cookie tests with both providers; real passkey
and email delivery tests; secure encryption-key backup/rotation;
expiry cleanup for abandoned attempts/security flows; factor replacement and recovery
code regeneration; staged legacy/admin enrollment and rollout review. Dependency
updates now yield zero reported vulnerabilities in root and API npm audits; this
is not a complete security audit or a production-ready claim. See LOCAL_VERIFICATION.md
for versions, compatibility checks and remaining rollout requirements.

Reconcile this branch's older deployment baseline against main before any approved
release. Do not overwrite production deployment fixes. Never roll back by casually
turning off MFA, which would reopen legacy password-only/reset routes.

## References consulted

- https://developers.google.com/identity/openid-connect/openid-connect
- https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps

## Subsequent adversarial review

See [SECURITY_TEST_REPORT.md](SECURITY_TEST_REPORT.md) for reproduced session/replay
findings, fixes and limitations. Latest verification: 64 API + 7 registration +
11 browser tests passed (82 total). Earlier counts above describe the prior checkpoint.
