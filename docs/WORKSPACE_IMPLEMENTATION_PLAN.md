# Servix workspace expansion — 28 September 2026

## Product map
- Shared responsive workspace shell: persistent desktop navigation, mobile menu, search, role-aware actions, sign-out and accessible focus states. Public marketing pages remain separate.
- Customer: overview, bookings, actual payment records/booking receipt links, service discovery, booking conversations, connections, account settings and verification.
- Professional: client bookings, existing real service/gig CRUD, profile/portfolio management, earnings/payout records, application status and the same private communications/security settings. Application intent is not professional approval.
- Community: opt-in in-app requests to public approved professionals, recipient acceptance/decline, withdrawal/removal, blocking and text conversations for accepted connections or owned bookings. No LinkedIn OAuth integration, public feed, cold bulk messages, attachments or read-receipt promises.
- Settings: persist account display name; email is read-only; use existing strong recovery to change password. Existing provider linking remains intact. Never expose authenticator secrets or recovery codes as profile data.
- Verification: independently show verified email, enrolled factor and professional application status. Do not label an applicant as approved.

## Implementation boundaries
Reuse existing guarded booking/service/earnings/payment flows. Payment records are not evidence that live charging has been enabled; retain the current provider mode. No simulated balances or fake successful messages. UI reports loading, empty, unavailable and error states.

Community needs one additive migration and COMMUNITY_ENABLED=true only after manual schema approval. Default off. No production migration, reseed, new database, Redis, worker or paid realtime provider. HTTP polling while visible is sufficient for this first text-chat release.

## Security / verification gates
Authenticate every private API; scope reads and writes to the authenticated user; block account/role spoofing; require verified, active accounts for community actions; require recipient-only acceptance; deny outsider message access; enforce text bounds and sender idempotency; rate-limit request/message creation. Blocking prevents messages across both booking and connection threads. Keep history available to its participants for dispute evidence; block is not erasure. No HTML or executable message content.

Test against disposable local PostgreSQL and intercepted browser responses. Review mobile and desktop with synthetic records. Deploy only after owner review, manual schema upgrade approval, and payment/community readiness checks. Full moderation operations, push/email chat notifications, attachments, calls, typing indicators and public social feeds are later increments—not silently claimed as delivered.

## Local implementation checkpoint

Implemented responsive shared customer/professional navigation; routed existing genuine professional services, bookings, earnings and portfolio flows; customer payment records and CSV export; account-name settings; separate email, factor and professional-approval status; catalogue search; private connection requests and text conversations. Community defaults off. No LinkedIn OAuth, feed, attachments, calls, typing indicator, push notification, tax invoice or new wallet capability is implied.

Chat uses participant-scoped queries and keyset history, sender/client UUID idempotency, active/verified account checks, blocking/removal checks, account-level send/request limits and pair-level transaction locks to serialize blocking against sending. Mark-read updates only the read marker, not inbox order. History is retained for participants after blocking. Older-message pagination no longer restarts when polling an exhausted history.

### Verification (local, 2026-09-28)
- Frontend production build and API TypeScript check pass.
- 53 isolated API tests pass: community (8), onboarding, security and OAuth. Community migration is exercised only against disposable local PostgreSQL.
- 32 mocked-browser tests pass: existing auth/privacy/onboarding plus workspace mobile layouts, navigation and disabled/enabled empty community views.
- 14 Node validation/privacy tests pass.
- Full legacy API suite attempted: 93 passed, 29 failed, 101 skipped; six failed files require the unavailable separate database at localhost:5432. This is **not** a full-suite pass.
- Desktop dashboard, mobile welcome, messages and network screenshots captured outside Git at `/home/user/workspace-previews`. Browser fixtures are synthetic test accounts, not production records.

### Remaining release gates
- Review populated conversations (including long history and concurrent blocking), real booking-linked chat, payment-record ownership with populated fixtures, and professional CRUD/earnings in the expanded shell. Existing isolated tests do not prove every one of these flows.
- Live OAuth, real passkeys, professional approval, payment provider flows and deployment health require separate live verification.
- Before any production schema change: owner approval, backup/restore plan, review all pending migrations and confirm the intended existing Neon target. Apply the additive community migration manually through the existing controlled `npm run db:migrate` procedure, never during startup or deploy. Do not reseed or create a replacement production database.
- Keep `COMMUNITY_ENABLED=false` until the migration and deployed API are verified. Enabling it is a separate explicit rollout step. Rollback by disabling the flag; do not drop dispute/message history.
- No push, deployment, production migration, payment-mode change, account deletion, PR or merge was performed for this workspace expansion.

## Notifications, Servix Pro plans, role-aware navigation and admin analytics (local, 2026-10-01)

Scope implemented locally on `arena/01a0dc4c-servix` (uncommitted, undeployed):

- **In-app notifications.** New `notifications` table; bell in the shared workspace top bar with unread badge, dropdown, mark-read and a full `/dashboard/notifications` page (filters, "load older", mark all read). Notifications are only created by real events: booking lifecycle (paid, requested, accepted, work started, delivered, confirmed/auto-confirmed, declined, cancelled, dispute outcomes), reviews, payouts, application decisions, connection requests/acceptances, one-per-thread chat alerts, plan activation and admin broadcasts. Polling every 45 s; no push, email or SMS is implied.
- **Admin "Send notification"** console tab: audience `all`, `customers`, `professionals` or one account by email; title/body/Servix-path link validation; recipient and read counts; audit-logged. Links must be internal paths, never external URLs.
- **Servix Pro plans.** `plan_subscriptions` + `plan_slug`/`plan_expires_at` on professional profiles. "Servix Pro" is the existing ₦15,000/month `professional` catalogue plan; Business is contact-only. Checkout reuses the existing payment provider (TEST mode); a plan only activates after provider verification (return URL or webhook) and expires after 30 days with no auto-renewal and no stored card data. Listing caps: Free 2 / Pro 10 / Business unlimited, enforced server-side (`403 PLAN_LIMIT`). Public profiles expose `plan` and show a "Servix Pro" badge.
- **Role-aware navigation.** Approved professionals no longer see "Become a professional"; they see "Upgrade to Servix Pro" (free plan) or "Servix Pro plan". Admins land on `/admin` and do not see customer-only tabs such as Verification. Customers get Saved professionals and Notifications; professionals get Availability, Analytics and Reviews.
- **Professional tabs** (modelled on Fiverr/Upwork seller dashboards): analytics from own bookings, ledger and reviews (earnings/bookings series, response rate, unique clients, rating, top services); weekly availability + days off (existing booking slot logic consumes these rules); reviews received. Detailed charts are gated behind Servix Pro; basic figures are always available.
- **Customer tabs:** saved professionals, spending per month from captured payments, upcoming bookings, pending reviews.
- **Admin analytics** tab: GMV, platform fees, plan revenue, new accounts, bookings/applications/paid-plan counts, daily series, bookings by status/category, top professionals, profiles by plan; plus a Plan subscriptions tab. All from verified payment and ledger records.
- Migrations `20260928000000_community` and `20261001000000_notifications_plans` are additive and must be applied manually once **before** the API deploys this code — never at startup or during deploy. Use either the controlled `npm run db:migrate` procedure or the guarded, re-runnable Neon SQL Editor script `api/docs/manual-workspace-upgrade.sql` (checks the 8 base migration checksums, applies only what is missing, records `_prisma_migrations`; verified against a disposable database mirroring production and confirmed idempotent).

### Verification (local, 2026-10-01)
- `npm run build` and `npx tsc --noEmit` (API) pass.
- 99 isolated API tests pass against disposable embedded PostgreSQL, including the new `tests/workspace-features-local.test.ts` (notifications/broadcast scoping, saved professionals, plan checkout/activation/expiry/listing cap, availability, admin analytics access control).
- 36 mocked-browser tests pass, including new checks for the bell/unread badge, the upgrade link replacing the apply tab, the Servix Pro plan tab and admin console tabs.
- 14 Node validation/privacy tests pass.
- Real-API preview exercised through `api/scripts/localPreview.ts` (embedded PostgreSQL, sandbox payments, console email): plan upgrade, broadcast, full booking lifecycle with review, notifications, availability and admin charts rendered without runtime errors on desktop and 390 px mobile.
- Live OAuth, real Paystack charges, production migration and deployment remain unverified; no push, PR, merge or deploy was performed.
