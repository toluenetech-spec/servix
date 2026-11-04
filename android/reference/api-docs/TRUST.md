# Trust & Performance

Flag: `TRUST_ENABLED=true` (public trust endpoints + the trust block on profiles).

Everything in this section is computed on demand from real rows — `bookings`,
`booking_events`, `reviews`, `users`, `portfolio_items`, `view_counters` — by
`api/src/lib/trust.ts` (`computeTrust`). Nothing is self-reported, cached in a
way that can drift, or editable by professionals or admins. Below each
threshold the API returns `null` and the UI shows **"Not enough data"**.

## Metrics and formulas

| Metric | Formula | Shown when |
| --- | --- | --- |
| Completed jobs | `count(bookings.status = 'completed')` | always |
| Verified projects | completed bookings that have a `portfolio_items.booking_id` row | always |
| Rating | `professional_profiles.rating_avg` (maintained by the review pipeline) | `review_count ≥ 3` |
| Delivery reliability | `onTime / (measurable + against)` | `measurable ≥ 5` |
| Response rate | `answered / sample` where sample = bookings with a `payment_captured` event; answered = those with a later `accepted` or `declined` event. Median hours between the two is reported alongside. | `sample ≥ 5` |
| Repeat customers | `customers with ≥ 2 completed bookings / customers with ≥ 1 completed booking` | `customers ≥ 5` |
| On Servix | days since `professional_profiles.created_at` | always |
| Servix Verified | `verification = 'verified'` **and** the user's email is verified | — |
| Identity verified | `users.kyc_status = 'verified'` (manual KYC) | — |

### Delivery reliability in detail

* `expected_delivery_at` is **snapshotted at payment capture**
  (`capturePayment` in `bookingService.ts`): `max(now, scheduled_at) + service.delivery_days`.
  Proposals awarded through the request marketplace set it from the proposal's
  `delivery_days`. Bookings created before this shipped have no deadline and are
  simply not measurable — they never count against anyone.
* `measurable` = completed bookings with `expected_delivery_at` and `delivered_at`.
* `onTime` = `delivered_at ≤ expected_delivery_at`, **or** the booking carries a
  `customer_reschedule` event (customer-caused delays are never penalised),
  **or** `deadline_changed_at` is set (deadline moved by agreement).
* `against` = bookings the professional cancelled after having accepted them
  (`status = cancelled`, `cancelled_by = professional`, an `accepted` event
  exists) plus bookings whose final status is `refunded`.
* Percent is rounded to the nearest integer.

### Response rate in detail

Only **paid** requests count (`payment_captured`), so enquiries that never
reached payment do not affect the professional. The response is the first
`accepted` or `declined` event after capture. Auto-expiry is not a response.

## Endpoints

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/v1/professionals/:slug/trust` | public | public subset + earned achievements |
| GET | `/api/v1/professionals/:slug` | public | includes `trust` (when flag on) and `verifiedProjects`; portfolio items carry `verified`, `completedAt`, `customerRating`, `deliveryDays` |
| GET | `/api/v1/pro/trust` | professional | full metrics + rule evaluation (also refreshes achievements) |
| GET | `/api/v1/pro/analytics` | professional | now includes `views`, `reliability`, `repeatCustomers`, `response`, `achievements`, `verifiedProjects` |
| GET | `/api/v1/admin/trust` | admin | list with badge counts |
| GET | `/api/v1/admin/trust/:slug` | admin | metrics, badge history (incl. revoked), source |
| POST | `/api/v1/admin/trust/:slug/recompute` | admin | re-runs rules; audited |
| POST | `/api/v1/views` | public, rate limited | `{type: 'professional'|'service', slug}` → daily counter upsert, **no visitor identity stored** |

## Verified Servix Projects

`POST /api/v1/pro/portfolio/from-booking/:bookingId` creates a `portfolio_items`
row with `booking_id` + `verified_at`. Server rules: the booking must belong to
the calling professional and be `completed`; one portfolio item per booking
(unique index). Title/description/image may be customised; the verification
facts (completion date, customer rating, duration) are always derived from the
booking. `GET /api/v1/pro/portfolio/verifiable` lists candidates.

## Privacy

View counters are aggregate per entity per day. Customer identities never
appear in trust output; "repeat customers" is a count only.
