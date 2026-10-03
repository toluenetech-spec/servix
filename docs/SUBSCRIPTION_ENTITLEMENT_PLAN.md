# Servix subscriptions, entitlements and feature access

Status: **implemented 2026-10-03 (release 0.9.0)**. Additive: one new migration
(`20261004000000_subscriptions_entitlements`), no existing table dropped, no existing flow replaced.
The API enforces every boundary; the web app only *explains* them.

## 1. Plans

| Plan | Price | Who it is for | Assigned how |
| --- | --- | --- | --- |
| **Free** | ₦0 | Everyone by default | automatic |
| **Go** | ₦5,000 / month | Individuals who need more room and productivity tools | self-serve checkout |
| **Pro** | ₦15,000 / month | Professionals who depend on Servix daily | self-serve checkout |
| **Team** | ₦35,000 / month | Agencies, studios and small teams (shared workspace, up to 5 seats) | self-serve checkout |
| **Enterprise** | custom | Organisations needing custom limits, admin controls, audit | **admin-assigned only** (`POST /admin/users/:id/plan` or organisation plan) |

Plans are billed monthly through the existing payment provider and never auto-renew (unchanged
behaviour). **Servix AI never touches payments**: checkout/verify live in `api/src/routes/billing.ts`
and the AI layer has no import path to them.

Legacy slugs `professional` → `pro` and `business` → `team` are renamed by the migration; existing
professional plan assignments are copied onto the user row (`users.plan_slug`, `users.plan_expires_at`)
so plans now apply to **every role**, not only professionals.

## 2. One source of truth: `api/src/lib/entitlements/catalog.ts`

Everything plan-related is declared once, typed, and consumed everywhere (API, seed, admin console,
web app via `GET /me/entitlements`):

- `PLAN_SLUGS`, `PLAN_RANK`, `PURCHASABLE_PLANS`, `ORGANIZATION_PLANS` (team, enterprise).
- `FEATURES` — boolean capabilities with a *minimum plan*:
  `advanced_filters` (Go), `proposal_organization` (Go), `profile_versions` (Go), `analytics_detailed` (Go),
  `proposal_pipeline` (Pro), `analytics_advanced` (Pro), `profile_badge` (Pro), `priority_ai` (Pro),
  `team_workspace` (Team), `team_analytics` (Team), `org_custom_limits` (Enterprise), `org_audit_log` (Enterprise).
- `LIMITS` — numeric caps per plan (`null` = unlimited):

| Limit | Free | Go | Pro | Team | Enterprise |
| --- | ---: | ---: | ---: | ---: | ---: |
| `monthly_ai_tokens` | 20,000 | 100,000 | 300,000 | 1,000,000 (team pool) | 3,000,000 default, customisable |
| `listings` | 2 | 5 | 15 | 30 | ∞ |
| `portfolio_items` | 6 | 12 | 20 | 30 | ∞ |
| `monthly_proposals` / `active_proposals` | 5 / 3 | 25 / 10 | 100 / 30 | 300 / 100 | ∞ |
| `monthly_requests` / `active_requests` | 3 / 2 | 10 / 5 | 30 / 15 | 100 / 50 | ∞ |
| `saved_professionals` | 10 | 50 | 200 | 500 | ∞ |
| `saved_searches` | 2 | 10 | 30 | 50 | ∞ |
| `profile_versions` | 1 | 3 | 10 | 25 | ∞ |
| `monthly_exports` | 1 | 5 | 25 | 100 | ∞ |
| `team_members` | 0 | 0 | 0 | 5 | 25 |

- `PLAN_AI_DEPARTMENTS` — which Servix AI tools each plan may call:
  Free: assistant, explanations, search_intent, project_health, pricing_guidance ·
  Go adds background_drafting, profile_analysis, job_matching ·
  Pro and above add proposal_generation, profile_improvement, opportunity_radar.

Adding a plan, feature or limit = one edit in the catalogue; the type system flags every place that
needs a value. No route contains `if (plan === 'pro')`.

### Overrides without a deploy
- `plans.limits` (JSON `{limits, features, aiDepartments}`) — per-plan operator overrides, edited from
  Admin → *Plans & organisations*; cached 60 s.
- `organizations.custom_limits` and `users.custom_limits` — Enterprise-only custom caps (tokens, members,
  listings, …), edited by an admin.

## 3. Engine: `api/src/lib/entitlements/index.ts`

`resolveEntitlements(userId)` → effective plan + features + limits + AI departments + usage + period.
Precedence: **active organisation membership** (team/enterprise plan, `source: 'organization'`) →
admin-assigned plan (`source: 'admin'`) → user's own paid plan (expired → Free).

API for routes:
```ts
const ent = await entitlementsFor(req);
canAccess(ent, 'analytics_advanced'); getLimit(ent, 'monthly_proposals'); canUseAI(ent, 'proposal_generation');
assertFeature(ent, 'proposal_pipeline');            // 403 PLAN_FEATURE
assertWithinLimit(ent, 'listings', currentCount);   // 403 PLAN_LIMIT
assertAiDepartment(ent, 'opportunity_radar');       // 403 PLAN_FEATURE (kind ai_department)
app.get('/x', { preHandler: requireEntitlement('team_workspace') }, …)
```
Every plan error carries `error.meta = { kind, limit|feature|department, plan, upgradeTo,
upgradeToLabel, used, allowed, resetAt, scope }` so the UI can say *“You have reached the limit of 2
saved searches on the Free plan — Go gives you 10”* without guessing.

Existing features wired into the engine (no duplicate logic): service listings & portfolio items
(`pro.ts`, `proWorkspace.ts`), proposals and requests (`requests.ts`), saved professionals and saved
searches (`account.ts`, `productivity.ts`), analytics depth (`proWorkspace.ts`), profile versions,
exports, proposal labels/notes/pipeline, team workspace, Servix AI departments and token metering.

## 4. AI usage metering: `usage.ts` + `api/src/ai/metering.ts`

- Monthly UTC calendar period; counters in `usage_periods` keyed by subject (`user` or `organization`),
  metric and period start. Team/Enterprise members draw from the **organisation pool**; usage is also
  recorded on the member and an optional per-member `ai_token_cap` is enforced.
- `runMetered()` wraps every AI task: **atomic reservation** (`UPDATE … WHERE used + reserved + estimate
  <= allowed`, so concurrent requests cannot overshoot), then settle to the real `prompt + completion`
  tokens. Failed provider calls are **never billed**. Estimates self-correct from an EMA of real usage.
- Levels: `ok` → `warning` (75 %) → `critical` (90 %) → `exhausted` (100 %, 403 `AI_QUOTA_EXCEEDED`).
  Every AI response carries `ai.quota` so the meter in the UI is live; `GET /ai/usage` returns
  `used / allowed / remaining / percent / level / resetAt`.
- `ai_usage_events`: one row per task — user, organisation, plan, department, model alias + id,
  prompt/completion/total tokens, ok, latency, fallback used, attempts, error **code**. Never prompts,
  answers, keys or provider messages.
- Model routing (`api/src/ai/router.ts`, DeepSeek → MiniMax → GLM chains) is unchanged; `priority_ai`
  (Pro+) only shortens the hedge window.

## 5. Teams and organisations: `api/src/routes/teams.ts`

`POST /team` (needs `team_workspace`), invitations by e-mail with hashed single-use tokens
(`/join-team?token=…`, 7-day expiry, counted against seats), roles owner / admin / member, member
removal, owner cannot leave (409), rename, activity feed, shared work (team requests + proposals),
`GET /team/ai-usage` (admins: pool, per member, per tool, daily), Enterprise audit log + CSV.
Members see the roster and pool but no admin controls (enforced server-side, mirrored in the UI).

## 6. Downgrades

`POST /billing/downgrade { confirm: true }` (or expiry) never deletes anything. Items above the new
limit stay visible and editable; only *new* items are blocked until the account is under the limit
again, with an explanation and a one-click path back to a bigger plan.

## 7. Admin console

- **Plans & organisations** tab: catalogue with defaults / effective values / overrides, per-plan editor
  (price, tagline, limit & feature overrides), organisations list and editor (plan, expiry, custom
  limits), grant a plan to any user (Enterprise included).
- **AI usage** tab: totals (requests, success/fail, tokens, average latency, fallback rate), by plan /
  AI tool / model, provider error codes, daily series, top users and teams, recent events — with
  date range, plan, tool, status and model filters. No prompts, answers, keys or PII beyond the
  account name/e-mail an admin already sees elsewhere.

## 8. Web app

`src/lib/useEntitlements.js` (one cached fetch of `/me/entitlements`, refreshed after plan changes),
`src/components/plans/PlanBits.jsx` (`UpgradeNotice`, `PlanTag`, `LimitChip`, `AiQuotaWarning`),
`/dashboard/plan` (meters, 5-plan grid, comparison table, downgrade confirmation), `/dashboard/team`,
`/join-team`, Servix AI hub meter + plan-tagged tools, proposal filters/pipeline/labels, analytics depth,
admin tabs. Unknown entitlement state (request failed) **never locks the UI** — the API decides.

## 9. Verification

- `api/tests/entitlements-local.test.ts` (13): legacy data migration, effective plans, limits, feature
  locks, AI departments, atomic quota with concurrency, warning levels, failures not billed, team pool
  + member cap, downgrade keeps data, admin grants/overrides, analytics shapes.
- `api/tests/manual-subscriptions-sql-local.test.ts` (2): the guarded Neon script applies once, records
  the Prisma checksum, migrates legacy plans, is idempotent, refuses a wrong database.
- `tests/browser/plans.spec.js` (8): plan page + downgrade, AI meter / 100 % stop / locked tools, quota
  error copy, advanced filter gating + saved-search limit, proposal labels vs pipeline, team member vs
  owner views, admin AI dashboard + plan editor.
- Full regression: API `tsc`, all local suites, root tests 23/23, Playwright 100/100, live browser smoke
  on the real local stack with a scripted model server.

## 10. Rollout (owner actions)

1. Run `api/docs/manual-subscriptions-upgrade.sql` once in the Neon SQL Editor (production `neondb`)
   **before** the API deploy finishes starting — it is guarded and re-runnable.
2. Deploy (automatic from the branch). No new environment variables.
3. Optional: in Admin → Plans & organisations, adjust prices/limits; grant Enterprise to organisations.
