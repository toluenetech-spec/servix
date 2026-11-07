# User Roles and Permissions (as the Android app behaves)

The backend has four roles on `UserDto.role`: `customer`, `professional`, `admin` (and the
unauthenticated **guest**). The Android app at `61a1c83` has **one experience** for all signed-in
roles. Role is read in exactly one UI place: the badge in the Account header
(`ui/account/AccountHubScreen.kt:212`). The unreachable `Stage1AccountTab` also shows a badge and
a `ProfessionalToolsWebCard` (`ServixAppShell.kt:1129, 1158`), but users never reach it.

## 1. Capability matrix

| Capability | Guest | Customer | Professional | Admin | Evidence |
| --- | --- | --- | --- | --- | --- |
| See Home catalogue (categories, recommended pros, AI card) | ✅ | ✅ | ✅ | ✅ | `HomeTabScreen.kt` |
| See Home account blocks (attention, your bookings, plan line) | — (sign-in card) | ✅ | ✅ (same as customer) | ✅ | `HomeTabScreen.kt:120-250` |
| Explore + filters + sort | ✅ | ✅ | ✅ | ✅ | `ExploreScreen.kt` |
| Open professional profile / service detail | ✅ | ✅ | ✅ | ✅ | catalogue screens |
| Save / unsave professional | sign-in prompt ("Sign in to save") | ✅ | ✅ | ✅ | `ProfileBookBar`, `account/saved` |
| Create booking + pay (Paystack) | sign-in prompt inside sheet; returns after auth | ✅ | ✅ | ✅ | `BookingSheetContent`, `pendingPostAuthRoute` |
| Bookings list / detail / cancel / confirm / dispute / review / re-book | sign-in prompt | ✅ | ✅ | ✅ | `bookings/*` |
| Servix AI assistant + budget guide | "Sign in to use Servix AI." | ✅ if entitled (plan) | ✅ if entitled | ✅ if entitled | `AiScreen.kt:98-150` |
| Notifications list + mark read + background poll | — | ✅ | ✅ | ✅ | `NotificationsScreen.kt`, `NotificationsWorker.kt` |
| Profile name + photo | — | ✅ | ✅ | ✅ | `ProfilePanel` |
| Plan view | — | read-only | read-only | read-only | `PlanPanel` "Read-only in the app" |
| Security summary | — | read-only | read-only | read-only | `SecurityPanel` |
| Change password / MFA settings / passkeys | — | website | website | website | "Manage on the website" |
| Professional tools (gigs, availability, earnings, proposals, analytics, team) | — | — | ⚪ website `/pro` | ⚪ website | `ProfessionalToolsWebCard` text; web routes `/dashboard/*` |
| Admin console | — | — | — | ⚪ website `/admin` | same |
| Apply to become a professional | link to website `/professionals/join` (Register screen) | same | — | — | `AuthScreens.kt:724` |
| Chat / connections / job requests / proposals | — | ⚪ web only | ⚪ web only | ⚪ web only | no app code; see `FEATURE_CATALOG.md` |

## 2. Guest experience, precisely

- Start route is **Welcome**; "Browse first" enters the 5-tab shell as a guest
  (`ServixAppShell.kt:464-478`).
- Bottom bar is identical for guests and signed-in users (plan §2 comment at
  `ServixAppShell.kt:189`).
- Guest-gated screens render an inline sign-in prompt rather than redirecting: Home
  (`SignInCard`), Bookings (`bookings_sign_in_message`), Servix AI, Account.
- A guest who taps **Book & Pay** is sent to Login/Register and, on success, returned to the same
  service with the sheet open (`pendingPostAuthRoute`, `ServixAppShell.kt:212-234, 837-858`).
- Guests do not trigger the notification worker or the permission prompt.

## 3. Account states that change what a signed-in user sees

| State | Source field | UI effect |
| --- | --- | --- |
| Email unverified | `UserDto.emailVerified == false` | Banner + **Verify email** on Account header; `VerifyEmail` route |
| Security flow pending | login/register returns `security` | Forced into S6 before anything else |
| Plan / entitlements | `GET billing/plan`, `GET me/entitlements`, `GET ai/usage` | Plan card, AI usage line, AI "not enabled on this account yet" |
| AI quota exhausted | error `AI_QUOTA_EXCEEDED` | Message + **Manage plan on website** |
| `AccountOverviewDto.kind / canManageServices / applicationStatus / kycStatus` | `GET account/overview` | **Fetched but not rendered** on `main` (only `plan` is used) — `HomeUiState.planName` |

## 4. What PR #4 changes (🟡 not merged)

The Stage 0 IA audit (`docs/ia/IA_AUDIT.md` on PR #4) found: the app never calls `GET /features`;
role is decorative; several screens are dead. The direction that is **written down in repository
documents** is limited to the servix repo prompt `docs/android/PROMPT_CHAT_RELEASE_1.1.md`:

- New bottom bar with **Chats in the centre** (visually the strongest item): Home · Explore · Chats ·
  Bookings · Account.
- Servix AI leaves the bottom bar and becomes the pinned first row inside Chats plus a small Home
  shortcut; Notifications stay behind the top-bar bell.
- Chats, Network and Requests are gated at runtime on `features.community` / `features.requests`.
- Avoid the word "escrow" in copy.

PR #4 also contains *proposed* role-aware Home/Account prototypes (`screenshots/in-flight-pr4/`).
The exact per-role content of those screens is **pending owner sign-off** and is deliberately not
specified in this brief. None of this is on `main`; design it only if the brief explicitly targets
Release 1.1 and only from an approved written specification.
