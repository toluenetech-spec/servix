# Screenshot Index

**Provenance (important).** No emulator or device was available during this investigation, so
no new captures were made. Every image here is a copy of an image that the Android repository's
own CI produced by rendering the real Compose screens with fixture data
(`app/src/test/java/ng/name/servix/app/screenshots/{ScreenshotTest,PlayAssetsTest,Fixtures}.kt`,
Robolectric, Pixel-class 412 dp-wide frame at 1.5× = 616×1371 px; Play assets 1080×1920). They
show the real UI code, but the data (names, prices, bookings) is **fixture data**, not production
data, and the status bar/system UI is not rendered. Dates in greetings reflect the CI run date.

| Folder | Source in Android repo | Ref | Count |
| --- | --- | --- | --- |
| `app-renders/` | `docs/screenshots/*.png` | `main@61a1c83` | 27 |
| `play-listing/` | `docs/play/phone/*.png` (Play Store listing images) | `main@61a1c83` | 8 |
| `in-flight-pr4/` | `docs/ia/screens/*.png` (Stage 0 IA audit prototypes) | PR #4 `arena/58792043-servix-android@3e48a0e` — **not merged** | 9 |

## app-renders (main)

| File | Screen (spec ID) | Variant / state | Notes |
| --- | --- | --- | --- |
| `00_components.png` | component gallery | — | primitives sheet (buttons, fields, chips, badges) |
| `01_welcome.png` | S2 Welcome | no providers | |
| `01b_welcome_providers.png` | S2 Welcome | Google + GitHub buttons | |
| `02_sign_in.png` | S3 Sign in | default | |
| `02b_sign_in_providers.png` | S3 Sign in | with providers | |
| `03_home_signed_in.png` | S8 Home | signed in, no bookings | shows bell, avatar initials, empty "Your bookings" |
| `03c_home_fontscale130.png` | S8 Home | font scale 1.3 | accessibility check |
| `04_home_guest.png` | S8 Home | guest | sign-in card |
| `05_home_bookings.png` | S8 Home | with attention cards + upcoming bookings carousel | |
| `05b_home_loading.png` | S8 Home | loading skeleton | |
| `06_explore_results.png` | S9 Explore | professionals results | chips row + rows |
| `06b_explore_fontscale130.png` | S9 Explore | font scale 1.3 | |
| `07_explore_empty.png` | S9 Explore | empty + clear filters | |
| `08_professional_profile.png` | S10 Professional profile | About tab, sticky Book bar | |
| `09_service_detail.png` | S11 Service detail | top of page | |
| `10_bookings_grouped.png` | S12 Bookings | Active, grouped Today/This week/Later | |
| `11_booking_pending_payment.png` | S13 Booking detail | `pending_payment` + Pay bar | |
| `11b_booking_detail_fontscale130.png` | S13 Booking detail | font scale 1.3 | |
| `12_booking_requested.png` | S13 Booking detail | `requested` | |
| `13_booking_completed.png` | S13 Booking detail | `completed`, Leave a review | |
| `14_ai_chat.png` | S14 Servix AI | assistant with turns | |
| `14b_ai_empty.png` | S14 Servix AI | empty with suggestions | |
| `14c_ai_fontscale130.png` | S14 Servix AI | font scale 1.3 | |
| `15_account.png` | S16 Account hub | signed in | groups + rows + sign out |
| `16_notifications.png` | S15 Notifications | list | |
| `17_plan.png` | S16 Account → Plan | `PlanCard` | |
| `18_security_check_step.png` | S6 Security check | one stage with progress | |

Not rendered by the harness (no image available): S1 splash, S4 Register, S5 Verify email, S7
Forgot password, Explore filter sheet, profile "Choose a service" sheet, booking sheet, booking
action modals, AI budget guide, Account panels other than Plan, notification permission dialog,
update card, offline banner.

## play-listing (main)

| File | Screen | Notes |
| --- | --- | --- |
| `01_home.png` | S8 Home | 1080×1920 store image |
| `02_explore.png` | S9 Explore | |
| `03_professional.png` | S10 Professional profile | |
| `04_service.png` | S11 Service detail | |
| `05_booking.png` | S13 Booking detail | |
| `06_ai.png` | S14 Servix AI | |
| `07_notifications.png` | S15 Notifications | |
| `08_account.png` | S16 Account | |

## in-flight-pr4 (🟡 prototypes, not shipped)

| File | What it shows |
| --- | --- |
| `ia_00_bottom_bar_before.png` | current 5-tab bar (Home · Explore · Bookings · Servix AI · Account) |
| `ia_01_bottom_bar_after.png` | proposed bar with Chats in the centre |
| `ia_02_home_professional_before.png` | a professional signed in today sees the customer Home |
| `ia_03_account_professional_before.png` | professional Account today |
| `ia_04_home_customer_after.png` | proposed customer Home (attention → chats → bookings → post a request) |
| `ia_05_home_professional_after.png` | proposed professional Home (jobs, this week, profile strength) |
| `ia_06_home_guest_after.png` | proposed guest Home |
| `ia_07_account_customer_after.png` | proposed customer Account |
| `ia_08_account_professional_after.png` | proposed professional Account |
