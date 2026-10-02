-- Additive; apply manually with the existing controlled migration runner after review.
-- Next-generation marketplace foundations: delivery-deadline snapshot on bookings,
-- verified Servix portfolio items, automatic achievements, privacy-safe view counters,
-- preferred professionals, and the service-request / proposal marketplace (flag-gated).
CREATE TYPE "RequestStatus" AS ENUM ('draft', 'open', 'paused', 'closed', 'awarded', 'cancelled');
CREATE TYPE "BudgetType" AS ENUM ('fixed', 'range');
CREATE TYPE "ProposalStatus" AS ENUM ('submitted', 'withdrawn', 'rejected', 'accepted');

ALTER TABLE "bookings" ADD COLUMN "expected_delivery_at" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN "deadline_changed_at" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN "rebooked_from_id" TEXT;
ALTER TABLE "bookings" ADD COLUMN "proposal_id" TEXT;
CREATE UNIQUE INDEX "bookings_proposal_id_key" ON "bookings"("proposal_id");

ALTER TABLE "portfolio_items" ADD COLUMN "booking_id" TEXT;
ALTER TABLE "portfolio_items" ADD COLUMN "verified_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "portfolio_items_booking_id_key" ON "portfolio_items"("booking_id");
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "saved_professionals" ADD COLUMN "preferred" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "saved_professionals" ADD COLUMN "note" TEXT;

CREATE TABLE "professional_achievements" (
    "id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "professional_achievements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "professional_achievements_professional_id_slug_key" ON "professional_achievements"("professional_id", "slug");
CREATE INDEX "professional_achievements_slug_idx" ON "professional_achievements"("slug");
ALTER TABLE "professional_achievements" ADD CONSTRAINT "professional_achievements_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "view_counters" (
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "view_counters_pkey" PRIMARY KEY ("entity_type", "entity_id", "day")
);

CREATE TABLE "service_requests" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "budget_type" "BudgetType" NOT NULL DEFAULT 'fixed',
    "budget_min_kobo" BIGINT,
    "budget_max_kobo" BIGINT,
    "deadline_at" TIMESTAMP(3),
    "preferred_delivery_at" TIMESTAMP(3),
    "is_remote" BOOLEAN NOT NULL DEFAULT true,
    "location" TEXT,
    "required_skills" JSONB NOT NULL DEFAULT '[]',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "extra_requirements" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'draft',
    "awarded_proposal_id" TEXT,
    "proposal_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "service_requests_status_published_at_idx" ON "service_requests"("status", "published_at");
CREATE INDEX "service_requests_customer_id_status_idx" ON "service_requests"("customer_id", "status");
CREATE INDEX "service_requests_category_id_status_idx" ON "service_requests"("category_id", "status");
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "service_id" TEXT,
    "cover" TEXT NOT NULL,
    "price_kobo" BIGINT NOT NULL,
    "delivery_days" INTEGER NOT NULL,
    "milestones" JSONB NOT NULL DEFAULT '[]',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "proposed_start_at" TIMESTAMP(3),
    "status" "ProposalStatus" NOT NULL DEFAULT 'submitted',
    "rejected_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "proposals_request_id_status_idx" ON "proposals"("request_id", "status");
CREATE INDEX "proposals_professional_id_status_idx" ON "proposals"("professional_id", "status");
-- One live proposal per professional per request (business rule, enforced in the database).
CREATE UNIQUE INDEX "proposals_one_active_per_request" ON "proposals"("request_id", "professional_id") WHERE "status" IN ('submitted', 'accepted');
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
