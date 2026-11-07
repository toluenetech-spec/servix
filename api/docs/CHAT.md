# Live chat (Messages)

Private 1:1 messaging between booking participants or accepted connections. Everything lives behind
`COMMUNITY_ENABLED=true` and the existing `chat_threads` / `chat_messages` tables — this document covers the
real-time layer added in API 0.9.6.

## Transport

`GET /api/v1/community/events` — server-sent events over a normal authenticated request (`Authorization: Bearer`).
Response is `text/event-stream`; every frame is `data: <json>\n\n`; `: ping` comments every 15 s keep proxies happy.
A single API process fans events out in memory (`src/lib/chatEvents.ts`) — no Redis, no extra service. If the API
ever runs as several instances, presence/typing would need a shared bus; messages and watermarks are always
persisted, so clients that reconnect or poll never lose data.

Limits: 6 open streams per account (`429 TOO_MANY_STREAMS`), `503 COMMUNITY_DISABLED` when the flag is off.

Events:

| type | payload | when |
|---|---|---|
| `hello` | `online: userId[]`, `lastSeen: {userId: iso}` | first frame, chat partners only |
| `message` | `threadId`, `message{id,body,senderId,createdAt,clientId}` | both participants, on send |
| `typing` | `threadId`, `userId`, `typing` | the other participant, on `POST …/typing` |
| `read` | `threadId`, `userId`, `at` | the other participant, on `POST …/read` |
| `delivered` | `threadId`, `userId`, `at` | the other participant, on `POST …/delivered` (only when the columns exist) |
| `presence` | `userId`, `online`, `lastSeen` | chat partners, when a user's first stream opens / last stream closes |
| `connection` | `connectionId`, `status` | connection requested / accepted / declined / removed / blocked |
| `thread` | `threadId` | a thread was opened for you |

Presence is ephemeral (process memory) and only visible to people you share a thread with.

## REST additions

- `POST /community/threads/:id/typing { typing: boolean }` → `{ ok }` (120/min).
- `POST /community/threads/:id/delivered` → `{ ok, at, supported }` (120/min). `supported:false` until the
  optional columns exist.
- `GET /community/threads` items also carry `lastMessageAt`, `lastMessageSenderId`, `lastMessageId`, `unreadCount`,
  `myReadAt`, `otherReadAt`, `otherDeliveredAt`, `online`, `lastSeenAt`, `updatedAt`.
- `GET /community/threads/:id/messages` also returns `myReadAt`, `otherReadAt`, `otherDeliveredAt`, `online`,
  `lastSeenAt`, `otherUserId`; each message has `clientId`.

Tick rule for your own message: `otherReadAt >= createdAt` → seen (✓✓ blue); else `otherDeliveredAt >= createdAt`
→ delivered (✓✓ grey); else sent (✓).

## Optional migration

`prisma/migrations/20261107000000_chat_delivery/migration.sql` adds `chat_threads.delivered_at_a` and
`delivered_at_b` (`ADD COLUMN IF NOT EXISTS`). It is not referenced by the Prisma schema; the API probes
`information_schema` once a minute and simply skips the delivered watermark while the columns are missing.
Apply by pasting `docs/manual-chat-upgrade.sql` into the Neon SQL editor. `/readyz` reports the pending column under
`optionalPending` until then.

## Web client

`src/lib/chatRealtime.js` opens the stream with `authorizedFetch` (token refresh included), reconnects with backoff
and reports `connecting | live | reconnecting | unavailable`. `src/pages/dashboard/MessagesPage.jsx` polls every
15 s only while the stream is not live. Typing is throttled to one call per 2.5 s and cleared on send/blur/idle.
Opening or receiving a message in the open thread calls `/read` + `/delivered`; messages for other threads call
`/delivered` only. "Share my location" sends `📍 My location: https://maps.google.com/?q=<lat>,<lng>` as plain
text, which every client (including the Android app) can render as a link.

## Native clients

Android can consume the same endpoint with OkHttp (long-lived GET, parse `data:` lines) and the same REST calls;
nothing is web-specific.

## Tests

`RUN_LOCAL_COMMUNITY_TESTS=1 npx vitest run tests/community-local.test.ts` — includes a real HTTP stream test
(hello frame, then a live `message` frame) and the typing/delivered/read fan-out test.
