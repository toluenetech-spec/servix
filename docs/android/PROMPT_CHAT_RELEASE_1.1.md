# Servix Android — Release 1.1 "Chats": information-architecture cleanup + live chat parity with the web

You are continuing work on `toluenetech-spec/servix-android` (Kotlin, Jetpack Compose, package `ng.name.servix.app`,
minSdk 26, target 36). The app is a client of the LIVE Servix API only — `https://api.servix.name.ng/api/v1/`
(header `X-Servix-Client: ng.name.servix.app`). The web product just shipped a WhatsApp-grade chat; this release
brings the app to the same level and tidies up what the app shows.

## Standing rules (unchanged — cite them in every report)

- Use the installed skills and **quote the specific rule you applied** in each report: Emil Kowalski Design Skills,
  Impeccable Design Skills, UI UX Pro Max, Anthropic Frontend Design, Visual App Skills, Android Testing Skills,
  Superpowers, Vercel Agent Skills.
- Honest reporting: say exactly what is built, what is tested, what is not. Never claim a feature works on the
  live API unless you exercised it. You cannot reach the live API or download artifacts from your sandbox — say so
  when it limits verification, and lean on unit/UI tests, screenshots from the Compose preview/emulator pipeline
  you already use, and the GitHub Actions build.
- Never upload to Google Play. The owner uploads the .aab by hand. Never touch the `servix` web repo.
- Work on your branch, open a PR to `main` for the owner to merge. **Stop and wait for "go" between stages.**
- Brand: Deep Forest `#12372A`, Forest Green `#1F5C45`, Warm Ivory `#F7F4EC`, Soft Sand `#EDE8DC`, Coral `#E56B5D`,
  Charcoal `#202622`, Muted Gray `#68716B`; Inter; radii 16/24/12; no gradients; app must not look like a website.
- Every API field you use must exist in the OpenAPI document `https://api.servix.name.ng/api/v1/docs/json` or in the
  spec files below. Read the specs from the web repo with
  `gh api "repos/toluenetech-spec/servix/contents/<path>?ref=arena/01a0dc4c-servix" -H "Accept: application/vnd.github.raw"`:
  `api/docs/CHAT.md` (chat — authoritative), `api/docs/MARKETPLACE_REQUESTS.md`, `api/docs/PROPOSALS.md`,
  `api/docs/NATIVE_CLIENTS.md`, and the live web implementation for behaviour reference:
  `src/pages/dashboard/MessagesPage.jsx`, `src/components/chat/*`, `src/lib/chatApi.js`, `src/lib/chatRealtime.js`.
  Do not invent fields.
- Version rule: `versionName 1.1.0`, `versionCode` = highest code ever uploaded to Play + 1 (currently ≥ 101; check
  `docs/play/RELEASE_CHECKLIST.md` and the last merged bump). Updates must install over the old version.
- If "Bug fix pass 1.0.1" (profile pictures not loading) is not yet merged into `main`, fold it into Stage 0.

---

## Stage 0 — Information-architecture audit and cleanup (design first, owner approves before code)

The owner's feedback: *"not everything on the web is in the app, and what is in the app is not well arranged —
some things are shown that aren't needed, and things that are needed are missing."*

Deliverable: `docs/ia/IA_AUDIT.md` + updated prototype screenshots, **no feature code yet**.

1. Inventory every screen and every item on it (tabs, cards, rows, buttons, menu entries, text blocks). Build a
   table: `Screen · Item · Who sees it today · Keep / Move / Remove / Add · Why`.
2. Apply these rules:
   - Show only what the signed-in person can act on. **Customer** and **Professional** see different Home and
     Account content (role from `GET /me`). Guests see Home (browse), Explore and Sign in only.
   - Feature-flagged areas (`GET /features` → `community`, `requests`, `ai`, …) are hidden when the flag is false —
     no empty tabs, no "coming soon" rows.
   - Remove explanatory text that only exists because the web has it; remove duplicate entry points (e.g. two
     ways to reach Notifications); remove "manage on the website" rows where the app can do the job itself; keep a
     single "Legal" row that opens Terms and Privacy.
   - Add what the web has and the app lacks: **Chats** (this release), **My network** (connections),
     **Requests / job board** (customers post, professionals browse and send proposals), saved professionals,
     payments history read-only (link rows are fine), Servix AI inside Chats.
3. New bottom bar (5 items, Chats in the centre, visually the strongest item):
   `Home · Explore · 💬 Chats · Bookings · Account`.
   - Chats gets an unread badge (sum of `unreadCount` across threads; refreshed from the event stream).
   - Servix AI leaves the bottom bar and becomes the **pinned first row inside Chats** (plus a small Home shortcut
     card). Notifications stay behind the bell in the top bar.
   - Professionals additionally get **Requests** and **Network** as cards on Home and rows in Account; customers get
     **Post a request** and **My network**. Nothing role-irrelevant is rendered.
4. Produce before/after screenshots for Home (customer, professional, guest), Account (customer, professional),
   and the new bottom bar. Explain each removal in one line.

Stop. Wait for the owner's "go" on the audit.

## Stage 1 — Chats tab: thread list + text conversation at web parity

Spec: `api/docs/CHAT.md`. Only when `features.community` is true.

- `GET /community/threads` → list rows: avatar (initials fallback), name, title, preview (`lastMessage`, already
  humanised: "📷 Photo", "🎤 Voice note", "📄 name", "This message was deleted"), time, unread badge, online dot
  (`online`), my last message's tick state (`lastMessageSenderId == me` → rule below).
- Pinned first row **Servix AI** when `features.ai` is true (Stage 2 wires it).
- Conversation screen: `GET /community/threads/:id/messages[?before=<cursor>]` with pull-to-load-older; bubbles mine
  right / theirs left, grouped by sender within 3 minutes, day separators, link detection, 📍 location messages
  rendered as a map link, Enter/Send button; optimistic send with `clientId` (UUID) and retry on failure;
  `POST …/read` and `POST …/delivered` when the thread is open; typing (`POST …/typing {typing}` throttled to one
  call per 2.5 s, cleared on send/blur/3 s idle).
- Ticks for my messages: `otherReadAt >= createdAt` → ✓✓ blue; else `otherDeliveredAt >= createdAt` → ✓✓ grey;
  else ✓. Pending → clock; failed → red ! with "Tap to retry".
- Realtime: `GET /community/events` (SSE, long-lived OkHttp GET; parse `event:`/`data:` lines; frames
  `hello | message | message_update | typing | read | delivered | presence | connection | thread`; `: ping` every
  15 s). Reconnect with backoff; while not connected poll threads every 15 s. One stream per app session, opened
  while the app is in the foreground only. Upsert messages by `id` (`message_update` carries the full message).
- Presence line under the name: "typing…" > "Online" > "Last seen <relative>" > service title / "Connection".
- Header tap → **Contact card** bottom sheet: big avatar, name, title, online/last seen, "View full profile"
  (professionals), booking link if `bookingId`, photos / files / links shared in this thread (from loaded messages),
  Block (`POST …/block`) and Report.
- Start a chat: from a booking (`POST /community/threads {bookingId}`) and from an accepted connection
  (`{connectionId}`) — buttons on Booking detail and Network.
- Tests: ViewModel unit tests for tick rule, merge/upsert by id, optimistic → saved replacement, SSE frame parser
  (hello, message, message_update, ping), reconnect/backoff. Compose UI test for list row + bubble states.

Stop. Report with screenshots. Wait for "go".

## Stage 2 — Media, replies, reactions, delete, voice notes, Servix AI thread

Upload path (same as every Servix upload): `POST /uploads?kind=<kind>&fileName=<name>` with the raw bytes as the
body and the file's `Content-Type` → `201 { url, key, kind, fileName, contentType, size }`. Then
`POST /community/threads/:id/messages { clientId, body?, attachment: { key, name, mime, size, durationMs?, width?,
height? }, replyToId? }`. A message needs a body or an attachment. Kinds and limits:
`chat-image` JPEG/PNG/WebP/GIF ≤10 MB · `chat-audio` audio/mp4, audio/aac, audio/x-m4a, audio/webm, audio/ogg,
audio/mpeg, audio/wav ≤10 MB · `chat-file` PDF/DOC/DOCX/XLS/XLSX/PPT/PPTX/TXT/CSV ≤20 MB. 40 uploads / 10 min.

- **Photos:** Android Photo Picker (`PickVisualMedia`), downsize to max edge 1600 px JPEG q≈0.86 before upload,
  send `width/height`; bubble shows the image with an upload progress ring; tap → full-screen viewer with share/save.
  Camera capture via `TakePicture` as a second option in the "+" sheet.
- **Documents:** `OpenDocument` with the allowed MIME list; file bubble = type badge, name, size, download/open.
- **Voice notes:** mic button replaces Send when the box is empty. Tap to start (RECORD_AUDIO permission with a
  plain-language rationale), live timer + level meter, tap ✓ to send / 🗑 to cancel, max 5 min, ignore < 0.7 s.
  Record with `MediaRecorder` → AAC in MP4 container (`audio/mp4`, extension `.m4a`), send `durationMs`.
  Player bubble: play/pause, waveform-style progress, duration, 1×/1.5×/2× speed; only one note plays at a time.
- **Reply:** long-press → sheet → Reply shows a quote bar above the composer; sent with `replyToId`; quoted block in
  the bubble; tap the quote to scroll to the original and flash it.
- **Reactions:** long-press sheet shows 👍 ❤️ 😂 😮 😢 🙏 🔥 ✅ → `POST …/messages/:mid/react {emoji}` (toggle);
  chips under the bubble, mine highlighted; updates arrive as `message_update`.
- **Delete for everyone:** sender only, confirm, `DELETE …/messages/:mid`; tombstone "This message was deleted".
- **Copy text**, **Download/Share file** in the same sheet.
- **Servix AI pinned thread:** same bubble UI; `POST /ai/assistant/stream` (SSE `data: {type:start|delta|done|error}`),
  streamed into one assistant bubble, Stop button, history kept locally per user (last 40), starter chips, Clear.
  The assistant is read-only; show the same one-line disclaimer as the web ("Servix AI is read-only…").
- Errors: show the API `error.message` under the failed bubble next to "Tap to retry" (e.g. "Unsupported file
  type", "File uploads are not available right now").
- Tests: downsizing (dimensions/size), MIME detection by extension when the picker gives no type, recorder state
  machine, reaction toggle optimistic update, delete tombstone rendering.

Stop. Report with screenshots (thread list, text chat, photo, voice note recording + playback, reply, reaction sheet,
contact card, AI thread). Wait for "go".

## Stage 3 — My network and Requests (job board)

Only when the respective flag is true (`features.community`, `features.requests`).

- **Network:** `GET /community/connections` (list with status), send request from a professional profile
  `POST /community/connections {profileSlug}`, incoming requests with Accept/Decline
  (`POST /community/connections/:id/action {action: accept|decline|remove|block|unblock}`), "Message" button on
  accepted connections → opens/creates the thread.
- **Requests (customer):** list `GET /requests`, create `POST /requests` (title, description, category, budget
  fixed/range, location/remote, deadline — fields exactly as in `MARKETPLACE_REQUESTS.md`), detail
  `GET /requests/:id`, publish/pause/close/cancel, proposals list `GET /requests/:id/proposals`, accept/reject.
- **Requests (professional):** browse `GET /requests/browse` with filters/sort (`newest|deadline|budget-high|
  budget-low`), detail `GET /requests/browse/:id`, send proposal `POST /requests/:id/proposals`, my proposals
  `GET /proposals/mine`, withdraw. Avoid the word "escrow": say "pay through Servix; released to the professional
  after you confirm the work".
- Tests: ViewModel tests for each list/action with fake API; screenshot each screen.

Stop. Wait for "go".

## Stage 4 — Release 1.1.0

- Bump `versionName 1.1.0`, `versionCode` per the rule above. Update `docs/play/LISTING.md` "What's new",
  regenerate the 8 phone screenshots including the new Chats screens (≤ 2:1 aspect, 320–3840 px), update
  `docs/play/RELEASE_CHECKLIST.md` (RECORD_AUDIO permission declaration: "voice notes in chat"; data-safety:
  photos/files/audio the user chooses to send are uploaded to Servix storage; location only when the user taps
  "Share my location").
- CI builds the signed .aab via the existing release workflow; post the Release link and the exact file name.
- Final report: features table (built / unit-tested / UI-tested / not verified live), known gaps, and the
  click-path for the owner's manual test on a phone: sign in → Chats → open a thread → send text, photo, voice
  note → long-press → react/reply/delete → tap header → contact card → Servix AI row.

Open the PR to `main` and stop. The owner merges and uploads to Play.
