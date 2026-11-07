# Design System Audit

What the app's visual system actually is at `61a1c83`, read from `ui/theme/*`, `ui/components/*`,
`ui/motion/Motion.kt`, `res/values/*`, and the rendered screenshots. Inconsistencies are listed as
findings in §7 — not fixed, not redesigned.

## 1. Colour tokens (`ui/theme/Color.kt`, `res/values/colors.xml`)

| Token | Hex | Material 3 role (`Theme.kt`) | Typical use |
| --- | --- | --- | --- |
| Deep Forest | `#12372A` | `primary` | primary buttons, selected tab, headings, top-bar titles |
| Forest Green | `#1F5C45` | `primaryContainer`, `secondary` | verified tick, links, accents |
| Warm Ivory | `#F7F4EC` | `background`, `onPrimary` | app canvas, nav bar, splash |
| Soft Sand | `#EDE8DC` | `secondaryContainer`, `surfaceVariant`, `outlineVariant` | search field, chips, nav indicator, secondary buttons, badges |
| Pure White | `#FFFFFF` | `surface` | cards, sheets |
| Charcoal | `#202622` | `onBackground`, `onSurface` | body text |
| Muted Gray | `#5F675F` (Kotlin) / `#68716B` (`colors.xml`) | `onSurfaceVariant` | secondary text, unselected tabs |
| Coral | `#E56B5D` | `tertiary` | star ratings, attention accents |
| Border Sand | `#DDD7C9` | `outline` | dividers, card borders |
| Border Strong Sand | `#C9C2B1` | — | emphasised borders |
| Danger Red | `#B3372A` | `error` | errors, destructive actions |

Theme is **light only**; `forceDarkAllowed=false`; transparent status/navigation bars with dark
icons (`themes.xml`, `MainActivity.kt:42`). No gradients anywhere (plan §3 comment, `Theme.kt`).

## 2. Typography (`ui/theme/Type.kt`)

Family: **Inter** 4.1 static files 400/500/600/700 (`res/font/inter_*.ttf`, OFL).

| Style | Weight | Size / line | Used for |
| --- | --- | --- | --- |
| displayLarge / Medium | Bold | 32 / 38 | welcome headline |
| displaySmall | Bold | 30 / 36 | — |
| headlineLarge / Medium | SemiBold | 24 / 30 | screen titles, greeting |
| headlineSmall | SemiBold | 20 / 26 | section titles on auth |
| titleLarge | SemiBold | 18 / 24 | card titles |
| titleMedium | SemiBold | 16 / 22 | section headers ("Your bookings"), row names |
| titleSmall | Medium | 14 / 20 | sub-headers |
| bodyLarge | Normal | 16 / 24 | inputs, search placeholder |
| bodyMedium | Normal | 15 / 22 | body copy |
| bodySmall | Normal | 14 / 20 | secondary copy |
| labelLarge | Medium | 14 / 20 | buttons |
| labelMedium | Medium | 13 / 18 | chips, metadata |
| labelSmall | Medium | 12 / 16 | nav labels, stat labels, eyebrows |
| `ServixNumericStyle` | SemiBold | 16 / 22, tabular figures | prices (`PriceText`) |

Eyebrow labels in strings are UPPERCASE ("ACCOUNT VERIFICATION", "SERVIX · ACCOUNT SECURITY").

## 3. Shape, spacing, elevation

| Element | Value | Source |
| --- | --- | --- |
| Cards | radius 16 dp, 0 elevation, white surface, optional 1 dp Border Sand | `ServixCard` (`ServixComponents.kt:299-315`) |
| Buttons / inputs / search | radius 12 dp; buttons min height **52 dp**, 0 elevation | `ServixPrimaryButton`, `ServixSecondaryButton` (`:116-190`) |
| Search field | 56 dp tall, Soft Sand fill, 20 dp search icon | `MobileComponents.kt:102-140` |
| Sheets | top radius 24 dp (`ServixSheetRadius`), `skipPartiallyExpanded` | `ServixBottomSheet`, profile/service sheets |
| Chips / badges | full pill (`RoundedCornerShape(50)`) | `ServixBadge`, `CategoryChip`, `FilterChipPill` |
| Screen padding | 16 dp horizontal; sections spaced 24 dp; lists 12 dp | `HomeTabScreen.kt:101-108` |
| List rows | min 72 dp (`ProfessionalRow`), 48 dp avatar circle with initials | `MobileComponents.kt:206-250` |
| Service card image | 150 dp tall | `MobileComponents.kt:251-300` |
| Top bar | min 56 dp, 48 dp back button | `ServixTopBar` |
| Touch targets | ≥ 48 dp enforced by `TouchTargetTest` | `app/src/test/.../a11y/TouchTargetTest.kt` |

## 4. Motion (`ui/motion/Motion.kt`)

| Token | Value |
| --- | --- |
| Screen push | 220 ms shared-axis X (slide ¼ in / 1⁄12 out + fade), `FastOutSlowInEasing` |
| Sheet | 250 ms |
| Crossfade | 150 ms |
| Tab switch | 120 ms |
| Press feedback | 120 ms, scale 0.98, darken 8 % (`Modifier.pressFeedback`) |
| Streaming caret | 600 ms blink (AI) |
| Success tick | haptic + view feedback on sign-in (`rememberSuccessTick`) |
| Respects system animator scale (0 → instant) | `Motion.duration()` |

## 5. Component library (`ui/components/`)

**ServixComponents.kt:** `ServixLogoMark`, `ServixPrimaryButton`, `ServixSecondaryButton`,
`ServixTextField` (label, error text, trailing show/hide), `ServixCard`, `ServixBadge`,
`OfflineBanner`, `ProfessionalToolsWebCard` (unused in live UI), `SkeletonBox`, `ErrorStateCard`.

**MobileComponents.kt:** `ServixTopBar`, `SearchField`, `SectionHeader` (title + optional action
text), `AvatarImage`, `ProfessionalRow`, `ServiceCard`, `CategoryChip`, `ServixSegmentedControl`,
`FilterChipPill`, `StatusChip`, `PriceText`, `InfoRow`, `ListSkeleton`, `EmptyState` (icon, title,
body, action), `ErrorCard`, `ServixTextButton`, `AttentionCard`, `ServixBottomSheet`,
`ButtonSpinner`.

**CatalogueComponents.kt:** `ServixAvatarImage`, `InitialsAvatarFallback`, `ServixMediaImage`,
`VerifiedBadgeChip`, `RatingRow`, `ProfessionalCardItem`, `ServiceCardItem`, `CategoryCardItem`,
`EmptyStateCard`, `ProfessionalCardSkeleton`.

**Domain components:** `BookingStatusChip` (`BookingStatusMeta.kt`, colour per status using Soft
Sand / Forest Green / Coral / Danger Red), `UpcomingBookingCard`, `AiCard`, `PlanLine`,
`SignInCard` (Home), `BookingRow`, `BookingActionBar`, `ProfileHeader`, `ProfileStatsStrip`,
`ProfileTabStrip`, `ProfileBookBar`, `ServiceBookBar`, `SixDigitCodeField`, `PasswordChecklist`,
`SecurityStepProgress`, `OAuthButtons`, `DeviceCard`, `PlanCard`, `UpdateCard`, `ChatBubble`,
`BudgetPanel`.

Gallery render of the primitives: `screenshots/app-renders/00_components.png`.

## 6. Iconography & brand assets

- Material Icons (filled/outlined/rounded) throughout; `material-icons-extended`.
- Brand mark `res/drawable/ic_servix_mark.xml`, wordmark `ic_servix_wordmark.xml`; adaptive
  launcher icon with monochrome layer (`ic_launcher_foreground.xml`, `ic_launcher_monochrome.xml`).
- Splash: Warm Ivory background, centred mark, no text (`Theme.Servix.Starting`).
- Avatars: image via Coil or initials circle (Soft Sand / Deep Forest text).

## 7. Findings (inconsistencies and residue — facts for the redesign to be aware of)

| # | Finding | Evidence |
| --- | --- | --- |
| F1 | **Muted Gray differs** between Compose (`#5F675F`) and XML (`#68716B`) and the brand sheet (`#68716B`) | `Color.kt:12` vs `colors.xml` |
| F2 | The word **"escrow"** still appears in user-facing copy although the owner asked for "pay through Servix; released after you confirm" wording: `welcome_subtext`, `register_subtitle`, `bookingNextStepSentence` for `pending_payment`/`accepted` | `strings.xml`, `BookingDetailScreen.kt:1163-1165` |
| F3 | Many strings are inline literals rather than resources (Account hub rows, booking actions, AI copy, profile section titles), so the app is effectively English-only | `AccountHubScreen.kt`, `BookingDetailScreen.kt:1162-1218`, `AiScreen.kt` |
| F4 | Unused string groups: `dashboard_*`, `nav_dashboard`, `nav_search`, `home_hero_*`, `home_how_*`, `home_stats_live_note`, `search_pros_*` (landing/dashboard residue) | `strings.xml` |
| F5 | Website-residue wording in the app: "Manage account on the website", "Manage on the website", "Manage plan on website", "Open www.servix.name.ng" appear on Account, Plan, Security, AI | Stage 0 audit; `AccountHubScreen.kt` |
| F6 | Duplicate entry points: Notifications via bell **and** Account row; Servix AI via tab **and** Home card | `HomeTabScreen.kt`, `AccountHubScreen.kt` |
| F7 | "Recommended for you" is not personalised (top-rated list) | `HomeViewModel.kt:45` |
| F8 | Demo-content disclaimers remain in strings (`home_demo_profiles_note`, `demo_reviews_note`, `search_pros_desc`) | `strings.xml` |
| F9 | Secondary CTA style varies: `ServixSecondaryButton` (Soft Sand fill) vs `ServixTextButton` vs Material `TextButton` on auth screens | `AuthScreens.kt`, `AccountHubScreen.kt` |
| F10 | Status chip palette is the only place Coral/Danger Red carry meaning; otherwise Coral is used for stars — same hue for "attention" and "rating" | `BookingStatusMeta.kt`, `MobileComponents.kt:232` |
| F11 | Dark theme, tablets and landscape are not designed for; `supportsRtl=true` but no RTL-specific checks | `Theme.kt`, manifest |
| F12 | Font-scale 1.3 renders exist and pass visually for Home, Explore, Booking detail and AI | `*_fontscale130.png` |

## 8. Copy voice (observed)

Short, plain, second person, Nigerian context, no exclamation marks except "Review published.
Thank you!". Reassurance lines recur ("Payment is held securely…", "Never share your code…").
Numbers use UK grouping (`Locale.UK`), prices as "₦120,000", dates as "Friday, 6 November".
