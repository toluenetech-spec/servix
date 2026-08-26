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

## BUG-004

- **Date:** 2026-08-24
- **Page:** Mobile navigation (`src/components/layout/Navbar.jsx`)
- **Description:** Three related defects in the mobile menu:
  1. Escape did not close the menu and did not restore focus to the
     toggle button — inconsistent with the focus pattern already used by
     Modal and Drawer.
  2. Focus stayed on the toggle button when the panel opened, so keyboard
     users tabbed into the page behind the panel.
  3. If the viewport was resized or rotated into the desktop layout while
     the menu was open, the fixed panel and the `body` scroll lock stayed
     applied and could trap the desktop page.
- **Severity:** Medium (accessibility, plus a state that can lock the page)
- **Status:** Fixed — PR #3, commit `95de989`
- **Fix:** Added `toggleRef` and `panelRef`. A `keydown` listener closes
  on Escape and refocuses the toggle; a separate effect moves focus into
  the panel on open (`tabIndex={-1}`); a `matchMedia` listener on
  `(min-width: 901px)` closes the menu when the viewport enters the
  desktop range. All three listeners clean up on close/unmount.
- **Testing result:** `npm run build` clean, no warnings. The three fixes
  were verified by review against the merged diff in `95de989`. They were
  **not** re-run through the headless-Chromium suite in that PR — see
  BUG-005.

## BUG-005

- **Date:** 2026-08-24
- **Page:** Documentation process (not the app)
- **Description:** PR #3 merged into `main` without a matching CHANGELOG,
  BUGS or PROJECT_PROGRESS update, so the project documentation silently
  described a pre-analytics codebase (CHANGELOG still topped out at
  0.1.1, BUGS.md still ended "No open bugs at the end of Phase 1"). This
  made the already-merged analytics integration look like uncommitted
  pending work in a later session.
- **Severity:** Low (process; no user-facing impact)
- **Status:** Fixed
- **Fix:** Retroactively added the 0.1.2 CHANGELOG entry, BUG-004 and
  this entry, and the PROJECT_PROGRESS updates (dependencies,
  observability, known issues). Going forward, documentation updates ship
  in the same PR as the change that motivates them.
- **Testing result:** Entries checked against `git show 95de989` and the
  merged history of `main` (`d20b8dc`); every claim matches the actual
  diff.

---

_No open bugs. BUG-004 and BUG-005 were found and closed after Phase 1._
