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

`src/lib/payments.ts` defines `PaymentProvider` with two drivers:

- **PaystackProvider** (active when `PAYSTACK_SECRET_KEY` is set): calls
  `api.paystack.co` — `/transaction/initialize`, `/transaction/verify`,
  `/transfer` — each with a 15s timeout (Phase E).
- **SandboxProvider** (active otherwise): serves a clearly-labelled local
  test-checkout page. Completing it emits a webhook **through the exact
  same signature-verified, idempotent pipeline** (HMAC-SHA512 with the
  configured secret). It is impossible to reach `captured` without a
  correctly signed webhook in either mode — sandbox parity, not faked
  success.

## 4. Webhook lifecycle & security

`POST /api/v1/webhooks/paystack`:
1. Raw body captured; `x-paystack-signature` must equal
   HMAC-SHA512(raw body, secret), timing-safe compared — otherwise
   **401, nothing persisted**.
2. Event stored with `UNIQUE(provider, provider_id)` — duplicates return
   200 no-op (never double-credit).
3. `charge.success` → server-to-server verify; amount/currency must match
   the payment row exactly.
4. Booking transition + ledger entries run in ONE DB transaction with
   CAS on payment AND booking. Out-of-order/repeated events no-op.
5. **Phase E:** processing errors record the error AND enqueue an
   idempotent `webhooks.retry` job that reprocesses the stored event
   with backoff; replays of processed events no-op.

## 5. Idempotency strategy

| Operation | Mechanism |
|---|---|
| Booking creation | `Idempotency-Key` header (`UNIQUE(customer_id, idempotency_key)`) |
| Slot integrity | Partial unique index on `(professional_id, scheduled_at)` for active statuses |
| Payment init | One open payment per booking (unique partial index) |
| Webhooks | `UNIQUE(provider, provider_id)` + CAS transitions |
| Payouts | `UNIQUE(professional_id) WHERE status='processing'` + in-transaction balance |
| Jobs (Phase E) | `UNIQUE(queue, idempotency_key)` + `FOR UPDATE SKIP LOCKED` claims |

## 6. Escrow & release

Verified payment → `customer_escrow`. Release only on `completed`:

```
DR customer_escrow  amount
CR professional_payable  amount − fee
CR platform_revenue      fee
```

A `disputed` booking cannot reach `completed` except through the admin
resolution endpoint, so disputed funds are frozen by construction.

## 7. Refund lifecycle (policy-controlled)

`src/lib/refundPolicy.ts` is the single source of refund rules — the
client never sends an amount:

| Scenario | Refund |
|---|---|
| Cancel before payment | n/a (nothing captured) |
| Customer cancels before acceptance | 100% |
| Professional declines / cancels at any stage | 100% |
| Customer cancels after acceptance, before work | 100% (config `REFUND_BEFORE_WORK_PCT`) |
| After work begins | no unilateral cancel → dispute; resolution decides |

Ledger: `DR customer_escrow / CR refunds_paid`. Payment → `refunded`.

## 8. Dispute lifecycle

Customer opens from `in_progress`/`delivered` with a reason →
`disputed` + funds frozen. **Phase E:** resolution is performed by
authenticated admins via `POST /admin/bookings/:id/resolve` (`release` →
completed, `refund` → refunded), every decision audit-logged, customer
notified by a queued email. The Phase D review-key endpoint is removed.

## 9. Ledger model (double-entry)

`ledger_entries` — append-only, no updates/deletes. Accounts:
`provider_cash · customer_escrow · professional_payable ·
platform_revenue · refunds_paid`. Every `txn_id` balances (asserted in
tests over ALL rows). Balances are always **derived from ledger
entries**, never from mutable rows.

## 10. Payout lifecycle

`POST /pro/payouts`: payable = ledger balance, recomputed inside the
transaction; hold posted (`DR professional_payable / CR provider_cash`);
provider transfer executed; `paid` on success. Duplicates → 409 (partial
unique index). Disputed bookings never contributed to payable.

### Failure recovery (Phase E)

If the provider transfer fails, the payout is CAS-marked `failed` and
the ledger hold is reversed **exactly once**
(`DR provider_cash / CR professional_payable`) — the professional's
balance is restored. `POST /admin/payouts/:id/retry` (or the
`payouts.retry` job) creates a fresh attempt; retrying an
already-recovered payout returns the successor payout instead of moving
money again.
