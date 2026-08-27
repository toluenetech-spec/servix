-- SERVIX Phase D — bookings, payments, ledger, payouts, availability

CREATE TYPE "BookingStatus" AS ENUM ('pending_payment','requested','accepted','in_progress','delivered','completed','declined','cancelled','disputed','refunded');
CREATE TYPE "PaymentStatus" AS ENUM ('initiated','captured','failed','refunded');
CREATE TYPE "PayoutStatus" AS ENUM ('processing','paid','failed');
CREATE TYPE "LedgerAccount" AS ENUM ('provider_cash','customer_escrow','professional_payable','platform_revenue','refunds_paid');

CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'pending_payment',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "platform_fee_kobo" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "service_title" TEXT NOT NULL,
    "price_unit" TEXT NOT NULL,
    "notes" TEXT,
    "idempotency_key" TEXT,
    "cancelled_by" TEXT,
    "cancel_reason" TEXT,
    "dispute_reason" TEXT,
    "disputed_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "auto_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bookings_reference_key" ON "bookings"("reference");
CREATE UNIQUE INDEX "bookings_customer_id_idempotency_key_key" ON "bookings"("customer_id","idempotency_key");
CREATE INDEX "bookings_customer_id_status_idx" ON "bookings"("customer_id","status");
CREATE INDEX "bookings_professional_id_status_scheduled_at_idx" ON "bookings"("professional_id","status","scheduled_at");
CREATE INDEX "bookings_status_delivered_at_idx" ON "bookings"("status","delivered_at");
-- DB-level double-booking prevention for active bookings:
CREATE UNIQUE INDEX "bookings_active_slot_key" ON "bookings"("professional_id","scheduled_at")
    WHERE "status" IN ('pending_payment','requested','accepted','in_progress','delivered','disputed');

CREATE TABLE "booking_events" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "event" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "booking_events_booking_id_created_at_idx" ON "booking_events"("booking_id","created_at");

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'paystack',
    "reference" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'initiated',
    "amount_kobo" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");
CREATE INDEX "payments_booking_id_status_idx" ON "payments"("booking_id","status");
-- One open (initiated) payment per booking:
CREATE UNIQUE INDEX "payments_open_per_booking_key" ON "payments"("booking_id") WHERE "status" = 'initiated';

CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "webhook_events_provider_provider_id_key" ON "webhook_events"("provider","provider_id");

CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "txn_id" TEXT NOT NULL,
    "booking_id" TEXT,
    "payment_id" TEXT,
    "payout_id" TEXT,
    "subject_id" TEXT,
    "account" "LedgerAccount" NOT NULL,
    "direction" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "memo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ledger_entries_direction_check" CHECK ("direction" IN ('debit','credit')),
    CONSTRAINT "ledger_entries_amount_positive" CHECK ("amount_kobo" > 0)
);
CREATE INDEX "ledger_entries_txn_id_idx" ON "ledger_entries"("txn_id");
CREATE INDEX "ledger_entries_account_subject_id_idx" ON "ledger_entries"("account","subject_id");
CREATE INDEX "ledger_entries_booking_id_idx" ON "ledger_entries"("booking_id");

CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "PayoutStatus" NOT NULL DEFAULT 'processing',
    "provider_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payouts_reference_key" ON "payouts"("reference");
CREATE INDEX "payouts_professional_id_status_idx" ON "payouts"("professional_id","status");
-- One in-flight payout per professional:
CREATE UNIQUE INDEX "payouts_processing_per_pro_key" ON "payouts"("professional_id") WHERE "status" = 'processing';

CREATE TABLE "availability_rules" (
    "id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_hour" INTEGER NOT NULL,
    "end_hour" INTEGER NOT NULL,
    CONSTRAINT "availability_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "availability_rules_professional_id_weekday_key" ON "availability_rules"("professional_id","weekday");

CREATE TABLE "availability_exceptions" (
    "id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    CONSTRAINT "availability_exceptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "availability_exceptions_professional_id_date_key" ON "availability_exceptions"("professional_id","date");

-- Review ↔ booking link (unique when set)
ALTER TABLE "reviews" ADD COLUMN "booking_id" TEXT;
CREATE UNIQUE INDEX "reviews_booking_id_key" ON "reviews"("booking_id");
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FKs
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
