# Servix Stitch design collection — delivery review (pre-implementation)

> **Update (2026-11-08):** the corrections described below have been applied. Corrected files, new screens, scripts and the Android hand-off prompt live in `docs/stitch-design/` (see `docs/stitch-design/CORRECTIONS.md`).


Source: Google Drive folder `1Zc417rTTaVHrLxFgzaUxKRprWnIMx4RG` ("Servix UI UX design"), 18 HTML files, all
modified at the same minute. Reviewed 2026-11-08 against the app on `servix-android` `main` (`179922c`),
the Stitch brief (`docs/stitch-design-brief/` @ `13fb6c5`) and the live API source (`api/src/routes/*.ts`).

> **Status: NOT ready to hand to the coding agent.** See §1 (what could not be inspected) and §5 (blocking
> inconsistencies). A draft screen-by-screen specification is in §8 so the handoff can be finished quickly once
> the raw files are available and the owner has answered the four questions in §9.

---

## 1. Method and a hard limitation

| Step requested | Done? | How / why not |
| --- | --- | --- |
| Download all 18 HTML files | **Partially** | The sandbox has no network route to Google (only GitHub/npm/PyPI hosts). Each file was fetched through the page-reader tool instead, which returns **rendered text only** — it strips `<link>`, `<style>`, `<script>`, class names and inline CSS. |
| Inspect every file's HTML and embedded CSS | **No** | Not possible from rendered text. Colours, fonts, spacing, radii, Tailwind config and any `<style>` blocks are unverified. |
| Identify external stylesheets / fonts / icons / images | **Partially** | Icons and images are provable from the text (see §3). Stylesheets and fonts are inferred from the Stitch export format, not confirmed. |
| Self-contained or not | **Answered (not self-contained)** | Every screen references Google-hosted icons and images (§3). |
| Resolve the duplicate account-creation files | **Done** | §4. |
| Compare against the screen inventory | **Done** | §6. |
| Inspect the motion system | **Done (text level)** | §7. |
| Screen-by-screen spec | **Draft** | §8, conditioned on §5 fixes. |

**To finish the inspection** the 18 raw `.html` files must reach the workspace. Easiest for a phone: in Drive tap
the folder's ⋮ → **Download** (gives one zip), then attach that zip in this chat. Alternative: upload the
zip to the `servix` repo through GitHub's web UI ("Add file → Upload files") on a branch — not `main`.

## 2. File manifest (Drive IDs, for retrieval)

| # | File | Drive file id | Size | Maps to |
| --- | --- | --- | --- | --- |
| 1 | `s2_welcome_minimal.html` | `1NUyMHIR7gCLDMmNL2mKNkFOwCqIpnEJB` | 9 KB | S2 Welcome |
| 2 | `s3_sign_in.html` | `1Kt_kOrFdrlhWTnbNJDEPA2px4KOCEAlh` | 14 KB | S3 Sign in |
| 3 | `s4_create_account_corrected.html` | `17unwTA6YYyLS7DTAM2jZ9hXI2zY7ciaM` | 19 KB | S4 Create account — **approved** |
| 4 | `s4_create_account.html` | `1dRtj0YeVH-ih8v6w8F3JyxzWpw0sVI_5` | 21 KB | S4 — superseded |
| 5 | `s5_email_verification.html` | `1nMEvFx1mEdR28oFmQTPIjgy-oox9rIMF` | 12 KB | S5 Verify email |
| 6 | `s6_security_check.html` | `1Cbxontu8maVZ6uuk0_xVRr9FrB124s__` | 16 KB | S6 Security check (one stage only) |
| 7 | `s7_forgot_password.html` | `1m2A2h5zhQIr1sQpYjDVrKxYDXIeInt7O` | 15 KB | S7 Forgot password |
| 8 | `s8_home_dashboard_messages_tab_final.html` | `1J56KnUmKgRxq1g2y1BSM3Ocw4zFDJpgk` | 28 KB | S8 Home (customer) |
| 9 | `s9_explore_discovery.html` | `1nTenHfLcH_DXzDZw-Q8g9WlgbiOfe1BW` | 37 KB | S9 Explore (browse) |
| 10 | `s9_search_results.html` | `1aGpw8nAyMV3Dm3zi6GNv9gKhMSc8D_-Q` | 26 KB | S9 Explore (results) |
| 11 | `s10_professional_profile.html` | `1fbgxxDXt-EJEytkOrjSsKwoIQnLU5OH_` | 32 KB | S10 Professional profile |
| 12 | `s11_service_detail.html` | `1N2E2Ttk_7qF9NZNXYbd7vSOB7HBEGJBv` | 20 KB | S11 Service detail |
| 13 | `s12_bookings_hub.html` | `1JU63m-lBFggmOxF3FgCNsu5b39MRrd1-` | 27 KB | S12 Bookings |
| 14 | `s13_booking_detail.html` | `1fTUvTKyVrskItA4pViW5Ljww7ACqgtu0` | 25 KB | S13 Booking detail (delivered state) |
| 15 | `s14_servix_ai_budget_guide.html` | `1oCeiVDUhBevzuUEZ_vMo1MAymTw5ynHd` | 21 KB | S14 Servix AI |
| 16 | `s17_chats_inbox_whatsapp_grade.html` | `1VyrwJaqXO9shIqsdgMpBjCCQmGuUnGjG` | 24 KB | Release 1.1 Chats list |
| 17 | `s18_chat_conversation_voice_note.html` | `1Yie7EPJHM5TswS7MkRSjhjLGYh7XzJNB` | 23 KB | Release 1.1 Conversation |
| 18 | `servix_motion_interaction_system.html` | `1MKIu5zrT7Y9LNRTmtZkpkSyqX6J-O8N6` | 36 KB | Motion tokens |

The `sN` numbers follow the brief's S1–S16 numbering exactly, which makes the gaps unambiguous (see §6).

## 3. Asset dependencies (what is provable)

| Dependency | Evidence | Verdict |
| --- | --- | --- |
| **Material Symbols icon font** (Google Fonts) | Icon ligature names leak into the rendered text of all 18 files: `verified_user`, `arrow_forward`, `done_all`, `lock_clock`, `credit_card_clock`, `calendar_add_on`, … | External. The app uses Material Icons Extended (Compose) — every icon must be re-mapped; several names (`lock_clock`, `credit_card_clock`, `propane`, `oil_barrel`, `precision_manufacturing`) have no Compose equivalent and need a drawable or a substitute. |
| **AI-generated raster images** on `lh3.googleusercontent.com/aida-public/…` | 40+ `<img>` URLs across s4(original), s8, s9×2, s10, s11, s12, s13, s14, s17, s18 | External, un-licensed for shipping, may expire. **None may be bundled.** All are placeholders for real avatars / gallery photos from the API (`avatarUrl`, gallery items). |
| **Web font** via `fonts.googleapis.com` | Confirmed in the decoded s2 head: Inter 400/500/600/700 | External, but the same family the app bundles — no change needed. |
| **Tailwind CDN** (`cdn.tailwindcss.com`) + inline `tailwind.config` | Confirmed in the decoded s2 head | External. The config holds the colour/radius tokens — see §3b: they are a Material-3 tonal palette, **not** the brand palette. |
| Inline `<script>` (motion page) | Interactive demos ("Tap to preview spring", haptics buttons) | The motion page is a web playground; only the token table transfers. |
| Dead links | `#`, `#terms-of-service`, `#signin`, `sms:+2348012345678`, `tel:+2348012345678`, `tel:+2341800737849` | All placeholder; the phone numbers and the "1 800 SERVIX" line are fictional and must not ship. |

**Conclusion:** the designs are **not self-contained**. They need an icon font, Google-hosted images and (almost
certainly) a Google-hosted web font. For Android none of these are used directly — the designs are a visual
reference, not an asset source.

## 3b. Design-system check (from the one file head that could be decoded — `s2_welcome_minimal.html`)

A relay proxy briefly returned the raw source of s2; its `<head>` is the shared Stitch theme block, so these
values almost certainly apply to all 18 files (to be confirmed once the zip is in the workspace).

| Item | In the Stitch files | Servix app standard | Verdict |
| --- | --- | --- | --- |
| Font | **Inter 400/500/600/700** (Google Fonts) | Inter 400–700 bundled | ✅ matches — keep Inter |
| Icons | Material Symbols Outlined (two `<link>`s) | Material Icons Extended | re-map |
| CSS engine | Tailwind CDN + inline `tailwind.config` (Material-3 tonal tokens) | Compose M3 theme | reference only |
| `primary` | `#002116` (near-black green) | DeepForest `#12372A` is the app primary | ⚠️ Stitch uses DeepForest only as `primary-container` |
| `secondary` / container | `#2d6951` / `#b2f0d1` (mint) | ForestGreen `#1F5C45` / SoftSand `#EDE8DC` | ⚠️ mint tint is off-brand |
| `surface` / `background` | `#f5fbf4` (cool greenish white); containers `#eff5ee` `#eaefe9` `#e4eae3` | WarmIvory `#F7F4EC`, SoftSand `#EDE8DC` | ⚠️ **wrong temperature** — the whole canvas reads cool/minty instead of warm ivory |
| Accent | `tertiary #420001`, container `#650c09`, `on-tertiary-container #f07365` | Coral `#E56B5D` | ⚠️ no Coral token; the only warm accent is a dark maroon pair |
| `error` | `#ba1a1a` | DangerRed `#B3372A` | close — use DangerRed |
| `outline` / variant | `#717974` / `#c1c8c3` | BorderStrongSand `#C9C2B1` / BorderSand `#DDD7C9` | ⚠️ grey-green vs sand |
| Radii | DEFAULT 4 px · lg 8 px · xl 12 px · full | button 12 · card 16 · sheet 24 | ⚠️ too tight — cards at 8–12 px look web-like |
| Type scale | body 16/24 & 14/20, title 16/22 600 & 18/24 600, headline 22/28 & 32/40 600, display 40/48 700, label 12/16 500 & 14/20 600, "currency-display" 28/36 700 | app `Type.kt` (Inter) | ✅ usable as-is; adopt `currency-display` for ₦ amounts |
| Layout | `min-height: max(884px, 100dvh)`, 16 px margins, safe-area paddings | 16 dp margins | ✅ |
| Welcome logo | inline animated SVG (gentlePulse / ringSpin / shieldFloat keyframes) — a *shield* mark | Servix wordmark | ⚠️ shield iconography reinforces the "escrow vault" theme; use the real logo |

**Conclusion:** the layouts can be kept, but the **colour tokens must be re-mapped to the brand palette** when
the files are corrected (surface → WarmIvory, containers → SoftSand, primary → DeepForest, secondary →
ForestGreen, tertiary → Coral, outline → BorderSand, error → DangerRed) and radii raised to 12/16/24.

## 4. Duplicate account-creation files — resolution

| | `s4_create_account.html` (original) | `s4_create_account_corrected.html` (**approved**) |
| --- | --- | --- |
| Header badge | "Escrow-Protected Registration" ✗ | none ✓ |
| Social proof strip | 3 AI avatars + "Over 18,400+ vetted artisans" ✗ (fabricated) | none ✓ |
| Fields | Full name, Email, **Phone (+234)**, Password | Full name, Email, Password, **Confirm password** |
| Password rules | 3 (8 chars, number, special) ✗ | 6: ≥8, upper, lower, number, special, max 200 ✓ matches `strongPasswordSchema` |
| Helper copy | "Used solely for booking updates and escrow releases." ✗ | — |
| Consent | Terms + Privacy + "confirm I am booking services in Nigeria" | Terms + Privacy + 18+ statement ✓ |
| Footer | "payments and data are held in escrow under NDPR standards" ✗ (escrow word; NDPR superseded by NDPA 2023) | none ✓ |
| Providers | Google · GitHub | Google · GitHub ✓ |

`POST /auth/register` accepts `fullName, email, password, accountType` only (`auth.ts:63-68`) — there is no phone
field, so the original is also wrong against the API. **Use `s4_create_account_corrected.html`; delete the
other from the hand-off.** One residual note on the approved file: the rule list says "Max 200 chars" — true
(`passwordPolicy.ts:2`) but a maximum is noise in a live checklist; show it only as an error.

## 5. Inconsistencies against the product (must be fixed in the design or overridden in the spec)

### 5.1 Blocking (contradict standing product rules or invent features)

1. **"Escrow" wording** appears in s3, s4(original), s5, s6, s7, s9 explore, s10, s14, s17 (×4), s18 (×4) and the
   motion page. Standing rule: never say escrow; say "pay through Servix; released to the professional after you
   confirm the work". s4-corrected, s11, s12, s13 already use "Protected Payment" — that is the pattern.
2. **Fabricated regulatory / trust claims:** "Central Bank of Nigeria (CBN) Tier 3 Escrow Standards" (s3),
   "CBN-compliant custody" (motion), "Tier-3 Vault Escrow Shield" (s6), "Government ID & NIN verified — cross-
   checked against NIMC database", "Criminal Background Check — Nigerian Police Force clearance", "Address &
   Workshop inspected" (s10), "Background checked with active identity guarantee" (s9), "100% dispute
   protection" (s9). Servix verification is an admin-granted *verified* badge — nothing else exists. Legal risk.
3. **Features that do not exist in the API** and must not be drawn as live controls: live tracking ("Track
   Artisan", "ON THE WAY", "ETA ~14 mins", "In Route" step) in s8/s12/motion; voice/video calls (s17, s18
   header, s12 "call", s13 `tel:`/`sms:` links — messaging must open the in-app chat); "Auto-release in 46h
   12m" countdown (s13 — no auto-complete job exists; verify before drawing); "Download Receipt / Invoice
   (PDF)" (s13); "Milestones", "Escrow milestone #2", "Milestone Invoice", "GitHub Branch", attachment-sheet
   "Escrow" option (s17/s18); AI "mic" voice input (s14, s18 composer shows mic for voice *notes*, which is
   fine — but s14's mic is AI voice input, which does not exist); "Typically replies in 5m" (s18 — API exposes
   `online` / `lastSeenAt` only); "Fast Response (~12 min)", "High Reliability 99%", "99% On-time" (s9/s10/s13).
4. **Chats inbox filter tabs** "All / Unread (5) / Tech Services / Escrow Active" (s17): threads have no
   categories. Keep "All" and an unread filter at most. The "+" FAB implies composing to anyone; threads are
   created only from a booking or an accepted connection (`POST /community/threads {bookingId|connectionId}`).
5. **Job numbers** "Job #SV-8921" etc. (s8/s12/s13): bookings have UUIDs and no human reference. Either the
   API adds a short reference (backend change — not in scope) or the design drops it.
6. **Design-note leakage:** "NEW — Release 1.1" ribbons and "Escrow Secured" pill in s17/s18 headers, "v1.1" and
   "Plus Plan active · 18/25 queries" header in s14 (plan/usage exists but the real labels come from
   `GET ai/usage` — do not hard-code).

### 5.2 Content / data mismatches

| Screen | Issue | Truth |
| --- | --- | --- |
| s8 | Date reads "Thursday, 7 Nov 2026" | 7 Nov 2026 is a Saturday — fixture only, but shows the copy was not checked |
| s8 | `messages_tab_final` in the filename, yet no bottom bar text appears in the render | Verify in raw HTML; Release 1.1 bar = Home · Explore · **Chats (centre)** · Bookings · Account |
| s8 | Status pills "ON THE WAY", "AWAITING CONFIRMATION", "PAYMENT REQUIRED" | Real statuses: pending_payment, requested, accepted, in_progress, delivered, completed, cancelled, declined, disputed, refunded. Map: PAYMENT REQUIRED→pending_payment ✓, AWAITING CONFIRMATION→delivered ✓, ON THE WAY→**no equivalent** (use accepted / in_progress labels) |
| s10 | "Servix Trust & Safety Audit" block, certifications chips, "View All (18)" gallery | Only `verified` flag, bio, gallery (images + PDF + one video), reviews exist |
| s11 | Coverage areas, FAQ, "Earliest available", "Reagents & labor included" | Service has title, description, price (one price — no tiers), category, duration if present; FAQ/coverage are not fields |
| s12 | "Call" and "Track Artisan" actions; "Live updates" pill | Chat only; no tracking |
| s13 | "Servix Protection & Guarantee Fee ₦0 (Included)" line | No fee line item in the booking model — drop or confirm with owner |
| s14 | Dropdown "Budget Estimator" form with trade/scope selects and a "Verified Market Estimate" | Servix AI is a chat (`POST ai/assistant/stream`); the estimator form is a new product feature, not a redesign |
| s17 | Fixture people are all software roles ("Senior Full-Stack Dev", "Cloud & DevOps") | Fine as fixtures, but the artisan-heavy screens (s8–s13) and the tech-heavy chat screens look like two different products — pick one fixture set |
| s18 | Reactions 👍 ❤️ 🚀 👏 | Server list is `👍 ❤️ 😂 😮 😢 🙏 🔥 ✅` (`community.ts:15`) |
| s6 | Only the "factor" stage (TOTP / Email OTP / Backup key tabs, passkey, device card) | S6 has six server-driven stages: `email`, `enroll`, `factor`, `recovery`, `reset_password`, `finish` — five are undesigned |
| s7 | "We'll send a password reset link"; no new-password screen | Reset flow routes into S6 `reset_password` ("Choose a new password" with the same live checklist as registration) — undesigned |
| s2 | Only logo + "Get Started" + "Sign In" (9 KB) | Current Welcome shows headline, value props and provider buttons; "minimal" may be intended — owner to confirm |

### 5.3 Platform wording
- "ProMotion Display · 120 FPS" (motion page) is Apple terminology; Android says high refresh rate / 120 Hz.
- Button labels mix Title Case ("Create Account", "Sign In") and sentence case ("Create account", "Sign in")
  across files; the app standard is sentence case.

## 6. Coverage against the screen inventory

| Inventory | Stitch file | Status |
| --- | --- | --- |
| S1 Splash | — | **Missing** |
| S2 Welcome | s2 | Present (minimal) |
| S3 Sign in | s3 | Present |
| S4 Create account | s4_corrected | Present |
| S5 Verify email | s5 | Present |
| S6 Security check (6 stages) | s6 | **1 of 6 stages** |
| S7 Forgot password (+ reset) | s7 | Email step only; **new-password step missing** |
| S8 Home — customer | s8 | Present |
| S8 Home — guest | — | **Missing** |
| S8 Home — professional ("This week", "Profile strength", jobs with customer name) | — | **Missing** |
| S9 Explore browse / results / empty | s9_explore, s9_search | Present; **empty state missing** |
| S10 Professional profile | s10 | Present |
| S11 Service detail | s11 | Present |
| S12 Bookings (Active/Past, empty) | s12 | Present; **empty state missing** |
| S13 Booking detail — 10 statuses | s13 | **delivered only**; pending_payment/requested/accepted/in_progress/completed/cancelled/declined/disputed/refunded missing |
| S14 Servix AI (chat, empty, disabled, usage limit) | s14 | Present as an estimator form; **chat/empty/disabled states missing** |
| S15 Notifications | — | **Missing** |
| S16 Account hub (+ Payments row, Plan, Security, Devices, Delete account) | — | **Missing** |
| Chats list (Release 1.1) | s17 | Present |
| Conversation (Release 1.1) | s18 | Present |
| Contact card sheet (block / view profile) | — | **Missing** |
| Image viewer / voice recorder / reply & reaction sheets (Stage 2) | — | **Missing** (partially implied in s18) |
| Servix AI thread opened from Chats | — | **Missing** |
| Requests / job board (Stage 3), Network / connections | — | **Missing** (flag-gated; may be deferred) |
| Bottom bar component (5 tabs, guest 3 tabs, badge) | — | **Missing as a component spec** |
| Error / offline / "Chats unavailable" states | — | **Missing** |

Count: 13 inventory screens covered at least partially; **5 core screens absent** (Splash, Notifications,
Account hub, guest Home, professional Home) and most secondary states absent.

## 7. Motion & interaction system — findings

Usable tokens (the only part that transfers to Compose):

| Token | Value in file | Compose note |
| --- | --- | --- |
| `ServixSpring.Micro` | spring(stiffness 400, dampingRatio 0.75) · "140 ms" | Springs have no duration; 140 ms is advisory. Use `spring(dampingRatio = 0.75f, stiffness = 400f)` for press scale 1 → 0.96. |
| `ServixEasing.Elevation` | cubic-bezier(0.2, 0, 0, 1) · 280 ms | = Material `EmphasizedDecelerate`-like; `tween(280, easing = CubicBezierEasing(0.2f,0f,0f,1f))`. |
| `ServixTransitions.Sheet` | slideInVertically + fadeIn · 360 ms, "Spring(Stiff=300)" | Two conflicting specs in one row (tween 360 vs spring 300). Pick spring `stiffness = 300f, dampingRatio = 0.8f`. |
| Success pop | "BouncySpring(0.55)" · 620 ms | `spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMediumLow)` for the confirm-complete tick only. |
| Haptics | Light 15 ms, Medium 35 ms, Success pattern, Error buzz | Map to `HapticFeedbackType.TextHandleMove` / `LongPress` / `VibrationEffect.EFFECT_TICK` / `EFFECT_HEAVY_CLICK`; respect system haptic setting. |

Problems: the five demos are built around non-features (escrow vault lock & celebration, milestone stepper
"Booked → In Route → Done", "Confirm Escrow Deposit" button); the "Messaging micro-states" demo is useful
(waveform, tick cycle, reaction bar, typing) and matches Stage 2; no reduced-motion guidance (must honour
`Settings.Global.ANIMATOR_DURATION_SCALE` / `LocalReduceMotion`); no list/enter choreography, no shared-element
spec for profile → service → booking, no pull-to-refresh or skeleton guidance.

## 8. Draft screen-by-screen implementation specification (for the Android coding agent)

Rules that apply to every screen: keep brand tokens and Inter; Compose Material3; light theme only; reuse
existing ViewModels and API calls (no new endpoints); every string through `strings.xml`; no "escrow";
no fabricated numbers; fixtures only in tests/renders; `testTag`s preserved; min touch target 48 dp, primary
buttons 52 dp; icons from Material Icons Extended (drawable fallback when no equivalent); images only from API
URLs via Coil with SoftSand placeholder; honour reduced motion.

| # | Screen (file) | Keep from Stitch | Change / drop | Data & states | Motion |
| --- | --- | --- | --- | --- | --- |
| S1 | Splash (none) | — | Design from brand: DeepForest field, ivory wordmark, no spinner for first 400 ms | `AuthRepository.bootstrap()` → Welcome / Home | Fade 280 ms Elevation |
| S2 | Welcome (s2) | Minimal layout: wordmark, headline, **Get started**, **Sign in** | Add the one-line value prop and provider buttons the current screen has unless owner confirms "minimal" | guest only | Buttons press-scale Micro |
| S3 | Sign in (s3) | Email with inline "Valid" check, password show/hide, Forgot link, providers | Drop "Verified Escrow Portal", "CBN Tier 3"; footer → "Protected by Servix sign-in security" | `POST auth/login` → security `stage`; errors inline; 401 copy from API | Error shake 140 ms + Error haptic |
| S4 | Create account (s4_corrected) | Everything | Max-200 rule only as error; keep 18+ line; links open Terms/Privacy in Custom Tab | `POST auth/register {fullName,email,password}`; live checklist = `strongPasswordSchema` | Checklist rows tick with Micro spring |
| S5 | Verify email (s5) | 6-digit code boxes, resend timer, Open mail app, Edit email | Drop "Instant Escrow Verification" card; remove "verification link" wording if the API sends code only | `POST auth/verify-email`, resend endpoint; 45 s cooldown | Code box focus ring Elevation |
| S6 | Security check (s6 + 5 new) | Method segmented control, code field, device card (name/IP/location) | Drop "Tier-3 Vault", "Concierge"; design `email`, `enroll`, `recovery`, `reset_password`, `finish` on the same frame | `POST auth/security/status` stage machine (brief S6) | Stage change slide 280 ms |
| S7 | Forgot + reset (s7 + new) | Email field, sent-state card, resend 0:45, back link | Drop "Escrow Protection Active" note and "Concierge"; add reset screen = S6 `reset_password` | `POST auth/forgot-password`; same checklist | Sent-state card fade/slide |
| S8 | Home customer (s8) | Greeting, date, bell, search, attention card (delivered → Confirm / Dispute), active bookings list, categories grid, AI card, recommended pros | Order per owner: attention → **Chats card (unread Σ)** → bookings → (Post a request hidden until Stage 3); drop Track Artisan/ETA; status pills from `BookingStatusMeta`; no job numbers | `GET account/overview`, `GET bookings`, `GET categories`, `GET professionals?sort=rating`, `GET community/threads` (unread) | Cards enter stagger 40 ms, Elevation |
| S8g | Home guest (new) | — | Hero search, categories, recommended pros, "Sign in to book" | public endpoints only | — |
| S8p | Home professional (new) | — | Jobs list with **customer name**, "This week · Jobs scheduled / Completed", Profile strength (CTA hidden until target exists), no category browsing | `GET bookings` (pro view), `GET account/overview` | — |
| S9 | Explore (s9_explore, s9_search) | Search + filter chips (location, verified, rating), categories "8 Core", popular services, pro cards with price-from, results header "N found", active-filter chips | Drop "Available Today" (no availability field), "Fast Response", reliability %, "Servix Escrow Guarantee" banner → "Protected payment" one-liner; add empty state | `GET services`, `GET professionals` with filters the API actually has (category, sort, price) | Chip toggle Micro; results list fade |
| S10 | Professional profile (s10) | Hero image, name + verified, title, location, rating/reviews/done-jobs stats, bio, services list with one fixed price each, gallery, reviews, sticky **Book** bar, bookmark/share | Drop Trust & Safety audit block, certification chips, "99% On-time"; gallery supports image/PDF/video; reviews = real `GET professionals/{id}/reviews` | `GET professionals/{id}`, services, gallery, reviews | Hero parallax ≤ 24 dp; sticky bar Elevation |
| S11 | Service detail (s11) | Gallery pager "1/4", category + duration, title, single price, provider row, "What's included" list, protected-payment card, sticky **Book this service** | Drop coverage areas, FAQ, "earliest available" unless fields exist; copy → "You pay through Servix; released to the professional after you confirm the work" | `GET services/{id}` | Pager snap; sticky bar |
| S12 | Bookings (s12) | Active/Past segmented, count badges, cards with status pill, pro row, time/location, amount, primary action per status | Drop Call/Track; "Needs attention" filter = delivered+disputed; add empty state | `GET bookings`; actions per status matrix (brief S13) | List item swipe none; pill colour change Micro |
| S13 | Booking detail (s13 + 9 states) | Status header, progress stepper (5 real steps: requested → paid → accepted → delivered → completed), service details, assigned pro card with **Message** (in-app chat) and **View profile**, payment breakdown, pre-release checklist, confirm sheet, dispute sheet | Drop `tel:`/`sms:`, auto-release countdown (unless confirmed), receipt PDF, fee ₦0 line, fake support number; design the other nine statuses | `GET bookings/{id}` 2 s poll ≤ 90 s after pay; `POST bookings/{id}/complete|dispute|cancel`; Paystack Custom Tab | Confirm sheet 360 ms; success pop on complete |
| S14 | Servix AI (s14) | Header with usage "n/N" from API, suggestion chips, message bubbles with copy/👍/👎, "Hire a pro" result card | Replace estimator form with the chat-first layout (brief S14); drop mic, "1,240 specialists", "escrow releases" footer | `GET ai/usage`, `POST ai/assistant/stream` fallback `ai/assistant`; disabled/limit states | Stream text fade-in per chunk |
| S15 | Notifications (new) | — | Bell-only entry; grouped by day; mark-all-read | `GET notifications` | — |
| S16 | Account hub (new) | — | Header, Plan, **Payments row** (`GET account/payments`), Security (manage on website), Devices, Notifications, Help/Terms/Privacy, Delete account (email support), Sign out | existing `AccountHubScreen` data | Row press Micro |
| C1 | Chats list (s17) | Search, pinned Servix AI row, thread rows (avatar, presence dot, name, preview with kind icon, time, ✓✓, Coral unread pill), "Live" pill | Drop category tabs, "Escrow Active", "+" FAB, "Escrow Guard" banner; Release 1.1 code already matches — treat Stitch as visual polish only | `GET community/threads`, SSE | Row enter 40 ms stagger |
| C2 | Conversation (s18) | Header (avatar, name, verified, Online/last seen), day pill, bubbles, voice note player (play, waveform, duration, speed), image bubble with size, reactions bar + "add", typing row, attachment sheet (Gallery, Document, Location?), composer (emoji, attach, camera, mic/send) | Drop call/video icons, "Replies in 5m", milestone chips, attachment "Escrow"; reactions = server list; Location only if a message kind exists (it does not — drop) | Stage 2 contract (CHAT.md) | Bubble send slide-up 140 ms; tick morph; waveform progress |
| C3 | Contact card, image viewer, recorder, reply/reaction sheets (new) | — | Design to match C2 | — | Sheet 360 ms |
| M | Motion tokens | Table in §7 | Add reduced-motion rule; drop escrow/milestone demos | — | — |

## 9. Owner questions before the hand-off

1. Welcome: keep Stitch's *minimal* version (logo + two buttons) or the current value-prop version?
2. Auto-release countdown on delivered bookings (s13): is there, or will there be, an auto-complete rule? If not
   the countdown is dropped.
3. Fixture world: artisans (s8–s13) or tech freelancers (s14, s17, s18)? Pick one for all renders.
4. Font: if the raw files use a non-Inter family, switch the app or keep Inter? (Recommendation: keep Inter.)

## 10. Next steps

1. Owner uploads the 18 raw HTML files (zip) → finish §3 (colours, font, Tailwind config, bottom bar in s8).
2. Owner answers §9.
3. Stitch round 2 (or spec overrides): remove all §5.1 items; add the §6 missing screens — at minimum Splash,
   Notifications, Account hub, guest + professional Home, S6 stages, reset-password, booking-detail status
   variants, AI chat state, contact card, bottom bar component.
4. Then this file becomes `PROMPT_STITCH_IMPLEMENTATION.md` for the Android agent, delivered in stages behind
   "go", after Release 1.1 Stage 2 lands.
