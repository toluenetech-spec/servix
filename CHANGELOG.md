# Changelog

All notable changes to the Servix public website.

## 0.1.2 — 2026-08-24

### Added
- Vercel Web Analytics (`@vercel/analytics` ^2.0.1) and Vercel Speed
  Insights (`@vercel/speed-insights` ^2.0.0), mounted once in
  `src/App.jsx` as `<Analytics />` and `<SpeedInsights />` inside
  `ToastProvider`, after `</Suspense>` — so they cover every route,
  including the lazy-loaded ones. Merged in PR #3 (commit `95de989`).

### Fixed
- Mobile navigation: three behaviour/accessibility defects, tracked as
  BUG-004. The menu now closes on Escape and returns focus to the toggle
  button, moves focus into the panel on open (`tabIndex={-1}`), and
  closes when the viewport grows into the desktop range
  (`(min-width: 901px)`, mirroring the `max-width: 900px` rule in
  `layout.css`), so the fixed panel and the body scroll lock can never
  trap the desktop layout.
- Mobile navigation panel is now rendered with
  `createPortal(<nav/>, document.body)`. The navbar's `backdrop-filter`
  creates a containing block, which clipped the `position: fixed` panel
  to the navbar's own height. Portaling to `<body>` escapes it.
  (Recovered from branch `arena/01a029fd-servix`, commits `6c937b5` +
  `c42da2c`, which had been pushed to origin but never merged.)

### Notes
- PR #3 recreated work from an earlier session whose changes were never
  committed, and supersedes the closed Vercel bot PR #2 (analytics only).
- This entry was written retroactively: PR #3 merged to `main` without a
  CHANGELOG/BUGS/PROJECT_PROGRESS update (BUG-005).

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
