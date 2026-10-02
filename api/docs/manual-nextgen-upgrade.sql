-- MANUAL ONLY: Neon SQL Editor, servix / production / neondb.
-- Applies the pending ADDITIVE migration 20261003000000_nextgen_marketplace
-- (next-generation marketplace: booking delivery-deadline snapshot, verified
-- portfolio items, achievements, view counters, preferred professionals,
-- service requests + proposals) and records it in _prisma_migrations exactly
-- as `npm run db:migrate` would.
-- Safe to re-run: an already-applied migration is skipped. Run this BEFORE the
-- API deploy that needs the new columns (bookings, portfolio_items and
-- saved_professionals queries read them). Do not run concurrently with another
-- migration command. One DO statement = one atomic transaction; nothing is
-- changed if any check fails. No existing rows are modified or deleted.
DO $servix_upgrade$
DECLARE
  matched integer;
  applied_count integer;
BEGIN
  IF current_database() <> 'neondb' THEN
    RAISE EXCEPTION 'Wrong database; expected neondb. Stop.';
  END IF;
  PERFORM set_config('search_path', 'public', true);
  PERFORM set_config('lock_timeout', '5s', true);
  IF NOT pg_try_advisory_xact_lock(72492160927004::bigint) THEN
    RAISE EXCEPTION 'Another manual upgrade is running. Stop.';
  END IF;
  LOCK TABLE public._prisma_migrations IN SHARE ROW EXCLUSIVE MODE;

  -- 1. The twelve earlier migrations must be present with the expected checksums.
  SELECT count(*) INTO matched
  FROM public._prisma_migrations m
  JOIN (VALUES
    ('20260824000000_catalogue_init', 'd52ab0fd3a583eef6d794be3f026f694fc0b332e2e671e59aca09b0115b8cf62'),
    ('20260826000000_auth_accounts', '34e649b6a3257a24f2b4ca9739d67d7932fdaa68a20823f2a1a4d43ad53c19bf'),
    ('20260826100000_professional_onboarding', 'ffb6532fd02550320369cda2799d3b5518f83baa2d581d8ba3976cf3e12c1e41'),
    ('20260826200000_bookings_payments', 'c9638c54861d4f61d0bc3d6a1371c55c53b5a94bf14089070a65e0721fcb8f84'),
    ('20260827000000_phase_e', '66a4423c8d0de193eafd53cdce611b70efd6741ec0944c313a00424258940eda'),
    ('20260926000000_email_verification_otp', '291fbc1d08752001e377f73b242d7a14a878524b5dfd265b653740fe849dacf9'),
    ('20260926100000_security_flows', '9c7bb6b181001728d2a183738077d7e6e4891687b5ec4e9d2c4d12bc5c56ffc2'),
    ('20260926200000_oauth', '4ff252edf47f510e1e56ba683a239f8d6f7593c87ae728b856d31b13a23ec816'),
    ('20260928000000_community', 'afb6fd1c71de9a33bb9d116daeb957682c1e9e61b94870edce1d411b0a66f79a'),
    ('20261001000000_notifications_plans', 'ff28143366e0b8af6d4b8dbd91830153f570d214c45936dd4c2bf7a1b5d2284e'),
    ('20261002000000_onboarding_gigs', '367ee51ebd68d828257688383c17cd7fb900e39f511ea7418d59dd4a8a26f901'),
    ('20261002120000_kyc_verifications', '0e8e80a22ed0192eef57e128ac0b5592475a2299d6de9d70cc7ed5f694efbce4')
  ) AS expected(name, checksum)
    ON m.migration_name = expected.name AND m.checksum = expected.checksum
  WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL
    AND m.applied_steps_count = 1;
  IF matched <> 12 THEN
    RAISE EXCEPTION 'Base migration history/checksums do not match (% of 12); stop and review.', matched;
  END IF;
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE rolled_back_at IS NOT NULL OR finished_at IS NULL) THEN
    RAISE EXCEPTION 'Unfinished or rolled-back migration records exist; stop and review.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public._prisma_migrations
    WHERE migration_name NOT IN ('20260824000000_catalogue_init', '20260826000000_auth_accounts', '20260826100000_professional_onboarding', '20260826200000_bookings_payments', '20260827000000_phase_e', '20260926000000_email_verification_otp', '20260926100000_security_flows', '20260926200000_oauth', '20260928000000_community', '20261001000000_notifications_plans', '20261002000000_onboarding_gigs', '20261002120000_kyc_verifications', '20261003000000_nextgen_marketplace')
  ) THEN
    RAISE EXCEPTION 'Unknown migration records exist; stop and review.';
  END IF;

  -- 2. The new objects must not already exist unless the migration is recorded.
  IF NOT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261003000000_nextgen_marketplace')
     AND (
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('service_requests', 'proposals', 'professional_achievements', 'view_counters'))
       OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name IN ('expected_delivery_at', 'proposal_id', 'rebooked_from_id', 'deadline_changed_at'))
       OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'portfolio_items' AND column_name IN ('booking_id', 'verified_at'))
       OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'saved_professionals' AND column_name IN ('preferred', 'note'))
       OR EXISTS (SELECT 1 FROM pg_type WHERE typname IN ('RequestStatus', 'BudgetType', 'ProposalStatus'))
     ) THEN
    RAISE EXCEPTION 'Some next-gen objects already exist but the migration is not recorded; stop and review.';
  END IF;

  -- 3. 20261003000000_nextgen_marketplace
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261003000000_nextgen_marketplace') THEN
    RAISE NOTICE '20261003000000_nextgen_marketplace already recorded; skipped.';
  ELSE
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

    INSERT INTO public._prisma_migrations
      (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
    VALUES (gen_random_uuid()::text, '4f11caf63e1b0cd2eb54b1c87027e8501f9dfcba2a5c41f802144797518efe95', '20261003000000_nextgen_marketplace', now(), now(), 1);
    RAISE NOTICE '20261003000000_nextgen_marketplace applied.';
  END IF;

  SELECT count(*) INTO applied_count FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
  IF applied_count <> 13 THEN
    RAISE EXCEPTION 'Expected 13 completed migration records after upgrade, found %.', applied_count;
  END IF;
  RAISE NOTICE 'Next-gen marketplace upgrade complete: 13 migrations recorded.';
END;
$servix_upgrade$;
