# Authentication follow-up verification — 2026-09-26

All work remains local on `arena/01a0dc4c-servix`. No real provider keys were used.
No push, PR, merge, deploy, Neon migration, purchase or hosting-variable change.
Authentication flags remain off by default. No production-readiness claim.

## Dependency review and remediation

| Area | Change | Reason / validation |
| --- | --- | --- |
| Frontend tooling | Vite 5 → 7.3.6, React plugin 4.7.0 | Removes reported Vite/esbuild advisories; frontend build and browser tests pass. Avoids jumping unnecessarily to Vite 8. |
| Frontend routing | React Router DOM 6 → 7.18.4 | Removes reported open-redirect/SSR hydration advisories. Existing declarative routing API retained; auth navigation tests and build pass. No SSR is used. |
| Prisma CLI dependencies | Narrow overrides: `prisma` → mysql2 3.24.4; `@prisma/config` → deepmerge-ts 8.0.2 | Removes reported MySQL protocol and merge recursion advisories. Prisma/client/adapter remain 7.9.1; no ORM downgrade. Prisma config load/client generation, API typecheck/build and disposable database tests pass. |

No `npm audit fix --force` was used. Prisma's MySQL dependency is CLI tooling;
Servix uses PostgreSQL, not a MySQL server. The merge override crosses a major
version and must remain covered by Prisma config/client-generation checks; revisit
it when a compatible Prisma release incorporates the patched dependency upstream.

Root package now declares Node `^20.19.0 || >=22.12.0`, required by Vite 7.
Tests ran on Node 22.22.3. Confirm the frontend host's build Node version before any
approved release. Deployment files/Docker builds were not changed or re-run.

Final `npm audit` result: **0 reported vulnerabilities** at root and in `api/`.
This only reflects the registry advisory database at the time of checking, not
proof that the app/dependencies contain no security flaws.

## Executed checks

- 53 targeted API tests passed: email OTP, crypto, restricted MFA, OAuth identity,
  state/browser binding, account linking and replay/concurrency/expiry protections.
- 7 registration-validation tests passed.
- 11 Chromium UI tests passed, using intercepted API fixtures and blocking outbound
  provider requests. Includes hidden/available buttons, provider failure retry,
  restored saved-factor step, failed-status retry, authenticated linking settings,
  explicit session completion, recovery-code save acknowledgement, explicit linking
  completion, and actual browser WebAuthn serialization with a virtual authenticator.
- Frontend production build, API typecheck/build, Prisma config/client generation
  and `git diff --check` passed.

**71 targeted tests passed in total.** This was not a run of every legacy API suite.
Integration migrations ran only against disposable loopback PostgreSQL clusters;
none used Neon. Browser REST responses are mocked: no end-to-end live provider/API
callback, production cookie round trip, real email delivery, or physical authenticator
has been verified. The Chromium virtual passkey is not a real device/biometric test.

Initial browser test failures were test-fixture problems: required-field label
matching, changing a mocked response before the initial request completed, and
mock user objects missing the real API's fullName. These were corrected without
loosening authentication checks.

## Reproduction

```
# Root, supported Node version
npm ci
npm run build
node --test tests/registrationValidation.test.js
npx playwright install --with-deps chromium
npm run test:browser -- --workers=1
npm audit

# API
cd api
npm ci
npx prisma generate
npm run typecheck
npm run build
RUN_LOCAL_SECURITY_TESTS=1 RUN_LOCAL_OTP_TESTS=1 RUN_LOCAL_OAUTH_TESTS=1 npx vitest run tests/security-local.test.ts tests/security-crypto.test.ts tests/email-otp-crypto.test.ts tests/email-otp-local.test.ts tests/oauth-provider.test.ts tests/oauth-local.test.ts
RUN_LOCAL_COMMUNITY_TESTS=1 RUN_LOCAL_WORKSPACE_TESTS=1 npx vitest run tests/community-local.test.ts tests/workspace-features-local.test.ts
RUN_LOCAL_ENTITLEMENT_TESTS=1 npx vitest run tests/entitlements-local.test.ts tests/manual-subscriptions-sql-local.test.ts   # plans, quotas, teams, Neon script
npm audit

# Full-stack local preview (no Neon, no live payments or email)
# Starts an embedded PostgreSQL in api/.local-preview (gitignored), applies every migration once,
# seeds the public catalogue, creates customer@/pro@/admin@servix.local (password printed in the script)
# and serves the API on 127.0.0.1:8080 with PAYMENT_MODE=sandbox and EMAIL_MODE=console.
cd api && npx tsx scripts/localPreview.ts
# In another terminal: VITE_API_URL=/ npm run dev   (Vite proxies /api and /sandbox to 8080)
# Delete api/.local-preview to reset the preview data.
```

Browser tests manage and stop their own local Vite test server on port 5174, using
`VITE_API_URL=/`; they never configure a real API key. A compatible preinstalled
Chromium can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; optional local launch
arguments are a JSON array in `PLAYWRIGHT_CHROMIUM_ARGS`. Neither setting changes
production code. Do not disable browser web security to make tests pass.

In this restricted sandbox, the Playwright CDN and Debian repositories were
unreachable. A temporary npm installation of `@sparticuz/chromium@153.0.0` supplied
Chromium; its bundled library archive supplied missing NSS/NSPR libraries. The test
process used the temporary library directory in LD_LIBRARY_PATH and only the
`--no-sandbox`, `--disable-dev-shm-usage`, `--no-zygote` launch flags. Browser binaries
and temporary libraries are not project dependencies or Git artifacts and may need
reinstallation in a fresh sandbox. Normal environments should use Playwright's
standard install command above instead.

## Gates still open

Review/reconcile upstream deployment fixes before any release; approve the manual
additive migration and production rollout separately. Exercise real Google/GitHub
consent, callback cookies, email delivery and physical passkeys in an approved test
setup. Review legacy/admin enrollment, encryption-key backup/rotation, expired-flow
cleanup, factor replacement and recovery-code regeneration. See MFA.md and OAUTH.md.
Do not turn MFA off as an ad-hoc rollback: that reopens legacy password-only paths.

## Subsequent adversarial review

See [SECURITY_TEST_REPORT.md](SECURITY_TEST_REPORT.md) for reproduced session/replay
findings, fixes and limitations. Latest verification: 64 API + 7 registration +
11 browser tests passed (82 total). Earlier counts above describe the prior checkpoint.
