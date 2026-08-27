# Changelog

All notable changes to the Servix public website.

## 0.5.0 — 2026-08-26 (Phase D: bookings + payments)

### Added
- **Real bookings** with immutable price snapshots (kobo integers), a
  10-state server-controlled state machine (CAS transitions, immutable
  event log), availability (weekly rules + exceptions + DB-level
  double-booking prevention via partial unique index) and real bookable
  slots at `GET /services/:slug/availability`.
- **Payments** behind a provider abstraction: Paystack (live when
  credentials exist) / sandbox with signature parity. Payment is only
  confirmed by the HMAC-SHA512-verified webhook + server-to-server
  verification with amount matching — never by browser redirects.
  Idempotent init, idempotent webhooks (UNIQUE provider event id),
  duplicate deliveries no-op.
- **Escrow + double-entry ledger** (append-only, every txn balanced,
  balances always ledger-derived): capture → escrow; confirm/3-day
  auto-confirm → payable + 10% platform fee; policy-controlled refunds
  (full before acceptance / pro cancellation; configurable before-work;
  dispute-only after work begins) — client never supplies amounts.
- **Disputes** freeze funds; auto-confirm can never touch disputed
  bookings; internal key-guarded resolution (release/refund).
- **Payouts** via provider transfers: ledger-derived balance, in-flight
  uniqueness (DB partial index), provider references stored.
- **Reviews from real bookings**: customer-only, completed-only,
  once-only (DB unique on booking_id), service/professional derived
  server-side; aggregates recomputed transactionally.
- **Frontend**: booking modal with live slots on service pages,
  provider-hosted checkout redirect, booking detail with payment status
  polling + lifecycle actions + dispute + review modals, My Bookings
  list, workspace Bookings/Earnings tabs with accept/start/deliver and
  payout request. Existing design system throughout.
- Migration `20260826200000_bookings_payments` (8 tables, 4 enums).
- 24 new integration tests (suite: 96) + 11-step dual-journey browser E2E.

### Fixed
- BUG-011: `useEffect` import missing after ServiceDetail booking-form
  integration (caught by browser E2E).


## 0.4.0 — 2026-08-26 (Phase C: professional onboarding)

### Added
- **Professional application workflow** with server-controlled approval:
  pending → under_review → approved/rejected. Role promotion happens ONLY
  inside the transactional approval (application + user role + profile
  created atomically). Duplicate active applications blocked; rejected
  applicants can re-apply; approved/locked applications are immutable.
- **Professional management API** (`/pro/*`): profile read/update, skills
  replace, portfolio add/remove, service CRUD with draft → publish →
  unpublish → archive lifecycle, startingPrice aggregate maintenance,
  presigned-upload boundary for R2/S3 (honest stub — no fake uploads).
- **Authorization**: `requireProfessional` guard re-reads role from the
  DB per request; all queries scoped to the owner; cross-owner access
  returns 404 (anti-enumeration); zod strips role-escalation payloads.
- **Frontend**: `/professionals/apply` (application form + status states)
  and `/pro` workspace (Services + Profile tabs), built entirely from the
  existing design system; navbar Workspace link for professionals; Join
  page CTAs now point at the application flow.
- DB migration `20260826100000_professional_onboarding`
  (professional_applications + users↔professional_profiles link).
- 31 new integration tests (suite: 72) + 9-step browser E2E
  (register → apply → approve → workspace → create → publish → public).

### Fixed
- BUG-009: `/pro/services/:id` actions 404ed for slugs — route params now
  accept UUID or public slug.
- BUG-010: parallel session resumes (React StrictMode) tripped refresh
  reuse detection — resume is now single-flight.


## 0.3.0 — 2026-08-26 (Phase B: accounts & authentication)

### Added
- **Real authentication system** (`api/`): register, login, logout,
  refresh (rotating httpOnly cookie with family reuse detection),
  email verification and password reset — all under `/api/v1/auth`,
  plus `GET /me`. scrypt password hashing, JWT HS256 access tokens
  (15 min, memory-only on the client), single-use hashed email tokens,
  anti-enumeration responses, per-route rate limits with 429 envelopes.
- `users`, `refresh_tokens`, `one_time_tokens` tables (migration
  `20260826000000_auth_accounts`).
- Frontend: `AuthProvider`/`useAuth` context with session resume on load;
  the existing Login / Register / Forgot / Reset / Verify pages now
  perform real authentication when `VITE_API_URL` is set, including
  field-level API validation errors, honest error toasts and redirect
  flows. Navbar shows the signed-in user + Sign Out (desktop & mobile).
- Email delivery abstraction with console transport for development
  (real provider is a one-file swap at deploy time).
- 21 new auth integration tests + rate-limit test (API suite now 61).

### Unchanged (honest fallback)
- With no `VITE_API_URL`, the auth pages keep their pre-launch messaging
  and make **zero** network calls — no fake authentication anywhere.
- Catalogue endpoints, page designs and component structure untouched.

### Fixed
- Rate limiter returned malformed 500s instead of 429 envelopes when
  triggered (BUG-007).
- Fastify rejects empty JSON bodies: auth client no longer sends
  `Content-Type: application/json` on body-less POSTs (BUG-008).


## 0.1.1 — 2026-08-22

### Changed
- Installed the official SERVIX brand identity: SX monogram ligature +
  SERVIX wordmark, vectorised as outlined-path SVGs from the supplied
  reference images. Replaced the temporary stand-in logo, dark-background
  variant and favicon in `public/brand/` (1:1 swap, no code changes).
- Regenerated the favicon with correct clear space around the monogram.
- Verified logo rendering in navbar (light), footer (dark) and favicon at
  1440/768/390/375 px with zero layout overflow.

## 0.1.0 — 2026-08-22

### Added
- Project setup: React 18 + Vite 5 + React Router 6, Inter Variable typeface
- Servix design system: full token set (color, type, spacing, radius,
  shadows, control sizing, motion) in `src/styles/tokens.css`
- Brand assets scaffold in `public/brand/` (temporary stand-ins, 1:1
  replaceable with the official logo)
- Public navigation (desktop + mobile menu) and corporate footer
- Homepage: hero with product-grade service search, trust strip (labelled
  demo values), popular services, featured professionals, how-it-works,
  for-professionals section with static dashboard preview, why Servix,
  demo-labelled testimonials, final CTA
- Service discovery page (`/services`): search, category/price/rating/
  location/availability filters, sorting, pagination, mobile filter drawer
- Service detail page (`/services/:id`): gallery, professional strip,
  what's included, requirements, availability preview, reviews, FAQ,
  honest booking placeholder modal
- Professional directory (`/professionals`) with full filtering/sorting
- Professional profile (`/professionals/:id`): stats, tabbed About/Services/
  Portfolio/Reviews, booking CTA
- For Professionals conversion page (`/professionals/join`)
- How It Works page with separate customer and professional flows
- Pricing page with three placeholder plans (marked subject to change)
- About page (no invented founders/history; explicit placeholders)
- Contact page with validated form architected for `POST /api/contact`
- Authentication UI: login, register, forgot/reset password, verify email —
  frontend validation only, honest "accounts launch later" messaging
- Legal placeholder pages (privacy, terms) and 404 page
- Reusable UI system: Button, Field, Icon, Rating, Badge/VerifiedBadge,
  Modal, Drawer, Toast, Tabs, Breadcrumb, Pagination, Skeletons,
  Empty/Error states, Accordion, SectionHeader, Gallery, cards
- Data layer (`src/lib/api.js`) mirroring future REST endpoints, with
  structured demo data for services, professionals, categories, reviews,
  testimonials, pricing plans and FAQs
- Per-route SEO metadata (title, description, Open Graph)
- Accessibility: skip link, focus management, keyboard navigation,
  aria-wired forms, reduced-motion support
- Automated headless-browser test pass across 18 routes × 6 viewports
  (console errors, overflow, interactions) — all green
