-- MANUAL ONLY: Neon SQL Editor, servix / production / neondb.
-- Applies the pending ADDITIVE migration 20261002120000_kyc_verifications
-- (identity verification: kyc_verifications table + users.kyc_status)
-- and records it in _prisma_migrations exactly as `npm run db:migrate` would.
-- Safe to re-run: an already-applied migration is skipped. Run this BEFORE the
-- API deploy that needs the new column (every user query reads users.kyc_status).
-- Do not run concurrently with another migration command. One DO statement = one
-- atomic transaction; nothing is changed if any check fails.
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
  IF NOT pg_try_advisory_xact_lock(72492160927003::bigint) THEN
    RAISE EXCEPTION 'Another manual upgrade is running. Stop.';
  END IF;
  LOCK TABLE public._prisma_migrations IN SHARE ROW EXCLUSIVE MODE;

  -- 1. The eleven earlier migrations must be present with the expected checksums.
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
    ('20261002000000_onboarding_gigs', '367ee51ebd68d828257688383c17cd7fb900e39f511ea7418d59dd4a8a26f901')
  ) AS expected(name, checksum)
    ON m.migration_name = expected.name AND m.checksum = expected.checksum
  WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL
    AND m.applied_steps_count = 1;
  IF matched <> 11 THEN
    RAISE EXCEPTION 'Base migration history/checksums do not match (% of 11); stop and review.', matched;
  END IF;
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE rolled_back_at IS NOT NULL OR finished_at IS NULL) THEN
    RAISE EXCEPTION 'Unfinished or rolled-back migration records exist; stop and review.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public._prisma_migrations
    WHERE migration_name NOT IN ('20260824000000_catalogue_init', '20260826000000_auth_accounts', '20260826100000_professional_onboarding', '20260826200000_bookings_payments', '20260827000000_phase_e', '20260926000000_email_verification_otp', '20260926100000_security_flows', '20260926200000_oauth', '20260928000000_community', '20261001000000_notifications_plans', '20261002000000_onboarding_gigs', '20261002120000_kyc_verifications')
  ) THEN
    RAISE EXCEPTION 'Unknown migration records exist; stop and review.';
  END IF;

  -- 2. The new objects must not already exist unless the migration is recorded.
  IF NOT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261002120000_kyc_verifications')
     AND (
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kyc_verifications')
       OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'kyc_status')
       OR EXISTS (SELECT 1 FROM pg_type WHERE typname IN ('KycDocumentType', 'KycStatus', 'UserKycStatus'))
     ) THEN
    RAISE EXCEPTION 'Some KYC objects already exist but the migration is not recorded; stop and review.';
  END IF;

  -- 3. 20261002120000_kyc_verifications
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261002120000_kyc_verifications') THEN
    RAISE NOTICE '20261002120000_kyc_verifications already recorded; skipped.';
  ELSE
-- Additive; apply manually with the existing controlled migration runner after review.
-- Manual KYC / identity verification: one submission per user, private file keys,
-- encrypted ID number, admin review trail, and a quick-check flag on users.
CREATE TYPE "KycDocumentType" AS ENUM ('nin_slip', 'international_passport', 'voters_card', 'drivers_license');
CREATE TYPE "KycStatus" AS ENUM ('not_submitted', 'pending', 'approved', 'rejected');
CREATE TYPE "UserKycStatus" AS ENUM ('unverified', 'pending', 'verified', 'rejected');

ALTER TABLE "users" ADD COLUMN "kyc_status" "UserKycStatus" NOT NULL DEFAULT 'unverified';

CREATE TABLE "kyc_verifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_type" "KycDocumentType" NOT NULL,
    "id_number_encrypted" TEXT NOT NULL,
    "id_number_digest" TEXT NOT NULL,
    "date_of_birth" DATE,
    "phone" TEXT,
    "document_file_key" TEXT NOT NULL,
    "selfie_file_key" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'pending',
    "rejection_reason" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "consent_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kyc_verifications_user_id_key" ON "kyc_verifications"("user_id");
CREATE INDEX "kyc_verifications_status_created_at_idx" ON "kyc_verifications"("status", "created_at");
CREATE INDEX "kyc_verifications_id_number_digest_idx" ON "kyc_verifications"("id_number_digest");

ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    INSERT INTO public._prisma_migrations
      (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
    VALUES (gen_random_uuid()::text, '0e8e80a22ed0192eef57e128ac0b5592475a2299d6de9d70cc7ed5f694efbce4', '20261002120000_kyc_verifications', now(), now(), 1);
    RAISE NOTICE '20261002120000_kyc_verifications applied.';
  END IF;

  SELECT count(*) INTO applied_count FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
  IF applied_count <> 12 THEN
    RAISE EXCEPTION 'Expected 12 completed migration records after upgrade, found %.', applied_count;
  END IF;
  RAISE NOTICE 'KYC upgrade complete: 12 migrations recorded.';
END;
$servix_upgrade$;

SELECT migration_name, finished_at
FROM public._prisma_migrations
ORDER BY migration_name;
