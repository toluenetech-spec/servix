-- MANUAL ONLY: Neon SQL Editor, servix / production / neondb.
-- Applies the pending ADDITIVE migration 20261002000000_onboarding_gigs
-- (profile photos, CV/LinkedIn import fields, gig wizard fields, mixed gallery media)
-- and records it in _prisma_migrations exactly as `npm run db:migrate` would.
-- Safe to re-run: an already-applied migration is skipped. Run this BEFORE the
-- API deploy that needs the new columns. Do not run concurrently with another
-- migration command. One DO statement = one atomic transaction.
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
  IF NOT pg_try_advisory_xact_lock(72492160927002::bigint) THEN
    RAISE EXCEPTION 'Another manual upgrade is running. Stop.';
  END IF;
  LOCK TABLE public._prisma_migrations IN SHARE ROW EXCLUSIVE MODE;

  -- 1. The ten earlier migrations must be present with the expected checksums.
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
    ('20261001000000_notifications_plans', 'ff28143366e0b8af6d4b8dbd91830153f570d214c45936dd4c2bf7a1b5d2284e')
  ) AS expected(name, checksum)
    ON m.migration_name = expected.name AND m.checksum = expected.checksum
  WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL
    AND m.applied_steps_count = 1;
  IF matched <> 10 THEN
    RAISE EXCEPTION 'Base migration history/checksums do not match (% of 10); stop and review.', matched;
  END IF;
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE rolled_back_at IS NOT NULL OR finished_at IS NULL) THEN
    RAISE EXCEPTION 'Unfinished or rolled-back migration records exist; stop and review.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public._prisma_migrations
    WHERE migration_name NOT IN ('20260824000000_catalogue_init', '20260826000000_auth_accounts', '20260826100000_professional_onboarding', '20260826200000_bookings_payments', '20260827000000_phase_e', '20260926000000_email_verification_otp', '20260926100000_security_flows', '20260926200000_oauth', '20260928000000_community', '20261001000000_notifications_plans', '20261002000000_onboarding_gigs')
  ) THEN
    RAISE EXCEPTION 'Unknown migration records exist; stop and review.';
  END IF;

  -- 2. The columns must not already exist unless the migration is recorded.
  IF NOT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261002000000_onboarding_gigs')
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND (
         (table_name = 'users' AND column_name = 'avatar_url') OR
         (table_name = 'professional_applications' AND column_name IN ('details', 'photo_url', 'resume_url', 'resume_file_name')) OR
         (table_name = 'professional_profiles' AND column_name = 'details') OR
         (table_name = 'services' AND column_name IN ('search_tags', 'service_type', 'delivery_days', 'revisions')) OR
         (table_name = 'service_media' AND column_name IN ('kind', 'file_name'))
       )
     ) THEN
    RAISE EXCEPTION 'Some new columns already exist but the migration is not recorded; stop and review.';
  END IF;

  -- 3. 20261002000000_onboarding_gigs
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261002000000_onboarding_gigs') THEN
    RAISE NOTICE '20261002000000_onboarding_gigs already recorded; skipped.';
  ELSE
-- Additive; apply manually with the existing controlled migration runner after review.
-- Fiverr-style professional onboarding (CV/LinkedIn import, richer profile details, photo),
-- gig creation wizard fields (search tags, service type, delivery, revisions, mixed media),
-- and account profile photos.
ALTER TABLE "users" ADD COLUMN "avatar_url" TEXT;
ALTER TABLE "professional_applications" ADD COLUMN "details" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "professional_applications" ADD COLUMN "photo_url" TEXT;
ALTER TABLE "professional_applications" ADD COLUMN "resume_url" TEXT;
ALTER TABLE "professional_applications" ADD COLUMN "resume_file_name" TEXT;
ALTER TABLE "professional_profiles" ADD COLUMN "details" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "services" ADD COLUMN "search_tags" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "services" ADD COLUMN "service_type" TEXT;
ALTER TABLE "services" ADD COLUMN "delivery_days" INTEGER;
ALTER TABLE "services" ADD COLUMN "revisions" INTEGER;
ALTER TABLE "service_media" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'image';
ALTER TABLE "service_media" ADD COLUMN "file_name" TEXT;

    INSERT INTO public._prisma_migrations
      (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
    VALUES (gen_random_uuid()::text, '367ee51ebd68d828257688383c17cd7fb900e39f511ea7418d59dd4a8a26f901', '20261002000000_onboarding_gigs', now(), now(), 1);
    RAISE NOTICE '20261002000000_onboarding_gigs applied.';
  END IF;

  SELECT count(*) INTO applied_count FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
  IF applied_count <> 11 THEN
    RAISE EXCEPTION 'Expected 11 completed migration records after upgrade, found %.', applied_count;
  END IF;
  RAISE NOTICE 'Onboarding/gig upgrade complete: 11 migrations recorded.';
END;
$servix_upgrade$;

SELECT migration_name, finished_at
FROM public._prisma_migrations
ORDER BY migration_name;
