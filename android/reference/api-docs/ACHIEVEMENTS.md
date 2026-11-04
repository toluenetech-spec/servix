# Achievements

Flag: `ACHIEVEMENTS_ENABLED=true` (controls UI display; evaluation itself is
cheap and always safe).

Rules live in one registry: `api/src/lib/achievements.ts` → `ACHIEVEMENT_RULES`.
Each rule is a pure function of `TrustMetrics` (see TRUST.md), so a new badge
is a single entry. Badges are **earned automatically** and stored in
`professional_achievements` with the evidence that satisfied the rule.
Professionals cannot request, edit or hide them. When a rule stops holding the
row gets `revoked_at` (never deleted) so admins keep the history.

## Current rules

| Slug | Name | Criteria |
| --- | --- | --- |
| `servix_verified` | Servix Verified | approved professional + verified email + verified identity |
| `jobs_10` / `jobs_25` / `jobs_50` | N Jobs Completed | ≥ N completed bookings |
| `top_rated` | Top Rated | rating ≥ 4.8 across ≥ 10 reviews |
| `five_star` | 5-Star Professional | rating 5.0 across ≥ 5 reviews |
| `fast_responder` | Fast Responder | response rate ≥ 90 % and median < 6 h, ≥ 5 paid requests |
| `consistent_delivery` | Consistent Delivery | reliability ≥ 95 % across ≥ 5 measurable deliveries |
| `repeat_clients` | Repeat Client Professional | ≥ 30 % repeat rate across ≥ 5 customers |
| `long_term` | Long-Term Professional | > 365 days on Servix and ≥ 5 completed jobs |

## When rules run

* After every booking completion (`completeBooking` → `refreshProfessionalStanding`, fire-and-forget).
* When the professional opens their own trust view (`GET /pro/trust`).
* On admin recompute (`POST /admin/trust/:slug/recompute`, audited).

Newly earned badges create an in-app notification (`achievement.earned`)
through the existing notification system.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/achievements/catalog` | every badge with its criteria text (shown to users) |
| GET | `/api/v1/professionals/:slug/achievements` | earned, not revoked |
| GET | `/api/v1/professionals/:slug/trust` | includes `achievements` |
