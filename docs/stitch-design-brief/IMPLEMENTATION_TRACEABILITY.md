# Implementation Traceability

Matrix linking each screen/feature to its source files, ViewModel/state, backend endpoints,
automated tests and screenshot evidence. Repository `toluenetech-spec/servix-android@61a1c83`;
Kotlin paths relative to `app/src/main/java/ng/name/servix/app/`; tests relative to
`app/src/test/java/ng/name/servix/app/`.

## 1. Screens

| ID | Screen | Composable (file:line) | State / ViewModel | Endpoints | Tests | Screenshots |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | Splash / init | `ui/navigation/ServixAppShell.kt:248` | `AuthViewModel.sessionState` | `GET me`, `POST auth/refresh` | `release/ReleaseSmokeTest` (container builds) | — |
| S2 | Welcome | `ui/auth/AuthScreens.kt:215` | `AuthUiState.oauthProviders` | `GET auth/oauth/config` | `screenshots/ScreenshotTest.welcome/welcomeProviders`, `Stage1AuthVerificationTest` | `01_welcome`, `01b_welcome_providers` |
| S3 | Sign in | `AuthScreens.kt:356` | `AuthViewModel` login fields | `POST auth/login` | `ScreenshotTest.signIn/signInProviders`, `Stage1AuthVerificationTest` | `02_sign_in`, `02b_sign_in_providers` |
| S4 | Register | `AuthScreens.kt:499` | register fields, `passwordRules` | `POST auth/register` | `Stage1AuthVerificationTest` | — |
| S5 | Verify email | `AuthScreens.kt:799` | `verificationMethod, otp*` | `GET auth/verification-method`, `POST auth/verify-email/{code,resend}` | `Stage1AuthVerificationTest` | — |
| S6 | Security check | `AuthScreens.kt:1159` | `securityFlow, security*` | `auth/security/*` | `ScreenshotTest.securityCheckStep`, `V031VerificationTest` | `18_security_check_step` |
| S7 | Forgot password | `AuthScreens.kt:1661` | `forgot*` | `POST auth/forgot-password` | `Stage1AuthVerificationTest` | — |
| S8 | Home | `ui/home/HomeTabScreen.kt:82` | `ui/home/HomeViewModel.kt` `HomeUiState` | `GET categories`, `GET professionals`, `GET account/overview`, `GET bookings`, `GET ai/usage`, `GET account/notifications/unread` | `ScreenshotTest.homeSignedIn/homeGuest/homeWithBookings/homeLoading/homeFontScale130`, `a11y/TouchTargetTest` | `03_home_signed_in`, `04_home_guest`, `05_home_bookings`, `05b_home_loading`, `03c_home_fontscale130`; Play `01_home` |
| S9 | Explore | `ui/explore/ExploreScreen.kt:79` | `ui/catalogue/SearchScreen.kt` `SearchViewModel`/`SearchUiState` | `GET professionals`, `GET services`, `GET categories` | `ScreenshotTest.exploreResults/exploreEmpty/exploreFontScale130`, `Stage2CatalogueVerificationTest` | `06_explore_results`, `07_explore_empty`, `06b_explore_fontscale130`; Play `02_explore` |
| S10 | Professional profile | `ui/catalogue/ProfessionalProfileScreen.kt:236` | `ProfessionalProfileViewModel` (`:52`) | `GET professionals/{slug}` + `/services` `/reviews` `/availability/summary`, `account/saved`, `POST views` | `ScreenshotTest.professionalProfile`, `Stage2CatalogueVerificationTest` | `08_professional_profile`; Play `03_professional` |
| S11 | Service detail | `ui/catalogue/ServiceDetailScreen.kt:326` | `ServiceDetailViewModel` (`:110` state) | `GET services/{slug}` `/reviews` `/availability`, `POST bookings`, `POST bookings/{id}/pay`, `POST views` | `ScreenshotTest.serviceDetail`, `Stage2CatalogueVerificationTest`, `Stage3BookingsVerificationTest` | `09_service_detail`; Play `04_service` |
| S12 | Bookings | `ui/bookings/BookingsScreen.kt:143` | `BookingsViewModel`/`BookingsUiState` (`:67`) | `GET bookings` | `ScreenshotTest.bookingsGrouped`, `Stage3BookingsVerificationTest` | `10_bookings_grouped` |
| S13 | Booking detail | `ui/bookings/BookingDetailScreen.kt:510` | `BookingDetailViewModel`/`BookingDetailUiState` (`:115`) | `GET bookings/{id}`, `POST bookings/{id}/{pay,cancel,confirm,dispute,review}`, `GET bookings/{id}/rebook` | `ScreenshotTest.bookingDetailPendingPayment/Requested/Completed/FontScale130`, `Stage3BookingsVerificationTest`, `V031VerificationTest` | `11_booking_pending_payment`, `12_booking_requested`, `13_booking_completed`, `11b_booking_detail_fontscale130`; Play `05_booking` |
| S14 | Servix AI | `ui/ai/AiScreen.kt:98` | `ui/ai/AiViewModel.kt` `AiUiState` | `POST ai/assistant/stream` (SSE; fallback `POST ai/assistant`), `GET ai/usage`, `POST ai/pricing/guidance`, `POST ai/feedback`, `GET categories` | `ScreenshotTest.aiChat/aiEmpty/aiFontScale130`, `AiOfflineTest` (6) | `14_ai_chat`, `14b_ai_empty`, `14c_ai_fontscale130`; Play `06_ai` |
| S15 | Notifications | `ui/notifications/NotificationsScreen.kt:47` | `ui/notifications/NotificationsViewModel.kt` | `GET account/notifications`, `POST account/notifications/read` | `ScreenshotTest.notificationsList`, `OfflineFeaturesTest` | `16_notifications`; Play `07_notifications` |
| S16 | Account hub | `ui/account/AccountHubScreen.kt:77` | local `AccountPanel` state + repository calls | `GET account/saved`, `GET billing/plan`, `GET account/security-summary`, `GET account/device`, `PATCH account/profile`, `POST uploads`, `POST auth/logout` | `ScreenshotTest.accountHub/planCard`, `OfflineFeaturesTest` | `15_account`, `17_plan`; Play `08_account` |

## 2. Cross-cutting features

| Feature | Source | Tests | Evidence |
| --- | --- | --- | --- |
| Bottom bar / NavHost / transitions | `ServixAppShell.kt:141-460`; `ui/navigation/ServixRoutes.kt` | `TouchTargetTest`, `ScreenshotTest` (bar visible in tab renders) | all tab renders |
| Session, token refresh | `data/repository/AuthRepository.kt`, `data/network/ServixNetworkModule.kt`, `data/local/TokenStore.kt` | `Stage1AuthVerificationTest`, `ReleaseSmokeTest.decodesUserAndAccountFamily` | — |
| Provider sign-in | `AuthScreens.kt:100`, `util/OAuthReturnBus.kt`, `MainActivity.kt:28`, manifest | `V031VerificationTest` | `01b`, `02b` |
| Offline handling | `util/ConnectivityObserver.kt`, `ServixComponents.kt:342` | `OfflineFeaturesTest` (6), `AiOfflineTest` | — |
| Notifications polling + deep links | `notifications/*`, `util/AppLinkBus.kt`, manifest | `OfflineFeaturesTest` | — |
| Self-update | `updates/Updates.kt`, `updates/UpdateUi.kt`, `res/xml/update_paths.xml` | `ReleaseSmokeTest.updaterIsUnreachableOnPlayChannel` | — |
| Location → city | `location/LocationButton.kt`, `location/NigerianCities.kt` | — | — |
| Theme / typography | `ui/theme/{Color,Type,Theme}.kt`, `res/font/inter_*.ttf` | `screenshots/TypographyTest` | `00_components` |
| Motion | `ui/motion/Motion.kt` | — | — |
| Formatting (₦, dates) | `util/ServixFormatters.kt` | `PlayAssetsTest` (indirect) | — |
| Play listing assets | `screenshots/PlayAssetsTest.kt` (10) renders `docs/play/phone/*.png` | — | `play-listing/*` |
| Release gates | `release/ReleaseSmokeTest.kt` (5): BuildConfig release-ready, updater off on Play, container builds, DTO decoding | — | — |

Test totals on `main`: **14 test files (2 are helpers), 67 `@Test` methods** (AiOffline 6, OfflineFeatures 6, Stage1/2/3 + V031 1 each, TouchTarget 8, ReleaseSmoke 5, PlayAssets 10, Screenshot 27, Typography 1) (Robolectric/JUnit; no instrumented
tests). CI: `.github/workflows/android-apk.yml` (APK + GitHub release), `screenshots.yml`
(renders committed to `docs/screenshots/`).

## 3. Documents in the Android repo that informed this brief

| Document | Content |
| --- | --- |
| `docs/ANDROID_DESIGN_PLAN.md` | the design plan the current UI implements (no landing page, Home = dashboard, visual system, component list, screen specs, pass order) |
| `docs/ANDROID_HANDOFF_PROMPT.md` | agent hand-off instructions and constraints |
| `docs/play/LISTING.md` | store copy, data-safety answers, "deliberately absent" list |
| `docs/play/RELEASE_CHECKLIST.md` | signing, versioning, upload steps |
| `docs/superpowers/plans/2026-11-05-servix-ai.md` | AI tab plan |
| `reference/api-docs/*.md`, `reference/web/PROJECT_PROGRESS.md` | snapshots of backend/web docs used during build |
| PR #4 `docs/ia/IA_AUDIT.md` (🟡) | Stage 0 IA audit: findings F1–F3, six decisions, before/after renders |

## 4. Known gaps between docs and code

| Claim in docs/strings | Reality in code |
| --- | --- |
| `pro_tools_on_web*` strings imply pros see a "tools are on the website" card | only on unreachable `Stage1AccountTab` |
| `dashboard_*` strings describe a stats dashboard (Bookings / In progress / Completed / Spent) | no such screen; insights endpoint unused |
| `home_stats_live_note`, `home_how_*` (landing-page blocks) | removed from UI |
| `docs/ANDROID_DESIGN_PLAN.md` §5 lists "Payments" under Account | no entry point on `main` |
