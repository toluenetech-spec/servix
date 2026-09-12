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

## BUG-007

- **Date:** 2026-08-26
- **Page:** API (rate limiting)
- **Description:** When the per-route auth rate limit triggered, the
  limiter's `errorResponseBuilder` returned a plain object that the
  global error handler re-processed as an unknown error, producing a
  500 with `INTERNAL_ERROR` instead of a 429 envelope.
- **Severity:** Medium (defence worked, but responses were wrong)
- **Status:** Fixed
- **Fix:** Removed the custom builder; the limiter now throws its native
  429 error, which the central error handler maps to the standard
  `{error:{code:'RATE_LIMITED',status:429}}` envelope. Also added a
  4xx passthrough branch for other framework errors.
- **Testing result:** 12 rapid logins → `422×10, 429, 429` with correct
  envelope; dedicated vitest case added (tests/ratelimit.test.ts).

## BUG-008

- **Date:** 2026-08-26
- **Page:** Frontend auth client (`src/lib/authApi.js`)
- **Description:** Session resume failed: `POST /auth/refresh` returned
  400 `FST_ERR_CTP_EMPTY_JSON_BODY` because the client always sent
  `Content-Type: application/json`, even on body-less requests, and
  Fastify rejects an empty JSON body.
- **Severity:** High (sessions did not survive page reloads)
- **Status:** Fixed
- **Fix:** The JSON content type is now only set when a body exists.
- **Testing result:** Browser E2E — register → reload → session resumes,
  navbar keeps the signed-in state; refresh returns 200.

## BUG-009

- **Date:** 2026-08-26
- **Page:** API (`/pro/services/:id/*`)
- **Description:** Publishing from the workspace returned 404. The
  serializer exposes service slugs as `id`, so the frontend naturally
  sends slugs — but `ownedService()` looked rows up by UUID only.
- **Severity:** High (publish/edit/delete broken from the UI)
- **Status:** Fixed
- **Fix:** `ownedService()` now matches `id OR slug` before the ownership
  check (ownership semantics unchanged).
- **Testing result:** Browser E2E publish step passes; 72/72 API tests
  green including ownership matrix.

## BUG-010

- **Date:** 2026-08-26
- **Page:** Frontend session resume (`src/lib/authApi.js`)
- **Description:** With React StrictMode double-invoking effects, two
  parallel `POST /auth/refresh` calls raced; the second presented the
  already-rotated cookie, which the reuse-detection correctly treated as
  a breach and revoked the session family — users appeared logged out
  right after registering.
- **Severity:** High (intermittent session loss)
- **Status:** Fixed
- **Fix:** `resumeSession()` is single-flight: concurrent callers share
  one in-flight refresh promise.
- **Testing result:** E2E navbar/session-resume steps pass consistently.

## BUG-011

- **Date:** 2026-08-26
- **Page:** Service detail booking form
- **Description:** The new BookingForm used `useEffect` but the page only
  imported `useState`, crashing the modal (`useEffect is not defined`).
- **Severity:** High (booking modal broken)
- **Status:** Fixed
- **Fix:** Added the missing import.
- **Testing result:** 11-step Phase D browser E2E passes end to end.

## BUG-012

- **Date:** 2026-08-27
- **Page:** Frontend live-API provider (`src/lib/httpApi.js`)
- **Description:** The services/professionals pages pass their search text
  as `query` (the demo provider's contract), but the live API validates
  `q`. `getServices`/`getProfessionals` forwarded the params untouched,
  so with the live API attached, every catalogue search silently returned
  the full unfiltered list. Discovered by the Phase E browser E2E when
  the freshly published service could not be found via search.
- **Severity:** Medium (search unusable in live mode; no data damage)
- **Status:** Fixed
- **Fix:** `httpApi` now maps `query` → `q` before building the query
  string (demo provider behaviour unchanged).
- **Testing result:** Phase E browser E2E finds services through the real
  search box; API-side filter tests remain green (128/128).

---

_No open bugs._
