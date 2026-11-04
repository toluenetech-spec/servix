# Local adversarial authentication review — 2026-09-26

## Scope and authorization

Owner-authorized testing of this checkout only, on `arena/01a0dc4c-servix`.
Used synthetic accounts and disposable loopback PostgreSQL. No attacks against
production, Google, GitHub or another tenant. No real credentials, hosting changes,
Neon migration, push, PR, merge, deployment or purchase. Features remain default OFF.

This is targeted adversarial regression testing, not an independent, comprehensive
penetration test or a guarantee that no vulnerabilities remain. Findings below refer
to the local code, not confirmed exploitation of the running service.

## Reproduced failures and fixes

Six attack assertions were observed failing before fixes and passing afterward:

| Finding | Before | Fix / passing regression |
| --- | --- | --- |
| Refresh rotation race | Six simultaneous requests using one refresh cookie produced two successful rotations in the observed run. Read/revoke/create were separate operations. | Lock the user row, re-read token state, and rotate/create in one transaction. Exactly one succeeds; subsequent reuse commits revocation of the entire family. |
| Access survives logout | A copied valid access JWT still returned HTTP 200 from `/me` after logout. | New JWTs carry a signed `sid` (session family). Auth guard verifies a current unrevoked family record; post-logout replay now returns 401. |
| Access survives refresh replay detection | Replaying an old refresh cookie revoked refresh records, but its recently issued access token still worked. | Same session-family guard now rejects access tokens after replay detection. Failure returns from the transaction rather than throwing before commit, preserving revocation. |
| Missing refresh/logout Origin checks | A supplied foreign Origin and valid cookie were accepted by the local request injector. | Reject untrusted browser origins. MFA mode also requires Origin. Both endpoints use no-store responses. This is an API-level finding; actual browser cross-site exploitation was NOT established. SameSite/CORS impose additional constraints. |
| Cancelled restricted flow remains usable | Cancellation only cleared the client cookie; replaying a saved copy could still finish the already-verified flow. | Idempotent server-side cancellation under the user lock invalidates the flow and clears pending secrets, codes and challenges. Replay now returns 401. |
| Email-only reset request disrupts verified enrollment | Starting reset for a known email invalidated the user's in-progress, already-verified enrollment flow. | An unproven reset request may supersede only other unverified reset/email flows, not verified enrollment/login/linking progress. Completed reset still revokes all flows and sessions. Recovery-code use also invalidates other pending flows. |

Token possession is a prerequisite for the session replay findings. This review did
not demonstrate theft of a token, XSS, or compromised TLS. Origin checks protect
browser requests; they cannot authenticate a non-browser caller who already has a
stolen cookie and can forge headers.

## Additional attack/control checks

- JWT payload changes to claim `admin` and unsigned `alg:none` tokens return 401;
  verifier now explicitly permits HS256 only.
- A genuine customer session gets 403 on the admin users endpoint.
- Logout racing refresh leaves no unrevoked descendant.
- Logging out one session family does not sign out a different device's family.
- Concurrent recovery-code redemption succeeds only once.
- Existing suites continue checking MFA step skipping, factor substitution,
  expiry/replay, persistent budgets, legacy weak sessions/reset denial, suspension,
  OAuth browser/state binding, provider email-collision takeover, identity ownership,
  explicit linking proof, Google issuer/audience/nonce/signature validation, and
  WebAuthn origin/user-verification/counter checks.

## Important limitation: bearer token theft

An explicit test confirms that a copied, unexpired, unrevoked bearer access token
works from another IP/user agent. That is the bearer-token model, NOT a solved
attack. It stops working after its family is logged out/revoked or the token expires.
IP/user-agent binding was deliberately not added: both are unreliable and spoofable,
and strict IP binding breaks mobile networks. Device-bound proof/DPoP would require
a separate protocol and client design. Preventing theft still depends on HTTPS,
HttpOnly/Secure cookies, XSS prevention, client/device security and safe log handling.

Requests already authorized/in flight when revocation happens are not retroactively
cancelled. Guard checks protect subsequent requests. This is not transactional
revocation of every possible application mutation.

## Compatibility and operational notes

- No new schema migration is required by these fixes. The existing unshipped
  OTP/MFA/OAuth schema migrations still require separate approval.
- All newly issued access tokens include `sid`; family checks apply even if MFA is
  off. With MFA on, older JWTs without `sid` are rejected and require sign-in again.
- For legacy compatibility only, MFA-off mode still accepts previously issued
  signed JWTs without `sid` until their normal expiry. They cannot get the new
  immediate family-revocation protection. Do not treat disabling MFA as rollback.
- Supplied untrusted Origins are rejected on refresh/logout in either mode;
  Origin-less legacy non-browser requests remain possible only with MFA off.
- Rotation uses the same user-first lock order as reset/recovery/logout. Database
  transactions avoid races across API instances, not just in one process.
- Strict replay revocation can sign out legitimate simultaneous browser tabs.
  The existing client single-flight handles one tab, not cross-tab coordination;
  a future cross-tab refresh coordinator can improve usability without weakening
  server replay handling.
- Additional DB checks on authenticated requests add latency; test under realistic
  concurrency and Neon latency before deployment.

## Executed verification after fixes

- **64 API tests passed**, including 11 added adversarial/control tests.
- **7 registration-validation tests passed**.
- **11 Chromium UI tests passed** (intercepted API fixtures, including virtual passkey).
- **82 targeted tests passed in total**; not every legacy repository test was run.
- Frontend build, API typecheck/build and `git diff --check` passed.
- Root/API `npm audit`: zero reported vulnerabilities at verification time.

Reproduction: use the commands in LOCAL_VERIFICATION.md. The attacks are regression
cases within `api/tests/security-local.test.ts`, enabled only with
`RUN_LOCAL_SECURITY_TESTS=1`; the fixture replaces DATABASE_URL before app import.

## Still open / not claimed tested

Physical devices, real OAuth consent/callback cookies and actual email delivery;
production deployment/proxy/cookie settings; broad XSS/injection/SSRF review; all
booking/payment/file authorization paths; distributed password-guessing protection;
load testing; dependency/source-code supply-chain review beyond registry advisories;
security-method replacement, recovery-code regeneration, key rotation/backups and
expired-flow cleanup. Recovery-management UI is still pending, not completed by
these session fixes. A comprehensive independent security review is recommended
before enabling this expanded authentication policy.
