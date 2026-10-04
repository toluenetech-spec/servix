-- MANUAL ONLY: Neon SQL Editor, servix / production / neondb.
-- Applies the pending ADDITIVE migration 20261004120000_ai_feedback (one new
-- table, ai_feedback, for thumbs-up/down on Servix AI answers) and records it
-- in _prisma_migrations exactly as `npm run db:migrate` would.
-- Safe to re-run: an already-applied migration is skipped. No existing table,
-- column or row is touched. One DO statement = one atomic transaction.
-- Until this runs, only the "Was this helpful?" buttons and the admin
-- Satisfaction panel answer 503 SCHEMA_PENDING; everything else keeps working.
DO $servix_ai_feedback$
DECLARE
  applied_count integer;
BEGIN
  IF current_database() <> 'neondb' THEN
    RAISE EXCEPTION 'Wrong database; expected neondb. Stop.';
  END IF;
  PERFORM set_config('search_path', 'public', true);
  PERFORM set_config('lock_timeout', '5s', true);
  IF NOT pg_try_advisory_xact_lock(72492160927006::bigint) THEN
    RAISE EXCEPTION 'Another manual upgrade is running. Stop.';
  END IF;
  LOCK TABLE public._prisma_migrations IN SHARE ROW EXCLUSIVE MODE;

  -- 1. The previous migration (subscriptions) must already be applied.
  IF NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                 WHERE migration_name = '20261004000000_subscriptions_entitlements' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'Run docs/manual-subscriptions-upgrade.sql first; stop.';
  END IF;
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE rolled_back_at IS NOT NULL OR finished_at IS NULL) THEN
    RAISE EXCEPTION 'Unfinished or rolled-back migration records exist; stop and review.';
  END IF;

  -- 2. Already applied? Then do nothing.
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261004120000_ai_feedback') THEN
    RAISE NOTICE 'Migration 20261004120000_ai_feedback already recorded; nothing to do.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_feedback') THEN
    RAISE EXCEPTION 'Table ai_feedback already exists but the migration is not recorded; stop and review.';
  END IF;

  -- 3. The migration (identical to prisma/migrations/20261004120000_ai_feedback/migration.sql).
  CREATE TABLE "ai_feedback" (
      "id" TEXT NOT NULL,
      "user_id" TEXT,
      "department" TEXT NOT NULL,
      "rating" TEXT NOT NULL,
      "comment" TEXT,
      "prompt" TEXT,
      "answer" TEXT,
      "model_alias" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
  );

  CREATE INDEX "ai_feedback_created_at_idx" ON "ai_feedback"("created_at");
  CREATE INDEX "ai_feedback_rating_created_at_idx" ON "ai_feedback"("rating", "created_at");
  CREATE INDEX "ai_feedback_user_id_created_at_idx" ON "ai_feedback"("user_id", "created_at");

  ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

  -- 4. Record it as Prisma would (checksum = sha256 of migration.sql).
  INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (gen_random_uuid()::text, '1ce8fbc14f1a843da415dc7c428f107ffcfeb08cd1e3557a5e5b5bc21e322a70', now(), '20261004120000_ai_feedback', NULL, NULL, now(), 1);

  SELECT count(*) INTO applied_count FROM public._prisma_migrations WHERE migration_name = '20261004120000_ai_feedback';
  IF applied_count <> 1 THEN
    RAISE EXCEPTION 'Migration record not written; stop.';
  END IF;
  RAISE NOTICE 'Applied 20261004120000_ai_feedback: table ai_feedback created.';
END
$servix_ai_feedback$;

-- Check (run separately after the block above):
-- SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 2;
-- SELECT count(*) FROM ai_feedback;
