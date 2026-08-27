# SERVIX — Project Progress

> Living documentation for the Servix public website (Phase 1).
> Last updated: 2026-08-22

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

**Delivered** (scope: accounts/auth only — no onboarding, bookings,
payments, messaging or subscriptions):

- DB: `users`, `refresh_tokens`, `one_time_tokens` (+2 enums), migration
  `20260826000000_auth_accounts` applied via the offline runner.
- API (`/api/v1`): register, login, refresh, logout, verify-email
  (+resend), forgot-password, reset-password, `GET /me`.
- Security: scrypt hashing (OWASP params, timing-safe compare); JWT HS256
  access tokens (15 min) kept in client memory only; rotating refresh
  tokens in httpOnly SameSite=Lax cookies scoped to /api/v1/auth, stored
  sha256-hashed with family reuse detection; single-use hashed one-time
  tokens (verify 24h, reset 30m); reset revokes all sessions;
  anti-enumeration on login and forgot-password; per-route rate limits
  (login/register 10/min, forgot 5/15min, resend 3/5min) with 429
  envelopes; production boot refuses a missing AUTH_JWT_SECRET.
- Email: console transport abstraction (`api/src/lib/mailer.ts`) —
  provider swap is one file at deploy time; no fake "email sent" claims.
- Frontend: `AuthProvider`/`useAuth` (src/lib/AuthContext.jsx) with
  session resume; authApi.js client (no demo fallback for auth — real or
  honestly unavailable); all five existing auth pages now perform real
  auth with API field errors mapped into the existing `Field` component;
  Navbar shows first name + Sign Out when signed in (desktop + mobile);
  design and component structure unchanged.

**Testing performed (all actually executed):**
- `tsc --noEmit` clean (API); frontend `vite build` clean.
- 61/61 vitest integration tests (20 catalogue + 40 auth/limits + docs):
  register happy/duplicate/validation/roles; login valid/wrong/unknown
  parity; /me token handling; refresh rotation + family reuse detection;
  logout revocation; verification valid/single-use/unknown/expired;
  reset full-flow + session revocation + reuse; CORS with credentials;
  429 envelope.
- Manual curl pass over every auth endpoint including reset-link
  round-trip from the console-transport email.
- Browser E2E (live API): register → /verify-email redirect; navbar
  signed-in chip; session survives reload; sign out; wrong-password
  inline error; login redirect; forgot-password confirmation screen;
  email-link verification (valid + reused-link failure states).
- Demo-mode drill (no VITE_API_URL): auth pages show the original honest
  pre-launch toasts and make zero API calls; catalogue demo data intact.

**Bugs found & fixed:** BUG-007 (rate-limit 500s), BUG-008 (refresh 400
on empty JSON body) — see BUGS.md.

## 11e. Phase C — Professional Onboarding (2026-08-26)

**Delivered** (scope: onboarding + profile + service management only):

- Application workflow (`professional_applications`): pending →
  under_review → approved/rejected. Server-controlled approval performs
  the ONLY role promotion in the codebase, transactionally (application +
  user.role + profile creation). Duplicate-active blocked, rejected may
  re-apply, locked once submitted. Review endpoint is internal-only
  (hidden from OpenAPI, X-Servix-Review-Key guarded) until the Phase E
  admin dashboard.
- `/pro/*` management API: profile (get/patch with category validation),
  skills (replace-on-write), portfolio (add/remove, 20-item cap), service
  CRUD with draft → publish → unpublish → archive lifecycle; slugs or
  UUIDs accepted; startingPrice aggregate maintained; drafts invisible
  publicly. Full zod validation server-side (title/price/description
  lengths, category existence, bounded lists).
- Authorization: `requireProfessional` re-reads role+profile from the DB
  every request (JWT alone never grants pro access); all queries scoped
  to the owner; cross-owner probes get 404 (anti-enumeration); unknown
  body fields stripped (role-escalation test proves users.role is
  untouched).
- Storage boundary: `POST /pro/uploads` presign contract with type/size
  validation and an HONEST LocalStubProvider (enabled:false, no fake
  uploads); R2 provider is a documented deploy-time swap.
- Frontend: `/professionals/apply` + `/pro` workspace (Services/Profile
  tabs) using only existing components/tokens; navbar Workspace link;
  Join page CTAs → application flow. Route order preserved
  (`/professionals/join`, `/professionals/apply` before `:id`).
- Migration `20260826100000_professional_onboarding` applied; catalogue
  data untouched.

**Testing performed (all actually executed):**
- `tsc --noEmit` clean; frontend `vite build` clean.
- **72/72 API integration tests** — Phase A catalogue regression
  (hardened for organic growth: seed presence, filter correctness,
  duplicate-free pagination at any total), Phase B auth suite, and 31
  Phase C tests: application lifecycle, duplicates, ownership,
  transitions, rejection/re-application, approval side-effects, full
  authorization matrix (customer/rejected/anonymous/role-escalation),
  profile/skills/portfolio, upload presign honesty, service CRUD +
  publish/unpublish/archive + cross-professional denial, public
  visibility rules, new-professional public-directory appearance.
- **9-step browser E2E** (real DB/API, zero console errors): register →
  apply → submit → server approval → workspace redirect → profile loads →
  service created as draft → publish → public service page (₦250,000) →
  public professional profile page.

**Bugs found & fixed:** BUG-009 (slug lookup), BUG-010 (parallel refresh
vs. reuse detection) — see BUGS.md.

## 11f. Phase D — Bookings + Payments (2026-08-26)

**Design first:** api/docs/BOOKINGS.md + api/docs/PAYMENTS.md written and
internally reconciled before implementation (state machine, transitions
table with actors, availability, payment/webhook/escrow/refund/dispute/
payout/ledger lifecycles, review eligibility, idempotency and
concurrency strategy).

**Delivered:**
- Bookings: customer+professional+service links, immutable kobo price
  snapshot + service title snapshot, scheduled slot, cancellation/
  completion/dispute fields, reference, immutable booking_events audit
  trail. 10-state machine; every transition is a compare-and-swap inside
  a DB transaction (2 simultaneous accepts → exactly one winner, tested).
- Availability: weekly rules + date exceptions + defaults; conflicts
  rejected in API AND enforced by a partial unique index on
  (professional_id, scheduled_at) for active statuses.
- Payments: provider abstraction (Paystack live / sandbox parity). The
  ONLY path to paid state is: signed webhook (HMAC-SHA512 over raw body,
  timing-safe compare) → server-to-server verify → amount/currency match
  → CAS capture. Init idempotent (one open payment per booking, partial
  unique index); webhooks idempotent (UNIQUE provider event id);
  duplicates/out-of-order no-op; booking creation idempotent via
  Idempotency-Key (UNIQUE customer+key).
- Escrow & ledger: append-only double-entry (5 accounts), every
  transaction balanced (asserted over ALL entries in tests), balances
  ledger-derived only. Release on confirm or 3-day auto-sweep (interval
  in server, direct invocation in tests); disputes freeze funds and are
  excluded from the sweep by construction.
- Refund policy module (single source, env-configurable): full refund
  before acceptance/professional cancellation, configurable before-work,
  dispute-only after work begins. Clients never supply amounts.
- Payouts: ledger-derived balance recomputed in-transaction, in-flight
  uniqueness at DB level, provider refs stored, failures marked.
- Reviews: bound to completed bookings (customer-only, once-only via DB
  unique, target derived server-side), aggregates recomputed atomically.
- Frontend (existing design system): booking modal with real slots,
  checkout redirect, booking detail (status polling, confirm/cancel/
  dispute/review), My Bookings, workspace Bookings + Earnings tabs.

**Testing:** 96/96 API tests (A+B+C+D: creation, conflicts, duplicate
requests, init, success/duplicate/invalid webhooks, verification, failed
payment, cancellation, refunds, completion, auto-confirm, disputes,
escrow hold/release, payout + duplicate payout, review eligibility +
duplicate, authorization matrix incl. price/refund manipulation attempts,
concurrent accepts, ledger balance invariant). `tsc --noEmit` clean.
Frontend build clean. 11-step browser E2E across both journeys
(customer: register→book→pay→confirm→review; professional:
accept→start→deliver→earnings→payout) — zero page errors; payable
₦135,000 on a ₦150,000 booking (10% fee) verified in UI.

**Bugs:** BUG-011 (missing useEffect import) — fixed. See BUGS.md.

**Environment note:** outbound Paystack API is blocked in this sandbox,
so live-key integration ran against the sandbox provider with full
signature/webhook parity; PaystackProvider activates automatically when
PAYSTACK_SECRET_KEY is configured at deploy time.

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
