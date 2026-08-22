# Changelog

All notable changes to the Servix public website.

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
