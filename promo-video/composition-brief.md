# Hyperframes Composition Brief: Servix

## Objective
Create a short launch video for Servix for mobile-first social platforms (TikTok, Reels, Shorts) that is also
presentable to investors and partners.

## Output
- Composition directory: `promo-video/composition/` (vertical) and `promo-video/composition-landscape/`
- Rendered video: `promo-video/servix-launch-vertical.mp4` (1080x1920) and `promo-video/servix-launch-landscape.mp4` (1920x1080)
- Duration: ~25.5 s at 30 fps

## Source Material
- Project root: the Servix repository (React + Vite frontend, Fastify API)
- Primary files read: `PROJECT_PROGRESS.md` (brand guidelines), `src/styles/tokens.css`, `public/brand/*`,
  `src/pages/HomePage.jsx`, `src/pages/ProfessionalsPage.jsx`, `src/pages/ServiceDetailPage.jsx`,
  `src/components/ai/*`, `api/docs/BOOKINGS.md`, `api/docs/AI_ROUTING.md`
- Product name: Servix
- Tagline / strongest claim: "Services, delivered professionally." / "the price is locked when you book.
  Payment is held securely and only released after you confirm completion."
- Key UI moments to show (real screenshots in `work/shots/`): professionals cards, booking sheet, booking page,
  Servix AI chat
- Copy that must appear verbatim:
  - Services, delivered professionally.
  - Payment is held securely and only released after you confirm completion.
  - www.servix.name.ng

## Creative Direction
- Tone preset: polished (app-store pacing in the middle)
- Creative direction: premium Nigerian tech launch; calm confidence; product is the hero
- Angle: "Hiring a professional in Nigeria shouldn't be a gamble." Servix answers the fear three times:
  verified people, a locked price held until you confirm, and an assistant grounded in real listings.
- Hook: the two-line statement on Deep Forest, second line slamming on the beat.
- Outro: logo lock-up → "Find your professional today." → www.servix.name.ng
- Avoid: generic SaaS language, abstract filler, particles/glitch, any stat the app labels as demonstration,
  any invented UI state.

## Visual Identity
- Background: #12372A; Secondary: #1F5C45; Ivory: #F7F4EC; Sand: #EDE8DC; Accent: #E56B5D; Charcoal: #202622
- Display + body font: Inter Variable (local woff2 copied from node_modules/@fontsource-variable/inter)
- Visual references: SX monogram tile, warm-ivory app screens, deep-forest primary buttons, 10px radius cards

## Storyboard
Use `brag-plan.md` as the creative contract. Scene summary (vertical):
1. Hook — 3.70s — two lines, coral underline, beat-locked at 0.35 / 1.60
2. Reveal — 2.64s — monogram, wordmark, tagline, phone rises at 5.80
3. Find — 6.31s — three real cards one by one at 7.38 / 8.44 / 9.50, Verified ring at 10.5
4. Book — 5.26s — booking sheet, tap at 14.2, booking page at 15.28, verbatim escrow copy
5. AI — 4.74s — question at 17.91, answer grows 18.6–21.3
6. Outro — 2.9s — lock-up at 22.65, CTA, URL, music fade

## Audio
- Music: `assets/music/happy-beats-business-moves-vol-11-by-ende-dot-app.mp3`, volume 0.55, fade out last 1.2 s
- Music cue guidance: bundled preset `work/music-cues.json` (strong cues 1.60, 3.70, 5.80, 6.34, 8.96, 12.65,
  17.91, 22.65). Lock the hook line, logo, booking sheet, AI question and outro to those; cards every other beat.
- Audio-reactive: none
- SFX (Kenney, CC0, copied to `assets/sfx/`): impactSoft_medium for slams/logo, card-slide for cards,
  click for the tap, keyboard ticks for typing, impactBell_heavy once on the final logo. All at ≤0.5 volume.

## Hyperframes Instructions
- One root composition, GSAP paused timeline registered in `window.__timelines`, all assets local (GSAP from
  node_modules; no CDN — the render machine has no internet).
- Phone device frame built in HTML/CSS; app screens are `<img>` of the captured PNGs, animated by translating the
  inner screen (scroll) and swapping screens with opacity.
- Keep every readable line on screen ≥ 0.3 s per word after it has fully entered.
- Run `hyperframes check` (zero errors) before `hyperframes render`.
- Keep creation and rendering local; nothing is published.
