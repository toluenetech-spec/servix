# Stitch Design Requirements

These are **constraints for the redesign**, derived from (a) what the app does today, (b) the
owner's standing product decisions recorded in the servix repositories, and (c) platform facts.
They are not a redesign; Stitch decides the visuals within these bounds.

## 1. Non-negotiables (owner decisions on record)

| # | Requirement | Source of the decision |
| --- | --- | --- |
| R1 | **No landing page.** First run shows Welcome (logo, headline, Create account / Sign in / provider buttons / Browse first), then auth, then the security check, then **Home = dashboard**. | `docs/ANDROID_DESIGN_PLAN.md` §1; owner rule |
| R2 | The app must **not look generic or web-like**; it is a native phone app, light theme, brand palette, Inter, radii 16/24/12, no gradients. | plan §3; owner feedback on build 7 |
| R3 | Brand colours exactly: Deep Forest `#12372A`, Forest Green `#1F5C45`, Warm Ivory `#F7F4EC`, Soft Sand `#EDE8DC`, Coral `#E56B5D`, Charcoal `#202622`, Muted Gray `#68716B`. | brand sheet; `ui/theme/Color.kt` |
| R4 | **Chats is top priority** for the next release: a Chats entry in the **centre of the bottom bar**, visually the strongest item. Target bar: Home · Explore · Chats · Bookings · Account. | servix repo `docs/android/PROMPT_CHAT_RELEASE_1.1.md:54-58` |
| R5 | Show each role only what it needs: customer Home ≠ professional Home ≠ guest Home. Remove unnecessary items, add missing web features where the API supports them. The concrete per-role block lists are **not yet approved in writing** — treat them as open. | owner rule; `USER_ROLES_AND_PERMISSIONS.md` §4 |
| R6 | Servix AI stays available: as a pinned first row inside Chats and a shortcut on Home (it leaves the bottom bar). | `PROMPT_CHAT_RELEASE_1.1.md:57-58` |
| R7 | Notifications are reached from the top-bar bell (no Account row duplicate). | `PROMPT_CHAT_RELEASE_1.1.md:58` |
| R8 | Copy: say "pay through Servix; released to the professional after you confirm the work" — **avoid the word "escrow"** in user-facing text. | owner Terms wording rule |
| R9 | One price per service (no 3-tier packages). | owner pricing rule |
| R10 | Registration = full name, email, password, **confirm password** (not confirm email), live password checklist (min 8), Terms + Privacy acceptance, 18+. | owner rules; `AuthScreens.kt` |
| R11 | Security/MFA screens must keep the server-driven stages (email code → optional TOTP → recovery codes → finish; reset password) and the "never share your code" reassurance. | `SecurityCheckScreen` |
| R12 | The app gathers and shows device name, IP and approximate location on the "This device" panel, and self-updates in place for test builds. Keep these surfaces. | owner rule; `DeviceCard.kt`, `updates/*` |
| R13 | Do not design professional/admin workspaces (gigs, earnings, availability, KYC, admin) for this release — they stay on the web. Role-specific Home/Account content for professionals is pending owner sign-off; design it only from a written, approved specification. | `docs/play/LISTING.md` "deliberately absent"; PR #4 `docs/ia/IA_AUDIT.md` (proposal, unmerged) |
| R14 | Never present platform-only or in-flight features as working. Chats, Network, Requests screens are **new designs for Release 1.1**, labelled as such. | brief rules |

## 2. Must-keep behaviours per screen (functional parity)

| Screen | Keep |
| --- | --- |
| Home | greeting/date/city, bell with badge, avatar → Account, search → Explore, needs-attention (≤3, three rules), active bookings (≤3), categories, recommended professionals, AI shortcut, plan/usage line, guest sign-in card |
| Explore | Professionals/Services toggle, search, Filters sheet (category, city, rating, price ≤₦500k slider, 6 availability options), Sort menu (5 options), result count, infinite scroll, empty + clear filters |
| Professional profile | header with verified + availability + response time, Rating/Reviews/Projects strip, About/Services/Portfolio/Reviews tabs, trust & performance, Save toggle, Book → choose service |
| Service detail | gallery, pro card, price + meta (delivery, duration, revisions, availability), Servix protection card, about/included/needs, availability preview, reviews, FAQ, sticky Book; booking sheet with slot picker, notes, Book & Pay, guest sign-in path |
| Bookings | Active/Past, Today/This week/Later groups, status chips |
| Booking detail | status + next-step sentence, payment polling banners, notices (pending/delivered/dispute), exactly one primary action + More, five modals, snackbars |
| Servix AI | assistant stream with stop, suggestions, copy/helpful/not-helpful, budget guide form + result, usage meter, quota/entitlement messages |
| Notifications | list, unread styling, mark all read, tap-through |
| Account | header (avatar, name, email, role badge, verify-email banner), Profile (name + photo), Saved, Plan (read-only), Security (read-only), This device, Updates, Legal, Sign out |
| Auth | all states and error strings listed in `SCREEN_SPECIFICATIONS.md` S2–S7 |

## 3. States every screen design must include

Loading (skeleton, not spinner-only), empty, error with retry, offline banner, guest variant
where applicable, font-scale 1.3 check, and — for lists — pull-to-refresh affordance. These are
all present today (`ListSkeleton`, `EmptyState`, `ErrorCard`, `OfflineBanner`, `*_fontscale130.png`).

## 4. Technical envelope Stitch should respect

- Phone portrait first (renders are 616×1371 logical px ≈ 412×914 dp at 1.5×); minSdk 26;
  Material 3 Compose components are the implementation target, so prefer patterns that map to
  `NavigationBar`, `ModalBottomSheet`, `LazyColumn`, `HorizontalPager`, `DropdownMenu`,
  `AlertDialog`, `Slider`, segmented control.
- Edge-to-edge with transparent system bars on Warm Ivory; keep bottom bar + 1 dp divider.
- Touch targets ≥ 48 dp; buttons 52 dp; Inter only.
- Payment and web hand-offs stay in Chrome Custom Tabs (design the "Redirecting to payment…" and
  the return/polling states, not an in-app checkout).
- Images may be missing (initials avatar fallback, inbox icon fallback for services).

## 5. Deliverables expected back from Stitch

Per screen in `SCREEN_INVENTORY.md` (16 screens + 7 Account panels + 9 sheets/dialogs), plus the
new Release 1.1 surfaces (Chats list, chat thread, contact card, Network, Post a request, request
detail, proposals — see servix `docs/android/PROMPT_CHAT_RELEASE_1.1.md` and `api/docs/CHAT.md`
for the data they must carry): default, loading, empty, error, guest (if any) frames; a component
sheet mapping to §5 of `DESIGN_SYSTEM_AUDIT.md`; and a token sheet using R3.

## 6. Suggested Stitch prompt preamble (verbatim-safe)

> Redesign the Servix Android app (Nigerian professional-services marketplace, Jetpack Compose,
> Material 3, light theme only). Keep every function listed in SCREEN_SPECIFICATIONS.md and the
> status/wording rules in STITCH_DESIGN_REQUIREMENTS.md. Palette: #12372A, #1F5C45, #F7F4EC,
> #EDE8DC, #E56B5D, #202622, #68716B. Font Inter. Radii 16 (cards) / 24 (sheets) / 12
> (buttons, inputs). No gradients. Bottom bar: Home · Explore · Chats (centre, prominent) ·
> Bookings · Account. Home is the dashboard; no marketing landing. Avoid the word "escrow".
