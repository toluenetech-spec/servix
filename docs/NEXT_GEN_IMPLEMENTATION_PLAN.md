# Servix — Next-Generation Marketplace Upgrade: Implementation Plan

_Status: PLAN ONLY (no feature code written yet). Produced after inspecting the live repository at commit `f8e0ad1` (KYC deployed). This document is the contract for the work that follows; each wave gets its own report when it ships._

## 1. What exists today (inspected)

| Area | Reality in the repo | Consequence for the plan |
|---|---|---|
| Schema | 49 Prisma models, 12 additive migrations, applied manually via guarded Neon scripts (`api/docs/manual-*.sql`). Never at start-up. | Every wave that adds columns/tables ships one guarded SQL script the owner runs **before** the push (Prisma selects all columns, so a missing column breaks every query of that model). |
| Booking | `Booking` is the unit of work: `pending_payment → requested → accepted → in_progress → delivered → completed` (+ declined/cancelled/disputed/refunded). Fields: `scheduledAt`, `amountKobo`, `platformFeeKobo`, `serviceTitle`, `priceUnit`, `deliveredAt`, `completedAt`, `autoConfirmed`, `cancelledBy`. `BookingEvent` timeline (`created`, `payment_captured`, `delivered`, `disputed`, …). **No agreed-deadline field** exists. | Delivery reliability needs an immutable `expectedDeliveryAt` snapshot on new bookings; it cannot be back-computed honestly for old bookings → metric shows "Not enough data" until enough post-change bookings exist. |
| Money | `Payment` (Paystack TEST / sandbox) + double-entry `LedgerEntry` (`postTransaction`, `captureLegs/releaseLegs/refundLegs/payoutLegs`), `Payout`, `refundPolicy.ts`, auto-confirm sweep. | Milestones must be **bookings** (one booking per funded milestone, grouped by a Project) so capture/release/refund/dispute/payout keep working unchanged. No new ledger. |
| Projects / milestones | **Do not exist.** The spec says "expand the existing milestone/project architecture" — there is none. | Phase 9 is a new `Project` grouping over bookings, not an expansion. Scoped accordingly. |
| Services | One price per gig (`price`, `priceUnit`, `deliveryDays`, `revisions`, `included[]`, `requirements[]`). The owner **explicitly rejected 3-tier packages** during gig-wizard work (Oct 2026). | Phase 10 is **blocked pending an explicit owner decision**; designed as fully optional (single price stays default) if approved. |
| Portfolio | `PortfolioItem {title, category, description, mediaUrl, position}` — no booking link. | Add nullable `bookingId` (unique) + `verifiedAt`; set only by server from a completed booking. |
| Saved professionals | `SavedProfessional {userId, professionalId}`. | Extend with `preferred Boolean`, `note`; no second table. |
| Availability | `AvailabilityRule` (weekly), `AvailabilityException` (days off), `availableSlots(professionalId, days)` already computes real slots and excludes booked ones. | "Available today/this week" = derived from `availableSlots`; nothing self-declared. |
| Analytics | `GET /pro/analytics` already computes response rate/median, earnings, status counts, top services from real rows. Plan gating via `effectivePlan` (`free / professional / business`). | Extend this route; gate the new sections with the existing plan limits. |
| Notifications | `notify(tx, {userId,type,title,body,link})`, `notifySafely`, broadcasts, bell + page. | All new events use `notify`; no new channel. |
| Feature flags | Env-driven (`COMMUNITY_ENABLED`) read per request; frontend asks `/community/config`. | Generalise: `api/src/lib/features.ts` + `GET /api/v1/features` + `useFeatures()` hook. All new systems default **off** in production. |
| Admin | `/admin` tabs with `requireAdmin` (role re-read from DB), `adminLimit`, `audit()`. | New tabs follow the AdminExtraTabs / AdminIdentityTab pattern. |
| Tests | Local-DB vitest suites (`*-local.test.ts`, embedded Postgres, opt-in flags), Playwright 78 specs, 14 unit tests. Legacy `auth/professional/...` suite is stale (pre-existing: test passwords fail the live checklist). | Each wave adds a `*-local.test.ts` + Playwright spec; the stale legacy suite is repaired as its own small task (not blocking). |
| Delivery constraints | Live product; owner is non-technical and often on a phone; Vercel production needs manual Promote; sandbox resets wipe git state mid-session. | Small, independently deployable waves; commit after every green step; **as few migrations as possible** (one per wave, max). |

## 2. Non-negotiables carried into every wave

- Additive migrations only; never touch ledger/booking/payment history; never rewrite migration history.
- No second payment, ledger, notification, or upload system.
- Server derives everything sensitive (ids, prices, roles, trust metrics, badges); clients only pick options.
- Every metric has a documented formula and a visible "Not enough data" state (threshold stated per metric).
- Feature flags per system; production stays unchanged until the owner flips a flag on Railway.
- Paystack TEST, Community/Messages/Network off, no AI features.
- Each wave ends with: existing suites green, new suites green, `api` tsc + root Vite build green, honest pass/fail report.

## 3. Waves (safe grouping of the 17 phases)

Waves are ordered by dependency and by how much they touch money. Each wave = one Neon script (if any) → one push → one Railway deploy → flags stay off → owner enables when ready.

### Wave A — Foundations + Trust (phases 3, 4, 5, 6, 15 part 1, 16, 17 part 1)
**Why first:** read-mostly, no money paths, and later waves (comparison, requests, CRM) display these metrics.

Schema (one migration `nextgen_trust`):
- `bookings.expected_delivery_at TIMESTAMP NULL`, `bookings.deadline_changed_at`, `bookings.deadline_changed_by` (snapshot at payment capture from `service.deliveryDays`/`scheduledAt`; mutual change recorded as a `BookingEvent`).
- `portfolio_items.booking_id TEXT NULL UNIQUE`, `portfolio_items.verified_at`.
- `professional_metrics` (materialised per professional: completed, cancelled_by_pro, delivered_on_time, delivered_late, measurable_deliveries, repeat_customer_pct, response_rate, median_response_hours, computed_at) — recomputed by a PgQueue job after booking transitions + nightly; every field has a formula in `TRUST.md`.
- `achievements` (slug, name, criteria JSON, active) + `professional_achievements` (professional_id, slug, earned_at, evidence JSON, revoked_at) — seeded from code (`lib/achievements.ts` rule registry), evaluated by the same job.
- `profile_views` / `service_views` daily counters (`entity_type, entity_id, day, count`) — privacy-safe aggregates only, no visitor ids.

API: `GET /professionals/:slug/trust`, `GET /professionals/:slug/achievements`, `GET /achievements/catalog`, `POST /pro/portfolio/from-booking/:bookingId` (server validates the booking is the pro's own and `completed`), `GET /pro/analytics` extended (conversion, cancellation rate, reliability, repeat customers, retention, views; Pro-only sections gated by plan), `GET /admin/trust/:professionalId` (metrics + badge history + calculation source), `POST /admin/achievements/recompute/:professionalId`.

Delivery reliability (documented formula): measurable = completed bookings with `expected_delivery_at` set; on-time = `deliveredAt ≤ expected_delivery_at` **or** deadline mutually changed and met; customer-caused delays (customer-requested reschedule events) excluded; professional cancellations after `accepted` count against; disputes resolved as refund count against; payment/platform delays excluded (clock starts at `payment_captured`). Shown only when measurable ≥ 5.

UI: "Trust & Performance" section on the public professional profile; achievements strip with criteria tooltips; "Verified Servix Project" badge on portfolio items; Analytics page extensions (Free vs Pro); admin **Trust** tab. Notifications: `achievement.earned`.

### Wave B — Comparison + Availability discovery + Preferred professionals + Book again (phases 2, 7, 11, 13)
**Why second:** pure reads over Wave A metrics plus the existing slot engine; very low risk.

Schema (one small migration `nextgen_discovery`): `saved_professionals.preferred BOOLEAN DEFAULT false`, `saved_professionals.note TEXT NULL`. Nothing else (comparison lists live in `localStorage` + URL `?ids=`; no server state needed).

API: `GET /compare?professionals=a,b,c` / `?services=…` (max 4; returns the full matrix incl. trust, availability next slot, "not enough data" nulls), `GET /professionals/:slug/availability/summary` + `nextAvailable` on list payloads + `available=today|tomorrow|week` filter on `/professionals` and `/services` (derived from `availableSlots`), `POST /bookings/:id/rebook-draft` (returns a prefilled, **sanitised** draft: service, previous notes only if the customer opts in — never auto-copies), `PATCH /account/saved/:slug {preferred, note}`.

UI: compare tray + `/compare` page (works from discovery lists, profile, service detail); "Available today" chip + filter; "Book again" on completed bookings and on the profile for previous clients; "Preferred" toggle in Saved. Notifications: `professional.preferred` (to the professional, no customer identity beyond name).

### Wave C — Service Request Marketplace + Proposals (phases 1, 16, 17 part 2) — **flag `REQUESTS_ENABLED`**
Schema (one migration `nextgen_requests`): `service_requests` (customer_id, title, category_id, description, budget_type fixed|range, budget_min_kobo, budget_max_kobo, deadline_at, preferred_delivery_at, is_remote, location, required_skills JSON, attachments JSON (private keys), extra_requirements, status draft|open|paused|closed|awarded|cancelled, awarded_proposal_id, published_at, closed_at), `proposals` (request_id, professional_id, cover, price_kobo, delivery_days, milestones JSON (plan only, no money), attachments JSON, proposed_start_at, status submitted|withdrawn|rejected|accepted|expired; **unique (request_id, professional_id) where status in (submitted, accepted)**), `request_events` timeline.

Business rule for award: accepting a proposal → request `awarded`, all other proposals `rejected`, and a **normal Booking** is created in `pending_payment` with `amountKobo = proposal.price_kobo` (immutable snapshot), `serviceId` = a hidden per-award service record *or* the professional's chosen existing service (decision below), then the existing pay → requested → accepted … pipeline runs untouched. Platform fee rule unchanged (10 %).

API: customer `GET/POST/PATCH /requests`, `POST /requests/:id/publish|pause|close|cancel`, `GET /requests/:id/proposals`, `POST /requests/:id/proposals/:pid/accept|reject`; professional `GET /requests/browse` (filters: category, budget, deadline, location, remote, skills; sorts newest/deadline/budget), `POST /requests/:id/proposals`, `PATCH /proposals/:id`, `POST /proposals/:id/withdraw`; admin `GET /admin/requests`, `GET /admin/proposals`. Rate limits on create routes; idempotency key on accept.

UI: customer "Post a request" wizard (draft autosave) + "My requests" + proposal comparison table; professional "Browse requests" + proposal form; admin **Requests** and **Proposals** tabs; nav entries appear only when the flag is on. Notifications: `request.new` (to pros in category, batched), `proposal.new`, `proposal.accepted`, `proposal.rejected`, `request.closed`.

### Wave D — Projects & Milestones (phase 9) — **flag `PROJECTS_ENABLED`** (depends on C)
Schema (one migration `nextgen_projects`): `projects` (customer_id, professional_id, request_id?, title, description, status draft|active|completed|cancelled), `milestones` (project_id, title, description, amount_kobo, due_at, position, status draft|funded|in_progress|submitted|approved|disputed|released|refunded, **booking_id UNIQUE NULL**), `project_files` (private keys), `project_events`.

Money rule: **funding a milestone creates a Booking** for that milestone (existing Paystack checkout, capture, ledger legs). `submitted` = booking `delivered`; `approved` = booking `completed` (release legs); `disputed`/`refunded` reuse `/bookings/:id/dispute` + admin resolve. Milestone status is a projection of its booking's status plus the pre-funding `draft`. Auto-confirm sweep unchanged. No milestone ever holds money outside a booking.

UI: project workspace (overview, participants, milestones, files, deliverables, timeline, payment status); admin **Projects** tab reusing the dispute resolver. Notifications: `project.created`, `milestone.funded|submitted|approved|disputed`, `project.deadline` (job).

### Wave E — Professional CRM (phase 8) — **flag `CRM_ENABLED`** (depends on A for metrics; B for Book again)
Schema: `client_notes` (professional_id, customer_id, body, updated_at; unique pair). Everything else is derived from bookings. Admin never reads notes (no admin route exposes them; documented).
API: `GET /pro/clients` (search, filters: active/completed/last booking), `GET /pro/clients/:customerId` (bookings the pro legitimately has with that customer only), `PUT /pro/clients/:customerId/note`. UI: **Clients** workspace section; "Book again" deep-links to a new booking for that customer only via a share link (customers always initiate payment).

### Wave F — Service Packages (phase 10) — **BLOCKED pending owner decision**
If approved: `service_packages` (service_id, tier basic|standard|premium, name, price_kobo, delivery_days, revisions, description, features JSON, requirements JSON, position); `services.pricing_mode single|packages`; `bookings.package_snapshot JSON` + `package_id`. Single-price stays default; existing gigs untouched; booking stores an immutable snapshot. Flag `PACKAGES_ENABLED`.

### Wave G — Business workspace foundation (phase 12) — **flag `BUSINESS_ENABLED`, foundation only**
Schema: `organizations`, `organization_members` (role owner|admin|member, status invited|active|removed, invited_email), `organization_invites` (token hash, expiry). `bookings.organization_id NULL` (set when the booking customer is acting for an org). Authorisation helper `requireOrgRole(min)`. API: create org, invite/accept/remove members, org booking history and spend (ledger-derived, owner/admin only), org favourites (extends saved). UI minimal: Organization page, members, shared history. Full migration of personal accounts is **not** attempted (model is single-user; documented as the safe boundary).

### Wave H — Price intelligence foundation (phase 14) — **flag `PRICING_INSIGHTS_ENABLED`**
Schema: `price_observations` (category_id, source service|package|completed_booking, price_kobo, delivery_days, location_city, observed_at; no customer/pro ids). Nightly job aggregates to `price_stats` (category, location?, n, p25, p50, p75). Public read returns "Not enough Servix data yet." below n = 20 per bucket. Admin **Price data** tab shows aggregates only.

### Wave I — Hardening + docs sweep
Repair the stale legacy API suite; full Playwright run on mobile viewport for every new page; docs: `MARKETPLACE_REQUESTS.md`, `PROPOSALS.md`, `PROJECTS.md`, `MILESTONES.md`, `TRUST.md`, `ACHIEVEMENTS.md`, `PROFESSIONAL_CRM.md`, `BUSINESS.md`, `SERVICE_PACKAGES.md`, `PRICE_INTELLIGENCE.md` (each written in the wave that ships the feature, finalised here), plus `PROJECT_PROGRESS.md`, `CHANGELOG.md`, `BUGS.md`.

## 4. Cross-cutting pieces built in Wave A and reused everywhere
- `api/src/lib/features.ts`: typed flag registry read from env (`REQUESTS_ENABLED`, `PROJECTS_ENABLED`, `CRM_ENABLED`, `PACKAGES_ENABLED`, `BUSINESS_ENABLED`, `ACHIEVEMENTS_ENABLED`, `PRICING_INSIGHTS_ENABLED`, `COMPARE_ENABLED`); `requireFeature(flag)` preHandler (503 `FEATURE_DISABLED`); `GET /api/v1/features` for the frontend; `useFeatures()` hook; nav items hidden when off.
- Metrics job runner on the existing PgQueue (`metrics.recompute`, `achievements.evaluate`, `price.aggregate`).
- Standard admin table component (search, filters, pagination) extracted from existing tabs.

## 5. Per-wave deliverable checklist (what "done" means)
1. Guarded Neon script verified on a throwaway PostgreSQL mirroring Neon (apply + idempotent re-run), owner runs it, confirms the migration count.
2. API: tsc clean; new `*-local.test.ts` covers auth, authorization/ownership, validation, state transitions, duplicates, race (concurrent accept), flag-off behaviour.
3. Frontend: Vite build clean; Playwright covers main journey, empty, error, and a mobile-viewport pass.
4. Existing suites re-run (onboarding-gigs, kyc, media, root unit, Playwright full).
5. Push → Railway + Vercel green → `/readyz` ready:true → owner Promotes on Vercel.
6. Report lists exactly what passed/failed and what remains flag-off.

## 6. Decisions needed from the owner before Wave C/F/G
1. **Service packages (Wave F):** you previously rejected 3-tier pricing. Proceed as *optional* packages (single price remains the default), or drop Phase 10?
2. **Award → booking (Wave C):** when a proposal is accepted, should the booking attach to one of the professional's existing gigs (they pick at proposal time) or to a hidden "custom work" service created per award? Recommended: professional picks an existing gig or "Custom work" (hidden service auto-created once per professional).
3. **Business (Wave G):** foundation behind a flag only (recommended), or full team workspace in this programme?

## 7. Estimated effort and sequencing
Each wave is a separate session block with its own Neon step. Wave A and B are the largest value-per-risk and need no owner decisions; they start immediately once this plan is acknowledged. Waves C→D→E follow; F/G/H depend on the answers above.
