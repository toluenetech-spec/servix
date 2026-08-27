# Servix — Payments, Ledger & Payouts (Phase D design + implementation)

## 1. Money representation

All financial amounts are **integers in kobo** (NGN minor units).
Catalogue prices remain whole-naira integers for display; the booking
snapshot converts once: `amountKobo = price × 100`. No floating-point
arithmetic anywhere in money paths (BigInt end-to-end).

## 2. Payment lifecycle

```
booking(pending_payment)
   │ POST /bookings/:id/pay            (customer, idempotent)
   ▼
payments row (initiated, unique open payment per booking)
   │ provider.initialize() → authorization_url + reference
   ▼
customer pays on the PROVIDER page (Paystack hosted checkout)
   │
   ▼ POST /webhooks/paystack  (charge.success)
signature verified → event persisted (idempotent) → provider.verify(reference)
   │ amount & currency re-checked against the payment row
   ▼
payment → captured  ·  booking pending_payment → requested (CAS)
ledger: DR provider_cash / CR customer_escrow
```

**The browser redirect/callback is NEVER authoritative.** The frontend
polls `GET /bookings/:id` and shows "payment processing" until the
webhook-driven state change lands. No client input can mark anything
paid.

## 3. Paystack integration (provider abstraction)

`src/lib/payments.ts` defines `PaymentProvider`:

```ts
interface PaymentProvider {
  name: string;
  initialize(p: { reference, amountKobo, email, callbackUrl }): { authorizationUrl, reference };
  verify(reference): { status: 'success'|'failed'|'pending', amountKobo, currency };
  transfer(p: { reference, amountKobo, recipient }): { status, providerRef };
}
```

- **PaystackProvider** (active when `PAYSTACK_SECRET_KEY` is set): calls
  `api.paystack.co` — `/transaction/initialize`, `/transaction/verify`,
  `/transfer`. The booking/ledger domain only sees the interface.
- **SandboxProvider** (active otherwise, e.g. this environment, where
  outbound Paystack traffic is blocked): serves a clearly-labelled local
  test-checkout page. Completing it emits a webhook **through the exact
  same signature-verified, idempotent pipeline** (HMAC-SHA512 with the
  configured secret) — the domain code path is identical to production.
  It is impossible to reach `captured` without a correctly signed
  webhook in either mode. This is sandbox parity, not faked success.

## 4. Webhook lifecycle & security

`POST /api/v1/webhooks/paystack`:
1. Raw request body captured; `x-paystack-signature` must equal
   HMAC-SHA512(raw body, secret) — otherwise **401, nothing persisted**.
2. Event stored in `webhook_events` with `UNIQUE(provider, provider_id)`
   — duplicate deliveries hit the constraint and return 200 no-op
   (never double-credit).
3. `charge.success` → `provider.verify(reference)` server-to-server;
   verified amount/currency must match the payment row exactly
   (mismatch → event recorded as error, nothing credited).
4. Booking transition + ledger entries run in ONE DB transaction with a
   CAS on both payment (`initiated→captured`) and booking
   (`pending_payment→requested`). Out-of-order or repeated events find
   the CAS empty and no-op safely.

## 5. Idempotency strategy

| Operation | Mechanism |
|---|---|
| Booking creation | `Idempotency-Key` header stored on the booking (`UNIQUE(customer_id, idempotency_key)`); replays return the original booking |
| Slot integrity | Partial unique index on `(professional_id, scheduled_at)` for active statuses |
| Payment init | One open payment per booking (unique partial index); repeat calls return the existing checkout URL |
| Webhooks | `UNIQUE(provider, provider_id)` + CAS transitions |
| Payouts | `UNIQUE(professional_id) WHERE status='processing'` + ledger-derived balance recomputed inside the transaction |

## 6. Escrow & release

Verified payment → funds sit in `customer_escrow` (ledger). Release
happens only on `completed` (customer confirm or 3-day auto-confirm):

```
DR customer_escrow  amount
CR professional_payable  amount − fee
CR platform_revenue      fee
```

A `disputed` booking cannot reach `completed` except through the
internal resolution endpoint, so disputed funds are frozen by
construction.

## 7. Refund lifecycle (policy-controlled)

`src/lib/refundPolicy.ts` is the single source of refund rules — the
client never sends an amount:

| Scenario | Refund |
|---|---|
| Cancel before payment | n/a (nothing captured) |
| Customer cancels before acceptance (`requested`) | 100% |
| Professional declines / cancels at any stage | 100% |
| Customer cancels after acceptance, before work (`accepted`) | 100% (config `REFUND_BEFORE_WORK_PCT`) |
| After work begins (`in_progress`) | no unilateral cancel → dispute; resolution decides 0% or 100% |

Ledger: `DR customer_escrow / CR refunds_paid`. Payment row →
`refunded`. With Paystack credentials the provider refund call is issued;
the ledger is the source of truth either way.

## 8. Dispute lifecycle

Customer opens from `in_progress`/`delivered` with a reason →
`disputed` + funds frozen. Resolution is **internal-only** (same
`X-Servix-Review-Key` guard as application review; admin dashboard is
Phase E): `release` → completed + normal release entries, or `refund` →
refunded + refund entries. Both are CAS transitions; no automatic path
touches disputed money.

## 9. Ledger model (double-entry)

`ledger_entries(txn_id, booking_id, payment_id, payout_id, account,
direction, amount_kobo)` — append-only, no updates/deletes. Accounts:
`provider_cash · customer_escrow · professional_payable ·
platform_revenue · refunds_paid`. Every `txn_id` balances
(Σdebits = Σcredits) — asserted in tests for every flow. Balances (e.g.
a professional's payable) are always **derived from ledger entries**,
never from summing mutable booking/payment rows.

## 10. Payout lifecycle

`POST /pro/payouts` (professional): payable = ledger credits − debits on
`professional_payable` for that professional. If > 0 and no payout is
in-flight: create `payouts` row (processing) + `DR professional_payable /
CR provider_cash`, call `provider.transfer(reference…)`, store the
provider reference, mark `paid`. Duplicate requests while one is
processing → `409`. Disputed bookings never contributed to payable, so
they cannot be paid out. `GET /pro/earnings` returns payable balance,
lifetime earnings and payout history — all ledger-derived.
