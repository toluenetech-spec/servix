# Brag Plan: Servix

Workflow adapted from the open-source `/brag` skill (latent-spaces/brag): inspect → plan/storyboard →
composition brief → Hyperframes composition → check → render → poster + share copy. Brag's own branding,
example sites and tone presets are *not* reused; only its production discipline is.

## What is this app?
Servix is a Nigeria-first marketplace where customers find identity-verified professionals, book them at a
locked price with the payment held until the work is confirmed, and get help from Servix AI, which answers
from real Servix data.

## The angle
**"Hiring shouldn't be a gamble."** Every Nigerian has a story about paying a "professional" upfront and
never hearing back. Servix's real product answers that fear three times over — verified profiles, a locked
price with payment held in escrow until you confirm, and an assistant that only talks about real listings.
The video is the product doing those three things on a phone, not a landing page describing them.

## Hook (first 2–3 seconds)
Dark Deep-Forest frame. Two lines of big ivory type land on the beat:
"Hiring a professional in Nigeria" → "shouldn't be a gamble." (coral stroke under *gamble*).
A line everyone in the audience already agrees with, before the brand even appears.

## Key moments (the middle)
- The real `/professionals` cards (Chiamaka Eze, Tunde Bakare, Emeka Nwosu) arriving one by one inside a
  phone, each with its Verified tick, rating and "Starting at ₦…".
- The real "Book this service" sheet: "₦350,000 per project — the price is locked when you book. Payment is
  held securely and only released after you confirm completion." Then the real booking page: "Requested",
  ₦350,000, Thursday 15 October at 16:00.
- Servix AI: the question "Who can design a logo for a small bakery in Lagos?" and the answer streaming in
  with two real catalogue professionals and their real starting prices.

## Outro / punchline
SX monogram + SERVIX wordmark. "Services, delivered professionally." → "Find your professional today." →
`www.servix.name.ng`.

## User flow worth showing
Browse professionals → open a gig → Book & Pay (price locked, payment held) → booking confirmed as
"Requested" → ask Servix AI for the next hire. (Captured from the real app running locally with its seeded
demonstration catalogue; see Source material honesty below.)

## Tone
- Preset: `polished` with `app-store` pacing for the feature beats.
- Creative direction: premium Nigerian tech launch — confident, calm, editorial; the product is the hero.
- Interpretation: few words per scene, long enough holds to read, motion from the phone and cards rather than
  from effects. No particles, no glitch, no stock footage. Deep Forest + Warm Ivory only, coral as a single accent.

## Format: vertical — 1080x1920 (primary); landscape 1920x1080 (secondary, same timeline, re-laid-out)
## Duration: ~25.5 seconds

## Visual identity (from the project)
- Background: Deep Forest `#12372A` (dark scenes) / Warm Ivory `#F7F4EC` (phone screens are the app's own ivory)
- Secondary surface: Forest Green `#1F5C45`, Soft Sand `#EDE8DC`
- Accent: Coral `#E56B5D` (used once per scene at most)
- Text: Warm Ivory `#F7F4EC` on dark; Charcoal `#202622` inside the app
- Display font: Inter Variable (the app's single typeface, self-hosted from `@fontsource-variable/inter`)
- Body font: Inter Variable
- Strongest visual element: the SX monogram (`public/brand/servix-app-logo.png`, `favicon.svg`) and the
  warm-ivory app screens with deep-forest buttons.

## Source material honesty
- All app screens are screenshots of the real Servix frontend (this repository) running against the real
  API and database locally, seeded with the project's own demonstration catalogue (`api/prisma/seed.ts`).
  The professionals shown (Chiamaka Eze, Tunde Bakare, Emeka Nwosu…) are that demonstration content, not
  real people; the customer account "Ada Okafor" is a local fictional account. No production data was used.
- The booking was really created and paid through the API's sandbox checkout (the same webhook → verify →
  capture path as production). Its status "Requested" = paid, held, waiting for the professional to accept.
- The sandbox had no route to the live AI provider, so the Servix AI answer was produced by a local stand-in
  model (`work/ai-standin.mjs`) that called the **real** `search_professionals` tool through the real router
  and wrote its two bullets strictly from the tool's result. The UI, streaming, copy buttons and "Helpful?"
  controls are the real interface. The production assistant answers the same kind of question from live data.
- Landing-page demo statistics ("500+ verified professionals" etc. — labelled demonstration values in the app)
  are deliberately **not** shown. No invented numbers, testimonials or features.

## Share copy (draft)
Hiring a professional in Nigeria shouldn't be a gamble. Servix: verified professionals, a locked price, and
your payment held until you confirm the work — with Servix AI to help you choose. www.servix.name.ng

## Audio direction
- Role: warm bed with sparse professional accents.
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (bundled with /brag; 114.8 BPM). License
  caveat: /brag credits ende.app but does not ship licence terms — confirm or replace before public posting
  (single-file swap in `composition/assets/music/`).
- Music treatment: starts at 0 at −10 dB-ish (volume 0.55), small lift under the outro, 1.2 s fade at the end.
- Music cue guidance (from the bundled preset): strong cues at 1.60, 3.70, 5.80, 6.34, 8.96, 12.65, 17.91,
  22.65 s. Beat grid ≈ every 0.52 s. Hook line 2 locks to 1.60; logo to 3.70; phone rise to 5.80; booking
  sheet to 12.65; AI question to 17.91; outro logo to 22.65. Cards use every other beat (7.38 / 8.44 / 9.50).
- Audio-reactive treatment: none (restraint; polished tone).
- SFX posture: sparse, motion-matched, low high-frequency risk (Kenney, CC0): soft impacts on the two hook
  slams and the logo; card slides for the three profile cards; a click on "Book & Pay"; soft keyboard ticks
  under the typed AI question; a single bell on the final logo.
- Restraint rule: no whooshes, no risers, no stingers over text the viewer is reading; SFX sit under the music.

## Storyboard

### Scene 1 — Hook — 3.7s (0.00–3.70)
Deep Forest full-frame with a very faint ivory grain. Line 1 "Hiring a professional in Nigeria" rises in at
0.35 s; line 2 "shouldn't be a gamble." slams in at 1.60 s with a coral underline drawing under "gamble".
Hold until 3.4 s, then dip.
Sequential/interaction: two-line reveal, beat-locked.
Audio intent: tension → recognition. Audio-coupled idea: soft impact on each line. Music: bed enters at 0.
Transition mood: hard cut on the beat → Scene 2

### Scene 2 — Reveal — 2.64s (3.70–6.34)
SX monogram tile pops in at centre (3.70), wordmark SERVIX slides out beside it, tagline "Services, delivered
professionally." (the app's own hero copy) fades under. At 5.80 the phone (real home screen, hero visible)
rises from the bottom edge and the logo lock-up moves to the top third.
Sequential/interaction: logo → wordmark → tagline → phone rise.
Audio intent: arrival. Audio-coupled: soft impact on the monogram. Transition: soft → Scene 3

### Scene 3 — Find verified professionals — 6.31s (6.34–12.65)
Caption at top: "Find verified professionals." Phone shows the real `/professionals` screen; the three real
cards slide into the phone one by one (7.38, 8.44, 9.50 s) with a card sound each; the "Verified" tick on the
first card gets a brief coral ring at 10.5 s. Sub-caption at 10.6 s: "Identity-checked. Rated. Priced upfront."
Sequential/interaction: yes — 3 cards arrive one by one; highlight ring on Verified.
Audio intent: momentum. Audio-coupled: card slides on each arrival. Transition: slide → Scene 4

### Scene 4 — Book & pay, protected — 5.26s (12.65–17.91)
Caption: "Book. Pay once. Held until you confirm." The real "Book this service" sheet is on the phone; a
finger-dot tap lands on "Book & Pay ₦350,000" at 14.2 s (click); the phone screen cuts to the real booking page
("Requested" · ₦350,000 · Thursday, 15 October 2026 at 16:00) at 15.28 s with a soft impact. Sub-caption at
15.6 s (verbatim app copy): "Payment is held securely and only released after you confirm completion."
Sequential/interaction: simulated tap → screen change.
Audio intent: reassurance. Transition: soft → Scene 5

### Scene 5 — Ask Servix AI — 4.74s (17.91–22.65)
Caption: "Ask Servix AI." Phone shows the real chat. The question "Who can design a logo for a small bakery
in Lagos?" is already in the bubble at 17.91; the answer bubble grows in from 18.6 to 21.3 s (real answer with
Tunde Bakare and Chiamaka Eze, prices ₦120,000 / ₦180,000). Sub-caption at 20.4 s: "Answers from real Servix
data. Never moves your money." (the app's own disclaimer wording).
Sequential/interaction: typed question (keyboard ticks), streaming answer.
Audio intent: intelligence, lightness. Transition: dip → Scene 6

### Scene 6 — Outro — 2.9s (22.65–25.55)
Monogram + SERVIX wordmark lock-up at 22.65 (bell). "Find your professional today." at 23.2. `www.servix.name.ng`
at 23.8 in coral-underlined ivory. Music fades out over the last 1.2 s.
Sequential/interaction: three-step text reveal.
Audio intent: resolve.

**Music mood for this video:** upbeat but understated.
**Audio summary:** a warm bed from frame 0, two soft hits for the hook, card slides for the profiles, one
click and one soft impact for the booking, keyboard ticks for the AI question, a single bell on the final
logo, then a clean fade.
