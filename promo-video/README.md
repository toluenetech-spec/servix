# Servix launch video (promo-video/)

Everything for the launch video lives in this directory. Nothing here is used by the Servix app.

| File | What it is |
| --- | --- |
| `servix-launch-vertical.mp4` | **Primary deliverable** — 1080×1920, 30 fps, 25.6 s, H.264 + AAC (TikTok / Reels / Shorts) |
| `servix-launch-landscape.mp4` | 1920×1080 version of the same timeline (YouTube, decks, website) |
| `servix-launch-vertical-poster.jpg`, `servix-launch-landscape-poster.jpg` | Poster/thumbnail frames (also baked in as frame 0 of each MP4) |
| `share-copy.txt` | Caption for social posts |
| `brag-plan.md` | Storyboard + production plan (angle, hook, scene timings, audio direction, honesty notes) |
| `composition-brief.md` | Composition brief handed to the Hyperframes build |
| `composition/` | Hyperframes source — `build.mjs` generates `index.html`; `assets/` holds screenshots, brand files, font, music, SFX |
| `composition-landscape/` | Generated landscape variant (same template, different layout) |
| `work/` | Capture scripts and raw screenshots (`shots/`), the local AI stand-in used only for filming, music cue data |
| `REPORT.md` | What was done, how it was verified, and the limitations |

## Re-rendering

```bash
cd promo-video/composition
node build.mjs                      # regenerates both index.html files
npx hyperframes check .             # validation (0 errors expected)
npx hyperframes render . --output ../servix-launch-vertical.mp4
cd ../composition-landscape && npx hyperframes render . --output ../servix-launch-landscape.mp4
```

Requires Node 20+, `hyperframes`, a Chromium build and ffmpeg (see REPORT.md → Toolchain).
To swap the music, replace the file in `composition/assets/music/` and update the `<audio id="music">` src in `build.mjs`.
