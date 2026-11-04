# Servix — Bookings, Escrow & Disputes (Phase D design + implementation)

> Decisions locked earlier: Paystack · 3-day customer confirmation ·
> 3-day payout release after completion unless disputed · PostgreSQL.

## 1. Booking state machine

```
                         ┌──────────────┐
   customer creates ───▶ │pending_payment│──payment verified (webhook)──┐
                         └──────┬───────┘                               ▼
                                │cancel (customer)                 ┌─────────┐
                                ▼                                  │requested│
                           cancelled                               └────┬────┘
                                                    decline (pro) ◀─────┼─────▶ cancel (customer, full refund)
                                                        │               │accept (pro)
                                                        ▼               ▼
                                                    declined         ┌────────┐    cancel (customer: policy refund
                                                  (full refund)      │accepted│◀──  / pro: full refund)
                                                                     └───┬────┘
                                                                         │start (pro)
                                                                         ▼
                                                                   ┌───────────┐   dispute (customer)
                                                                   │in_progress│──────────────┐
                                                                   └────┬──────┘              │
                                                                        │deliver (pro)        ▼
                                                                        ▼                ┌────────┐
                                                                   ┌─────────┐  dispute  │disputed│
                                                                   │delivered│──────────▶└───┬────┘
                                                                   └────┬────┘               │resolve (admin, Phase E)
                                                                        │confirm (customer)  │ release → completed
                                                                        │or AUTO after 3 days│ refund  → refunded
                                                                        ▼                    ▼
                                                                    completed          completed | refunded
```

### Allowed transitions (server-controlled — clients NEVER set status)

| From | To | Actor | Endpoint | Money effect |
|---|---|---|---|---|
| — | `pending_payment` | customer | `POST /bookings` | none |
| `pending_payment` | `requested` | **system** (verified webhook only) | webhook | capture → escrow |
| `pending_payment` | `cancelled` | customer | `/cancel` | none (nothing captured) |
| `requested` | `accepted` | professional (owner) | `/accept` | none (stays in escrow) |
| `requested` | `declined` | professional (owner) | `/decline` | **full refund** |
| `requested` | `cancelled` | customer (owner) | `/cancel` | **full refund** (before acceptance) |
| `accepted` | `in_progress` | professional | `/start` | none |
| `accepted` | `cancelled` | customer | `/cancel` | policy refund (default 100% before work begins) |
| `accepted` | `cancelled` | professional | `/cancel` | **full refund** |
| `in_progress` | `delivered` | professional | `/deliver` | none |
| `in_progress` | `disputed` | customer | `/dispute` | funds frozen |
| `in_progress` | `cancelled` | professional | `/cancel` | **full refund** |
| `delivered` | `completed` | customer | `/confirm` | escrow → payable + fee |
| `delivered` | `completed` (auto) | **system** (3-day sweep) | — | escrow → payable + fee |
| `delivered` | `disputed` | customer (within window) | `/dispute` | funds frozen |
| `disputed` | `completed` | **admin** (Phase E, audited) | `POST /admin/bookings/:id/resolve` release | escrow → payable + fee |
| `disputed` | `refunded` | **admin** (Phase E, audited) | `POST /admin/bookings/:id/resolve` refund | escrow → refund |

Everything else → `409 INVALID_TRANSITION`.

> **Phase E change:** the temporary `X-Servix-Review-Key`-guarded
> `/bookings/:id/resolve` endpoint has been REMOVED. Dispute resolution
> is now performed by authenticated admins through
> `POST /api/v1/admin/bookings/:id/resolve` and recorded in the audit log.

### Concurrency / race strategy

Every transition executes inside a Prisma transaction as a **compare-and-
swap**: `updateMany({ where: { id, status: <expectedFrom> }, data: … })`.
If `count === 0` another request won the race → `409 CONFLICT`. Financial
side-effects run in the same DB transaction as the state change, so a
booking can never be, e.g., refunded twice or completed-and-refunded.
Every transition appends an immutable `booking_events` row (audit trail).

### Snapshots

`bookings` stores at creation time: `amountKobo` (price × 100, integer),
`currency`, `serviceTitle`, `priceUnit` — the agreed price is immune to
later service edits. `platformFeeKobo` is computed at creation from the
configured fee (default 10%) and frozen.

## 2. Availability model

- `availability_rules` — weekly template: weekday (0–6), startHour,
  endHour (1-hour slots). Default when a professional has no rules:
  Mon–Fri 9:00–17:00.
- `availability_exceptions` — full-day closures for specific dates.
- **Booked-slot conflicts:** a partial unique index
  `(professional_id, scheduled_at) WHERE status IN ('requested','accepted','in_progress','delivered','disputed','pending_payment')`
  makes double-booking impossible at the database level, regardless of
  application race conditions. The API also pre-checks and returns a
  friendly `409 SLOT_TAKEN`.
- `GET /services/:slug/availability?days=N` returns real bookable slots
  (rules − exceptions − active bookings).

## 3. Review eligibility

`reviews.booking_id` (nullable for legacy seed reviews, **UNIQUE** when
set). `POST /bookings/:id/review` requires, server-side: requester is the
booking's customer; booking status = `completed`; the review targets the
booking's own service/professional (derived server-side); no review
exists for the booking. On success service and professional aggregates
are recomputed in the same transaction.

## 4. Auto-confirmation sweep

`runAutoConfirmSweep()` finds `delivered` bookings with
`delivered_at <= now() − 3 days`, and completes each via the same CAS
transition + release transaction as a manual confirm (marked
`auto: true` in `booking_events`). In Phase E the sweep is scheduled as
an idempotent repeatable job (10-minute buckets) through the job queue;
tests invoke it directly. Disputed bookings are by definition no longer
`delivered`, so they can never auto-release.
