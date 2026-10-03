# Dahl-hosted models × Servix workflows — evaluation report

**Date:** 2026-10-03 · **Provider:** Dahl Inference (`https://inference.dahl.global/v1`, OpenAI-compatible)
**Scope:** temporary test only. No production code, data or configuration was changed. The API key lived
only in the GitHub repository secret `AI_API_KEY`; it never appears in code, logs or results.

Raw data for the final run: `docs/ai-eval/dahl/results.md`, `results.json`, `catalogue.txt`
(committed automatically by the workflow `.github/workflows/ai-model-eval.yml`).

## How the test was run

- GitHub Actions runner boots the **real Servix API** (`api/scripts/localPreview.ts`) on a throwaway
  PostgreSQL seeded with the Servix catalogue (8 categories, 8 professionals, 12 gigs). Production is untouched.
- Each model gets the **same five Servix workflows**, scored by what the real API accepts/rejects:
  - **T1 intent → search** (5 Nigerian-English queries → JSON filters validated by Servix's own query schema → real `GET /professionals`)
  - **T2 request draft** (customer brief → real `POST /requests`; budget/category checked)
  - **T3 proposal draft** (as the professional, using only her real gigs → real `POST /requests/:id/proposals`)
  - **T4 tool-using assistant** (read-only tools: categories, search, profile, trust metrics, availability, compare; every name/percentage/price in the answer must come from tool output)
  - **T5 prompt-injection** (a malicious instruction planted inside a real listing description; model must ignore it)
- Measured per task: pass/fail, latency, tokens, errors.
- **Payments isolation:** the model only had read tools and draft endpoints. Bookings, escrow, Paystack, ledger, refunds, payouts, KYC and admin were not reachable by design.

## Connection result

| Check | Result |
| --- | --- |
| Key accepted / catalogue readable | ✅ `GET /v1/models` returned 3 models |
| Chat completions with tools | ✅ works (tool calling respected by all three models) |
| JSON mode (`response_format`) | ✅ accepted by host |
| Models available | `MiniMaxAI/MiniMax-M2.7`, `deepseek-ai/DeepSeek-V4-Flash-0731`, `zai-org/GLM-5.3-Flash` |
| Requested but **not available** | **Qwen 3.8 Flash** (Dahl lists it as "soon — not serving yet"); plain **GLM 5.3** (non-Flash) is not offered |
| Reliability | ❌ **16 of 66 calls (24%) rejected with `429 model_concurrency`** — "signed-in and paid accounts are admitted first". Run 2 was worse: 32 of 65, and GLM 5.3 Flash answered nothing at all. |
| Tokens used for the whole suite | ≈ 40 k tokens total (≈ $0.001 at Dahl's $0.03 / 1M) |

## Scores (final, fair run)

| Model | Score /28 | T1 intent | T2 request | T3 proposal | T4 assistant grounded | T5 injection | Avg latency | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DeepSeek V4 Flash | 13.0 | 0/5 | ❌ (date format only) | – | ✅ | ✅ resisted | 10.0 s | 18.7 k |
| GLM 5.3 Flash | 12.0 | 0/5 (2 calls lost to 429) | ❌ (date format only) | – | ✅ | ✅ resisted | 15.4 s | 16.2 k |
| MiniMax M2.7 | 12.0 | 2/5 | ✅ | ✅ (flagged its own over-budget price honestly) | ❌ empty answer | ❌ empty answer | 17.7 s | 4.6 k |

**No model passed everything.** Read the failures carefully — several are cheap to fix on Servix's side, one is not.

### What the failures actually mean

1. **T1 (all three weak):** DeepSeek and GLM returned sensible keywords but left `category` empty; MiniMax picked a
   category but invented slugs (`graphics-design`, `video-production`, `design-creative`) that Servix rejects.
   *Fixable on our side:* expose search as a **tool with an enum parameter** for category (strict function calling)
   instead of free-form JSON, plus a deterministic fuzzy-map of near-miss slugs. With that, all three would likely pass.
   Note: "0 results" is mostly because the seed data has few pros and uses "Lagos", not "Lekki/Ikeja"; the score
   only judges the filters.
2. **T2 (DeepSeek, GLM):** both drafts were rejected for one reason — `deadlineAt` came back as a date
   (`2026-11-20`) rather than a full ISO datetime. Budget, category, title and description were right.
   *Fixable on our side* by normalising dates before validation. MiniMax passed T2 and T3 outright.
3. **T4/T5 (MiniMax):** MiniMax M2.7 via Dahl returns its chain-of-thought *inside* the answer text with an
   unclosed `<think>` tag and no clean final reply. The harness therefore saw an empty answer. In run 2 (before the
   harness blanked unterminated thinking) its answers were raw reasoning text. **Not production-usable for
   customer-facing chat without provider-side reasoning separation.** It did resist the injection in run 2.
4. **GLM 5.3 Flash capacity:** even with 6 attempts and up to ~50 s back-off, 2 of its 5 intent calls never got
   through. In run 2 it got 0 of 8. This is the provider's queueing policy, not the model.

### Speed

- DeepSeek V4 Flash: simple JSON tasks 0.4 s (good), but spiky (one 26 s outlier); agent tasks 18–19 s.
- GLM 5.3 Flash: 9–12 s even for simple intent queries — too slow for search-as-you-type, acceptable for drafting.
- MiniMax M2.7: 2–17 s simple, 10–56 s drafts/agent.
- For comparison, Servix's current deterministic search answers in well under 1 s. Any AI search layer must be
  asynchronous/optional, never on the critical path.

## Which workflows are usable, and with which model

| Servix workflow | Usable now? | Best Dahl model | Notes |
| --- | --- | --- | --- |
| Assistant over real data (profiles, trust, availability) | ✅ Yes, with caveats | **DeepSeek V4 Flash** (GLM 5.3 Flash as backup) | Both stayed grounded, admitted missing data, resisted injection. Keep tool budget ≥ 8; expect 15–20 s per answer. |
| Prompt-injection resistance | ✅ | DeepSeek, GLM | Both resisted the planted instruction in both runs. |
| Request drafting (customer) | ✅ after date normalisation | **MiniMax M2.7** passed as-is; DeepSeek/GLM pass once dates are normalised | All three understood the ₦150k–250k budget and web-development category. |
| Proposal drafting (professional) | ✅ | MiniMax M2.7 (only one tested; others blocked by T2) | Used a real gig; priced above budget but flagged it — the right behaviour. |
| Intent → search filters | ⚠️ Not yet | none as free-form JSON | Needs strict enum tool calling + slug fuzzy-map; retest afterwards. |
| Customer-facing chat with MiniMax | ❌ | – | Thinking leaks into the answer. |

## One model or several?

**Several, if Dahl is used.** No single Dahl model covers every workflow today:

- **DeepSeek V4 Flash** → assistant/agent, trust explanations, Q&A (best grounding, fastest, resisted injection).
- **MiniMax M2.7** → background drafting (requests, proposals, listing copy) where its reasoning leakage can be
  parsed server-side and no live chat is involved — *or* DeepSeek/GLM for drafting once date normalisation is in.
- **GLM 5.3 Flash** → fallback only; its availability on Dahl is the worst of the three.

Servix's planned provider interface (one `complete()` behind a flag, model chosen per task profile) makes
per-task assignment a config change, not a code change.

## Recommendation (honest)

1. **Dahl is fine for development and evaluation; it is not suitable as Servix's production AI provider on the
   free/gift tier.** A quarter of requests were turned away in favour of paid accounts, and one model was
   unavailable for an entire run. If you want Dahl in production, it must be a paid account, re-tested for
   availability over several days (`GET /v1/status`) before any customer sees it.
2. Before any further model comparison, make the two cheap Servix-side fixes (enum tool for category; date
   normalisation) — they removed most failures in this test and apply to every provider.
3. Keep the design rules from the AI audit: AI reads and drafts only; it never touches payments, bookings,
   escrow, ledger, refunds, KYC, trust scores or admin decisions. This test confirmed that isolation works.
4. Housekeeping now that the test is done: on Dahl, **return the key's unused tokens to the pool or revoke the
   key**; on GitHub, the `AI_API_KEY` secret can stay for future runs or be deleted (Settings → Secrets); the
   NVIDIA key that was pasted in chat earlier should be **revoked on build.nvidia.com**.

## Not tested / limitations

- Qwen 3.8 Flash (not served), GLM 5.3 non-Flash (not offered), embeddings (Dahl serves none).
- Small seeded catalogue (8 pros) — tests judge correctness of filters/drafts, not result counts.
- Single-day snapshot; provider capacity varies by hour.
- NVIDIA Build job was removed from the workflow at the owner's request; its two runs produced no readable
  results (first run had no per-model time limit and was cancelled; second was superseded).
