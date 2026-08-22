# Servix — Bug Tracker

Every bug discovered during development is recorded here. None are silently
ignored.

---

## BUG-001

- **Date:** 2026-08-22
- **Page:** Data layer (`src/data/categories.js`)
- **Description:** During initial data authoring, the Video Editing category
  was written with an invalid `serviceCount` value (a stray function
  placeholder instead of a number), which would have rendered garbage in the
  category card meta line.
- **Severity:** Medium
- **Status:** Fixed
- **Fix:** Replaced with the correct numeric demo value (59) and the missing
  `icon: 'film'` field before first render.
- **Testing result:** Category grid verified on `/` and `/services` at
  1440px and 390px — all 8 categories render name/description/count/arrow
  correctly.

## BUG-002

- **Date:** 2026-08-22
- **Page:** Service detail (`/services/:id`)
- **Description:** Initial demo data referenced gallery images
  (`business-website-2.jpg`, `business-website-3.jpg`, `brand-identity-2.jpg`)
  that were never going to exist as assets, which would have produced broken
  gallery thumbnails.
- **Severity:** Medium
- **Status:** Fixed
- **Fix:** Rewrote gallery arrays to reference only real files shipped in
  `public/images/services/`.
- **Testing result:** Automated smoke test reported zero failed image
  requests across all routes; gallery thumbnail switching verified on
  `/services/business-website-development` and `/services/brand-identity-package`.

## BUG-003

- **Date:** 2026-08-22
- **Page:** Automated test suite (not the app)
- **Description:** The interaction test initially reported "mobile menu does
  not close after navigation" and "0 search results for `photo`".
  Investigation showed both were race conditions in the test itself: the
  target routes are lazy-loaded chunks, and the assertions ran before the
  chunk finished loading on first (cold) navigation.
- **Severity:** Low (false positive)
- **Status:** Closed — not an application bug
- **Fix:** Re-ran with proper waits; menu-close passed 3/3 consecutive runs
  and `q=photo` correctly returns 2 services. App behaviour confirmed
  correct: menu closes via a `useEffect` on `location.pathname`.
- **Testing result:** 3/3 PASS at 390px viewport.

---

_No open bugs at the end of Phase 1._
