# Service Request Marketplace

Flag: `REQUESTS_ENABLED=true`. All `/requests/*`, `/proposals/*`,
`/admin/requests`, `/admin/proposals` return `503 FEATURE_DISABLED` when off,
and the UI hides the navigation entries.

Customers post what they need; professionals send proposals; the customer
accepts one and a **normal booking** is created, paid and fulfilled through the
existing pipeline (Paystack → escrow ledger → accept → start → deliver →
confirm/dispute → payout). No new payment, ledger or notification code.

## Data

* `service_requests` — owner `customer_id`, `category_id`, title/description,
  `budget_type` fixed|range with `budget_min_kobo`/`budget_max_kobo`,
  `deadline_at`, `preferred_delivery_at`, `is_remote`/`location`,
  `required_skills` JSON, `attachments` JSON (own uploaded media only),
  `extra_requirements`, `status`, `proposal_count`, `awarded_proposal_id`,
  `published_at`, `closed_at`.
* `proposals` — see PROPOSALS.md.
* `bookings.proposal_id` (unique) links the booking created on award.

## Request lifecycle

```
draft ──publish──▶ open ──pause──▶ paused ──publish──▶ open
  │                  │                 │
  │                  ├──close──▶ closed ◀──close──┘
  │                  └──accept proposal──▶ awarded
  └──cancel──▶ cancelled (also from open/paused)
```

* Publishing requires: title ≥ 6 chars, description ≥ 40 chars, a budget,
  and a location when not remote. Problems come back as `422 REQUEST_INCOMPLETE`
  with a per-field map (also returned as `publishProblems` on every read).
* Transitions are compare-and-set (`updateMany … where status in (…)`), so a
  stale client gets `409 INVALID_TRANSITION` instead of overwriting.
* Closing/cancelling rejects every live proposal and notifies those professionals.
* Editing is allowed in draft/open/paused only.

## Award

`POST /requests/:id/proposals/:pid/accept` runs in one transaction:

1. request must belong to the caller and be open/paused (CAS → `awarded`);
2. proposal must be `submitted` and not the caller's own;
3. the chosen proposal → `accepted`; every other submitted proposal → `rejected`;
4. a booking is created in `pending_payment` with `amount_kobo` = proposal price
   (immutable snapshot), `platform_fee_kobo` from the existing fee policy,
   `expected_delivery_at = start + delivery_days`, attached to the gig the
   professional picked or to an auto-created, **archived** (never listed)
   "Custom work" service for that professional;
5. audit log + notification to the professional; losers are notified after commit.

The client then calls the existing `POST /bookings/:id/pay`.

## Privacy

Professionals browsing requests see `displayName` (first name) and
`memberSince` only — never the customer's id, email or avatar. Attachments are
served through the normal media proxy.

## Endpoints

Customer (`requireAuth`): `GET/POST /requests`, `GET/PATCH /requests/:id`,
`POST /requests/:id/{publish|pause|close|cancel}`,
`GET /requests/:id/proposals`,
`POST /requests/:id/proposals/:pid/{accept|reject}`.

Professional (`requireProfessional`): `GET /requests/browse` (filters:
`category, minBudget, maxBudget, deadlineBefore, location, remote, skills, q,
sort=newest|deadline|budget-high|budget-low, page, pageSize`),
`GET /requests/browse/:id`, `POST /requests/:id/proposals`,
`GET /proposals/mine`, `PATCH /proposals/:id`, `POST /proposals/:id/withdraw`.

Admin (`requireAdmin`, read-only): `GET /admin/requests`, `GET /admin/proposals`.

## Tests

`api/tests/nextgen-local.test.ts` (isolated embedded PostgreSQL) covers
validation, ownership, publish checklist, every transition, one-live-proposal,
self-proposal refusal, award → booking snapshot, loser rejection, double-award
race, notifications and admin visibility. Browser journeys: `tests/browser/nextgen.spec.js`.
