# Screen Specifications

One section per screen. Each lists: purpose, who sees it, layout/elements **in on-screen order**,
data sources, actions, states, exact copy (from `app/src/main/res/values/strings.xml` or inline
literals), and evidence. All at `61a1c83` unless marked 🟡.

Shared frame for every non-auth screen: Warm Ivory canvas, optional offline banner on top, 5-tab
bottom bar at the bottom (`ServixAppShell.kt`). Auth screens hide the bottom bar.

---

## S1 · Splash / Initialising
- **Purpose:** cover the `/me` + token check at launch.
- **Elements:** Android 12 splash (`Theme.Servix.Starting`, `res/values/themes.xml`), then an
  in-app frame: `ServixLogoMark` centred + one 16 dp skeleton bar (`ServixAppShell.kt:248-268`).
- **Next:** Home (authenticated) or Welcome (guest).

## S2 · Welcome  (`01_welcome.png`, `01b_welcome_providers.png`)
- **Purpose:** first-run entry; the app has **no marketing landing page** by owner decision
  (`docs/ANDROID_DESIGN_PLAN.md` §1).
- **Elements (top→bottom):** logo mark; headline "Hire trusted Nigerian professionals."
  (`welcome_headline`, testTag `welcome_hero_title`); sub-text "Book verified services with upfront
  pricing and escrow payment protection." (`welcome_subtext`); primary **Create account**;
  secondary **Sign in**; provider buttons "Continue with Google / GitHub" when the API's
  `auth/oauth/config` lists them (`OAuthButtons`, `AuthScreens.kt:100`); text button **Browse first**.
- **Actions:** Create account → S4; Sign in → S3; Browse first → Home as guest
  (`ServixAppShell.kt:464-478`); provider → Custom Tab → `ng.name.servix.app://oauth/callback` →
  ticket exchange (`AuthViewModel.handleOAuthReturn`).
- **Copy note:** uses the word "escrow" (see `DESIGN_SYSTEM_AUDIT.md` §7).

## S3 · Sign in  (`02_sign_in.png`, `02b_sign_in_providers.png`)
- **Elements:** title "Welcome back" (`login_title`); subtitle "Sign in to manage your bookings and
  services."; provider buttons + "or" divider (when providers exist); **Email** field; **Password**
  field with show/hide (`show_password` / `hide_password`); link **Forgot password?**; primary
  **Sign in** ("Signing in…" while busy); footer "New to Servix?" + **Create account**.
- **Validation / errors:** `err_enter_email`, `err_valid_email`, `err_enter_password`,
  `err_invalid_credentials`, `err_rate_limit`, `err_login_unavailable` (`AuthViewModel`).
- **Result routing:** API returns `{security}` → S6 Security check (production); `{user,
  accessToken}` → Home or the pending post-auth route (e.g. back to a booking sheet)
  (`ServixAppShell.kt:480-520`, `pendingPostAuthRoute`).
- **Back:** to Welcome (`popUpTo(0)`).

## S4 · Create account
- **Elements:** title "Create your account"; subtitle "Book verified professionals with locked
  pricing and escrow protection."; **Full name**; provider buttons + divider; **Email**; **Password**
  (+ hint "Choose a unique password you do not use elsewhere." + live **PasswordChecklist** of 6
  rules: ≥8 chars, uppercase, lowercase, number, symbol, ≤200); **Confirm password** with live
  hint "✓ Passwords match" / "Passwords do not match yet"; **Checkbox** "I agree to the Terms of
  Service and acknowledge the Privacy Policy." with tappable links (Custom Tab to
  `/terms`, `/privacy`, `AuthScreens.kt:667-681`); note "…You must be 18 or older…"
  (`register_terms_note`); primary **Create account** ("Creating account…"); text
  "Want to offer your services on Servix? Apply at www.servix.name.ng" → Custom Tab
  `/professionals/join` (`:724`); footer "Already have an account?" + **Sign in**.
- **Errors:** `err_enter_full_name`, `err_password_requirements`, `err_passwords_must_match`,
  `err_register_rate_limit` ("…Your details are still here."), `err_register_unavailable`.
- **Result:** `{security}` → S6; else → S5 Verify email or Home. Terms acceptance stored locally
  (`data/local/TermsAcceptanceStore.kt`).

## S5 · Verify email
- **Mode decided by** `GET auth/verification-method` → `"otp"` (default) or `"link"`.
- **OTP mode elements:** eyebrow "ACCOUNT VERIFICATION"; title "Your inbox. Your code."; lead
  "Enter the six-digit code sent to {email}. It expires after 10 minutes."; `SixDigitCodeField`
  (`AuthScreens.kt:1042`, paste-all-six supported, hint `verify_code_hint`); primary **Verify
  email** ("Please wait…"); **Send a new code** with cooldown "Request another code in {n}s";
  footer "Never share your code. Servix support will never ask for it."; notice
  `verify_queued_notice` after resend.
- **Link mode:** title "Check your email for the verification link", **Resend Verification
  Email**, **I've verified — continue**.
- **Success state:** "Email confirmed" / "Your email address has been verified successfully." →
  **Go to dashboard**.
- **Errors:** `err_otp_six_digits`, `err_otp_invalid`, `err_otp_limit_hour`,
  `err_otp_session_expired`, `err_otp_network`.
- **Back/Sign out:** returns to Welcome.

## S6 · Security check (MFA)  (`18_security_check_step.png`)
- **Purpose:** complete the server-driven security flow after sign-in (`POST auth/security/status`
  returns `stage`). Eyebrow "SERVIX · ACCOUNT SECURITY"; `SecurityStepProgress` shows the step.
- **Stages and content** (`AuthScreens.kt:1159-1655`):
  - `email` — "Check your inbox"; code field; **Verify email**; resend with "Resend in {n}s".
  - `enroll` — "Choose your security method"; Google Authenticator card: instructions "Open Google
    Authenticator → tap + → Enter a setup key…", **Copy key**, **Open app**, code field,
    **Confirm authenticator**, **Choose a different method**.
  - `factor` — "One more check. Then you're in."; authenticator code or recovery code; **Verify
    security code**; toggles "Lost access? Use a recovery code" / "Use my enrolled security method";
    passkey accounts see "Use your authenticator app or a recovery code".
  - `recovery` — "Keep a way back in"; list of recovery codes; **Copy recovery codes**; checkbox
    "I have saved my recovery codes somewhere private."; **Finish securely**.
  - `reset_password` — "Choose a new password"; New password + Confirm password with checklist
    (basic policy = length only when server says `passwordPolicy == "basic"`); **Save new password**;
    success "Password updated" → **Back to sign in**.
  - `finish`/complete — "Your checks are complete" → **Finish signing in** (`POST auth/security/finish`).
- **Other states:** "Preparing your secure check…", expired → "Let's start again" + **Start again**,
  load failure → **Try loading again**, security disabled → "Please sign in on www.servix.name.ng…"
  + **Open www.servix.name.ng**.

## S7 · Forgot password
- **Elements:** title "Reset your password"; "Enter your account email to begin secure password
  recovery."; Email; primary **Continue recovery** ("Sending…"); sent state "Check your inbox" /
  "If an account exists for {email}, we've sent a password reset link. The link expires in 30
  minutes."; "Remembered it?" + **Back to sign in**.
- **Note:** if the API returns a security flow it routes into S6 `reset_password`
  (`ServixAppShell.kt:619-640`).

## S8 · Home (dashboard)  (`03_home_signed_in.png`, `04_home_guest.png`, `05_home_bookings.png`, `05b_home_loading.png`)
- **Purpose:** the dashboard — "Home must be the dashboard, no landing page" (owner rule; plan §2).
- **Top bar** (`HomeTopBar`, `:259-327`): greeting by hour ("Good morning" 0–11, "Good afternoon"
  12–16, else "Good evening") + first name; guest: "Welcome". Second line: **today's date**
  ("Friday, 6 November", `EEEE, d MMMM`, UK locale) when signed in, or the **stored city**
  (fallback "Nigeria") for guests — never both. Bell icon with unread badge → Notifications;
  36 dp **initials** avatar → Account (`AvatarImage(image = null)` — no photo on `main`;
  🟡 PR #4 adds the photo); guest sees a **Sign in** text button instead.
- **Search field** placeholder "What do you need done?" → opens Explore (`home_search_field`).
- **Guest only:** `SignInCard` "Sign in to book and track jobs" / "Your bookings, payments and AI
  history stay in one place." + Sign in / Create account.
- **Signed in:**
  - "Needs your attention" — up to 3 `AttentionCard`s derived from bookings: `pending_payment` →
    "Payment due for {service}" / **Pay now**; `delivered` → "{service} was delivered" / **Confirm**;
    `completed && !hasReview` → "How was {service}?" / **Review** (`HomeViewModel.kt:58-80`).
  - "Your bookings" + **See all** — horizontal `UpcomingBookingCard`s (≤3 active, soonest first)
    or empty state "No bookings yet" / "When you book a professional, the job shows up here with its
    status." / **Explore services**.
- **All users:** "Browse by category" + See all — chips (first 8 categories); "Recommended for
  you" + See all — 4 `ProfessionalRow`s (name, verified tick, title, ★ rating (count) · location,
  "₦X starting"); empty "No professionals found" / "Try another category, or ask Servix AI what a
  job should cost."; `AiCard` "Servix AI" / "Describe the job and get a fair price range before you
  book." / **Ask Servix AI**.
- **Signed in footer:** `PlanLine` "{Plan} plan" · "AI {used} / {allowed} words this month" ·
  **Manage plan** → Account.
- **States:** loading skeleton (`ListSkeleton(rows=4)`), `ErrorCard` with retry, pull-to-refresh
  is **not** on Home (only via retry/refresh calls).
- **Data:** `GET categories`, `GET professionals?sort=rating&pageSize=6`, `GET account/overview`,
  `GET bookings`, `GET ai/usage` (via AiViewModel), `GET account/notifications/unread`.
- **Role:** identical for customer/professional/admin on `main`. 🟡 PR #4 prototypes a role-aware
  Home (`in-flight-pr4/ia_04…06`).

## S9 · Explore  (`06_explore_results.png`, `07_explore_empty.png`)
- **Elements:** `ServixTopBar` "Explore"; search field (same placeholder, `explore_search_field`,
  debounced + submit); `ServixSegmentedControl` **Professionals | Services**; chip row: **Filters**
  (with active count), **Sort · {label}** dropdown, **Category**, **City**, **Available now**
  toggle; result count "{n} professionals found" / "{n} services found"; `LazyColumn` of
  `ProfessionalRow` or `ServiceCard` (image, title, pro name, ★, "From ₦…"); infinite scroll
  (`loadingMore` skeleton); pull-to-refresh.
- **Filter sheet** (`ServixBottomSheet` "Filters"): Category chips ("All categories" + list);
  City text field ("City, e.g. Lagos"); Rating (Any / 4.8+ / 4.5+); Price slider ₦0–₦500,000 with
  label "Up to ₦X" / "Any starting price" and **Any price** reset; Availability (Any, Available
  now, Limited availability, Free today, Free tomorrow, Free this week); primary **Show N
  professionals/services**; **Clear filters**.
- **Sort options:** Recommended, Highest rated, Most reviewed, Starting price low→high, high→low
  (`SearchScreen.kt:98-104`).
- **Empty:** "Nothing matches those filters" / "Try a different city, category or price range." /
  **Clear filters**. **Error:** `ErrorCard` + retry.
- **Data:** `GET professionals` / `GET services` with `q, category, location, minRating, maxPrice,
  availability, available, sort, page, pageSize=6`; `GET categories` (cached).
- **Entry params:** Home category chip / "See all" pre-apply a category (`openExplore`).

## S10 · Professional profile  (`08_professional_profile.png`)
- **Layout:** back top bar; `ProfileHeader` (avatar, name + Verified chip, title, location, rating
  row, availability line "Available now / Free today / Free tomorrow / Free this week / Limited
  availability", "Responds {responseTime}"); `ProfileStatsStrip` **Rating · Reviews · Projects**;
  sticky `ProfileTabStrip` **About · Services · Portfolio · Reviews** (`ProfileTab` also declares
  `TRUST("Trust & performance")`, `:226-232`, but only four tabs are passed to the strip, `:292-295`;
  trust content renders at the end of About); tab content; sticky `ProfileBookBar` with **Save**
  toggle (bookmark icon `Bookmark`/`BookmarkBorder`, `:625`; "Sign in to save" for guests) and
  primary **Book**.
- **About tab:** bio ("No bio added yet."), Skills chips, Experience, Education, Certifications,
  "More" (Occupation, Languages, Website → Custom Tab), then **Trust & performance**
  (`TrustTabSection`: Servix verified, identity verified, completed jobs, verified projects,
  reliability %, response rate / median hours, repeat customers, rating average, achievements).
- **Services tab:** list of the pro's services → S11. **Portfolio tab:** image cards with title,
  category, verified flag, rating, delivery days. **Reviews tab:** `ReviewsTabSection` list.
- **Book sheet:** "Choose a service" list (`profile_sheet_service_{id}`) + `escrow_copy` + Close
  → S11 with `openBookingSheet = true`.
- **States:** skeleton; not found "Professional not found" / "This profile does not exist or may
  have been removed." + **Browse all professionals**; error + retry.
- **Data:** `GET professionals/{slug}`, `/services`, `/reviews`, `/availability/summary`;
  `GET account/saved` (signed in); `POST views {type:"professional"}`; save = `POST/DELETE account/saved`.

## S11 · Service detail  (`09_service_detail.png`)
- **Layout (top→bottom):** back bar; gallery `HorizontalPager` of images (video/PDF items appear
  as "Watch service video on www.servix.name.ng" / **Open video** / **Download document (PDF)**
  links); professional card ("Professional on Servix", name, **View profile**); main card: title,
  price (`PriceText`) + unit, meta rows "Delivery: N days", "Duration: …", revisions ("No
  revisions" / "Unlimited revisions" / n), availability ("Available now"/"Limited availability");
  primary **Request Booking** + "No payment is taken at this stage."; `servix_protection_title/body`
  card ("Servix protection." / "Clear scope, agreed pricing and structured communication on every
  booking."); "About this service"; "What's included"; "What the professional needs from you";
  `AvailabilityPreviewSection` ("Availability preview", next slots or "No open slots in the next two
  weeks."); "Reviews" card ("No reviews yet."); "Frequently asked questions" accordion
  (Expand/Collapse); sticky `ServiceBookBar` **Book this service**.
- **Booking sheet** (`BookingSheetContent`, `:980`): title "Book this service" (or "Book again"
  when `rebookedFrom`); price line "₦X per project — the price is locked when you book…";
  **Choose a time** dropdown of slots from `GET services/{slug}/availability?days=14`
  ("Select a slot…", "Selected: {date time}", or "No open slots in the next two weeks."); **Notes
  for the professional (optional)** (pre-filled with `initialNotes` on re-book); primary **Book &
  Pay ₦X** → "Redirecting to payment…"; **Cancel**; footer `booking_sheet_held_copy`. Guests see
  "Sign in to book this service." + Sign in / Create account, and return here after auth.
- **Flow:** `POST bookings` (with `Idempotency-Key`) → `POST bookings/{id}/pay` → Custom Tab to
  `authorizationUrl` → navigate to S13 with `pollingAfterPay = true`. Errors: `SLOT_TAKEN`,
  "Could not create the booking.", "Could not start payment."
- **Data:** `GET services/{slug}`, `/reviews`, `/availability`; `POST views {type:"service"}`.

## S12 · Bookings  (`10_bookings_grouped.png`)
- **Elements:** top bar "My Bookings"; tab pills **Active | Past** (`BookingsTabPill`);
  group headers **Today · This week · Later** (Africa/Lagos; overdue falls into Today,
  `BookingsScreen.kt:291-314`); `BookingRow` = status chip, service title, professional + slot,
  price, chevron; pull-to-refresh.
- **Active** = `pending_payment, requested, accepted, in_progress, delivered, disputed`; **Past** =
  `completed, cancelled, declined, refunded` (`BookingStatusMeta.ACTIVE_STATUSES` / `PAST_STATUSES`,
  `BookingStatusMeta.kt:17-31`). Note: the Past empty-state copy lists "Completed, cancelled,
  declined and refunded", consistent with the code.
- **Empty states:** "No bookings yet" / "When you book a service, it appears here." / **Explore
  Services**; per-tab "No active bookings" / "No past bookings".
- **Guest:** "Sign in to see your bookings." + **Sign in**. **Error:** "We couldn't load your bookings."
- **Data:** `GET bookings`.

## S13 · Booking detail  (`11_booking_pending_payment.png`, `12_booking_requested.png`, `13_booking_completed.png`)
- **Header:** back bar "Bookings"; "Booking {reference}"; `BookingStatusChip`; **next-step
  sentence** per status (`bookingNextStepSentence`, `:1162`, e.g. requested → "Waiting for the
  professional to accept. You can cancel free of charge until they do.").
- **Banners:** payment polling "Confirming your payment… checking every 2 seconds." → "Payment
  received — request sent to {pro}" or "We're still confirming your payment" + **Refresh**;
  `pending_payment` notice "Payment pending." + body; `delivered` notice "Confirm within 3 days." +
  body; `disputed` notice "Dispute open." / "Funds are held while the Servix team reviews: "{reason}"".
- **Cards:** professional (name, **View profile →**), service (→ S11), schedule, price/payment,
  notes, "Booked on {date}", review (if any) / "Reviewed — thank you".
- **Sticky `BookingActionBar`:** exactly one primary + **More** menu. Rules (`bookingActionsFor`):
  pending_payment → **Pay ₦X** (+ Cancel); delivered → **Confirm work is done** (+ Report a
  problem); completed & no review → **Leave a review**; completed/cancelled/declined → **Book
  again** ("Preparing…"); requested/accepted → Cancel Booking; in_progress → Report a problem.
- **Modals** (`ModalBottomSheet`): Cancel ("Cancel this booking?", refund policy text, optional
  reason, **Cancel Booking** / **Keep Booking**); Confirm ("Confirm completion?", `modal_confirm_body`);
  Dispute ("Report a problem", "Opening a dispute freezes payment…", required "What went wrong?",
  **Open Dispute**); Review ("Review this service", star rating, optional text, **Publish Review**);
  Re-book (draft from `GET bookings/{id}/rebook`: professional, service options with `wasBooked`,
  previous notes → S11 with `rebookedFrom`, `initialNotes`, `openBookingSheet`).
- **Snackbars:** "Booking cancelled.", "Completion confirmed. Payment released.", "Dispute opened.
  Funds are on hold.", "Review published. Thank you!", "Booking status updated: {label}" and
  the matching "Could not …" failures.
- **Data:** `GET bookings/{id}` (polled every 2 s for up to 90 s after pay, `BookingDetailScreen.kt:199-206`), `POST
  bookings/{id}/{pay|cancel|confirm|dispute|review}`, `GET bookings/{id}/rebook`.
- **Deep link:** `servix://booking/{id}`.

## S14 · Servix AI  (`14_ai_chat.png`, `14b_ai_empty.png`)
- **Guest:** "Sign in to use Servix AI." + Sign in. **No entitlement:** "Servix AI helpers are not
  enabled on this account yet." **Loading:** "Loading Servix AI…".
- **Top bar** (`AiTopBar`): title "Servix AI", usage line from `GET ai/usage` (words used/allowed,
  plan label), sub-tabs **Assistant | Budget guide**; disclaimer `ai_disclaimer`.
- **Assistant:** greeting bubble "Hi — I'm Servix AI. I look things up in real Servix data before I
  answer."; suggestion chips ("Who can design a logo for a small bakery in Lagos?", "How does
  payment protection work on Servix?", "What does "delivered" mean on my booking?"); chat bubbles
  (light markdown); streaming bubble with blinking caret + "Looking that up…"; **Stop**; input
  "Ask Servix AI…" + **Send**; per-answer actions **Copy answer**, **Helpful**, **Not helpful** →
  dialog "What was wrong?" + "Comment (optional)" → `POST ai/feedback`; last 20 turns kept.
- **Budget guide** (`BudgetPanel`): Category dropdown ("Choose a category"), "Delivery (days,
  optional)", "Describe the job (optional)", **Get guidance** → "Checking Servix prices…" → result
  `summary`, `rangeLow–rangeHigh`, `basis`, `stats`, `tips`, or "Not enough Servix data yet";
  footnote "Ranges are clamped to real Servix prices — they are guidance, not a quote."
- **Errors:** `AI_QUOTA_EXCEEDED` → `ai_quota_exceeded` + **Manage plan on website**;
  `PLAN_FEATURE`; generic `AiError` + **Try again**.
- **Data:** `POST ai/assistant/stream` (SSE, `AiRepository.kt:42-60`; falls back to non-streaming
  `POST ai/assistant` if the stream route is missing, `:36`), `GET ai/usage` (also decides the
  "not enabled" state via `usage.enabled == false`, `AiScreen.kt:130`), `POST ai/pricing/guidance`,
  `POST ai/feedback`, `GET categories`.

## S15 · Notifications  (`16_notifications.png`)
- **Elements:** top bar "Notifications" + **Mark all read** ("Marking…"); list of `NotificationRow`
  (title, body, relative `createdAt`, unread styling via `readAt == null`); pull-to-refresh;
  empty "No notifications yet" / "Booking updates and account messages will appear here."
- **Actions:** tap → marks read and, if `link` resolves to a booking, opens S13
  (`ServixAppShell.kt:989-1005`).
- **Data:** `GET account/notifications`, `POST account/notifications/read {ids | all}`.
- **Background:** WorkManager 15-min poll posts local notifications on channel "Bookings & account".

## S16 · Account hub  (`15_account.png`, `17_plan.png`)
- **Guest:** "Sign in to manage your Servix account" + Sign in / Create account.
- **Header** (`AccountHeader`): avatar, full name, email, role badge (e.g. "Customer"), unverified
  banner `verify_email_banner_title` + **Verify email** → S5.
- **Groups and rows** (`AccountHubScreen.kt:120-160`):
  - **Account:** Profile — "Name and photo"; Saved — "Professionals you kept"; Notifications —
    "{n} unread" or "Booking and account updates" (→ S15, `:142-147`); Plan — "What your account includes"; Security —
    "Sign-in protection".
  - **This device:** This device — "Sessions and app version"; Updates — "App version 1.0.0".
  - **Legal:** Privacy and terms — "How Servix handles your data".
  - **Sign out** button; text button "Manage account on the website".
- **Panels** (replace the list in place with "← Back to account"):
  - *Profile:* avatar + **Change photo** (JPEG/PNG/WebP ≤5 MB → `POST uploads?kind=avatar` →
    `PATCH account/profile`), "Uploading…", "Photo updated."; Full name field ("Use at least 2
    characters.") + **Save name** → "Saved. Your name is up to date."
  - *Saved:* list with **Remove**; empty "Nothing saved yet" / "Tap Save on a professional profile
    and they will appear here."
  - *Plan:* `PlanCard` — plan name, "Source: …", "Renews or ends …", badge "Read-only in the app",
    "Upgrades, downgrades and receipts are handled on the website." + **Manage on the website**.
  - *Security:* rows Sign-in method / Recovery codes left / Passkeys; "Changing your password,
    two-factor or passkeys happens on the website." + **Manage on the website**.
  - *This device* (`DeviceCard`): Device name, Model, Android version, App version, Network
    (Wi-Fi/Mobile/Offline), Local IP, Public IP, "Device as seen by Servix" (`GET account/device`),
    "Approximate location" + `LocationButton` (coarse location → nearest Nigerian city, stored).
  - *Updates:* `UpdateCard` / **Check for updates** (GitHub channel only).
  - *Legal:* "Version 1.0.0 · API: api.servix.name.ng", **Privacy Policy**, **Terms of Service**.
- **Data:** `GET me`, `GET account/saved`, `GET billing/plan`, `GET account/security-summary`,
  `GET account/device`, `PATCH account/profile`, `POST uploads?kind=avatar`, `POST auth/logout`.
  (`GET me/entitlements` is declared in `ServixApiService` but never called.)
- 🟡 PR #4 prototypes role-aware Account lists (`in-flight-pr4/ia_07`, `ia_08`).
