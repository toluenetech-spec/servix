# SERVIX — Project Progress

> Living documentation for the Servix public website (Phase 1).
> Last updated: 2026-08-27 (Phase E complete)

---

## 1. Project Overview

Servix is a professional services marketplace connecting customers with
trusted professional service providers. **Phase 1** (this repository state)
delivers the complete public-facing website: marketing pages, service and
professional discovery, detail pages, pricing, company pages and the
authentication UI shell — with a clear architecture ready for the backend,
dashboards and payments to be added in later phases **without rebuilding
the frontend**.

Explicitly out of scope for this phase (per spec): customer/professional/admin
dashboards, AI features, payments, real authentication, full backend.

## 2. Brand Guidelines

### Palette (design tokens in `src/styles/tokens.css`)

| Token | Hex | Usage |
|---|---|---|
| Deep Forest | `#12372A` | Primary brand: nav CTA, primary buttons, dark sections |
| Forest Green | `#1F5C45` | Hover states, secondary elements, selected states |
| Warm Ivory | `#F7F4EC` | Primary page background (defining characteristic) |
| Soft Sand | `#EDE8DC` | Subtle sections, secondary surfaces |
| Coral | `#E56B5D` | Sparing accent: rating stars, demo badges, small status |
| Charcoal | `#202622` | Primary text |
| Muted Gray | `#68716B` | Secondary text |
| White | `#FFFFFF` | Cards, forms, clean surfaces |

### Logo

The official SERVIX identity (provided 2026-08-22) is the **SX monogram
ligature + SERVIX wordmark** in Deep Forest. Because the identity was
supplied as raster reference images (JPEG), the mark was reproduced as
faithful, crisp vector SVGs (converted to outlined paths — no font
dependency) matching the reference proportions and letterforms exactly:

- `public/brand/servix-logo.svg` — Deep Forest on light backgrounds
- `public/brand/servix-logo-dark.svg` — Warm Ivory on dark backgrounds
- `public/brand/favicon.svg` — SX monogram, ivory on Deep Forest tile

The `Logo` component (`src/components/brand/Logo.jsx`) only controls
display height — it never restyles or distorts the asset. If master vector
files (AI/SVG) of the logo become available, drop them over these three
filenames 1:1; no code changes required.

### Typography

Single typeface: **Inter Variable** (`@fontsource-variable/inter`, self-hosted).
Type scale, weights and tracking are tokenised (`--text-xs` … `--text-3xl`).
Headings are confident but not oversized; hierarchy is achieved through
scale + weight + letterspacing, not size alone.

## 3. Design Decisions

- **Editorial, calm, low-ornament direction**: hierarchy from typography,
  whitespace, 1px borders and dividers — not shadows/gradients/blobs.
- Radius scale intentionally restrained (3/6/10px). No pill cards.
- Coral used only for rating stars, demo badges and small status accents.
- Warm Ivory page background + white cards + Deep Forest dark sections
  define the visual rhythm.
- All animations are short (140–400ms), purposeful, and disabled under
  `prefers-reduced-motion`.
- Honesty rules enforced in copy: demo stats/testimonials/reviews/profiles
  are labelled as demonstration content; booking/auth/contact flows state
  clearly that no live backend exists.

## 4. Pages Completed (all routes)

| Route | Page | Status |
|---|---|---|
| `/` | Home (hero, search, trust, categories, featured pros, how-it-works, for-professionals + dashboard preview, why Servix, demo testimonials, final CTA) | ✅ |
| `/services` | Service discovery: search, category/price/rating/location/availability filters, sort, pagination, mobile filter drawer | ✅ |
| `/services/:id` | Service detail: gallery, professional strip, description, included, requirements, availability preview, reviews, FAQ, booking CTA (honest placeholder modal) | ✅ |
| `/professionals` | Professional directory: search, filters, sort, pagination, mobile drawer | ✅ |
| `/professionals/:id` | Professional profile: header, stats, tabs (About/Services/Portfolio/Reviews), booking CTA | ✅ |
| `/professionals/join` | Conversion page: hero, benefits, onboarding steps, profile/listing examples, booking + earnings previews, FAQ, CTA | ✅ |
| `/how-it-works` | Customer flow (5 steps), professional flow (5 steps), platform explainer, FAQ | ✅ |
| `/pricing` | Free/Professional/Business plans (placeholder pricing clearly marked), FAQ | ✅ |
| `/about` | Story, mission, values, team placeholder (no invented people), CTA | ✅ |
| `/contact` | Validated contact form, contact info placeholders, FAQ links | ✅ |
| `/login` `/register` `/forgot-password` `/reset-password` `/verify-email` | Auth UI with frontend validation; honest "accounts launch later" messaging — no fake auth | ✅ |
| `/privacy` `/terms` | Placeholder legal pages (clearly labelled) | ✅ |
| `*` | 404 page | ✅ |

## 5. Components Completed

**Layout**: `Navbar` (desktop + mobile menu), `Footer`, `Layout` (skip link,
scroll restoration).

**UI system** (`src/components/ui/`): `Button` (5 variants × 3 sizes, renders
as button/Link/a), `Field` (label/hint/error + aria wiring), `Icon` (inline
stroke set), `Rating`, `Badge` + `VerifiedBadge`, `Modal` (focus trap, Esc,
overlay close), `Drawer` (mobile bottom sheet), `Toast` (provider + hook),
`Tabs` (arrow-key nav), `Breadcrumb`, `Pagination`, `Skeleton` +
`CardGridSkeleton`, `EmptyState`, `ErrorState`, `Accordion` (FAQ),
`SectionHeader`, `Gallery`.

**Cards** (`src/components/cards/`): `ServiceCard`, `ProfessionalCard`,
`CategoryCard`.

**Brand**: `Logo`.

## 6. Data Structures (`src/data/`)

- `categories.js` — 8 categories `{id, name, description, serviceCount, icon}`
- `services.js` — 12 services `{id, title, categoryId, professionalId, rating, reviewCount, price, priceUnit, duration, location, availability, image, gallery, shortDescription, description, included[], requirements[], faqs[]}`
- `professionals.js` — 8 fictional demo profiles `{id, name, title, location, categoryId, rating, reviewCount, startingPrice, verified, completedProjects, responseTime, memberSince, availability, image, about, skills[], serviceIds[], portfolio[]}`
- `reviews.js` — demo reviews keyed by serviceId + professionalId
- `testimonials.js` — placeholder testimonials with `isDemo: true`
- `pricingPlans.js` — 3 plans (placeholder pricing)
- `faqs.js` — grouped FAQ content (general / professionals / contact)

All demo data flows through **one data layer** (`src/lib/api.js`) so no
component imports raw data for fetching (cards resolve display-only joins).

## 7. Architecture Decisions

- **Stack**: React 18 + Vite 5 + React Router 6 (SPA). Chosen per user
  preference; light, fast, easy API integration later.
- **Data layer as API boundary**: `src/lib/api.js` mirrors the future REST
  endpoints (`getServices` ⇢ `GET /api/services`, etc.), returns promises
  with a small artificial delay so loading/error/empty states are real and
  exercised today. Swapping to `fetch()` changes only this file.
- **`useFetch` hook** standardises `loading / error / data / retry` for all
  listing and detail pages.
- **SEO**: `useDocumentMeta` sets unique title, meta description and Open
  Graph tags per route.
- **Code splitting**: every route except Home is lazy-loaded; vendor chunk
  split in `vite.config.js`.
- **Design tokens**: single `tokens.css` for color, type, spacing, radius,
  shadows, control heights, motion.
- **Filters live in the URL** (`useSearchParams`) so filtered views are
  shareable/bookmarkable and back/forward works.

## 8. Dependencies (and why)

| Package | Reason |
|---|---|
| `react`, `react-dom` | UI framework |
| `react-router-dom` | Routing for 18 public routes |
| `@fontsource-variable/inter` | Self-hosted brand typeface (no external font CDN, better performance/privacy) |
| `vite`, `@vitejs/plugin-react` | Build tooling (dev) |

No UI library, no CSS framework, no animation library — deliberate, per the
"every dependency needs a reason" rule.

## 9. Accessibility

- Semantic landmarks (`header/nav/main/footer`), one `h1` per page, ordered headings
- Skip-to-content link; visible `:focus-visible` outlines (ivory variant on dark)
- Modal: focus trap, Escape, focus restore. Drawer: Escape, focus move/restore
- Tabs: full arrow-key/Home/End keyboard support with correct ARIA
- Forms: labelled fields, `aria-invalid`, `aria-describedby` errors, `role="alert"`
- Results counts announced via `aria-live="polite"`; toast region `role="status"`
- 44px touch targets for controls; `prefers-reduced-motion` respected globally
- Decorative images `alt=""`; informative images described

## 10. Performance

- Route-level code splitting (largest route chunk ≈ 9 kB, vendor ≈ 54 kB gz)
- All below-the-fold images `loading="lazy"` with width/height attributes
- Demo images resized ≤1400px, ~2.1 MB total across the whole site
- Self-hosted variable font (single file)
- No runtime CSS-in-JS; plain CSS with tokens

## 11. Testing Performed (2026-08-22)

Automated headless-Chromium test suite executed against the dev server:

1. **Smoke test** — all 18 routes loaded at 1440/1280/1024/768/390/375 px:
   ✅ zero console errors, zero page errors, zero failed requests, zero
   horizontal overflow, `h1` present on every route (incl. 404).
2. **Interaction test** — ✅ mobile menu open/navigate/close, home search →
   `/services?q=…`, mobile filter drawer + category filter, empty state
   ("No services found"), booking modal open/Escape-close, FAQ accordion,
   gallery thumbnail switching, profile tabs (Services/Reviews), contact
   form validation (4 field errors) + success state + toast, login
   validation + honest "not live yet" toast, pagination page 2, unknown
   service id → "Service not found" state.
3. **Production build** — `npm run build` clean, no warnings.
4. **Visual review** — screenshots of home (desktop + mobile), services,
   service detail, professionals, profile, pricing, login reviewed for
   spacing/consistency/overflow.

## 11d. Phase B — Accounts & Authentication (2026-08-26)

**Delivered:** users/refresh_tokens/one_time_tokens tables; register,
login, refresh (rotating httpOnly cookie + family reuse detection),
logout, verify-email (+resend), forgot/reset password, `GET /me`; scrypt
hashing (OWASP), JWT HS256 15-min memory-only tokens, single-use hashed
one-time tokens, anti-enumeration, per-route rate limits with 429
envelopes; console email transport abstraction; AuthProvider/useAuth on
the frontend with session resume; all five auth pages perform real auth
when `VITE_API_URL` is set (honest pre-launch messaging otherwise).

**Testing:** 61/61 vitest integration tests; manual curl pass; browser
E2E (register → verify redirect → session survival → sign-out →
wrong-password → login → forgot-password → email-link verification);
demo-mode drill (zero API calls without VITE_API_URL).
**Bugs fixed:** BUG-007, BUG-008 (see BUGS.md).

## 11e. Phase C — Professional Onboarding (2026-08-26)

**Delivered:** professional_applications workflow (pending →
under_review → approved/rejected) with the ONLY role promotion in the
codebase inside the transactional approval; `/pro/*` management API
(profile/skills/portfolio/service CRUD with draft→publish→unpublish→
archive, slugs or UUIDs, startingPrice aggregates, full zod validation);
`requireProfessional` DB re-read authorization with owner scoping and
404 masking; honest presigned-upload stub; `/professionals/apply` +
`/pro` workspace frontend from the existing design system. Review was
guarded by the temporary X-Servix-Review-Key bridge (replaced in
Phase E by the admin system).

**Testing:** 72/72 API integration tests (incl. authorization matrix and
role-escalation proof); 9-step browser E2E (register → apply → approval
→ workspace → create → publish → public pages).
**Bugs fixed:** BUG-009, BUG-010 (see BUGS.md).

## 11f. Phase D — Bookings + Payments (2026-08-26)

**Design first:** api/docs/BOOKINGS.md + api/docs/PAYMENTS.md written and
reconciled before implementation.

**Delivered:** bookings with immutable kobo price snapshots and a
10-state CAS machine + immutable booking_events; availability (weekly
rules + exceptions + partial-unique-index double-booking prevention +
real slots endpoint); payments behind a provider abstraction (Paystack
live / sandbox parity) where the ONLY path to paid state is the signed
webhook → server verify → amount match → CAS capture; append-only
double-entry ledger (5 accounts, every txn balanced, ledger-derived
balances); policy-controlled refunds (client never supplies amounts);
disputes freeze funds and are excluded from the 3-day auto-confirm sweep
by construction; payouts with in-flight uniqueness; reviews bound to
completed bookings with transactional aggregates; booking/checkout/
booking-detail/My-Bookings/workspace-Earnings frontend.

**Testing:** 96/96 API tests; 11-step dual-journey browser E2E; payable
₦135,000 on a ₦150,000 booking (10% fee) verified in UI.
**Bugs fixed:** BUG-011 (see BUGS.md).

**Environment note:** outbound Paystack API is blocked in this sandbox,
so live-key integration ran against the sandbox provider with full
signature/webhook parity; PaystackProvider activates automatically when
PAYSTACK_SECRET_KEY is configured at deploy time.

## 11g. Phase E — Production Hardening, Administration & Launch Readiness (2026-08-27)

**Design first:** api/docs/PRODUCTION_HARDENING.md written before
implementation (admin model, audit logging, storage, email, job system,
security checklist, observability, deployment and reliability plans).

**Delivered:**
- **Admin system** (the X-Servix-Review-Key bridge is REMOVED):
  `requireAdmin` guard re-reads the role from the DATABASE on every
  request — a forged JWT `role:admin` claim is rejected (tested), and a
  suspended admin's token stops working immediately. Idempotent
  server-side bootstrap from ADMIN_EMAIL/ADMIN_PASSWORD (≥12 chars or it
  refuses). Endpoints: /admin/stats, /admin/applications (+approve/
  reject with transactional role promotion), /admin/services
  (+pause/unpause CAS), /admin/users (search/suspend-with-session-
  revocation/reinstate; no self-suspend; admins protected), /admin/
  bookings (+detail with event timeline, +resolve release/refund),
  /admin/payouts (+retry), /admin/audit (read-only). EVERY admin
  mutation writes an audit_log row transactionally.
- **Admin console UI** (`/admin`): Overview/Applications/Services/Users/
  Bookings & Disputes/Payouts/Audit Log tabs — existing design system
  only; navbar Admin link for admins.
- **Storage (Cloudflare R2)**: S3-compatible SigV4 presigner implemented
  and verified byte-for-byte against the official AWS documentation test
  vector; content-type whitelist + 5 MB cap enforced server-side; UUID
  keys (no path traversal); deletion presign; daily orphan sweep. Stub
  remains honest (enabled:false) without credentials. No binaries in
  PostgreSQL; secrets never sent to the browser.
- **Email**: transports console/noop/resend behind one `deliverMail`;
  the resend transport throws unless the provider returns 2xx+id — the
  system never claims delivery the provider didn't accept. All mails
  (verify, reset, booking confirmed, payment received, cancelled,
  dispute opened/resolved, payout sent) are queued jobs.
- **Job system**: `jobs` table with UNIQUE(queue, idempotency_key);
  PgQueue worker claims via FOR UPDATE SKIP LOCKED (concurrent claim
  test: 3 parallel workers, exactly 1 execution); exponential backoff
  30s·2^n; dead-letter state; repeatables idempotent by key;
  webhook-retry and payout-retry jobs. Inline worker by default,
  standalone worker.ts + WORKER_MODE=external for production; BullMQ/
  Redis documented as a deploy-time driver swap (no Redis available in
  this environment to verify).
- **Payout failure recovery**: transfer failure → payout `failed` +
  ledger hold reversed EXACTLY once (CAS on payout status); retry
  creates a fresh attempt; replayed retries return the successor payout
  (no double money — tested with the sandbox failNextTransfer hook and
  balance-conservation assertions).
- **Security hardening**: validateProductionConfig() refuses production
  boot on missing/weak config (9 classes, tested); bodyLimit 512 KB (413
  tested); security headers on every response; UUID request ids echoed
  as X-Request-Id; pino redaction (authorization, cookies, passwords,
  tokens — secrets never logged). npm audit run on both packages (see
  LAUNCH_AUDIT.md for the honest findings).
- **Observability**: structured request logs; /healthz liveness; /readyz
  readiness (DB + queue + storage), 503 when degraded (verified during
  the DB-kill drill).
- **Reliability**: graceful SIGTERM/SIGINT shutdown (HTTP close → finish
  in-flight job → prisma disconnect, 10s deadline); 15s timeout on
  provider HTTP calls; webhook processing errors enqueue retry jobs.

**Testing performed (all actually executed):**
- `tsc --noEmit` clean; frontend `vite build` clean.
- **128/128 API integration tests** (20 catalogue + 21 auth + 1 rate
  limit + 32 professional + 24 bookings + 15 admin + 15 phase-e —
  professional/bookings suites migrated from the review-key bridge to
  real admin auth). New coverage: admin authz matrix (anon 401, customer/
  pro 403, forged-JWT-role 403, suspended-admin 401, real admin 200),
  audit rows for approve/pause/suspend/resolve, job lifecycle
  (enqueue→done, duplicate-key no-op, backoff→dead-letter, concurrent
  claim = exactly-once), SigV4 AWS test vector, safe key generation,
  stub honesty + presign audit tracking, webhook replay ×3 (zero new
  ledger rows/events), payout failure→reversal-exactly-once→retry→paid→
  replay-no-op with global ledger balance assertion, production config
  validation, security headers, /readyz, 413 body limit.
- **21-step browser E2E** (single context, real sign-in/sign-out role
  switching, real DB/API/webhooks): Journey 1 Admin→Application→Approve→
  Professional; Journey 2 Admin→Dispute→Resolution (full refund);
  Journey 3 Customer→Booking→Payment→Completion→Payout (₦135,000
  payable on ₦150,000 booking verified in UI). Plus a security
  spot-check: non-admin blocked from the console AND the API (401).
- **Reliability drills** (executed, not simulated): API SIGTERM
  mid-payment → graceful shutdown logged; after restart the interrupted
  booking is still pending_payment with ZERO ledger entries and a
  retryable initiated payment; the orphaned sandbox session honestly
  409s instead of faking success. PostgreSQL killed → /readyz degrades
  to 503 {database:false,queue:false} while /healthz stays alive →
  postgres restarted → WAL crash recovery → API self-heals to /readyz
  200 without an API restart. Post-drill global ledger audit: all
  transactions balanced, no stuck jobs.

**Bugs found & fixed:** BUG-012 (live search param mismatch query vs q)
— see BUGS.md.

**Honest limits of this environment:** live Paystack, live R2, live
Resend, Redis/BullMQ, managed Postgres, backups/restore and TLS/edge
config CANNOT be verified from this sandbox (no external network). The
final launch audit (api/docs/LAUNCH_AUDIT.md) classifies every item as
Code verified / Infrastructure verified / Third-party verified / Not yet
verified — nothing is claimed "production ready" merely because tests
pass.

## 12. Known Issues / Remaining Tasks

- Service-detail availability preview is generated client-side (clearly
  labelled demo); replace with `GET /api/services/:id/availability`.
- Legal pages are placeholders pending real, reviewed documents.
- Social links in the footer are non-functional placeholders by design.
- Portfolio items on profiles use placeholder tiles (no fabricated project
  imagery) until real professionals supply work samples.

## 13. Backend Integration Points (next phase)

All in `src/lib/api.js` — replace demo resolvers with `fetch()`:

| Function | Endpoint |
|---|---|
| `getCategories()` | `GET /api/categories` |
| `getServices(params)` | `GET /api/services` |
| `getService(id)` | `GET /api/services/:id` |
| `getServiceReviews(id)` | `GET /api/services/:id/reviews` |
| `getProfessionals(params)` | `GET /api/professionals` |
| `getProfessional(id)` | `GET /api/professionals/:id` |
| `getProfessionalReviews(id)` | `GET /api/professionals/:id/reviews` |
| `getProfessionalServices(id)` | `GET /api/professionals/:id/services` |
| `getTestimonials()` | `GET /api/testimonials` |
| `getPricingPlans()` | `GET /api/plans` |
| `submitContact(payload)` | `POST /api/contact` |

Auth pages are UI-complete and awaiting `POST /api/auth/*` endpoints.
Booking CTAs currently open an honest "coming soon" modal — wire to the
booking service when it exists.
