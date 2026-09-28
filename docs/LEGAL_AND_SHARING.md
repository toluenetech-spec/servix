# Legal, cookie controls and sharing release — 2026-09-28

Owner authorised implementation and deployment. Public operator/contact supplied by owner: Toluwalase O. Samuel / toluenetech@gmail.com. No registered company or certification is claimed.

## Implementation
- Replaces prelaunch placeholder privacy/terms with current-app disclosures. Adds `/cookies` and footer preference controls.
- Shared versioned browser preference, expires after 180 days. Optional Vercel Analytics/Speed Insights are lazy-loaded only after allowance and only on a fixed public-route allowlist. Before-send middleware rechecks stored consent, rejects private/unknown routes, and strips queries/fragments. Withdrawing allowance reloads the page to discard already-loaded scripts. Storage failure leaves optional measurement off. Essential authentication cookies are unchanged.
- Terms/privacy notice at password and provider entry points. This is notice, not a server-side versioned terms-acceptance audit system or age-verification system.
- 1200×630 public PNG with absolute HTTPS Open Graph/Twitter tags in initial HTML. Build creates complete SPA HTML shells for fixed public routes, with explicit Vercel rewrites. Arbitrary/dynamic/private URLs receive the generic branded fallback, not personalised booking/user content. Canonical URLs exclude queries, tokens and private IDs. No per-service image-fetch or private data lookup.
- Auth/database/payment settings are untouched. No migration is required.

## Evidence
Frontend build passed. Fourteen Node tests (privacy/social + registration) passed. Eighteen Chromium browser tests passed, including actual script insertion gating, withdrawal/reload, private-page exclusion, legal mobile layout and existing auth regression. Browser provider/measurement endpoints are intercepted, not live-provider certification. Static HTML metadata and PNG dimensions verified without JavaScript. Real social apps may cache older previews or choose not to show an image.

## Deployment
Push only `arena/01a0dc4c-servix`. Vercel produces a preview; the owner must promote that exact deployment to Production. Verify `/privacy`, `/terms`, `/cookies`, the publicly accessible PNG and raw response metadata after promotion. No API feature flags are changed by this release.

## Legal/operational follow-up — not a compliance certificate
A Nigerian lawyer/privacy adviser should review terms and disclosures before broader launch, including lawful bases, cross-border transfer arrangements/provider contracts, applicable NDPC registration and compliance obligations, fee/refund disclosure, consumer rules, and business contact/disclosure requirements. A policy alone does not prevent lawsuits or establish compliance.

The operator must actually monitor the contact mailbox and process rights requests, establish an appropriate retention/deletion schedule (including backups, abandoned verification records and uploads), maintain provider agreements and an incident-response process, and assess registration requirements. These documents do not create those operations automatically. Current manual deletion limitations and payment testing are disclosed rather than falsely claiming instant deletion or fully live payments. No compulsory arbitration or blanket exclusion of statutory rights was added.

References reviewed: https://ndpc.gov.ng/ ; https://vercel.com/docs/analytics/privacy-policy ; https://vercel.com/docs/speed-insights/privacy-policy . These are reference links, not endorsements or evidence of legal approval.
