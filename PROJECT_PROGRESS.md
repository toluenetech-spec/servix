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

The official uploaded logo was **not yet provided** at build time. Temporary
stand-in assets live at:

- `public/brand/servix-logo.svg` (light backgrounds)
- `public/brand/servix-logo-dark.svg` (dark backgrounds)
- `public/brand/favicon.svg` (app icon)

**To install the official logo: replace these three files 1:1 (same
filenames). Zero code changes are required.** The `Logo` component
(`src/components/brand/Logo.jsx`) only controls display height — it never
restyles or distorts the asset.

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

## 12. Known Issues / Remaining Tasks

- **Official logo asset still pending** — replace the three stand-in files in
  `public/brand/` when uploaded (no code changes needed).
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
