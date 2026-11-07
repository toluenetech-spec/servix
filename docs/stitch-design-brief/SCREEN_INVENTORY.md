# Screen Inventory

Every full screen, bottom sheet, dialog and persistent chrome element in the Android app at
`61a1c83`. Routes come from `ui/navigation/ServixRoutes.kt` (type-safe `@Serializable` objects).
Screenshot names refer to `screenshots/app-renders/` unless prefixed.

## A. Full screens (NavHost destinations)

| # | Screen | Route | Source composable | Access | Status | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Splash / Initialising | — (shown while `SessionState.Initializing`) | `ServixAppShell.kt:248-268` + `Theme.Servix.Starting` splash | all | ✅ | — (not rendered by harness) |
| 2 | Welcome | `Welcome` | `ui/auth/AuthScreens.kt:215 WelcomeScreen` | guest start | ✅ | `01_welcome.png`, `01b_welcome_providers.png` |
| 3 | Sign in | `Login` | `AuthScreens.kt:356 LoginScreen` | guest | ✅ | `02_sign_in.png`, `02b_sign_in_providers.png` |
| 4 | Create account | `Register` | `AuthScreens.kt:499 RegisterScreen` | guest | ✅ | — |
| 5 | Verify email (OTP or link mode) | `VerifyEmail` | `AuthScreens.kt:799 VerifyEmailScreen` | signed in, unverified | ✅ | — |
| 6 | Security check (MFA flow, multi-stage) | `SecurityCheck` | `AuthScreens.kt:1159 SecurityCheckScreen` | after login/register/OAuth/reset | ✅ | `18_security_check_step.png` |
| 7 | Forgot password | `ForgotPassword` | `AuthScreens.kt:1661 ForgotPasswordScreen` | guest | ✅ | — |
| 8 | **Home** (dashboard; tab 1) | `Home` | `ui/home/HomeTabScreen.kt:82` | all (guest variant) | ✅ | `03_home_signed_in.png`, `04_home_guest.png`, `05_home_bookings.png`, `05b_home_loading.png`, `03c_home_fontscale130.png`; Play `01_home.png` |
| 9 | **Explore** (tab 2) | `Search` | `ui/explore/ExploreScreen.kt:79` | all | ✅ | `06_explore_results.png`, `07_explore_empty.png`, `06b_explore_fontscale130.png`; Play `02_explore.png` |
| 10 | Professional profile | `ProfessionalProfile(slug)` | `ui/catalogue/ProfessionalProfileScreen.kt:236` | all; save requires sign-in | ✅ | `08_professional_profile.png`; Play `03_professional.png` |
| 11 | Service detail | `ServiceDetail(slug, rebookedFrom?, initialNotes?, openBookingSheet)` | `ui/catalogue/ServiceDetailScreen.kt:326` | all; booking requires sign-in | ✅ | `09_service_detail.png`; Play `04_service.png` |
| 12 | **Bookings** (tab 3) | `Bookings` | `ui/bookings/BookingsScreen.kt:143` | signed in (guest sees sign-in prompt) | ✅ | `10_bookings_grouped.png` |
| 13 | Booking detail | `BookingDetail(id, pollingAfterPay)` | `ui/bookings/BookingDetailScreen.kt:510` | signed in | ✅ | `11_booking_pending_payment.png`, `12_booking_requested.png`, `13_booking_completed.png`, `11b_booking_detail_fontscale130.png`; Play `05_booking.png` |
| 14 | **Servix AI** (tab 4) — Assistant + Budget guide sub-tabs | `ServixAi` | `ui/ai/AiScreen.kt:98` | signed in (guest sees sign-in prompt) | ✅ | `14_ai_chat.png`, `14b_ai_empty.png`, `14c_ai_fontscale130.png`; Play `06_ai.png` |
| 15 | Notifications | `Notifications` | `ui/notifications/NotificationsScreen.kt:47` | signed in | ✅ | `16_notifications.png`; Play `07_notifications.png` |
| 16 | **Account** hub (tab 5) + in-place panels | `Account` | `ui/account/AccountHubScreen.kt:77` | all (guest variant) | ✅ | `15_account.png`, `17_plan.png`; Play `08_account.png` |

### Account hub in-place panels (same route, `AccountPanel` enum, `AccountHubScreen.kt:70`)

| Panel | Composable | Status |
| --- | --- | --- |
| Profile (name + photo) | `ProfilePanel` `:271` | ✅ (photo upload fixed in PR #4 🟡) |
| Saved professionals | `SavedPanel` `:372` | ✅ |
| Plan | `PlanPanel` `:420` / `PlanCard` `:447` | ✅ read-only |
| Security summary | `SecurityPanel` `:485` | ✅ read-only |
| This device | `ui/account/DeviceCard.kt:33` | ✅ |
| Updates | inline (`UpdateCard`, "Check for updates") | ✅ test channel; no-op on Play builds |
| Legal | `AccountLegalCard` `:542` | ✅ (links open Custom Tab) |

## B. Bottom sheets

| Sheet | Opens from | Source | Status |
| --- | --- | --- | --- |
| Explore **Filters** (category, city, rating, price slider, availability, "Show N results") | Explore → Filters / Category / City chips | `ExploreScreen.kt:227-340` via `ServixBottomSheet` | ✅ |
| Explore **Sort** dropdown menu (Recommended, Highest rated, Most reviewed, Price ↑, Price ↓) | Explore → Sort chip | `ExploreScreen.kt:85-110` (`DropdownMenu`) | ✅ |
| **Choose a service** (profile "Book") — lists pro's services, escrow copy | Professional profile → Book | `ProfessionalProfileScreen.kt:347-430` | ✅ |
| **Book this service** (slot picker, notes, "Book & Pay ₦…") | Service detail → Book / Book again / deep param `openBookingSheet` | `ServiceDetailScreen.kt:903-1240` (`BookingSheetContent`) | ✅ |
| Booking **action modals**: Cancel, Confirm completion, Report a problem (dispute), Review, Book again | Booking detail action bar / "More" | `BookingDetailScreen.kt:1058-1600` | ✅ |
| Account **Security** sheet / **Payments** sheet | — (no entry point on `main`) | `ui/account/AccountSheets.kt:54`, `:157` | 🟠 unreachable |
| Servix AI **feedback** dialog ("What was wrong?") | AI → "Not helpful" | `AiScreen.kt:399` (`AlertDialog`) | ✅ |
| Notification **permission rationale** dialog | first sign-in on Android 13+ | `ServixAppShell.kt:348-366` | ✅ |
| Self-**update card** | shell, when a newer GitHub release exists | `updates/UpdateUi.kt` | ✅ test channel only |

## C. Persistent chrome

| Element | Behaviour | Source |
| --- | --- | --- |
| Bottom navigation bar | 5 tabs: Home · Explore · Bookings · Servix AI · Account; hidden on auth routes; Explore stays selected on profile/service, Bookings on booking detail | `ServixAppShell.kt:141-190, 374-430` |
| Offline banner | top of shell when `isOnline == false` | `ServixComponents.kt:342` |
| Home top bar | greeting + date, bell with unread dot, avatar/initials → Account; guest sees "Sign in" | `HomeTabScreen.kt:259-327` |
| `ServixTopBar` | title + optional back on inner screens | `MobileComponents.kt:69` |
| Sticky action bars | `ProfileBookBar` (Save + Book), `ServiceBookBar`, `BookingActionBar` | respective screen files |

## D. Dead / unreachable UI on `main` (do not design as live)

| Item | Source | Note |
| --- | --- | --- |
| `Stage1AccountTab` | `ServixAppShell.kt:1038-1200` | Old account tab; never navigated to |
| `ProfessionalToolsWebCard` | `ServixComponents.kt:377` | Only referenced from `Stage1AccountTab` |
| `AccountPaymentsSheetContent`, `AccountSecuritySheetContent` | `AccountSheets.kt` | No caller |
| Older `SearchScreen` composable | `SearchScreen.kt` | Replaced by `ExploreScreen` |
| `ComponentsGallery` | `ui/components/ComponentGallery.kt` | Screenshot-harness only (`00_components.png`) |
| Dashboard strings `dashboard_*`, `nav_dashboard` | `strings.xml` | Leftover from the removed sixth "Dashboard" tab |

## E. In flight on PR #4 (🟡, not on `main`)

| Item | Evidence |
| --- | --- |
| New `ServixBottomBar` with **Chats** in the centre (Home · Explore · Chats · Bookings · Account) and Servix AI moved out of the bar | `ui/navigation/ServixBottomBar.kt`; `in-flight-pr4/ia_01_bottom_bar_after.png` |
| Role-aware Home prototypes (customer / professional / guest) | `in-flight-pr4/ia_04…ia_06` |
| Role-aware Account prototypes | `in-flight-pr4/ia_07`, `ia_08` |
| Profile-photo upload fix (1.0.1, versionCode 101) | PR #4 files `AccountHubScreen.kt`, `util/MediaCacheBust.kt` |

Count on `main`: **16 full screens** (incl. splash), **7 account panels**, **9 sheets/dialogs**,
**5 tabs**.
