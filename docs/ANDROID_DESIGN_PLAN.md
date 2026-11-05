# Servix Android — Design Plan (make it feel like a real app)

Owner feedback on builds 1–7: *"The UI does not look like an application. It looks generic and not professional.
An app should not have a landing page — the home page should be the dashboard."*

This plan fixes that. It is binding for every screen. Work through the passes in order, one pass per
push, and show screenshots (from the CI screenshot job in Pass 0) before moving to the next pass.

The brand stays exactly as it is (colours, Inter, no gradients, the website's wording). What changes is
**everything that was copied from a website layout instead of designed for a phone**.

---

## 0. Use the installed skills — visibly

Before Pass 1, read these skill files and apply them; in each pass report, list which rule from which skill
drove each decision (one line each):

- `emil-design-eng`, `mobile-native`, `animate`, `review-animations` (emilkowalski/skills)
- `impeccable` (pbakaus/impeccable) — run its audit/anti-pattern checklist on every screen
- `ui-ux-pro-max` — spacing, hierarchy, touch targets, empty/loading/error states
- `frontend-design` (anthropics) — hierarchy and restraint
- `design-mobile-apps` (designed-by-ai) — native app patterns
- `android-testing-skills` (skydoves) — Robolectric screenshot tests (Pass 0)
- `jetpack-compose-skills` — state, Scaffold padding, lifecycle-aware collection

A report that does not cite the skills is incomplete.

### Pass 0 — see your own UI (CI screenshot job)

You cannot run an emulator, so the build server must render screens for you.

- Add `.github/workflows/screenshots.yml` (push on `main` and `arena/**`, plus `workflow_dispatch`): same
  JDK/Gradle/SDK setup as `android-apk.yml`, then
  `gradle :app:testDebugUnitTest --tests "ng.name.servix.app.screenshots.*" --no-daemon`, then upload
  `app/build/reports/screenshots/**/*.png` as an artifact named `screenshots`.
- Add Robolectric screenshot tests under `app/src/test/java/ng/name/servix/app/screenshots/` using
  `@GraphicsMode(NATIVE)`, `isIncludeAndroidResources = true`, a Pixel-7-class qualifier
  (`w411dp-h914dp-xxhdpi`), light theme, and **fake in-memory data only** (fixtures that mirror the real
  JSON shapes). **Never call the network from these tests.** One PNG per screen state: Welcome, Sign in,
  Home (signed in), Home (guest), Explore results, Explore empty, Professional profile, Service detail,
  Booking sheet, Bookings list, Booking detail (pending_payment / requested / completed), AI chat, AI
  Budget Guide, Account, This device, Plan, Notifications.
- After each push: `gh run download <run-id> -n screenshots -D /tmp/shots` and look at every PNG before
  reporting. Attach the artifact link in the report.

---

## 1. App structure — no landing page

```
Launch ──► session valid? ──yes──► HOME (dashboard)  ← first tab, always
                 │
                 no
                 ▼
            WELCOME (auth) ──► Create account / Sign in ──► Security check ──► HOME
                 │
                 └── "Browse first" ──► HOME (guest mode)
```

- **Delete the website-style Home** (hero copy, "How Servix works", trust banner, "Offer your services"
  banner, stats strip, footer-like sections). None of that belongs in an app.
- **Merge Dashboard + Home into one `Home` tab.** The Home *is* the dashboard.
- Bottom navigation, exactly five tabs, in this order, Material 3 `NavigationBar` with icon + short label:
  **Home · Explore · Bookings · Servix AI · Account**. Selected = Deep Forest icon on Soft Sand pill;
  unselected = Muted Gray. Badge on Bookings for `pending_payment`/`delivered` counts, on Account for unread
  notifications.
- Welcome is a single calm screen (logo, one headline, two buttons, one text link). No carousel, no marketing.
- Deep links `https://www.servix.name.ng/bookings/<id>` open Booking detail (already done — keep).

## 2. Home (the dashboard) — signed in

A vertical feed, 16 dp side padding, 24 dp between sections, no section longer than needed:

1. **Top bar (not a toolbar):** left — "Good morning, Adaeze" (`titleLarge`) with the date below in
   `bodySmall` Muted Gray; right — avatar (36 dp, initials fallback) that opens Account, and a bell with unread dot.
2. **Search field** (56 dp tall, Soft Sand fill, 16 dp radius, search icon, placeholder "What do you need done?").
   Tapping it opens Explore with the keyboard up.
3. **"Needs your attention" strip** — only when relevant: pending payment ("Finish paying ₦350,000 →"),
   delivered ("Confirm completion →"), pending review. One card per item, Coral left accent 3 dp, max 3.
4. **Upcoming / active bookings** — horizontal cards (280 × 120 dp): service title, professional avatar + name,
   status chip, date. Empty: a single quiet line "No active bookings yet" with "Find a professional →".
5. **Categories** — horizontal row of 8 round-ish chips (icon 20 dp + label) from `GET /categories`.
6. **Recommended professionals** — vertical list of 4 `ProfessionalRow`s (see §4) from
   `GET /professionals?sort=recommended&pageSize=4` (if "Near Lagos" is set, pass `location`).
7. **Servix AI card** — one card: small sparkle icon, "Ask Servix AI", one-line example prompt, arrow. Taps to AI tab.
8. **Plan line** — single row "Free plan · AI 2,300 / 20,000 words this month" → Account › Plan.

No "Welcome back" hero. No stats grid of marketing numbers. No "Find a professional" button twice.

**Guest Home**: same screen; items 3, 4, 8 replaced by one quiet card: "Sign in to see your bookings" with
**Sign in** and **Create account** buttons. Nothing else differs.

## 3. Visual system for phones

Keep `Color.kt` as is. Change these:

- **Typography:** ship **all Inter weights** (Regular 400, Medium 500, SemiBold 600, Bold 700 — separate TTFs
  or the variable font with `FontVariation.weight`). Today one file is registered for every weight, so
  headings render as regular — that is a large part of the "generic" feeling. Scale: display 32/38,
  headline 24/30, title 18/24 (600), body 16/24, label 13/18 (500), caption 12/16; `tabular-nums` for
  prices and counters; `-0.2 sp` tracking on titles only.
- **Radii for mobile:** cards 16 dp, sheets 24 dp top, buttons 12 dp, inputs 12 dp, chips pill. (The web's
  3/6/10 looks boxy at phone density; the brand owner accepts larger radii on mobile. Still **no gradients**.)
- **Elevation:** none. Separate surfaces with colour only — White cards on Warm Ivory, 1 dp Border Sand hairline
  where two whites meet. No drop shadows except the bottom sheet scrim.
- **Spacing grid:** 4 dp base; 16 dp screen gutters; 12 dp inside cards; 8 dp between related elements;
  24 dp between sections. Touch targets ≥ 48 dp. Content respects `Scaffold` padding + IME insets; edge-to-edge
  with transparent status bar (dark icons on Warm Ivory).
- **Icons:** Material Symbols **Rounded**, 24 dp, 1.5–2 px stroke feel; never mix with emoji.
- **Images:** professional avatars circular (48 dp in rows, 72 dp on profile); service images 16:10, 16 dp
  radius; Coil crossfade 200 ms; Soft Sand placeholder; initials fallback in Deep Forest on Soft Sand.
- **Buttons:** Primary = Deep Forest fill / Warm Ivory text, 52 dp tall, full width in sheets; Secondary =
  Soft Sand fill / Charcoal text; Tertiary = text only Forest Green; Destructive = Danger Red text (confirm in dialog).
  Pressed state: scale 0.98 + 8% darker, 120 ms ease-out.
- **Status chips** (bookings): pill, `labelMedium` 500, tinted backgrounds — pending_payment Coral 12%/Coral
  text; requested & accepted Soft Sand/Charcoal; in_progress Forest Green 12%/Forest Green; delivered
  Forest Green 12%; completed Deep Forest/Warm Ivory; cancelled/declined/refunded Muted Gray 12%/Muted Gray;
  disputed Danger Red 10%/Danger Red.
- **Skeletons, not spinners:** every list shows 3 skeleton rows (Soft Sand blocks, 1.2 s shimmer-free pulse)
  while loading. A centred spinner only inside buttons.
- **Empty states:** one icon (48 dp, Muted Gray), one sentence from the website wording, one action. Never a
  blank screen.
- **Errors:** inline card with the server message and **Retry**; offline banner at top (keep); snackbars for
  success ("Saved", "Booking cancelled"), 3 s.
- **Motion** (Emil Kowalski rules): 150–250 ms, `FastOutSlowIn`/ease-out only, no bounce, no overshoot;
  screen transitions = horizontal shared-axis 220 ms; bottom sheets slide up 250 ms; content fades 150 ms;
  animate only what changed. Respect "Remove animations" system setting.
- **Haptics:** light tick on successful book/pay/confirm; none elsewhere.
- **Dark mode:** not in v1 (brand is light). Force light; do not let the system theme invert colours.

## 4. Reusable components (build once, use everywhere — `ui/components/`)

`ServixTopBar(title, back?, actions)`, `SearchField`, `SectionHeader(title, action?)`,
`ProfessionalRow(avatar, name, title, rating ★ 4.8 (23), startingPrice, verifiedBadge)`,
`ProfessionalCard` (grid/horizontal variant), `ServiceCard(image, title, pro, price, rating)`,
`CategoryChip`, `StatusChip(status)`, `PriceText(amount, unit)` (tabular, "₦350,000 · per project"),
`PrimaryButton/SecondaryButton/TextButton`, `InfoRow(label, value)`, `ListSkeleton`, `EmptyState`,
`ErrorCard(message, onRetry)`, `ServixBottomSheet(title, content)`, `AttentionCard`, `AvatarImage(size, initials)`.
Remove duplicated ad-hoc layouts in screens once these exist.

## 5. Screen specs (what to change)

- **Explore (Search):** search field pinned under a slim top bar; below it a horizontal filter chip row
  ("Filters ·2", Sort, Category, City, Available now); results as `ProfessionalRow`s with a toggle
  Professionals / Services as a segmented control (not two tabs). Filter sheet: grouped sections, pill chips,
  one price slider with ₦ labels, "Show 12 results" sticky button. Empty state per §3.
- **Professional profile:** collapsing header (72 dp avatar, name + verified, title, "Lagos · Responds in 2 h",
  rating/reviews/projects as three compact stats), then pill tabs About · Services · Portfolio · Reviews that
  stick under the top bar; sticky bottom bar "Book — from ₦120,000" (52 dp) with Save icon beside it.
  Trust panel as a compact card, not a web sidebar.
- **Service detail:** edge-to-edge image pager (16:10) with page dots; title + price block; provider row;
  "What's included" as checkmarks; slots as a horizontal date row then time pills; FAQs as expandable rows;
  reviews with avatar initials; sticky bottom bar "Book this service · ₦350,000".
- **Booking sheet:** 24 dp top radius, grab handle, title, price line, date row, time pills, notes field,
  **Book & Pay** button, "Payment is held securely…" as `bodySmall` under the button, not above it.
- **Bookings:** segmented control Active / Past; `BookingRow` (service title, pro, date, `StatusChip`, amount);
  group Active by date ("Today", "This week", "Later").
- **Booking detail:** status header card (chip + one plain sentence of what happens next), details as `InfoRow`s,
  actions as a bottom action bar (primary = the one next step; others in an overflow "More" sheet).
- **Servix AI:** chat bubbles (user = Deep Forest/Warm Ivory right-aligned 16 dp radius with 4 dp tail corner;
  assistant = White card left-aligned), streaming caret, suggestion chips when empty, composer pinned above the
  nav bar with IME insets, usage meter as a thin bar in the top bar (tap → details), 👍/👎 + Copy as small
  icon buttons under each answer, Budget Guide as a segment in the same tab.
- **Account:** header (avatar 64 dp, name, email, plan chip); grouped settings list (Profile · Saved ·
  Notifications · Plan · Security · This device · Updates · Legal · Sign out) with chevrons and section titles;
  destructive items in Danger Red at the bottom.
- **Welcome / Auth:** inputs 56 dp with floating labels, inline validation under the field, password
  visibility toggle, Terms checkbox row with tappable links, primary button pinned above the keyboard;
  Security check steps shown as a 4-dot progress row with the step name.

## 6. App icon & splash

- Adaptive icon from `public/brand/servix-app-logo.png` / `favicon.svg`: Deep Forest background layer,
  Warm Ivory mark foreground with safe-zone padding; monochrome layer for themed icons.
- Android 12+ `SplashScreen` API: Warm Ivory background, centred mark, no text; fade to Home in 200 ms.
- Status bar and navigation bar transparent; app name "Servix".

## 7. Order of work & acceptance

| Pass | Scope | Done when |
|---|---|---|
| 0 | Screenshot CI job + fixtures | Artifact with ≥ 12 PNGs; you have looked at all of them |
| 1 | Typography weights, radii, components (§3–4), icon + splash (§6) | Screenshots show bold headings, 16 dp cards, no shadows |
| 2 | Structure (§1) + Home dashboard (§2), guest Home, five tabs | Launch with session → Home; no landing content left anywhere |
| 3 | Explore, Profile, Service detail, Booking sheet (§5) | Screenshots pass the Impeccable checklist; no web-style sections |
| 4 | Bookings, Booking detail, AI, Account, Auth (§5) | Same |
| 5 | Motion + haptics + a11y sweep (TalkBack labels, 48 dp targets, font scaling to 1.3×) | Report lists each animation and its duration |

Each pass = one version bump (0.6.0, 0.6.1, …), one green APK build, one screenshot artifact, one report
that cites the skills used. Stop after each pass and wait for "go". The owner tests on a real phone.
