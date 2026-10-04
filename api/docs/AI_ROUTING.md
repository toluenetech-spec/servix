# Servix AI — model routing layer

Status: **implemented, flag-gated, OFF by default** (`AI_ENABLED`). Added 2026-10-03 after the
Dahl evaluation (`docs/ai-eval/DAHL_EVALUATION_REPORT.md`). No existing Servix feature was
changed; the layer is additive (`api/src/ai/*`, `api/src/routes/ai.ts`) and needs no migration.

## Model assignments (configuration, not code)

| Department | Primary | Fallback chain | Endpoint |
| --- | --- | --- | --- |
| `assistant` — AI Concierge | DeepSeek V4 Flash | → GLM 5.3 Flash | `POST /api/v1/ai/assistant` |
| `search_intent` — natural-language search | DeepSeek | → GLM | `POST /api/v1/ai/search/intent` |
| `job_matching` | DeepSeek | → GLM | `POST /api/v1/ai/opportunities/match` (pro) |
| `opportunity_radar` | DeepSeek | → GLM | `POST /api/v1/ai/opportunities/radar` (pro) |
| `profile_analysis` — CV/profile analysis | DeepSeek | → GLM | `POST /api/v1/ai/profile/analysis` (pro) |
| `profile_improvement` | DeepSeek | → GLM | `POST /api/v1/ai/profile/improve` (pro) |
| `pricing_guidance` | DeepSeek | → GLM | `POST /api/v1/ai/pricing/guidance` |
| `project_health` | DeepSeek | → GLM | `POST /api/v1/ai/bookings/:id/health` (party only) |
| `explanations` — "what does this mean?" | DeepSeek | → GLM | `POST /api/v1/ai/explain` |
| `proposal_generation` | **MiniMax M2.7** | → DeepSeek → GLM | `POST /api/v1/ai/proposals/draft` (pro) |
| `background_drafting` | **MiniMax M2.7** | → DeepSeek → GLM | `POST /api/v1/ai/drafts` |

Aliases → provider ids live in `api/src/ai/config.ts` and are overridable by environment
(`AI_MODEL_DEEPSEEK`, `AI_MODEL_MINIMAX`, `AI_MODEL_GLM`, `AI_ROUTE_<DEPARTMENT>=alias,alias`).
Defaults are the live Dahl ids from `GET https://inference.dahl.global/v1/models`.
Admins can read the effective routing (no secrets) at `GET /api/v1/admin/ai/status`.

## Architecture

```
routes/ai.ts  ──►  ai/departments.ts  ──►  ai/router.ts  ──►  ai/provider.ts  ──►  provider HTTP
 (auth, rate     (prompt, allowed tools,    (chain, bounded     (OpenAI-compatible;
  limit, input    strict schema +            retries, repair,    key only in header,
  validation)     normalisation)             tool loop,          scrubbed from errors)
                        │                    telemetry)
                        ▼
                  ai/tools.ts  — READ-ONLY tools over real rows (same code as the public API)
                  ai/normalize.ts — categories, dates, naira, enums, known ids
                  ai/telemetry.ts — in-memory ring buffer + structured log lines
```

- **Provider-agnostic.** One `AiProvider` interface; today one implementation (`OpenAICompatibleProvider`).
  Swapping Dahl for NVIDIA/OpenAI/OpenRouter is `AI_BASE_URL` + `AI_API_KEY` + model ids.
- **Controlled fallback.** Per model: 1 try + at most `AI_MAX_ATTEMPTS_PER_MODEL-1` retries on transient
  errors (429 capacity, 5xx, timeout, network) with short back-off; 400/401 skip the model at once.
  Invalid structured output gets ONE repair round (validator feedback) on the same model, then the next
  model. A wall-clock deadline (`AI_TASK_TIMEOUT_MS`) covers the whole task. Exhausted → `503 AI_UNAVAILABLE`,
  `502 AI_INVALID_OUTPUT` or `504 AI_TIMEOUT`. Nothing retries forever.
- **Structured output.** Every structured department parses the JSON, normalises backend-controlled
  values (category → real slug or null; bare date → ISO datetime; "₦150,000"/"50k" → integer; enums;
  request/gig ids → only ones the backend supplied), then validates with the SAME zod schemas the real
  endpoints use (`requestBody`, `proposalBody`, `professionalQuerySchema`). The model cannot invent ids,
  categories, prices outside real stats, or professionals.
- **Business logic stays in the backend.** Project-health status is derived from timestamps in code;
  the model only explains it. Price ranges are clamped into real Servix min/max or forced to
  "Not enough Servix data yet" (< 5 gigs). Completeness scores stay within ±10 of the backend count.
  Empty marketplaces short-circuit without calling a model.
- **Fast path (0.8.2).** Two latency measures, both configuration:
  - *Hedged fallback* — `AI_HEDGE_AFTER_MS` (default 6000): if the current model has produced nothing after
    the window, the next model in the chain starts in parallel. The first model to stream visible text or return
    a valid result wins; the others are aborted (`AbortSignal`), never recorded as failures. A failing model hands
    over immediately. Once a model has streamed text to the client it cannot be replaced (a mid-answer failure is
    a controlled error, never two answers stitched together). `0` disables hedging (strictly sequential chain).
  - *Streaming* — text departments (assistant, explanations) are available as server-sent events:
    `POST /ai/assistant/stream`, `POST /ai/explain/stream` emit `data: {"type":"start"|"delta"|"done"|"error"}`.
    The provider is asked for `stream:true`; `ThinkFilter` suppresses `<think>…</think>` reasoning even when the
    tags are split across chunks; tool-call fragments and usage are reassembled from the stream. A closed browser
    tab aborts every in-flight provider call. Non-streaming endpoints are unchanged.
  - `AI_EXTRA_BODY_JSON` merges provider-specific fields into every request body (e.g. disabling a model's
    thinking mode) without a code change; only key names are reported in `/admin/ai/status`.
- **Drafts only.** No department writes to the database. Drafts return to the client, which submits
  them through the normal validated endpoints (`POST /requests`, `POST /requests/:id/proposals`).

## Security boundaries

- The API key is read from `AI_API_KEY` on the server, sent only as `Authorization: Bearer`, scrubbed
  from any upstream error text, never serialised to the frontend or the admin status endpoint, and never
  logged (telemetry logs carry model/department/duration/tokens/error code only — no prompts, no user ids).
- **Payments are unreachable.** The AI layer has no tool for bookings, payments, payouts, ledger, refunds,
  wallets, KYC decisions or admin actions, imports none of those modules, and performs no Prisma writes.
  `tests/ai-router.test.ts` enforces this statically on every run. Booking timelines shown to the model
  exclude amounts, payment references and payout data. The model may *explain* how payments work
  (`SERVIX_FACTS`) but cannot act.
- Tools are allow-listed per department and audience-checked per caller (pro-only tools refuse customers).
  Caller role and profile come from the database, never from the JWT.
- All user/listing text reaches the model inside `UNTRUSTED_DATA` markers (prompt-injection hygiene,
  validated in the Dahl evaluation).
- Rate limit: 20 requests/minute per IP per AI route; body limit 512 KB (global).

## Admin read access (2026-10-04)

Platform admins asked Servix AI to "see everything except payments". `src/ai/adminTools.ts` adds eight **read-only**
tools that `buildToolRunner` exposes only when the caller's role (re-read from the database) is `admin`:
`admin_overview`, `admin_list_gigs` (who created which gig, when, owner email, identity status, what still blocks
publishing), `admin_list_users`, `admin_list_applications`, `admin_list_identity_checks` (status only — never ID numbers or
documents), `admin_list_bookings` (status only — no amounts), `admin_list_requests`, `admin_recent_activity` (audit log).
Time filters accept `today` / `yesterday` / `7d` / ISO dates on the Lagos calendar (`src/ai/since.ts`).

The assistant's system prompt gains `ADMIN_BRIEF` for admins: always call a tool before answering operational questions,
never claim to lack access, **never act** (approve/reject/publish/suspend/pay/message) — instead point to the exact admin
console screen — and never touch payments, payouts, ledger, refunds or wallets. Customers and professionals never see
admin tools; a forged `admin_*` call from them returns `tool "…" is not available here`. Covered by
`tests/ai-local.test.ts` ("admin assistant …").

## Capacity errors and the backup provider (2026-10-04)

Dahl's free (gift-token) tier answers `429 {"code":"model_concurrency"}` — *"Signed-in and paid accounts are admitted
first"* — whenever the shared free capacity is busy; every call fails in ~0.1 s, and both Dahl models usually fail
together because they share the same account priority. Mitigations now in place:

1. **Retries**: `AI_MAX_ATTEMPTS_PER_MODEL` default 3 with `AI_RETRY_BACKOFF_MS` 2000 (2 s, 4 s … + jitter) per model.
2. **Independent backup provider**: set `AI_BACKUP_API_KEY` (and optionally `AI_BACKUP_BASE_URL`, default NVIDIA
   `https://integrate.api.nvidia.com/v1`, and `AI_BACKUP_MODEL`, default `meta/llama-3.3-70b-instruct`). The alias
   `backup` is appended to every chain, served by `FailoverProvider` on its own host and key — keys never cross hosts.
   It is only reached after every Dahl model failed, so Dahl stays primary and the agreed routing is unchanged.
3. **Provider check**: `GET /admin/ai/provider-check` (button in Model health) verifies, per host, reachability, whether
   the key is accepted, whether the configured model ids are in the host's catalogue, and on Dahl the key's remaining
   token allocation — the three things that explain almost every "busy" report.

## Answer feedback (2026-10-04)

Every assistant answer carries **Copy** and **Helpful? 👍/👎**. The write lives in `src/routes/aiFeedback.ts`, *outside*
the AI layer (which still never writes to the database — see the static guard in `tests/ai-router.test.ts`).

- `POST /api/v1/ai/feedback` `{ rating:'up'|'down', department?, comment?≤500, prompt?, answer?, modelAlias? }` — signed-in,
  30/min. **A 👍 stores only rating/department/model.** A 👎 stores the comment, the question and the answer; the chat shows
  the user "Your question and this answer will be shared with the Servix team" before they send it.
- `GET /api/v1/admin/ai/feedback?days=30&rating=down|up|all&page=&pageSize=` — `totals {up,down,rated,satisfaction%}`,
  `daily [{date,up,down}]` (zeros filled), `byDepartment`, and `items` with `user {id,name,email,role}`, `prompt`, `answer`,
  `comment`, `modelAlias`, `createdAt`. Rendered in **Admin → AI usage → Satisfaction** (chart + "Not satisfied" list).
- Table `ai_feedback` — migration `prisma/migrations/20261004120000_ai_feedback`, manual script `docs/manual-ai-feedback.sql`.
  It is an *optional* migration: while missing, only these two endpoints answer `503 SCHEMA_PENDING`; `/readyz` stays
  `ready:true` and reports it under `optionalPending` (`src/lib/schemaCheck.ts` → `OPTIONAL_TABLES`).
- Tests: `tests/ai-feedback-local.test.ts` (`RUN_LOCAL_AI_TESTS=1`): privacy rule (no text on 👍), admin summary, and the
  503-not-500 behaviour when the table is absent.

## Telemetry

**Model health (admin console)** — `Admin → AI usage → Model health` reads `/admin/ai/status` (per-model calls, ok,
failed, average latency, last error code + scrubbed provider reason, since process start) and
`/admin/ai/telemetry/recent` (last failed attempts with department, tool-call count and reason). Use it first when users
report "Servix AI is busy": `rate_limited … model_concurrency` = provider per-account concurrency cap;
`bad_request … model` = catalogue id retired/renamed (fix with `AI_MODEL_*` env); `auth` = key; `unavailable` = provider
5xx; `timeout` = raise `AI_CALL_TIMEOUT_MS`. Hedging never starts a sibling while the primary is mid tool-loop.


`AiTelemetry` records every attempt (department, alias, model id, duration, ok, fallback index,
attempt number, tokens, error code, tool calls) and every task (model used, fallback used, attempts).
Bounded ring buffer (1000). Read with `GET /api/v1/admin/ai/status` (aggregates) and
`GET /api/v1/admin/ai/telemetry/recent`. Mirrored to the structured logger as `ai.kind=attempt|task`.
Persisting to a table is a possible follow-up (additive migration) — not needed for operation.

## Known provider behaviour (from the evaluation)

Dahl's free/gift tier rejects a share of requests with `429 model_concurrency` ("paid accounts admitted
first"); GLM 5.3 Flash was unavailable for an entire run. The chain tolerates this, but the layer must not
be assumed production-grade on Dahl's free tier; `AI_BASE_URL` can point elsewhere without code changes.

## Turning it on (manual)

1. On the API host (Railway → Variables): `AI_ENABLED=true`, `AI_API_KEY=<key>`, optionally model ids.
2. Restart; `GET /api/v1/features` shows `ai: true`; `GET /api/v1/admin/ai/status` shows the routing.
3. The frontend follows the flag automatically (see below). Optional tuning: `AI_HEDGE_AFTER_MS`, `AI_EXTRA_BODY_JSON`.

## Tests

- `tests/ai-router.test.ts` (unit, no DB): routing table, overrides, fallback flows (DeepSeek→GLM,
  MiniMax→DeepSeek), bounded retries, repair round, deadline, tool loop + UNTRUSTED wrapping, key
  scrubbing, status classification, think-stripping, telemetry hygiene, normalisers, static payment isolation,
  hedged fallback (slow primary → next model wins, cancelled primary, no hedge inside the window, `0` = off),
  streaming deltas from the winning model only, client abort cancels every call, `ThinkFilter` across split
  chunks, SSE assembly in the provider (deltas, tool-call fragments, usage), `AI_EXTRA_BODY_JSON` parsing.
- `tests/ai-local.test.ts` (opt-in, embedded PostgreSQL + real app, scripted provider):
  `RUN_LOCAL_AI_TESTS=1 npx vitest run tests/ai-local.test.ts` — flag gating, every department endpoint,
  audience checks, fallback via HTTP + telemetry, invalid JSON → 502, category/date normalisation accepted
  by the real `POST /requests`, over-budget/invented-gig handling, project-health derivation, strangers → 404,
  streamed explain over HTTP (SSE deltas, final `done` event, in-band `error` event, CORS header preserved, 401).

## Frontend (follows the flag)

`src/lib/useFeatures.js` reads `ai` from `GET /api/v1/features`; every AI component returns `null` while it is
false, so a disabled instance shows no AI UI at all. Client: `src/lib/aiApi.js` (POST only, abortable, 75 s cap);
pure mappers, error copy and a safe light-Markdown parser (bold/italic/code/lists → React elements, never HTML)
in `src/lib/aiHelpers.js`. The assistant and “What does this mean?” read the streamed endpoints and render words as
they arrive (falling back to the plain endpoints if the stream is unavailable). Surfaces: smart search (`/professionals`), assistant
launcher (workspace shell) and hub (`/dashboard/ai`), request-brief assist (request editor), proposal draft
(proposal page), text drafts (gig editor, profile About), booking explain + project health (booking page).
The browser never submits anything on the AI's behalf: drafts are placed in the ordinary forms and go through
the usual validated endpoints when the user saves/sends.
