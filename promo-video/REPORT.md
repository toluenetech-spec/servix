# Servix launch video — report

Date: 15 October 2026. Branch `arena/01a0dc4c-servix`. Nothing was published, deployed or committed; all files
sit in `promo-video/`.

## Deliverables

- `servix-launch-vertical.mp4` — 1080×1920 @ 30 fps, 25.6 s, H.264/AAC, 4.8 MB (primary, 9:16)
- `servix-launch-landscape.mp4` — 1920×1080 @ 30 fps, 25.6 s, 4.6 MB (16:9)
- `servix-launch-vertical-poster.jpg`, `servix-launch-landscape-poster.jpg` — poster frames (baked as frame 0)
- `share-copy.txt` — caption
- `brag-plan.md` (storyboard + production plan), `composition-brief.md`
- `composition/` + `composition-landscape/` — Hyperframes source (template `composition/build.mjs`)
- `work/` — capture scripts, raw screenshots, filming-only AI stand-in, music cue data

## How it was made (Brag workflow, adapted)

1. **Inspect.** Read the Brag skill (`latent-spaces/brag`: SKILL.md, step 1–4 references, audio/tones guides)
   for process only — none of Brag's branding, tone copy or examples were reused. Inspected Servix: brand
   guidelines (`PROJECT_PROGRESS.md` §2), tokens, logos, routes, the booking state machine docs, AI docs.
2. **Plan.** `brag-plan.md`: angle "Hiring shouldn't be a gamble", six scenes beat-locked to the music's cue
   map (1.60 / 3.70 / 5.80 / 6.34 / 12.65 / 17.91 / 22.65 s), copy limited to verbatim app language, reading
   floors respected (every settled line ≥ 0.3 s per word).
3. **Capture real UI.** The actual Servix frontend + API from this repository were run locally (embedded
   PostgreSQL, seeded with the project's own demo catalogue). Playwright drove a 390×844 phone viewport at 3×
   and captured: home, `/professionals` (header + three real cards), the "Book this service" sheet, the real
   booking page after a real sandbox checkout (SVX-2026-188C7B47, status Requested, ₦350,000, Thu 15 Oct
   16:00), and the Servix AI chat with a streamed answer. No UI was mocked, drawn or edited.
4. **Compose.** Hyperframes composition (GSAP timeline, local Inter Variable font, brand palette only; phone
   device frame in CSS; screens are the PNG captures; iOS-style push transitions between screens; a tap dot
   and an answer-reveal mask for the AI stream). SFX: Kenney CC0 impacts/card slides/click/bell on tracks 3–4;
   music on track 2 at 0.55 with a 1.4 s fade.
5. **Validate.** `hyperframes check` → **0 errors** for both layouts; 10/10 text contrast checks pass WCAG AA;
   remaining warnings are the intentional off-canvas phone/screens (marked `data-layout-allow-overflow`).
6. **Render + finish.** `hyperframes render` (768 frames each), then ffmpeg baked the poster frame as frame 0
   (CRF 18, faststart). Frames were extracted at 12 timestamps per video and reviewed.

## Verification

- Both MP4s probe as h264 1080×1920 / 1920×1080, 30 fps, 25.6 s, AAC audio; audio peak −3.6 dBFS, mean −21 dB.
- Reviewed frames: hook (0–3.7 s), reveal, three cards landing, booking sheet + tap, booking page, AI answer
  reveal, outro — all legible, no clipped text, no notch/overlay over app content.
- Every number on screen comes from the running app: ₦120,000 / ₦250,000 / ₦180,000 starting prices, ratings
  4.9★ (156) / 4.9★ (127) / 4.8★ (94), ₦350,000 booking, 15 Oct 2026 16:00, "8 professionals found".

## Limitations and honest disclosures

1. **Demonstration catalogue.** The professionals shown (Tunde Bakare, Adaeze Okafor, Chiamaka Eze…) are the
   repository's seeded demo profiles, which the live site itself labels as demonstration content. The customer
   account ("A" avatar) is a throw-away local account; no production data, emails or real users appear.
2. **Rendered from a local instance, not production.** The sandbox cannot reach www.servix.name.ng, so the UI
   was captured from the same code running locally. The interface is identical to what is deployed at `5c5f14d`.
3. **Payment was the sandbox checkout.** The booking in the video was genuinely created and paid through the
   API's sandbox flow (same webhook/verify/capture path); no real money moved. The sandbox banner page is
   deliberately not shown.
4. **Servix AI answer came from a stand-in model.** The sandbox has no route to the live AI provider, so for
   filming a local OpenAI-compatible stub (`work/ai-standin.mjs`) stood in for the model. It went through the
   real Servix router, really called the real `search_professionals` tool, and wrote its two bullets strictly
   from the tool's returned data. UI, streaming, Copy and Helpful controls are the real product. If you want
   the frame to be a 100% production capture, run `work/`'s capture against production with your account and
   drop the PNG into `composition/assets/screens/ai.png`; the composition needs no other change.
5. **Music licence.** The bed track (`happy-beats-business-moves-vol-11-by-ende-dot-app.mp3`) is bundled with
   the open-source Brag skill and credited to ende.app, but Brag ships no licence text and the sandbox could not
   reach ende.app to confirm terms. **Confirm the licence or swap the track before public posting** (single
   file + one `src` in `build.mjs`). SFX are Kenney (CC0) — no restriction.
6. **Capture speed.** Hyperframes fell back to screenshot capture (no GPU in the sandbox); output quality is
   unaffected, only render time (~1.5 min per video).
7. **Not shown on purpose:** landing-page demo statistics, Community/Messages/Network (disabled), live Paystack.

## Toolchain (all local to the sandbox, nothing added to the Servix app)

hyperframes CLI + GSAP (vendored into `composition/assets/gsap.min.js`), `@sparticuz/chromium` headless
Chromium, Playwright-core for capture, `@ffmpeg-installer/linux-x64` ffmpeg/ffprobe, embedded PostgreSQL for the
local database. Servix source, configs and dependencies were not modified; `api/.promo-local-pg.mjs` is a scratch
launcher that should not be committed.
