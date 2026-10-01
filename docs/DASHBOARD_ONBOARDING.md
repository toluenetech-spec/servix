# Dashboard and social onboarding — local implementation, 2026-09-28

## Changes
- `/dashboard` is the authenticated landing destination after password login and completed MFA/provider registration/login. Provider linking retains its explicit connection confirmation; password reset retains the sign-in prompt. Recovery codes must still be saved before enrollment completes.
- Header navigation and legacy email-verification success links point to Dashboard.
- Customer landing: real recent bookings, empty/loading/error states, service discovery, application status and connected-sign-in access. Professional landing links to the existing bookings/services/earnings/profile workspace. Admin landing links to the existing admin console. No synthetic totals or booking records are used by the app.
- After verified Google or GitHub sign-in, customer accounts without a recorded onboarding choice or professional application see an accessible choice dialog. This includes existing social accounts that missed this step in the previous release. Dismissal does not fabricate completion; a visible call to action reopens the dialog.
- “Book services” saves the choice and remains on Dashboard. “Apply as a professional” saves applicant intent and opens the existing application form. Future dashboard visits show application progress. Selecting a path never changes the user's role, grants a profile or bypasses review.
- Fixed the legacy professional-role/no-profile dead end: these accounts can now submit an application instead of being rejected/redirected between workspace and application. Approved applications lead to the workspace.

## Server protections
`GET /account/overview` and `POST /account/onboarding` require a full authenticated bearer session (including the existing MFA guard when enabled), use server-side user identity, and return no-store. Choice writes require verified email, accept only a strict enum input, reject injected identity/role fields and lock the user row to serialise concurrent choices. Repeated submissions return the previously saved result.

No schema migration. The durable first-choice record uses the existing audit log, action `account.onboarding_selected`, entity `user` and data `{intent}`. Preserve these records if future audit retention is introduced, or migrate this state to a dedicated account-preferences field under a separately approved schema change. No provider tokens or recovery secrets are recorded.

Dashboard/private routes remain excluded from optional measurement and use generic, non-personalised share metadata. No production auth flags, credentials or admin account are changed.

## Verification
45 disposable-local-database integration tests passed (onboarding 7, existing MFA 26, OAuth 12). 27 mocked-API Chromium tests passed (including 7 new dashboard tests). API typecheck and frontend/API builds passed. Dashboard and mobile choice-dialog screenshots reviewed with synthetic test data. Live Google/GitHub end-to-end verification and professional approval still need owner testing after deployment; no live tests or migration were performed here.

Status: local changes only, not pushed/deployed. On approval deploy API first, then promote the matching frontend in Vercel; otherwise the new dashboard endpoint will not be available to the new frontend.
