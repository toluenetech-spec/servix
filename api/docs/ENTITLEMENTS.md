# Entitlements, billing, teams and AI usage — API reference

Architecture and plan tables: `docs/SUBSCRIPTION_ENTITLEMENT_PLAN.md` (repository root).
All routes are under `/api/v1`, JSON, bearer auth unless noted. Errors use the standard envelope
`{ error: { status, code, message, meta? } }`.

## Plan errors (any route)

| Status / code | When | `meta` |
| --- | --- | --- |
| 403 `PLAN_LIMIT` | creating an item past a numeric cap | `{ kind:'limit', limit, plan, used, allowed, upgradeTo, upgradeToLabel }` |
| 403 `PLAN_FEATURE` | capability not in plan | `{ kind:'feature'|'ai_department', feature|department, plan, upgradeTo, upgradeToLabel }` |
| 403 `AI_QUOTA_EXCEEDED` | monthly AI tokens used up | `{ kind:'ai_quota', plan, used, allowed, resetAt, scope:'plan'|'member', upgradeTo }` |

## Account

- `GET /me/entitlements` — `{ current, label, source:'account'|'admin'|'organization', own, expiresAt,
  expired, organization, features[], limits{}, usage{}, aiDepartments[], ai: meter, period, plans[], subscriptions[] }`.
- `GET /billing/plan` — same payload (legacy alias of the above).
- `POST /billing/checkout { plan }` — purchasable plans only (go, pro, team); returns the provider
  authorisation URL. Payment handling unchanged from 0.6.x.
- `POST /billing/verify { reference }` — activates the plan after payment.
- `POST /billing/downgrade { confirm: true }` — immediate move to Free; nothing deleted.

## Productivity (plan-limited)

- `GET|POST /account/saved-searches`, `DELETE /account/saved-searches/:id` — `saved_searches` limit.
- `GET /exports` (what can be exported + remaining), `GET /exports/:kind.csv` — `monthly_exports` limit.
- `GET|POST /pro/profile/versions`, `POST …/:id/restore`, `DELETE …/:id` — `profile_versions` feature + limit.
- `PATCH /proposals/:id/organize { label, privateNote }` — `proposal_organization` (Go+).
- `GET /proposals/mine` — `{ items, labels, access: { organization, pipeline } }`; status/label filters
  and price/updated sorts require `proposal_pipeline` (Pro+).
- `GET /requests/browse` — remote/skills/location/sort filters require `advanced_filters` (Go+); basic
  keyword/category/budget filters are always available.

## Teams (`team_workspace`, Team and Enterprise)

- `POST /team { name }` · `GET /team` · `PATCH /team { name }` · `POST /team/leave`
- `POST /team/invites { email, role }` · `GET /team/invites/preview?token=` (no auth) ·
  `POST /team/invites/accept { token }`
- `PATCH /team/members/:id { role?, aiTokenCap? }` · `DELETE /team/members/:id`
- `GET /team/activity` · `GET /team/work` · `GET /team/ai-usage` (admins) · `GET /team/audit[?format=csv]` (Enterprise)

## Servix AI usage

- `GET /ai/usage` — `{ plan, planLabel, departments[], subject:'user'|'org', used, allowed, remaining,
  percent, level:'ok'|'warning'|'critical'|'exhausted', requests, periodStart, resetAt, member?, enabled }`.
- Every `/ai/*` success response includes `ai.quota` (same meter) after settlement.

## Admin (role `admin`)

- `GET /admin/plans` — catalogue, defaults, overrides, effective tables, account counts.
- `PATCH /admin/plans/:slug { price?, tagline?, cta?, highlighted?, isActive?, limits?, features?, aiDepartments? }`
- `POST /admin/users/:id/plan { plan, days?, note? }` — grant/assign any plan including Enterprise (audited).
- `GET /admin/organizations[?q=]` · `PATCH /admin/organizations/:id { plan?, planExpiresAt?, customLimits? }`
- `GET /admin/ai/usage?from&to&plan&department&status&model&userId&organizationId` — totals, byPlan,
  byDepartment, byModel, errors, series, topUsers, topOrganizations, filters.
- `GET /admin/ai/usage/events?page&pageSize&…same filters` — recent events (codes only, never content).
- `GET /admin/users/:id/ai-usage` — one account's meter + recent events.

## Data

Migration `20261004000000_subscriptions_entitlements`: `users.plan_slug/plan_expires_at/custom_limits`,
`plans.limits`, `plan_subscriptions.user_id`, `proposals.label/private_note`, tables `organizations`,
`organization_members`, `usage_periods`, `ai_usage_events`, `saved_searches`, `profile_versions`.
Production: apply once with `api/docs/manual-subscriptions-upgrade.sql` (guarded, idempotent).
Seed (`prisma/seed.ts`) upserts the five plans and deactivates unknown slugs; it never deletes plans.

## Local verification

```
cd api && RUN_LOCAL_ENTITLEMENT_TESTS=1 npx vitest run tests/entitlements-local.test.ts tests/manual-subscriptions-sql-local.test.ts
npx playwright test tests/browser/plans.spec.js
```
