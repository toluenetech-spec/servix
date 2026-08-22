# Servix — Public Website

The official public-facing website for **Servix**, a professional services
marketplace connecting customers with trusted professional service providers.

This repository currently contains **Phase 1**: the complete public website
(marketing, discovery, detail pages, pricing, company pages and the
authentication UI shell), architected so the backend, dashboards and
payments can be integrated later without rebuilding the frontend.

## Stack

- React 18 + Vite 5 + React Router 6
- Plain CSS with a full design-token system (no UI framework)
- Inter Variable (self-hosted)

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
npm run preview  # preview the production build
```

## Project structure

```
public/
  brand/            Logo assets (see note below)
  images/           Demo imagery
src/
  components/
    brand/          Logo component
    cards/          ServiceCard, ProfessionalCard, CategoryCard
    layout/         Navbar, Footer, Layout
    ui/             Reusable UI system (buttons, fields, modal, drawer, …)
  data/             Structured DEMO data (services, professionals, …)
  lib/              api.js (future API boundary), hooks, formatters
  pages/            One module per route (code-split)
  styles/           tokens.css, base.css, layout.css, components.css, pages.css
```

## Brand note

`public/brand/` contains the official SERVIX identity (SX monogram +
wordmark) as outlined-path SVGs: `servix-logo.svg` (light backgrounds),
`servix-logo-dark.svg` (dark backgrounds) and `favicon.svg`. To update the
identity, replace these three files 1:1 — no code changes are required.

## Documentation

- `PROJECT_PROGRESS.md` — living project documentation
- `CHANGELOG.md` — release history
- `BUGS.md` — bug tracker

## Honest-by-design

This is a pre-launch website. Demo statistics, listings, profiles, reviews
and testimonials are clearly labelled as demonstration content, and no UI
pretends that bookings, payments or accounts are live.
