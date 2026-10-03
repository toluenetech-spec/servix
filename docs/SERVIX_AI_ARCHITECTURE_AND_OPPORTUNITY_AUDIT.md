# SERVIX AI ARCHITECTURE & OPPORTUNITY AUDIT

**Status:** audit only. Nothing in this document has been implemented. No code,
migrations, packages or deployments were changed to produce it.
**Repository inspected at:** branch `arena/01a0dc4c-servix`, commit `5515dd1`
(2026-10-02). Every statement about "what Servix does today" below was checked
against the source, not the brief.

---

## 1. Repository findings — what is actually implemented

The brief lists capabilities "where implemented". The table below is what the
code really contains. This matters because several AI ideas in the brief depend
on features that **do not exist yet**.

| Area | Real state in the repository |
| --- | --- |
| Accounts & security | Email + password, email OTP verification, Google/GitHub OAuth, TOTP MFA, passkeys, recovery codes, security flows (new device / sensitive action), refresh-token rotation, rate limits per route. Password policy is a live checklist (min 8). |
| Identity (KYC) | `kyc_verifications`: document + selfie upload to private R2, admin review, `requireKycVerified` guard on publishing gigs and payouts. |
| Professional applications | Multi-step application; `POST /applications/resume` runs **`api/src/lib/resumeParser.ts` — a 305-line heuristic (unpdf text extraction + headings/regex)**. It only pre-fills the form; it is **not AI**. Admin approves/rejects with audit. |
| Profiles | `professional_profiles` + `professional_skills` + `portfolio_items` (now with `booking_id` / `verified_at` for Verified Servix Projects), availability rules/exceptions, `details` JSON. |
| Services (gigs) | **One price per service** (`price`, `priceUnit`), `shortDescription`, `description`, `included`, `requirements` (≤15 structured questions), `searchTags` (≤5), `serviceType`, `deliveryDays`, `revisions`, media (images/PDF/one video), FAQs. **Service packages / tiers are NOT implemented** (owner rejected tiers; `PACKAGES_ENABLED` flag exists, no code). |
| Search & ranking | Prisma `contains` / `mode: 'insensitive'` over name/title/skills (professionals) and title/description/category (services). Sorts: `recommended` (= verification desc → rating → reviews), `rating`, `reviews`, `price-asc/desc`. **No relevance scoring, no full-text index, no synonyms, no embeddings.** New: `available=today|tomorrow|week` filter computed from real rules + bookings. |
| Comparison | `GET /compare` (≤4 professionals, real trust data, "Not enough data" when under sample). Live behind `COMPARE_ENABLED`. |
| Bookings | 10-state machine (`pending_payment → requested → accepted → in_progress → delivered → completed`, plus `declined/cancelled/disputed/refunded`), `booking_events` audit, `expected_delivery_at` snapshot at payment capture, `rebooked_from_id`, `proposal_id`. Auto-confirm job after `CONFIRM_WINDOW_DAYS`. |
| Payments & ledger | Paystack (TEST keys live), `payments`, `webhook_events` (idempotent), double-entry `ledger_entries` across 5 accounts (`provider_cash, customer_escrow, professional_payable, platform_revenue, refunds_paid`), `refundPolicy.ts` as single source of refund percentages (env-configurable), `PLATFORM_FEE_PCT`. Payouts `processing/paid/failed` with admin retry. |
| Disputes | Customer opens (`reason` ≥10 chars) → funds frozen → **admin resolves `release` or `refund`** (`/admin/bookings/:id/resolve`, audited, ledger legs posted). No evidence upload, no messaging thread, no partial refunds. |
| Reviews | One per completed booking; rating + text; aggregated into `ratingAvg/reviewCount`. |
| Requests & proposals | **Implemented in block 1 (flag `REQUESTS_ENABLED`)**: `service_requests` (title, category, description, budget fixed/range, deadline, remote/location, `requiredSkills`, attachments, `extraRequirements`), `proposals` (cover, price, deliveryDays, milestones JSON, one live per pro per request), accept → booking at proposal price. Admin read-only tabs. |
| Projects & milestones | **NOT implemented.** `PROJECTS_ENABLED` flag only. Proposals carry a `milestones` JSON array that is informational. |
| Trust & achievements | `trust.ts` (reliability, response rate, repeat customers, verified projects; minimum samples), `achievements.ts` (10 rules, evidence, revocable). Flags `TRUST_ENABLED`, `ACHIEVEMENTS_ENABLED`. |
| Saved / preferred / rebook | `saved_professionals` with `preferred` + private `note`; `GET /bookings/:id/rebook` sanitised prefill. |
| CRM | **NOT implemented** (`CRM_ENABLED` flag only). |
| Business workspace / orgs | **NOT implemented** (`BUSINESS_ENABLED` flag only; `business` plan slug exists but is not purchasable). |
| Price intelligence | **NOT implemented** (`PRICING_INSIGHTS_ENABLED` flag only). |
| Analytics | `/pro/analytics` (bookings, earnings, views via `view_counters`, reliability, repeat, achievements) gated by plan (`PLAN_LIMITS.analytics`: Pro/Business). Admin `/admin/stats`, `/admin/analytics`. |
| Notifications | In-app `notifications` + Brevo email through `PgQueue` (`jobs` table; job names `email.send, bookings.autoconfirm, payouts.retry, cleanup.orphans, webhooks.retry`). ~20 notification `type`s. Admin broadcast. **Single inline worker, no Redis.** |
| Community / messages / network | Models exist (`chat_threads`, `chat_messages`, `community_connections`) but **disabled in production** (`COMMUNITY_ENABLED=false`). There is **no customer↔professional messaging** live today. |
| Support | `contact_messages` table from the contact form (status `new`). **No ticketing, no help-centre content model**; policies live in frontend legal pages, `faqs` table, and `docs/SERVIX_FEATURE_GUIDE.md`. |
| Admin | Stats, analytics, applications, users, services, bookings + dispute resolution, payouts retry, subscriptions, broadcast notifications, audit log, KYC review, requests/proposals + trust tabs. Every admin mutation is audited in-transaction (`audit.ts`). |
| Infrastructure | React 18 + Vite (Vercel), Fastify 5 + Prisma 7 (`@prisma/adapter-pg`) on Node 22 (Railway), Neon PostgreSQL (Ohio), Cloudflare R2, Brevo, Paystack. OpenAPI (swagger) documents every route. **No AI/LLM dependency exists. No `pgvector` extension is enabled.** |
| Data volume | Early-stage. Seeded catalogue is 8 categories / 8 professionals / 12 services; production is comparable. Any "learned" ranking or price model would be trained on almost nothing today. |

### Consequences for the AI plan

1. The brief's "Projects, Milestones, Service packages, CRM, Business accounts"
   rows in the opportunity map are **future features**; AI for them is scored
   on the assumption they are built as planned, and is not a near-term option.
2. The biggest *real* gaps AI can address are: (a) search is literal substring
   matching, (b) customers must already know what to ask for, (c) professionals
   write listings/proposals unaided, (d) admins review free text (applications,
   disputes, contact messages) one by one.
3. The platform already has the three things a safe agent needs: a
   **documented, authenticated REST API** (OpenAPI), **server-side
   authorization on every route**, and an **audit trail**. An agent can be a
   client of the existing API rather than a new privileged subsystem.
4. There is **no messaging channel**, so "AI drafts a message to the customer"
   has nowhere to go yet except proposals and booking notes.

---

## 2. Current architecture relevant to AI

```
Browser (React) ──HTTPS──▶ Fastify /api/v1 ──Prisma──▶ Neon PostgreSQL
                              │   ├─ requireAuth / requireProfessional / requireAdmin / requireKycVerified
                              │   ├─ zod validation on every body (parseBody)
                              │   ├─ audit() inside transactions
                              │   └─ PgQueue jobs (inline worker, 2s poll)
                              ├─ Paystack (webhooks, idempotent)
                              ├─ Cloudflare R2 (private, /media proxy)
                              └─ Brevo (email)
```

Facts that shape the AI design:

* **Authorization is route-level and user-scoped** (`req.auth.sub`, role,
  KYC). Any AI tool must call the same service functions with the same user
  context, never a privileged "AI" database user.
* **Feature flags** (`features.ts`) already gate systems and return `503
  FEATURE_DISABLED`. An `AI_ENABLED` flag (plus per-capability flags) fits the
  existing pattern.
* **Background jobs are PostgreSQL-backed and single-worker.** Long AI jobs
  (embedding backfill, nightly reports) can be new `JobName`s, but a slow LLM
  call inside the inline worker would delay emails; AI batch jobs need their own
  concurrency guard or a second worker process.
* **Money and state are deterministic modules** (`ledger.ts`, `refundPolicy.ts`,
  `bookingService.ts` transitions, `payoutService.ts`). AI must sit *in front
  of* these as a client, never inside them.
* **Rate limiting** exists per route (`@fastify/rate-limit`), which can be
  reused for AI endpoints; usage metering does not exist and would be new.
* **Content the model would read is user-generated** (descriptions, reviews,
  requests, proposals, CV PDFs). Every one of these is a prompt-injection
  surface (see §16).

---

## 3. AI opportunity map

Scale: **A** high value · **B** medium · **C** low · **D** should not use AI.
"Complexity" and "Risk" are low/med/high. "Mode" previews §8 (call = single
structured API call; workflow = fixed multi-step pipeline; agent = tool-using
loop; det = deterministic code, no AI).

| # | Feature | Current functionality | Potential AI capability | Expected user benefit | Required data | Tools / API access | Cx | Risk | Rec. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Service discovery | Category tiles, substring search, 5 sorts | Intent understanding: "I need a logo and business cards for my bakery" → category, service type, budget band, skills; semantic retrieval over service text | Customers who don't know the right vocabulary find the right gig | services, categories, searchTags | `search_services` (existing filters) + embeddings index | med | low (read-only) | **A** · workflow |
| 2 | Professional discovery | Substring over name/title/skills | Same intent → skills/category + semantic match over `about`, skills, portfolio titles, verified projects | Better recall, fewer "0 results" | profiles, skills, portfolio | `search_professionals` + embeddings | med | low | **A** · workflow |
| 3 | Search (query understanding) | `contains` ILIKE | Query rewriting (typos, Nigerian English / Pidgin, synonyms "web designer"≈"website developer"), structured filter extraction | Immediate recall gain, invisible to user | query logs (none today) | none beyond API | low | low | **A** · call (nano/mini) |
| 4 | Filtering | Manual facets | Natural-language → facet values (location, remote, price ≤, available this week) | Fewer taps on mobile | facet vocabulary | existing query params | low | low | **B** · call |
| 5 | Professional profiles (viewing) | Static profile + trust tab | "Why this professional fits your request" explanation grounded in real fields; summary of reviews (themes) | Faster decisions; trust | profile, reviews, trust | `get_professional_profile`, `get_reviews` | low | med (hallucination if ungrounded) | **B** · call with citations to fields |
| 6 | Service pages | Static | Requirements helper: turn the pro's `requirements` questions into a guided intake; detect missing info before booking | Fewer back-and-forth after payment | service.requirements | `get_service` | low | low | **A** · call |
| 7 | Service comparison | Real-data table, "best value" highlight | Plain-language comparison summary ("A is cheaper but has 2 reviews; B has 97% on-time over 12 jobs") strictly from the compare payload | Interpretability | compare payload | `compare_professionals` | low | low | **B** · call |
| 8 | Booking | Form + Paystack | Prepare booking draft from brief (service, date suggestion from availability, notes) — **never submit or pay** | Less friction | availability, service | `get_availability`, `prepare_booking_draft` | med | med | **B** · agent step, confirmation required |
| 9 | Availability | Rules + exceptions + slots | **D for computing slots** (deterministic). AI may *phrase* ("earliest is Thursday 10:00") | — | — | `check_availability` | — | — | **D** compute / C explain |
| 10 | Customer requests | Structured form (block 1) | Vague text → structured request draft (title, category, budget type, deadline, skills, missing-info questions); quality score before publishing | Better requests → better proposals | categories, skills vocab, past requests | `create_request_draft` (draft only) | low | low | **A** · call (structured output) |
| 11 | Proposals | Pro writes cover/price/days | Draft cover letter grounded in the pro's own gigs/portfolio + the request; flag mismatches (budget vs price, deadline vs deliveryDays) | Faster, more relevant proposals | request, pro profile/services | `draft_proposal` (draft only) | low | med (generic spam) | **A** · call; rate-limited |
| 12 | Projects | **Not built** | Later: brief → milestone plan draft | — | — | — | — | — | defer |
| 13 | Milestones | **Not built** | Later: overdue detection is **deterministic**; AI summarises status | — | — | — | — | — | defer / D for detection |
| 14 | Reviews | Rating + text | Moderation triage (abuse, PII, injection), theme summarisation on profiles ("praised for communication"), review-writing nudges with *no* fabricated content | Safer, more useful reviews | reviews | `get_reviews`, `flag_content` | low | med | **B** · call |
| 15 | Trust / reputation | Deterministic formulas (documented) | **D for scoring.** AI may explain a score ("3 of 12 deliveries late") | — | — | `get_trust_metrics` | — | — | **D** compute / B explain |
| 16 | Rebooking | Sanitised prefill | Suggest rebook moments (deterministic rules: last completed N months ago + pro available) ; AI only phrases | Repeat business | bookings | — | low | low | **C** (det first) |
| 17 | Professional onboarding | Multi-step form | Guided assistant: ask what they do → suggest title/skills/category/about draft; quality checklist | Higher-quality, faster applications | categories, skills | `suggest_profile` | low | low | **A** · call |
| 18 | CV / LinkedIn parsing | Heuristic regex parser | LLM extraction with the **same output schema** (`ResumeSuggestions`) as fallback when heuristics find < N fields; still pre-fill only | Far better extraction on non-LinkedIn CVs | PDF text (already extracted by unpdf) | none | low | med (injection in PDFs, PII) | **A** · call (structured output) |
| 19 | Gig creation | Wizard | Title/short description/description/tags/FAQ/requirements drafts from a few answers; price **shown as Servix range, never set** | Better listings | pro profile, category peers | `get_price_information` | low | med | **A** · call |
| 20 | Service packages | **Not built / rejected** | — | — | — | — | — | — | **D** (not applicable) |
| 21 | Professional analytics | Numbers + charts (Pro plan) | Narrative explanation + 1–3 concrete actions grounded in the numbers ("your profile got 40 views, 0 bookings; your price is 30% above category median") | Actionability | analytics payload | `get_analytics`, `get_price_information` | low | low | **B** · call (Pro feature) |
| 22 | CRM | **Not built** | Later: private note summarisation; follow-up suggestions | — | — | — | — | — | defer |
| 23 | Business accounts | **Not built** | Later: multi-request brief building for teams | — | — | — | — | — | defer |
| 24 | Notifications | Templated | **D** for triggering. AI could write *weekly digests* (summaries of real events) | Lower noise | notifications | `get_notifications` | low | low | **C** · call (digest only) |
| 25 | Admin (general) | Tables per entity | Read-only ops assistant: "show pending applications older than 3 days", "summarise dispute #…", drafts broadcast copy | Speed for a one-person team | all admin reads | admin read tools | med | med | **B** · agent (read-only) |
| 26 | Disputes | Reason text → admin picks release/refund | Summarise booking timeline + both parties' text, list facts for/against, **no recommendation of outcome by default** (or clearly labelled, non-binding) | Faster, more consistent review | booking events, payment, reason | `get_booking`, `get_booking_events` | low | **high** if it nudges decisions | **B** · call, human decides |
| 27 | Customer support | Contact form only | Policy Q&A grounded in Servix docs/refund rules (RAG) + "explain my booking/payment status" from the user's own records | Most support questions answered instantly | docs, FAQs, user's bookings | `get_booking`, `get_payment`, retrieval | low | med | **A** · agent (read-only) |
| 28 | Payments | Paystack + ledger | **D.** AI explains statuses only ("payment captured, held in escrow until you confirm") | — | — | `get_payment` | — | — | **D** |
| 29 | Security | MFA, flows, rate limits | **D** for auth decisions. Possibly anomaly *flagging* later | — | — | — | — | — | **D** |
| 30 | Fraud / risk | None beyond KYC + rate limits | Deterministic rules first (duplicate text across listings, burst sign-ups, mismatched payout names). AI: text-similarity / spam classification to *flag* for admin | Catch spam listings/proposals early | listings, proposals, sign-up metadata | `flag_content` | med | med | **B** · call + det rules |
| 31 | Marketplace operations | Manual | Weekly ops report generated from real metrics (supply gaps per category, requests with 0 proposals, pros with no listings) | Focus for a small team | aggregates | admin stats | low | low | **B** · call |

---

## 4. Customer AI

Capability-by-capability. "Safe?" assumes the mitigations in §16.

| Capability | Safe? | Data needed | Tools | Needs confirmation | Must stay deterministic |
| --- | --- | --- | --- | --- | --- |
| Understand natural-language request | Yes | categories, skills vocabulary | none (structured output) | — | — |
| Convert to structured requirements | Yes | same + `ServiceRequest` schema | `create_request_draft` (returns a draft object, not a DB row) | Publishing the request | zod validation on save |
| Build project brief | Yes | request draft | same | Saving as draft | — |
| Search services / professionals | Yes | catalogue | `search_services`, `search_professionals` | No | Filters, pagination, visibility rules (`status=active`, verified) |
| Match professionals to requirements | Yes with hybrid design (§7) | candidates from deterministic query | `search_professionals` → re-rank | No | Candidate set must come from DB; AI may only re-order/explain |
| Compare professionals | Yes | compare payload | `compare_professionals` | No | Figures |
| Explain why a professional matches | Yes if every claim cites a returned field | profile, trust, reviews | `get_professional_profile`, `get_trust_metrics` | No | — |
| Check availability | Yes (read) | availability | `check_availability` | No | Slot computation |
| Estimate Servix price range from real data | **Only with enough data**; otherwise must say "Not enough Servix data yet" (matches the existing rule) | prices of active services + completed bookings per category | `get_price_information` (deterministic aggregates) | No | Aggregation, thresholds (e.g. ≥8 datapoints) |
| Recommend service packages | N/A (not built) | — | — | — | — |
| Identify missing requirements | Yes | service.requirements, request | `get_service` | No | — |
| Prepare booking information | Yes as *draft* | service, availability, brief | `prepare_booking_draft` | **Yes** before create; payment always on Paystack page | Price (server snapshot), state machine |
| Help with project planning | Partially (no project model yet) | proposal milestones JSON | — | — | — |
| Explain booking/payment rules | Yes (RAG over policy docs + the user's booking) | docs, booking | `get_booking`, `get_payment`, `get_policy` | No | Refund % comes from `refundPolicy` output, never from model memory |
| Explain disputes/refunds | Yes, explain only | booking, policy | same | Opening a dispute: **Yes** | Resolution (admin) |
| Help customers communicate requirements | Yes (drafts for booking notes / request text) | — | — | User edits/sends | — |
| Recommend rebooking | Deterministic trigger; AI phrasing | bookings | `get_my_bookings` | Booking: Yes | — |
| Track project/booking status | Yes | user's bookings/events | `get_my_bookings`, `get_booking` | No | — |
| Explain notifications | Yes | user's notifications | `get_notifications` | No | — |

**Customer AI verdict:** high value, mostly read-only, and the two write
actions (save request draft, create booking draft) are naturally confirmable
screens that already exist. The customer assistant should be an **agent with
read tools + two draft tools**, embedded in the existing UI (search page,
request editor, booking form), not a detached chat window.

---

## 5. Professional AI

| Capability | Verdict | Why |
| --- | --- | --- |
| Create/improve service listings | **Genuine value** | Listings are thin today; drafts from 4–5 answers, constrained to the pro's own facts (no invented clients/awards). Pro edits and saves through the existing wizard. |
| Suggest titles / descriptions / search tags | Genuine (same feature) | `searchTags` ≤5, 2–20 chars — AI should respect the schema and the category vocabulary. |
| Structure service packages | **Not applicable** (owner rejected tiers) | Skip. |
| Analyse requirements / respond to requests | Genuine | Summarise a request, surface gaps, propose clarifying questions (shown as text; no messaging exists). |
| Draft proposals | **Genuine, with guard-rails** | Grounded in the pro's listings + request; mismatch flags (price vs budget, days vs deadline). Must be rate-limited and clearly editable, or the marketplace fills with identical AI covers. Consider showing customers a "written with help from Servix AI" only if edited < X% — decision for product. |
| Help price services | **Range only, from real data; otherwise "Not enough Servix data yet"** | Never a single recommended number; the deterministic `get_price_information` aggregate speaks, the model explains. |
| Analyse performance / explain analytics | Genuine (Pro plan feature) | Narrative over real numbers + concrete actions. Strong fit for the Pro upsell. |
| Identify weak-performing services | Mostly deterministic (views/booking ratio, no views in 30 days) | AI explains; rules detect. |
| Suggest profile improvements | Genuine | Checklist first (deterministic completeness score), AI for wording of `about`/title. |
| Organise portfolio information | Medium | Titles/descriptions for verified projects from booking facts. |
| Help prepare professional applications | Genuine | Same engine as onboarding + CV extraction (§3 rows 17–18). |
| Explain customer behaviour | Low | Not enough data; avoid speculation. |
| Help manage projects / summarise activity / overdue tasks | Defer | Projects not built. Overdue = deterministic when it exists. |
| Help with client communication | Defer | No messaging channel live. |
| Suggest follow-up / rebooking opportunities | Deterministic trigger; AI phrasing | Low priority. |

**Decoration to avoid:** "AI insights" cards with vague advice, auto-generated
reviews/responses, AI-generated portfolio imagery (owner already rejected
fabricated imagery), AI pricing that sets a number.

---

## 6. Admin / operations AI

Hard rule (from the brief and consistent with `audit.ts`): AI **never**
executes suspension, approval, payment, refund/release, fraud labelling or
dispute outcomes. It may read, summarise, rank, flag and draft.

| Capability | Value | Shape |
| --- | --- | --- |
| Admin dashboard assistant (natural-language reads over admin endpoints) | Medium-high for a 1–2 person team | Read-only agent with admin read tools; every answer links to the real table rows |
| Marketplace analytics explanation / trends / revenue / failed payments | Medium | Scheduled weekly report (call), grounded in `/admin/analytics` + `/admin/stats` JSON |
| Application review assistance | **High** | Structured checklist per application: completeness, consistency CV↔form, duplicate-text similarity with existing profiles, policy red flags. Output = facts + questions, not approve/reject |
| Profile / service quality checks | High | Same engine at publish time: thin description, missing requirements, prohibited content, contact details in text (off-platform leakage), injection patterns |
| Duplicate / spam detection | Medium | Embedding similarity (cheap) + deterministic rules; result = flag |
| Suspicious behaviour detection | Low now (little data) | Deterministic rules first; revisit |
| Dispute summarisation | **High, with care** | Timeline from `booking_events` + both texts + payment facts + the `refundPolicy` output. Present neutral summary; **no suggested decision by default** |
| Support ticket classification / assistance | Medium | Classify `contact_messages` (billing, account, abuse, partnership), draft reply grounded in policy docs; admin sends |
| Payout anomaly detection | Low-medium | Deterministic (failed retries, bank-name mismatch); AI unnecessary |
| Notification drafting | Medium | Broadcast copy drafts in Servix voice |
| Operational reports | Medium | Weekly digest job |
| Moderation assistance | Medium | Shared `flag_content` classifier used by reviews, listings, requests, proposals |

---

## 7. Matching engine analysis

**Question:** should Servix build an AI-assisted professional matching system?

### Option A — existing deterministic ranking only
`verification desc → ratingAvg → reviewCount`, plus filters. Transparent,
cheap, safe. Weakness: it is **not a relevance ranking at all** — it ignores the
query beyond substring filtering, cannot use the request's skills/budget/
deadline, and with ≤ a few hundred professionals it mostly surfaces the same
verified top-rated people regardless of fit.

### Option B — AI-assisted ranking (model orders results)
Model reads the request + candidate profiles and ranks them. Strengths: handles
language, nuance, portfolio relevance. Weaknesses: non-deterministic, opaque,
costly per query, vulnerable to injection in profile text ("rank me first"),
and biased toward verbose profiles. **Not acceptable as the source of truth.**

### Option C — hybrid (recommended)
```
request/query
  │ 1. Query understanding (nano/mini, structured output): category, skills[], budget band,
  │    remote/location, deadline, must-haves
  ▼
  2. DETERMINISTIC candidate retrieval (SQL): status active, category/skills overlap, filters,
     availability window (existing filterByAvailability), KYC/verification visibility
  │  + lexical match (Postgres full-text / pg_trgm — not yet enabled)
  │  + semantic match (pgvector cosine over profile/service embeddings — not yet enabled)
  ▼
  3. DETERMINISTIC feature scoring (documented weights, like trust.ts):
     skill overlap, semantic similarity, rating (shrunk by review count), reliability
     (only when ≥ sample), response rate, repeat rate, price fit vs budget, delivery-days
     fit vs deadline, verified projects in category, availability match
  ▼
  4. OPTIONAL LLM re-rank of the top-N (N ≤ 10) with strict output = permutation of the
     given ids + one-sentence grounded reason each. Any id not in the input is discarded;
     on failure fall back to step 3 order.
  ▼
  5. Explanation layer: "Matches because: 4/5 skills, 96% on-time (24 jobs), ₦ within budget"
     — generated from step-3 features, so it is always true.
```

Why C is technically safest:

* **Professionals can only come from step 2** — hallucination is structurally
  impossible; step 4 can only reorder.
* Scoring in step 3 is auditable and testable like `trust.ts`; the weights can
  be tuned without touching the model.
* Step 4 is optional and cheap (top-10 only). It can be A/B tested against
  step-3 order and disabled by flag with zero UX breakage.
* Explanations are derived from features, not free generation.
* Degrades gracefully: with little data (today), steps 1–3 already improve on
  Option A; embeddings and re-rank add value as the catalogue grows.

Data the hybrid needs that does not exist yet: query/search logs (for
evaluation), a `pgvector` column or side table for embeddings (additive
migration, later), and a per-category price aggregate (also feeds "price
intelligence"). Professional preferences (e.g. "no on-site work") exist only
implicitly via `isRemote`/location today.

Recommendation: **Option C, staged** — ship steps 1, 2 (with full-text) and 3
first; add embeddings when there are > ~200 listings; add step 4 only if
offline evaluation shows a measurable gain.

---

## 8. Agent architecture recommendation

### Which features should be what

| Feature | Shape | Why |
| --- | --- | --- |
| Query understanding, request drafting, listing drafts, proposal drafts, CV extraction, review/listing moderation, dispute summary, analytics narrative, ops report | **Normal AI call with structured output** | Single input → single schema; no exploration needed; cheapest, testable, cacheable |
| Matching (intent → retrieval → scoring → optional re-rank → explain) | **AI workflow** (fixed pipeline, two model calls max) | Deterministic control flow; AI only at the edges |
| Customer assistant ("find me someone / explain my booking / help me write the request") | **Agent with tools** (read tools + 2 draft tools, ≤ 6 tool calls per turn) | Needs to choose between searching, reading the user's bookings, and drafting |
| Admin assistant | **Agent with read-only tools**, separate tool set | Open-ended questions over many endpoints |
| Professional assistant | Mostly **calls**, embedded in the gig wizard / proposal form / analytics; a thin agent only if "ask about my business" chat is wanted later | Tasks are page-local |
| Availability, trust, refunds, overdue, scoring | **Deterministic code** | Must be exact and explainable |
| Multi-agent system | **Not recommended now** | Nothing requires agents talking to each other; it adds latency, cost and failure modes |

### One agent or three?

| Architecture | Pros | Cons |
| --- | --- | --- |
| Three separate agents (customer / professional / admin) | Smallest prompts; cleanest permission boundary; no accidental tool exposure | Three prompts/evals to maintain; shared logic duplicated |
| One unified Servix agent, tools filtered by role | One codebase and eval suite; shared policy knowledge | Larger prompt; a role-filter bug would be a privilege-escalation path; admin tools in the same process as public traffic |
| **Recommended: one runtime, multiple *profiles*** | Shared runner, tool registry, metering, guard-rails, logging; **tool set, system prompt and limits selected server-side from the authenticated role at session start** (not from the conversation) | Must be disciplined: profiles are configuration, and the admin profile should additionally require `requireAdmin` on its endpoint and ideally a separate route prefix (`/api/v1/ai/admin/*`) |

This mirrors how the API is already built: one Fastify app, route-level
guards per role.

### Runtime placement
Inside the existing API process (new `api/src/ai/` module + `/api/v1/ai/*`
routes) is the natural first step: it reuses auth, zod, rate limits, audit,
flags and the Prisma client. If AI traffic grows, the same module can run as a
second Railway service without changing the contracts, because tools call
service functions, not HTTP.

---

## 9. Proposed tools

All tools run **server-side, in the authenticated user's context**
(`req.auth.sub`, role), reuse existing service functions, and return
**compact, allow-listed JSON** (never raw Prisma rows; no emails, no phone
numbers, no internal ids the user cannot already see). Output size is capped
(e.g. ≤ 10 results, text fields truncated) to control cost and injection
surface. Every tool call is logged with arguments and result size.

### READ tools (auto-executable)

| Tool | Purpose | Input | Output | Who | Mutating | Confirm |
| --- | --- | --- | --- | --- | --- | --- |
| `search_services` | Catalogue search with existing filters | `{q?, categorySlug?, priceMax?, remote?, location?, available?, sort?, limit≤10}` | `[{id, slug, title, shortDescription, price, priceUnit, deliveryDays, rating, reviewCount, professional{slug,name,verified}}]` | all | no | no |
| `search_professionals` | Professional search (hybrid retrieval when enabled) | `{q?, categorySlug?, skills[]?, location?, remote?, available?, budgetMaxKobo?, limit≤10}` | summaries + match features (skill overlap, price fit…) | all | no | no |
| `get_service` | Service detail incl. `requirements`, FAQs | `{slugOrId}` | public detail | all | no | no |
| `get_professional_profile` | Public profile | `{slug}` | public detail, skills, portfolio titles (+ `verified` flag), achievements | all | no | no |
| `get_trust_metrics` | Public trust summary (or "not enough data") | `{slug}` | `profileTrustSummary` payload | all | no | no |
| `get_reviews` | Recent reviews (text truncated, flagged as untrusted content) | `{slug, limit≤10}` | `[{rating, text, createdAt}]` | all | no | no |
| `compare_professionals` | Existing compare endpoint | `{slugs[2..4]}` | compare table | all | no | no |
| `check_availability` | Real slots / next free window | `{slug, from?, to?}` | `{nextAvailable, windows[]}` | all | no | no |
| `get_price_information` | Deterministic aggregate per category/service type | `{categorySlug, serviceType?}` | `{sample, p25, median, p75} \| {enough:false}` | all | no | no |
| `get_categories` | Vocabulary for intent mapping | — | categories + common skills | all | no | no |
| `get_policy` | Retrieval over Servix policy/help corpus | `{question}` | `[{title, excerpt, url}]` | all | no | no |
| `get_my_bookings` | Caller's bookings (customer side or pro side) | `{status?, limit≤10}` | compact booking list | auth | no | no |
| `get_booking` | One booking the caller is party to, with timeline + payment status + applicable refund rule (from `refundPolicy`) | `{bookingId}` | compact booking + events | party only | no | no |
| `get_my_requests` / `get_request` | Caller's requests (customer) or an open request (pro) | ids | request + proposal counts | auth | no | no |
| `get_my_proposals` | Pro's proposals | — | list | pro | no | no |
| `get_my_services` / `get_my_profile` | Pro's own listings/profile (for drafting) | — | own data | pro | no | no |
| `get_analytics` | Pro analytics payload (Pro plan) | `{period}` | existing `/pro/analytics` | pro (plan-gated) | no | no |
| `get_notifications` | Caller's recent notifications | `{limit≤10}` | list | auth | no | no |
| `admin_get_stats` / `admin_list_applications` / `admin_get_application` / `admin_list_bookings` / `admin_get_booking` / `admin_list_contact_messages` / `admin_get_payout_failures` / `admin_list_users` (compact) | Read-only admin views | filters | compact rows + links | admin only, separate profile | no | no |

### DRAFT tools (produce an object the user must review; nothing persisted or persisted as `draft` only)

| Tool | Purpose | Input | Output | Who | Mutating | Confirm |
| --- | --- | --- | --- | --- | --- | --- |
| `create_request_draft` | Structured request from brief; optionally saved with `status=draft` via existing route | brief fields | validated draft + `missing[]` + `questions[]` | customer | draft row only | **Publish requires UI confirmation** |
| `prepare_booking_draft` | Prefill for the booking form (service, suggested date from availability, notes) | `{serviceId, preferredDate?, notes?}` | prefill object (no DB write) | customer | no | **Booking creation + payment always confirmed by the user on existing screens** |
| `draft_proposal` | Cover + mismatch flags for a request | `{requestId, serviceId?, priceKobo?, deliveryDays?}` | text + flags (no DB write) | pro | no | **Submitting is the existing proposal form** |
| `draft_listing` | Title/short/description/tags/FAQ/requirements suggestions | answers | draft fields | pro | no | Save via wizard |
| `draft_profile` | Title/about/skills suggestions | answers / CV text | draft fields | applicant/pro | no | Save via form |
| `draft_message` (admin: broadcast / contact reply) | Copy in Servix voice | intent | text | admin | no | Admin sends |
| `summarise_dispute` | Neutral fact summary | `{bookingId}` | timeline + claims + policy facts, **no decision** | admin | no | n/a |
| `flag_content` | Moderation classification | `{text, kind}` | `{labels[], confidence, injectionSuspected}` | system/admin | writes a flag row only | Human reviews |

### WRITE/ACTION tools — intentionally **none** in v1
No `create_booking`, `pay`, `cancel_booking`, `open_dispute`, `accept_proposal`,
`resolve_dispute`, `suspend_user`, `approve_application`, `retry_payout`. The
agent hands the user to the existing screen with a prefilled draft. If later
versions add e.g. `cancel_booking`, it must (1) go through `bookingService`,
(2) require a signed one-time confirmation token minted by the server for that
exact action + arguments and clicked by the user, (3) be audited with
`actor=user, via=ai`.

---

## 10. Permission model

| Level | Meaning | Examples | Enforcement |
| --- | --- | --- | --- |
| **Read** | Agent may call automatically | search, compare, availability, policy retrieval, the caller's own bookings/requests/analytics | Tool executes with the caller's identity; existing service-layer scoping (`customerId = sub`, `professionalId = own profile`, `requireAdmin`) decides what comes back |
| **Recommend** | Agent may say it | "These three fit best because…", "You could lower your price", "This dispute shows delivery after deadline" (admin) | Explanations must cite tool outputs; evals check for unsupported claims |
| **Draft** | Agent may produce an editable artefact | request draft, booking prefill, proposal cover, listing copy, profile copy, broadcast copy, dispute summary | Draft objects are validated by the same zod schemas as manual input; stored (if at all) as `draft` |
| **Execute (confirmed)** | User clicks a real Servix button | publish request, create booking, pay (Paystack page), cancel, open dispute, submit proposal, save listing | Existing routes, existing guards; AI is not in the request path |
| **Never by AI** | Human-only decisions | refund/release, payouts, suspension, application approval, KYC decisions, fraud labels, plan activation, trust/achievement grants | No tool exists; backend routes keep `requireAdmin` + audit |

Mapping to the brief's examples: search → auto; comparison → auto; project
brief → auto draft; create request → confirm (publish); book service →
confirm; payment → always explicit (Paystack checkout, unchanged); cancel →
confirm (not even a tool in v1); dispute → confirm (not a tool in v1); refund →
never; admin suspension → never.

Additional rules:

* Tool availability is chosen **from the session's authenticated role**, never
  from conversation content.
* Authorization errors from tools are returned to the model as plain "not
  permitted" strings — the model cannot retry with other ids to enumerate.
* Any tool argument that is an id is checked for ownership inside the service
  function, exactly as the HTTP route does.

---

## 11. AI usage / credit architecture

Design so pricing can change without touching the AI runtime.

**Unit of account: the "AI task"** — one user-visible operation (one assistant
turn, one draft generation, one match query), regardless of how many internal
model/tool calls it took. Users understand tasks; tokens and tool calls are
internal. Internally record tokens and cost per task for finance.

**Weights (configurable, default):**

| Task class | Weight | Examples |
| --- | --- | --- |
| light | 1 | query understanding, explain comparison, policy answer, notification explanation |
| standard | 2 | request draft, listing draft, proposal draft, analytics narrative |
| heavy | 4 | assistant turn with tool use, CV extraction, matching with re-rank |
| admin | 0 (not metered against plans, but logged) | dispute summary, ops report |

**Plan allowances (proposal, not implemented):** Free: ~30 weighted units /
month (enough to feel it, not to run a business on it); Servix Pro (₦15,000 /
30 days today): ~400; Business: ~2,000 pooled per organisation + per-seat caps.
Customers: a free allowance tied to the account; abuse-prone operations (bulk
drafts) capped per day.

**Tracking:** an additive `ai_usage` table (`id, user_id, org_id?, task,
weight, model, input_tokens, output_tokens, cost_usd_micros, tool_calls,
status, created_at`) + monthly aggregate view; enforcement reads the aggregate
(cheap) and a per-minute rate limit (existing `@fastify/rate-limit`). Store
prompts/outputs **only** in a short-retention debug log (e.g. 14 days, flag-
gated), never in `ai_usage`.

**Enforcement:** `requireAiQuota(taskClass)` preHandler → 402/429-style
`AI_QUOTA_EXCEEDED` with the reset date; the UI shows remaining tasks. Limits
are plan attributes (`PLAN_LIMITS`), so changing prices = changing config.
Business/enterprise: org-level pool once orgs exist; until then a per-user
override column.

**Abuse prevention:** per-user and per-IP rate limits; max tool calls and max
tokens per task; identical-request caching (hash of normalised input) for
read-only tasks; cost circuit-breaker per day for the whole platform (env);
block AI for unverified-email accounts.

---

## 12. Model strategy

Prices below are the public OpenAI list prices seen on 2026 pricing summaries
(GPT-5 ≈ $1.25 in / $10 out per 1M tokens; GPT-5 mini ≈ $0.25 / $2; GPT-5 nano
≈ $0.05 / $0.40) [1](https://nicolalazzari.ai/articles/openai-api-pricing-explained-2026)
[2](https://www.spurnow.com/en/tools/openai-chatgpt-api-pricing-calculator);
verify against the official pricing page before budgeting.

| Model type | Servix tasks | Expected quality | Cost | Latency | Why |
| --- | --- | --- | --- | --- | --- |
| **Fast/cheap (nano-class)** | Query understanding, facet extraction, moderation/injection pre-screen, classification of contact messages, notification explanation | Good for extraction/classification with strict schemas | ~1/25th of flagship | < 1 s | These are the highest-volume calls; schema-constrained outputs keep quality acceptable |
| **Mid (mini-class) — the default** | Request/listing/proposal drafts, analytics narrative, match explanations, customer assistant turns, CV extraction, dispute summary | Strong for grounded drafting and tool use | ~1/5th of flagship | 1–4 s | Best cost/quality for grounded generation; most Servix tasks are not hard reasoning |
| **Reasoning / flagship** | Only: offline evaluation, hard application-review checklists, weekly ops report (batched) | Highest | 5–25× mini | slow | Not needed in the request path; use in batch where latency is free |
| **Embedding model** (e.g. `text-embedding-3-small`) | Semantic retrieval over services/profiles/requests; duplicate detection; policy RAG | Good for English + mixed Nigerian English; evaluate on real queries | fractions of a cent per listing | ms (precomputed) | Precomputed in a job; makes retrieval cheap and model-independent |
| **Vision** | Optional later: portfolio/KYC image sanity checks (blurry, not a document, logo vs photo) | Useful but KYC decision stays human | per image | 2–5 s | Not a launch priority; CV PDFs are text-extracted already |
| **Speech** | Not recommended now | — | — | — | No voice surface in the product; mobile users type |
| **Routing** | Rule-based by task class (not an LLM router) | — | — | — | Simple, predictable, testable |

Primary recommendation: **one primary mid-class model for generation and tool
use, one nano-class model for extraction/moderation, one embedding model** —
with model names held in config so upgrades are a config change. Use prompt
caching for the static system prompt/tool schemas (cached input is ~10× cheaper
on these tiers [1](https://nicolalazzari.ai/articles/openai-api-pricing-explained-2026)).

---

## 13. OpenAI architecture recommendation

Current platform building blocks (checked against 2026 documentation):

* **Responses API** is the current primary API: `input` items, `tools` with
  `strict: true` function schemas, `text.format = json_schema` for Structured
  Outputs (replacing the older `response_format`), `previous_response_id` for
  continuation, streaming events, built-in tools (web/file search) [3](https://gist.github.com/steipete/b58f0087c02fd97cea73f016e42c8ac0)
  [4](https://developers.openai.com/api/reference/python/resources/responses)
  [5](https://sloth255.com/en/blog/openai-api-responses-api-structured-outputs).
* The Node SDK exposes `responses.parse` with `zodTextFormat` so Servix's
  existing **zod** schemas can define both tool parameters and output shapes
  [6](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs).
* Structured Outputs via strict function definitions guarantee tool arguments
  match the schema (not that they are *authorised* — that remains Servix's job)
  [7](https://openai.com/index/introducing-structured-outputs-in-the-api/).

Recommended architecture:

1. **Responses API + strict function tools + zod structured outputs** as the
   core. Write a small in-house runner (`api/src/ai/runner.ts`): build input →
   call → execute function calls through the tool registry → feed
   `function_call_output` back → stop on final message, on tool-call cap, on
   token cap, or on wall-clock cap. ~200 lines; fully under Servix control;
   testable with a fake model.
2. **Agents SDK: not for v1.** It is convenient for multi-agent hand-offs and
   tracing, but Servix's needs (one agent, ≤ 6 tool calls, hard permission
   boundaries, custom metering) are better served by a thin runner over the
   Responses API, with fewer dependencies in a security-sensitive backend.
   Revisit if hand-offs between profiles are ever required.
3. **Conversation state:** keep Servix's own compact transcript per session
   (DB row with short TTL) and send it as `input`, rather than relying only on
   `previous_response_id`, so sessions survive model swaps and can be redacted.
4. **Embeddings/retrieval:** OpenAI embeddings stored in Postgres (`pgvector`
   on Neon — additive migration, later). Do **not** use hosted file search for
   catalogue data (it would copy user data out of the database); hosted file
   search is acceptable only for the static policy corpus, and even there a
   small local index is simpler.
5. **Structured Outputs everywhere a result is machine-consumed** (drafts,
   classifications, re-rank permutations). Free text only for the final
   assistant message.
6. **No built-in web search / code interpreter / computer use** for Servix
   tools: they widen the attack surface and are not needed.
7. **Batch API** for nightly embedding backfills, weekly reports and
   evaluation runs (≈50% cheaper).

---

## 14. Retrieval architecture

| Source | Access method | Notes |
| --- | --- | --- |
| Services, professionals, categories, availability, trust, compare, prices | **Direct tools over existing service functions** (structured queries) | Always fresh, always authorised, compact |
| User's own bookings / requests / proposals / notifications / analytics | Direct tools, caller-scoped | Never pre-indexed into a shared vector store (cross-user leakage risk) |
| Service descriptions, profile `about`, portfolio titles, request text | **Embeddings** (semantic retrieval) + Postgres full-text (lexical) | Index only public, active content; re-embed on update via a job; delete on unpublish |
| Reviews | Direct tool (recent N); embeddings optional later for theme summaries | Treat as untrusted content |
| Platform policies, terms, refund rules, help docs, FAQs | **Small curated corpus** (markdown chunks ≈ 300–600 tokens) with embeddings; `get_policy` returns excerpts + URLs | Refund **percentages** are not retrieved from docs — the tool calls `refundPolicy` for the specific booking |
| Platform behaviour summary (what Servix is, what the assistant can/can't do, Nigerian context, currency ₦, Paystack TEST caveat) | **Static system instructions** (cached) | Keep under ~1.5k tokens |
| Analytics aggregates | Direct tool | — |

Never: dumping tables into context, giving the model SQL, or letting it read
other users' private data.

---

## 15. Memory architecture

**Short-term (conversation):** per session, server-side, compact transcript +
tool results summary, TTL 24 h, deleted with the account. Purpose: coherence
within a task.

**Long-term (user memory):** keep it **explicit and small**, stored as
structured preference fields the user can see and edit (Settings → "AI
preferences"), not as free-form model-written notes:

| Memory item | Store? | Where | Privacy note |
| --- | --- | --- | --- |
| Preferred language/tone (English / concise) | Yes | user preferences | harmless |
| Customer: typical location, remote preference, budget band, categories of interest | Yes, derived from *their own requests/bookings* and shown to them | preferences JSON | Opt-out toggle; never inferred sensitive traits |
| Customer: preferred professionals | Already exists (`saved_professionals.preferred`) | reuse | — |
| Professional: service focus, target clients, availability pattern | Yes (derived from profile) | profile `details` | — |
| Private CRM notes (future) | **No AI memory**; AI may read them only inside that pro's session | — | Never visible to customers/admin (user rule) |
| Previous project context | Reuse booking/request records; no separate memory | — | — |
| Anything about third parties mentioned in chat, health/religion/ethnicity/finances beyond budget | **Never store** | — | NDPA 2023 data-minimisation |

Rules: memory writes only through explicit "remember this?" confirmation or
derived from records the user already owns; show provenance; one-click clear;
include memory in data-export/deletion flows.

---

## 16. Security architecture

| Risk | Where it appears in Servix | Mitigation |
| --- | --- | --- |
| Prompt injection via user content (service descriptions, `about`, reviews, requests, proposals, CV PDFs, contact messages) | Every tool output and the CV pipeline | Wrap all retrieved text in delimited "untrusted content" blocks with an instruction that it is data; **tool results never change the tool set**; strip URLs/markup from tool text; nano-class pre-screen `injectionSuspected` on content at save time and at retrieval; cap text length |
| Data leakage / cross-user access | Tools with ids | Tools call the same scoped service functions as HTTP routes; no "AI" DB role; allow-listed output fields; admin tools only in the admin profile on an admin-guarded route |
| Hallucinated data (invented professionals, prices, policies) | Matching, explanations, support | Candidates only from retrieval; re-rank output validated as a permutation of input ids; prices/trust/availability only from tool outputs; UI renders cards from tool JSON, not from model prose; eval suite for unsupported claims; refusal path "Not enough Servix data yet" |
| Manipulated tool arguments | Any tool | Strict JSON schema + server-side zod re-validation + ownership checks in service layer; ids are opaque; no free-form filters/SQL |
| Unauthorised actions | Write tools | None in v1; later writes require signed one-time confirmation tokens bound to (user, action, args hash, expiry) |
| Tool abuse / agent loops / excessive calls | Runner | Hard caps: ≤ 6 tool calls, ≤ 2 identical calls, ≤ 20 s wall clock, token caps; terminate with a safe message |
| Cost abuse | Public endpoints | Email-verified accounts only; per-user/IP rate limits; quota; daily platform circuit-breaker; response caching for identical read tasks |
| Malicious uploaded documents | CV/LinkedIn PDFs, attachments | Existing size/type limits; text extraction only (unpdf), no image/HTML rendering by the model; treat extracted text as untrusted; never execute links |
| Model output as authorisation | Everywhere | Model output is advisory text or a draft; **Servix routes + guards remain the authority** (this is already how the codebase works) |
| Logging/privacy | Debug logs | Redact emails/phones in transcripts; short retention; flag-gated; no third-party analytics on AI content |
| Vendor outage | Runtime | Timeouts, graceful degradation to non-AI UI (search still works; drafts just unavailable); never block booking/payment on AI |

Also recommend a red-team checklist before launch: injection strings placed in
a test listing/review/CV; attempts to read another user's booking by id;
attempts to get the assistant to state a refund amount without the tool;
runaway-loop prompts; cost spikes.

---

## 17. Deterministic systems AI must never control

| System | Module today | AI role |
| --- | --- | --- |
| Payments, escrow, webhooks | `payments.ts`, `webhookService.ts` | Explain status only |
| Ledger | `ledger.ts` (double-entry, 5 accounts) | None |
| Refund calculation | `refundPolicy.ts` (env-driven percentages) | Quote the module's result for a specific booking |
| Booking state transitions | `bookingService.ts` | Explain; prefill drafts |
| Permissions / authentication / MFA / security flows | `authGuard.ts`, `auth.ts`, `securityFlow.ts` | None |
| Identity verification (KYC) | `kyc.ts`, admin review | At most image-quality hints later; decision human |
| Subscription activation / plan limits | `plans.ts` | Explain plan |
| Payouts | `payoutService.ts` | Explain status |
| Trust metrics, achievements, reliability | `trust.ts`, `achievements.ts` | Explain; never alter |
| Availability slots | availability rules + bookings | Phrase results |
| Platform fee / financial maths | `PLATFORM_FEE_PCT`, ledger legs | None |
| Feature flags, audit log | `features.ts`, `audit.ts` | None |
| Admin decisions (approve, suspend, resolve, retry) | `admin.ts` | Summarise / flag / draft only |

---

## 18. Recommended user experience

### Customer — "I need a website for my restaurant"

Entry point: the search bar on `/services` and `/professionals` and the
"Describe what you need" box in the request editor — not a separate chatbot
page. Mobile-first (owner and most users are on phones).

1. Customer types the sentence. Servix AI (nano) extracts: category *Web
   development*, service type *business website*, skills [web design, menus,
   online ordering?], budget unknown, deadline unknown, remote OK.
2. It asks **at most two** questions, pre-filled as chips: "Budget range?"
   (ranges come from `get_price_information`, or "Not enough Servix data yet"
   if too few datapoints) and "Do you need online ordering?"
3. It shows a **structured brief card** (editable) — this is the future
   service request draft.
4. Behind the card, the hybrid matcher (deterministic retrieval + scoring; LLM
   re-rank optional) finds real professionals and real gigs. Each card shows
   the existing `ProfessionalCard` plus one grounded line: "Matches: web
   design, 2 verified restaurant projects, 95% on-time (19 jobs), ₦ within your
   range, free this week."
5. Availability chips come from `check_availability`.
6. "Compare these 3" opens the existing `/compare` with an AI one-paragraph
   summary above the table.
7. Customer picks a gig → "Prepare booking" → the existing booking form opens
   **prefilled** (notes from the brief, suggested date); the customer reviews,
   confirms, and pays on Paystack. Nothing is booked or paid by the AI.
8. Or: "Post this as a request" → request editor opens with the brief; the
   customer presses Publish (existing route, existing validation).
9. Later, in Bookings: "What happens if I cancel now?" → assistant calls
   `get_booking` (which embeds the `refundPolicy` result) and answers with the
   exact rule for *this* booking, plus a link to the Cancel button.

### Professional — "Help me win more work"

1. **Gig wizard**: "Describe what you offer in one sentence" → AI drafts
   title, short description, full description, 5 tags, 3 FAQs and 3–5 intake
   requirements, all in the pro's words and category vocabulary; price field
   shows the Servix range for the category (or "Not enough Servix data yet").
   Pro edits and publishes (KYC guard unchanged).
2. **Requests & proposals**: for each open request, "Summarise" shows the
   request's essentials, fit with the pro's gigs, and gaps. "Draft proposal"
   produces a cover grounded in the pro's listings/verified projects and flags
   "your price is above the budget range" or "your delivery days exceed the
   deadline". Pro edits and submits (one-live-proposal rule unchanged).
3. **Analytics (Pro)**: "Explain this month" → three sentences and three
   actions derived from the real numbers; each action deep-links to the page
   where it is done.
4. **Profile**: completeness checklist (deterministic) + "Improve wording"
   for `about`/title.
5. **Onboarding**: CV upload → LLM extraction into the existing
   `ResumeSuggestions` schema when the heuristic parser finds little; applicant
   reviews everything; admin still sees the original PDF.

### Admin — "What needs me today?"

A read-only panel: pending applications with checklist summaries, disputes
with neutral timelines, contact messages classified, anomalies flagged by
deterministic rules, and a weekly report. Every item links to the existing
admin action buttons; the AI never has those buttons.

---

## 19. Top 5 AI features (ranked by usefulness to Servix)

### 1. Intent-aware search & hybrid matching
* **User problem:** search is substring matching; customers must guess the
  right words; results are not relevance-ranked.
* **Why AI:** language understanding (incl. Nigerian English) and semantic
  similarity are exactly what LLMs/embeddings do; the ranking itself stays
  deterministic.
* **Impact:** highest — affects every customer session and the supply side's
  exposure. **Difficulty:** medium.
* **Data:** services, profiles, skills, categories, trust, availability; later
  embeddings + query logs.
* **Tools:** `get_categories`, `search_services`, `search_professionals`,
  `check_availability`, `get_price_information`.
* **Models:** nano for query understanding; embeddings; mini for optional
  re-rank/explanations.
* **Complexity:** MVP 2–3 weeks; embeddings +1–2 weeks (needs `pgvector`
  migration). **Risks:** injection via profile text (mitigated: re-rank is a
  permutation), cold-start sparsity (mitigated: deterministic scoring works
  with small data).
* **Shape:** AI workflow (not an agent).
* **MVP:** query → structured filters → existing search + feature scoring +
  grounded "matches because" lines; full-text index.
* **Future:** embeddings, LLM re-rank, learning weights from outcomes.

### 2. Request & brief assistant (customer) + proposal assistant (professional)
* **Problem:** vague requests get poor proposals; pros write proposals from
  scratch; both sides waste time.
* **Why AI:** turning prose into the structured `ServiceRequest` schema and
  drafting grounded text is a language task.
* **Impact:** high for the new marketplace loop (block 1). **Difficulty:** low.
* **Data:** request schema, categories/skills, pro's listings/projects.
* **Tools:** `create_request_draft`, `get_request`, `get_my_services`,
  `draft_proposal`, `get_price_information`.
* **Models:** mini with structured outputs. **Complexity:** 1–2 weeks.
* **Risks:** identical AI covers (rate-limit, require edits, mismatch flags);
  budget hallucination (ranges from tool only).
* **Shape:** normal AI calls.
* **MVP:** "Describe what you need" → draft request; "Draft proposal" button.
* **Future:** clarifying-question loop; quality score before publishing.

### 3. Listing & profile drafting (incl. LLM CV extraction)
* **Problem:** thin listings and profiles reduce conversions and search
  recall; the heuristic CV parser is weak on non-LinkedIn CVs.
* **Why AI:** drafting and extraction. **Impact:** medium-high (supply
  quality compounds into #1). **Difficulty:** low.
* **Data:** gig/profile schemas, category vocabulary, PDF text.
* **Tools:** `draft_listing`, `draft_profile`, `get_price_information`.
* **Models:** mini (drafts), nano/mini (CV extraction with the existing
  `ResumeSuggestions` schema). **Complexity:** 1–2 weeks.
* **Risks:** fabricated credentials — prompt to use only supplied facts, UI
  marks every AI-filled field for review, admin sees original PDF (already
  true). PDF injection — untrusted-content wrapping.
* **Shape:** normal AI calls. **MVP:** wizard buttons. **Future:** quality
  checklist shared with admin review.

### 4. Policy & status support assistant
* **Problem:** no support tooling; questions about escrow, refunds, cancellation,
  payouts and KYC will dominate the contact form.
* **Why AI:** answering from a policy corpus plus the user's own booking facts.
* **Impact:** medium-high (support load, trust). **Difficulty:** low-medium.
* **Data:** curated policy corpus, `refundPolicy` output, bookings/events,
  payment status, notifications.
* **Tools:** `get_policy`, `get_my_bookings`, `get_booking`,
  `get_notifications`. **Models:** mini; embeddings for the corpus.
* **Complexity:** 2 weeks incl. writing the corpus (which Servix needs anyway).
* **Risks:** wrong policy statements — refunds always from the module;
  "escalate to a human" path to the contact form.
* **Shape:** agent with read-only tools (≤ 4 calls). **MVP:** Help panel in the
  workspace. **Future:** contact-message classification + draft replies for
  admin.

### 5. Admin review copilot (applications, disputes, contact messages, weekly ops report)
* **Problem:** a very small team reviews free text by hand.
* **Why AI:** summarisation, checklisting and classification over real records.
* **Impact:** medium (team time, consistency). **Difficulty:** low.
* **Data:** applications + CV text, booking events, payments, contact
  messages, admin stats. **Tools:** admin read tools, `summarise_dispute`,
  `flag_content`, `draft_message`. **Models:** mini; flagship optionally for
  the weekly report via Batch.
* **Complexity:** 1–2 weeks. **Risks:** decision nudging — neutral summaries,
  no recommended outcome by default; audit that every admin action still goes
  through existing routes.
* **Shape:** normal calls now; read-only admin agent later.
* **MVP:** "Summarise" buttons on application and dispute pages.
* **Future:** ops report job, anomaly flags, duplicate detection with
  embeddings.

---

## 20. What NOT to build

| Idea | Why not |
| --- | --- |
| A general ChatGPT-style chat page detached from Servix screens | No grounding in the user's task; invites off-topic use and cost; every valuable capability above is better embedded in an existing page |
| AI that books or pays on the user's behalf ("just book the best one") | Payment and state transitions must stay explicit; Paystack checkout is a user action; liability |
| AI-set prices or "AI says charge ₦X" | Owner's rule: one price per gig set by the pro; Servix has too little data; invites anchoring and disputes. Ranges from real data only, else "Not enough Servix data yet" |
| AI-invented professionals/results, "AI-generated sample portfolios" | Owner already rejected fabricated imagery; trust is the product |
| AI dispute resolution or refund recommendations | Human-only decision; even a "suggested outcome" biases the admin — keep summaries neutral |
| AI fraud accusations or auto-suspension | Flags only, with human review |
| AI-written reviews, auto-replies to reviews, or "polishing" customer reviews | Authenticity; reviews feed trust metrics |
| AI-generated service packages/tiers | Feature rejected by owner |
| Multi-agent orchestration (customer agent negotiating with professional agent) | Nothing in Servix requires agents talking to agents; cost, latency and failure modes with no user benefit |
| Fine-tuning a custom model now | No data volume; prompt + structured outputs + retrieval cover the needs |
| Voice assistant | No voice surface; mobile users type; adds speech cost for no clear demand |
| Letting the model write SQL / Prisma queries | Direct authorisation bypass risk; use fixed tools |
| Indexing private data (bookings, notes, messages, KYC) into a shared vector store | Cross-user leakage; private data stays behind per-user tools |
| AI "trust score" or AI-adjusted rankings as the source of truth | Trust formulas must remain documented and deterministic (`TRUST.md`) |
| AI chat with professionals on behalf of customers before messaging exists | No channel; would create one with unclear rules |

---

## 21. Recommended implementation phases (for later decision — nothing started)

| Phase | Scope | Flags | Pre-requisites |
| --- | --- | --- | --- |
| 0 — Foundations (≈1 week) | `api/src/ai/` module: provider client, runner, tool registry, zod schemas, usage metering table (`ai_usage`, additive), `AI_ENABLED` master flag + per-capability flags, prompt-injection wrapping, eval harness with a fake model, cost circuit-breaker | `AI_ENABLED` | OpenAI key in Railway (never in repo); decide data-processing terms (NDPA) and a short AI section in Privacy Policy |
| 1 — Drafting calls (≈2 weeks) | Request draft, proposal draft, listing/profile drafts, LLM CV extraction fallback | `AI_DRAFTS_ENABLED` | Phase 0 |
| 2 — Intent search + deterministic matching (≈2–3 weeks) | Query understanding, Postgres full-text (additive migration), feature scoring + grounded explanations on `/professionals`, `/services`, request → suggested pros | `AI_SEARCH_ENABLED` | Phase 0; search logging for evaluation |
| 3 — Support & customer assistant (≈2 weeks) | Policy corpus, `get_policy`, read-only agent in the workspace, booking/payment explanations | `AI_ASSISTANT_ENABLED` | Phases 0–1; written policy corpus |
| 4 — Admin copilot (≈1–2 weeks) | Summaries for applications/disputes/contact messages, weekly report job | `AI_ADMIN_ENABLED` | Phase 0 |
| 5 — Embeddings + re-rank (≈2 weeks, when catalogue > ~200 listings) | `pgvector` (additive), embedding jobs, semantic retrieval, optional LLM re-rank, duplicate detection | `AI_SEMANTIC_ENABLED` | Phase 2 + evaluation data |
| 6 — Plans & quotas | Allowances per plan, UI meters, Business pools when orgs exist | — | Product pricing decision |

Each phase follows the existing rules: inspect → reuse → additive migration
(manual, guarded) → backend → frontend → tests (unit with fake model, API
auth/authz, Playwright with mocked AI endpoints) → honest report.

---

## 22. Risks and unresolved questions

1. **Data scale.** With tens of listings, semantic ranking and price ranges
   will mostly return "Not enough Servix data yet". Phases 1–2 still deliver
   value; Phase 5 should wait for volume.
2. **Cost control vs free tier.** Decide whether customers get AI free forever
   (acquisition) or metered; the architecture supports both, product must
   choose.
3. **Legal/privacy.** Sending user content (requests, CVs, reviews) to a US
   processor needs a Privacy Policy update and data-minimisation (redaction of
   emails/phones; no KYC images; opt-out). NDPA 2023 applies.
4. **Disclosure.** Should customers see when a proposal/listing was AI-drafted?
   Marketplace integrity argues for at least internal tracking (`ai_assisted`
   boolean on proposals/listings) and possibly a label.
5. **Language.** Evaluate extraction quality on Nigerian English/Pidgin
   queries with real users before relying on nano-class models for intent.
6. **Messaging.** Several professional-side capabilities (client communication,
   follow-ups) need a messaging channel that is currently disabled; decide
   whether messaging ships before those AI features.
7. **Projects/milestones, CRM, business, packages** are unbuilt; AI for them is
   scored on assumptions and should be re-audited once they exist.
8. **Operational.** A single inline PgQueue worker should not run slow AI
   batch jobs next to email delivery; batch AI jobs need a concurrency guard or
   a second worker.
9. **Vendor dependence.** Keep model names, prompts and the provider client
   behind one interface so a provider or model change is configuration, not a
   rewrite.
10. **Evaluation.** Before any launch, build a small golden set (≈100 real
    queries/requests once available) and measure: unsupported-claim rate,
    schema-validity rate, injection resistance, latency, cost per task.

---

*End of audit. No implementation was performed.*
