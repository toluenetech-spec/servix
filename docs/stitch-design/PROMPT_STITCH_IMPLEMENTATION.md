# Servix Android — Release 1.2 "Stitch visual redesign"

You are continuing work on `toluenetech-spec/servix-android` (Kotlin, Jetpack Compose, package `ng.name.servix.app`,
minSdk 26, target 36). Release 1.1 "Chats" is merged. This release applies the **approved Stitch visual design** to the
whole app **without changing behaviour, data flow or API usage**. Same screens, same ViewModels, same routes — new look.

## Standing rules (unchanged — cite them in every report)

- Use the installed skills and quote the rule you applied in each report (Emil Kowalski Design Skills, Impeccable
  Design Skills, UI UX Pro Max, Anthropic Frontend Design, Visual App Skills, Android Testing Skills, Superpowers,
  Vercel Agent Skills).
- Honest reporting: what is built, what is tested, what is not. You cannot reach the live API from your sandbox — say so.
- Never upload to Google Play; the owner uploads the .aab. Never touch the `servix` web repo.
- Work on your branch, open a PR to `main` for the owner to merge.
- **Owner instruction for this release: do NOT wait for "go" between stages.** Finish a stage, post its report,
  and move straight on to the next stage **as long as there is no conflict**. Stop and ask only when: (a) your branch
  conflicts with `main` or with the Release 1.1 PR, (b) the HTML and the behaviour spec contradict each other in a way
  §"How to translate" does not settle, (c) a design needs data the API does not provide, or (d) a product decision is
  needed. Otherwise keep going until Stage F is done, then deliver **one final report** (see end of file).
- `versionName 1.2.0`; `versionCode` = highest code ever uploaded to Play + 1. Updates install over the old version.
- Every API field must exist in `https://api.servix.name.ng/api/v1/docs/json` or `api/docs/*.md`. This release adds
  **no new endpoints**; if a design shows data the app does not have, use the fallback in `CORRECTIONS.md` §3 or omit it.
- **No "escrow" anywhere in the UI.** Use: "You pay through Servix. It is released to the professional after you
  confirm the work." Remove the remaining `escrow` strings in `strings.xml` and `BookingDetailScreen.kt`.

## The design source (read all of it first, before any code)

Read these files from the web repo with
`gh api "repos/toluenetech-spec/servix/contents/<path>?ref=arena/01a0dc4c-servix" -H "Accept: application/vnd.github.raw"`:

1. `docs/stitch-design/CORRECTIONS.md` — **start here**: what was corrected and why, token → Compose mapping (§4),
   icon list, motion tokens, and §5 "things that stay out of the app".
2. `docs/stitch-design/corrected/*.html` — 17 corrected Stitch screens (HTML + Tailwind classes). Read the HTML:
   the class names ARE the spec (spacing, radii, type scale, colours). Listing:
   `s2_welcome_minimal, s3_sign_in, s4_create_account, s5_email_verification, s6_security_check, s7_forgot_password,
   s8_home_customer, s9_explore, s9b_explore_results, s10_professional_profile, s11_service_detail, s12_bookings_hub,
   s13_booking_detail, s14_servix_ai, s17_chats_list, s18_chat_conversation, m0_motion_system`.
3. `docs/stitch-design/new/*.html` — 14 screens in the same system:
   `s1_splash, s6a–s6f security stages (email, enroll, factor, recovery, set_new_password, complete), s8b_home_guest,
   s8c_home_professional, s15_notifications, s16_account, s13b_booking_status_variants, s14b_servix_ai_empty,
   s19_contact_card`.
4. `docs/stitch-design-brief/SCREEN_SPECIFICATIONS.md` + `DESIGN_SYSTEM.md` — behaviour, states, data per screen
   (unchanged by this release). Where HTML and spec disagree on **behaviour**, the spec wins; on **looks**, the HTML wins.

Use `gh api "repos/toluenetech-spec/servix/contents/docs/stitch-design/corrected?ref=arena/01a0dc4c-servix"` to list the
folder, then fetch each file raw. Do not skim: for each screen you implement, open its HTML and transcribe the structure.

## How to translate HTML → Compose (rules)

- Tailwind colour classes map 1:1 via `CORRECTIONS.md` §4 to the existing `ui/theme/Color.kt` tokens. Add the few
  missing tokens there (`SurfaceContainerLow #F3EFE5`, `SurfaceContainerHigh #E6E0D2`, `TertiaryContainer #FBE4E0`,
  `ErrorContainer #F9DEDA`, `InversePrimary #CFE0D6`). **Do not** introduce Material dynamic colour or dark theme.
- Type: extend `Type.kt` with the Stitch scale (display-lg … label-md, currency-display) using the existing Inter
  family; map `font-headline-lg-mobile` → `headlineLarge` 26/34, `font-title-md` → `titleMedium` 16/22 600, etc.
- Radii: `rounded` 12 · `rounded-lg` 16 · `rounded-xl` 20 · `rounded-2xl` 24. Buttons `heightIn(min = 52.dp)`.
- Material Symbols Outlined → `Icons.Outlined.*` (filled variant when the HTML sets `FILL 1`). If an icon has no
  Compose equivalent, use the closest Outlined icon and list it in the report.
- `px-gutter` = 16 dp, `px-margin` = 16 dp, `space-sm/md/lg/xl` = 8/16/24/32 dp.
- Images: the HTML uses SVG placeholders. In the app use the real data: `AvatarImage` (photo or initials), gallery
  images from the API, no stock imagery.
- Motion (`m0_motion_system.html`, CORRECTIONS §4): press scale 0.96 spring(400, 0.75); content `tween(280,
  CubicBezierEasing(0.2f,0f,0f,1f))`; sheets `spring(stiffness = 300f)`; success pop `spring(dampingRatio = 0.55f)`.
  Respect "Remove animations" (`Settings.Global.ANIMATOR_DURATION_SCALE == 0` → fades only).
- Bottom bar: exactly `Home · Explore · Chats · Bookings · Account`, Chats centred in a 34 dp disc with the unread
  badge (Σ `unreadCount`), guests `Home · Explore · Account`. Already the IA from 1.1 — restyle only.

## Stages (run back-to-back; report after each; stop only on a conflict)

**Stage A — Foundation.** Tokens (colours, type, shapes, motion specs), `ServixButton` (primary/secondary/text),
`ServixCard`, `ServixField` (label above, 52 dp, focus ring), `StatusChip` (tones neutral/info/warn/ok/bad as in
`s13b`), `ServixTopBar`, restyled `ServixBottomBar`. Compose previews for each. Report with screenshots from your
preview pipeline. No screen migrations yet.

**Stage B — Auth flow.** S1 splash, S2 welcome (`s2_welcome_minimal`), S3 sign in, S4 create account (5-rule live
checklist, confirm password), S5 email verification, S6 all six stages (`s6_security_check` + `s6a–s6f`), S7 forgot
password. Terms/Privacy acceptance stays on S4. Replace remaining "escrow" strings.

**Stage C — Home, Explore, Profile, Service.** S8 customer / guest / professional (`s8_home_customer`, `s8b`, `s8c`;
role from `GET me`), S9 explore + results + filter sheet, S10 professional profile (gallery = images + PDF + one
video), S11 service detail (one price per service; no scheduling/FAQ blocks).

**Stage D — Bookings and payments.** S12 bookings hub (tabs, status chips, "Confirm completion"), S13 booking detail
with the header variants from `s13b` for all ten statuses, the **Confirm completion** and **Raise a dispute** bottom
sheets and the "Before you confirm" checklist. Keep the Paystack Custom Tab + poll flow exactly as today.

**Stage E — Chats, AI, Notifications, Account.** S17 chats list (pinned Servix AI row, unread pills, swipe actions as
in the HTML), S18 conversation (voice-note player, quoted reply, reactions = server set, image/file attach — no call
buttons, no location/escrow attachments), S19 contact card, S14 Servix AI thread + empty state, S15 notifications,
S16 account hub with **Payments as a row**, role-aware rows.

**Stage F — Polish and release.** Accessibility pass (48 dp targets, content descriptions, TalkBack order on the
bottom bar), reduced-motion check, dark-mode OFF confirmed, screenshot set for Play (≤ 2:1, 320–3840 px), version bump,
`docs/ia/IA_AUDIT.md` updated with a "Visual redesign 1.2" section, PR.

## Order of work if Release 1.1 is still open

1. If Release 1.1 Stage 2 (chat media) is not finished: finish it, open/refresh its PR to `main`, and tell the owner
   it is ready to merge. Do not start Stage A on top of unmerged 1.1 code in the same branch.
2. Branch Release 1.2 from the latest `main` once the 1.1 PR is merged (or, if the owner has not merged yet, branch
   from the 1.1 branch head and say so in the report — rebase onto `main` when it lands).
3. Then run Stages A → F back-to-back as described above.

## Reports

Each stage report: screens done (with preview screenshots), HTML file(s) consumed, deviations from the HTML and why,
skill rules cited, tests run, what is NOT verified.

**Final report (after Stage F):** PR link and head SHA; versionName/versionCode; table of all 31 design files →
Compose screen/composable; list of every deviation from the HTML; confirmed "escrow" count in the repo = 0; test
summary (unit + UI + CI build link); known gaps; what the owner must do next (merge, upload .aab, Play screenshots).
