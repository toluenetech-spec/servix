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

## Telemetry

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
3. Nothing in the frontend calls these endpoints yet — UI integration is a separate, later step.

## Tests

- `tests/ai-router.test.ts` (unit, no DB): routing table, overrides, fallback flows (DeepSeek→GLM,
  MiniMax→DeepSeek), bounded retries, repair round, deadline, tool loop + UNTRUSTED wrapping, key
  scrubbing, status classification, think-stripping, telemetry hygiene, normalisers, static payment isolation.
- `tests/ai-local.test.ts` (opt-in, embedded PostgreSQL + real app, scripted provider):
  `RUN_LOCAL_AI_TESTS=1 npx vitest run tests/ai-local.test.ts` — flag gating, every department endpoint,
  audience checks, fallback via HTTP + telemetry, invalid JSON → 502, category/date normalisation accepted
  by the real `POST /requests`, over-budget/invented-gig handling, project-health derivation, strangers → 404.
