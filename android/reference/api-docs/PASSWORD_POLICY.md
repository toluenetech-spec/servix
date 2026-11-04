# Password creation and reset policy

Deployment approved 2026-09-28. API rollout and frontend promotion must be verified independently.

- Public registration (customer/professional): 8–200 characters, uppercase, lowercase, number and non-whitespace symbol. Applies with MFA both on and off.
- Regular-user resets: same policy and shared live checklist as registration.
- Admin resets: existing basic 8–200 character bounds, no composition requirements, as explicitly requested by the owner. Longer unique admin passwords are still recommended.
- Existing-account login and admin bootstrap behavior are unchanged. No database or authentication-flag changes.

The legacy reset screen asks POST `/auth/reset-password/policy` with its email reset token. Only valid, unconsumed, unexpired tokens can retrieve the policy; the response is `no-store` and contains no email or role. The MFA flow exposes policy only at the verified reset-password stage. Actual reset validation always derives the role from the server-side user record, never submitted role/policy fields. The UI blocks submission if policy cannot be loaded and offers retry/new-link recovery.

Verification: frontend/API builds and API typecheck passed; 9 frontend validation tests, 5 disposable-local-database password policy tests, 26 existing local security tests, and 14 mocked-API browser tests passed. The local PostgreSQL tests create a separate loopback database and do not use Neon. Browser tests do not contact live providers.

Deployment order: API first (adds the policy endpoint), then promote the corresponding frontend deployment. An older frontend still has the old guidance until promoted; do not call the new screens live based on Railway deployment alone.
