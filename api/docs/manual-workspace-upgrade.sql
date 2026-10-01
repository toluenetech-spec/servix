-- MANUAL ONLY: Neon SQL Editor, servix / production / neondb.
-- Applies the two pending ADDITIVE migrations (community, notifications_plans)
-- and records them in _prisma_migrations exactly as `npm run db:migrate` would.
-- Safe to re-run: already-applied migrations are skipped. Keep COMMUNITY_ENABLED
-- false until the API deploy is verified. Do not run concurrently with another
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

  -- 1. The eight base migrations must be present with the expected checksums.
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
    ('20260926200000_oauth', '4ff252edf47f510e1e56ba683a239f8d6f7593c87ae728b856d31b13a23ec816')
  ) AS expected(name, checksum)
    ON m.migration_name = expected.name AND m.checksum = expected.checksum
  WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL
    AND m.applied_steps_count = 1;
  IF matched <> 8 THEN
    RAISE EXCEPTION 'Base migration history/checksums do not match (% of 8); stop and review.', matched;
  END IF;
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE rolled_back_at IS NOT NULL OR finished_at IS NULL) THEN
    RAISE EXCEPTION 'Unfinished or rolled-back migration records exist; stop and review.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public._prisma_migrations
    WHERE migration_name NOT IN ('20260824000000_catalogue_init', '20260826000000_auth_accounts', '20260826100000_professional_onboarding', '20260826200000_bookings_payments', '20260827000000_phase_e', '20260926000000_email_verification_otp', '20260926100000_security_flows', '20260926200000_oauth', '20260928000000_community', '20261001000000_notifications_plans')
  ) THEN
    RAISE EXCEPTION 'Unknown migration records exist; stop and review.';
  END IF;

  -- 2. 20260928000000_community
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20260928000000_community') THEN
    RAISE NOTICE '20260928000000_community already recorded; skipped.';
  ELSE
-- Additive; apply manually with the existing controlled migration runner after review.
CREATE TABLE "community_connections" (
 "id" TEXT PRIMARY KEY, "pair_key" TEXT NOT NULL UNIQUE,
 "requester_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "recipient_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','accepted','declined','removed','blocked')),
 "blocked_by_id" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CHECK ("requester_id" <> "recipient_id"), CHECK ("blocked_by_id" IS NULL OR "blocked_by_id" IN ("requester_id", "recipient_id"))
);
CREATE INDEX "community_connections_requester_id_status_idx" ON "community_connections"("requester_id","status");
CREATE INDEX "community_connections_recipient_id_status_idx" ON "community_connections"("recipient_id","status");
CREATE TABLE "chat_threads" (
 "id" TEXT PRIMARY KEY,
 "participant_a_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "participant_b_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "booking_id" TEXT UNIQUE REFERENCES "bookings"("id") ON DELETE RESTRICT,
 "connection_id" TEXT UNIQUE REFERENCES "community_connections"("id") ON DELETE RESTRICT,
 "read_at_a" TIMESTAMP(3), "read_at_b" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CHECK ("participant_a_id" <> "participant_b_id"), CHECK (("booking_id" IS NULL) <> ("connection_id" IS NULL))
);
CREATE INDEX "chat_threads_participant_a_id_updated_at_idx" ON "chat_threads"("participant_a_id","updated_at");
CREATE INDEX "chat_threads_participant_b_id_updated_at_idx" ON "chat_threads"("participant_b_id","updated_at");
CREATE TABLE "chat_messages" (
 "id" TEXT PRIMARY KEY, "thread_id" TEXT NOT NULL REFERENCES "chat_threads"("id") ON DELETE CASCADE,
 "sender_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "client_id" TEXT NOT NULL, "body" TEXT NOT NULL CHECK (length("body") BETWEEN 1 AND 4000),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("sender_id", "client_id")
);
CREATE INDEX "chat_messages_thread_id_created_at_id_idx" ON "chat_messages"("thread_id","created_at","id");

    INSERT INTO public._prisma_migrations
      (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
    VALUES (gen_random_uuid()::text, 'afb6fd1c71de9a33bb9d116daeb957682c1e9e61b94870edce1d411b0a66f79a', '20260928000000_community', now(), now(), 1);
    RAISE NOTICE '20260928000000_community applied.';
  END IF;

  -- 2. 20261001000000_notifications_plans
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261001000000_notifications_plans') THEN
    RAISE NOTICE '20261001000000_notifications_plans already recorded; skipped.';
  ELSE
-- Additive; apply manually with the existing controlled migration runner after review.
-- Notifications (in-app), admin broadcasts, professional plan subscriptions, saved professionals.
ALTER TABLE "professional_profiles" ADD COLUMN "plan_slug" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "professional_profiles" ADD COLUMN "plan_expires_at" TIMESTAMP(3);
CREATE TABLE "notification_broadcasts" (
 "id" TEXT PRIMARY KEY,
 "admin_id" TEXT NOT NULL REFERENCES "users"("id"),
 "audience" TEXT NOT NULL CHECK ("audience" IN ('all','customers','professionals','user')),
 "title" TEXT NOT NULL CHECK (length("title") BETWEEN 1 AND 120),
 "body" TEXT NOT NULL CHECK (length("body") BETWEEN 1 AND 2000),
 "link" TEXT, "recipient_count" INTEGER NOT NULL DEFAULT 0,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "notification_broadcasts_created_at_idx" ON "notification_broadcasts"("created_at" DESC);
CREATE TABLE "notifications" (
 "id" TEXT PRIMARY KEY,
 "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "type" TEXT NOT NULL, "title" TEXT NOT NULL CHECK (length("title") BETWEEN 1 AND 120),
 "body" TEXT NOT NULL CHECK (length("body") BETWEEN 1 AND 2000), "link" TEXT,
 "broadcast_id" TEXT REFERENCES "notification_broadcasts"("id") ON DELETE SET NULL,
 "read_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id","created_at" DESC);
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id","read_at");
CREATE TABLE "plan_subscriptions" (
 "id" TEXT PRIMARY KEY,
 "professional_id" TEXT NOT NULL REFERENCES "professional_profiles"("id") ON DELETE CASCADE,
 "plan_slug" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'initiated' CHECK ("status" IN ('initiated','active','failed','expired','cancelled')),
 "reference" TEXT NOT NULL UNIQUE, "provider" TEXT NOT NULL DEFAULT 'paystack',
 "amount_kobo" BIGINT NOT NULL CHECK ("amount_kobo" >= 0), "currency" TEXT NOT NULL DEFAULT 'NGN',
 "starts_at" TIMESTAMP(3), "ends_at" TIMESTAMP(3), "verified_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "plan_subscriptions_professional_id_status_idx" ON "plan_subscriptions"("professional_id","status");
CREATE TABLE "saved_professionals" (
 "id" TEXT PRIMARY KEY,
 "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "professional_id" TEXT NOT NULL REFERENCES "professional_profiles"("id") ON DELETE CASCADE,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("user_id","professional_id")
);

    INSERT INTO public._prisma_migrations
      (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
    VALUES (gen_random_uuid()::text, 'ff28143366e0b8af6d4b8dbd91830153f570d214c45936dd4c2bf7a1b5d2284e', '20261001000000_notifications_plans', now(), now(), 1);
    RAISE NOTICE '20261001000000_notifications_plans applied.';
  END IF;

  SELECT count(*) INTO applied_count FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
  IF applied_count <> 10 THEN
    RAISE EXCEPTION 'Expected 10 completed migration records after upgrade, found %.', applied_count;
  END IF;
  RAISE NOTICE 'Workspace upgrade complete: 10 migrations recorded.';
END;
$servix_upgrade$;

SELECT migration_name, finished_at
FROM public._prisma_migrations
ORDER BY migration_name;
