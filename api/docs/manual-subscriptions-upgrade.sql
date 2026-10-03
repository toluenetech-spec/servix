-- MANUAL ONLY: Neon SQL Editor, servix / production / neondb.
-- Applies the pending ADDITIVE migration 20261004000000_subscriptions_entitlements
-- (subscription plans for every account — Free / Go / Pro / Team / Enterprise —
-- centralised entitlements, metered AI usage, team workspaces, saved searches,
-- profile versions, proposal labels/notes) and records it in _prisma_migrations
-- exactly as `npm run db:migrate` would.
-- Safe to re-run: an already-applied migration is skipped. Run this BEFORE the
-- API deploy that needs the new columns (users.plan_slug is read on every
-- authenticated request). Do not run concurrently with another migration
-- command. One DO statement = one atomic transaction; nothing is changed if any
-- check fails. No rows are deleted. Existing plan rows 'professional'/'business'
-- are renamed to 'pro'/'team' and existing professional plan assignments are
-- copied onto their user rows (data-preserving; see section 3 of the SQL).
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
  IF NOT pg_try_advisory_xact_lock(72492160927005::bigint) THEN
    RAISE EXCEPTION 'Another manual upgrade is running. Stop.';
  END IF;
  LOCK TABLE public._prisma_migrations IN SHARE ROW EXCLUSIVE MODE;

  -- 1. The thirteen earlier migrations must be present with the expected checksums.
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
    ('20261002120000_kyc_verifications', '0e8e80a22ed0192eef57e128ac0b5592475a2299d6de9d70cc7ed5f694efbce4'),
    ('20261003000000_nextgen_marketplace', '4f11caf63e1b0cd2eb54b1c87027e8501f9dfcba2a5c41f802144797518efe95')
  ) AS expected(name, checksum)
    ON m.migration_name = expected.name AND m.checksum = expected.checksum
  WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL
    AND m.applied_steps_count = 1;
  IF matched <> 13 THEN
    RAISE EXCEPTION 'Base migration history/checksums do not match (% of 13); stop and review.', matched;
  END IF;
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE rolled_back_at IS NOT NULL OR finished_at IS NULL) THEN
    RAISE EXCEPTION 'Unfinished or rolled-back migration records exist; stop and review.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public._prisma_migrations
    WHERE migration_name NOT IN ('20260824000000_catalogue_init', '20260826000000_auth_accounts', '20260826100000_professional_onboarding', '20260826200000_bookings_payments', '20260827000000_phase_e', '20260926000000_email_verification_otp', '20260926100000_security_flows', '20260926200000_oauth', '20260928000000_community', '20261001000000_notifications_plans', '20261002000000_onboarding_gigs', '20261002120000_kyc_verifications', '20261003000000_nextgen_marketplace', '20261004000000_subscriptions_entitlements')
  ) THEN
    RAISE EXCEPTION 'Unknown migration records exist; stop and review.';
  END IF;

  -- 2. The new objects must not already exist unless the migration is recorded.
  IF NOT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261004000000_subscriptions_entitlements')
     AND (
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('organizations', 'organization_members', 'usage_periods', 'ai_usage_events', 'saved_searches', 'profile_versions'))
       OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name IN ('plan_slug', 'plan_expires_at', 'custom_limits'))
       OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'limits')
       OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plan_subscriptions' AND column_name = 'user_id')
       OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proposals' AND column_name IN ('label', 'private_note'))
       OR EXISTS (SELECT 1 FROM pg_type WHERE typname IN ('OrganizationRole', 'OrganizationMemberStatus'))
       OR EXISTS (SELECT 1 FROM public.plans WHERE slug IN ('go', 'pro', 'team', 'enterprise'))
     ) THEN
    RAISE EXCEPTION 'Some subscription objects already exist but the migration is not recorded; stop and review.';
  END IF;
  -- The migration renames the two legacy plan rows; they must still carry their legacy slugs (or be absent).
  IF NOT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261004000000_subscriptions_entitlements')
     AND EXISTS (SELECT 1 FROM public.professional_profiles WHERE plan_slug NOT IN ('free', 'professional', 'business')) THEN
    RAISE EXCEPTION 'Unexpected plan slugs on professional_profiles; stop and review.';
  END IF;

  -- 3. 20261004000000_subscriptions_entitlements
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261004000000_subscriptions_entitlements') THEN
    RAISE NOTICE '20261004000000_subscriptions_entitlements already recorded; skipped.';
  ELSE
-- Additive; apply manually with the existing controlled migration runner after review.
-- Subscription plans for every account (Free / Go / Pro / Team / Enterprise), centralised
-- entitlements, metered AI usage, team workspaces, saved searches, profile versions and
-- proposal organisation tools. Nothing is dropped; existing "professional"/"business"
-- plan data is renamed to the new slugs ("pro"/"team") and copied onto users.

-- 1. Users carry the subscription (all roles). Professional profiles keep their mirror columns.
ALTER TABLE "users" ADD COLUMN "plan_slug" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "users" ADD COLUMN "plan_expires_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "custom_limits" JSONB NOT NULL DEFAULT '{}';

-- 2. Plan catalogue: operator overrides column + new slugs.
ALTER TABLE "plans" ADD COLUMN "limits" JSONB NOT NULL DEFAULT '{}';
UPDATE "plans" SET "slug" = 'pro',  "name" = 'Pro'  WHERE "slug" = 'professional';
UPDATE "plans" SET "slug" = 'team', "name" = 'Team', "price" = 35000 WHERE "slug" = 'business';
INSERT INTO "plans" ("id", "slug", "name", "tagline", "price", "currency", "period", "cta", "highlighted", "features", "is_active", "position")
VALUES
  (gen_random_uuid(), 'free', 'Free', 'Discover Servix and take part in the marketplace.', 0, 'NGN', 'per month', 'Get started', false, '[]', true, 0),
  (gen_random_uuid(), 'go', 'Go', 'More capacity and productivity for serious individuals.', 5000, 'NGN', 'per month', 'Start Go', false, '[]', true, 1),
  (gen_random_uuid(), 'pro', 'Pro', 'For professionals who depend on Servix every day.', 15000, 'NGN', 'per month', 'Start Pro', true, '[]', true, 2),
  (gen_random_uuid(), 'team', 'Team', 'Agencies, studios and small teams working together.', 35000, 'NGN', 'per month', 'Start Team', false, '[]', true, 3),
  (gen_random_uuid(), 'enterprise', 'Enterprise', 'Custom limits, organisation controls and reporting.', 0, 'NGN', 'custom', 'Contact Servix', false, '[]', true, 4)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name", "tagline" = EXCLUDED."tagline", "price" = EXCLUDED."price", "period" = EXCLUDED."period",
  "cta" = EXCLUDED."cta", "highlighted" = EXCLUDED."highlighted", "position" = EXCLUDED."position", "is_active" = true;
UPDATE "plans" SET "features" = '["Basic profile and marketplace participation","Up to 2 service listings","5 proposals a month, 3 live at a time","3 service requests a month","10 saved professionals, 2 saved searches","Basic analytics and 1 export a month","20,000 Servix AI tokens a month"]' WHERE "slug" = 'free';
UPDATE "plans" SET "features" = '["Everything in Free","Up to 5 service listings","25 proposals a month, 10 live at a time","Advanced job filters and 10 saved searches","Proposal labels and private notes","3 profile versions","Detailed analytics and 5 exports a month","100,000 Servix AI tokens a month and AI drafting"]' WHERE "slug" = 'go';
UPDATE "plans" SET "features" = '["Everything in Go","Up to 15 service listings","100 proposals a month, 30 live at a time","Proposal pipeline view and advanced filters","10 profile versions","Application and profile performance analytics","25 exports a month","300,000 Servix AI tokens a month and the full individual AI set","Priority AI routing"]' WHERE "slug" = 'pro';
UPDATE "plans" SET "features" = '["Everything in Pro","Team workspace for up to 5 members","Invitations, roles and permissions","Shared view of team requests and proposals","Team dashboard, activity and analytics","Team AI pool of 1,000,000 tokens a month with per-member caps","100 exports a month"]' WHERE "slug" = 'team';
UPDATE "plans" SET "features" = '["Everything in Team","Custom AI token allocation","Custom member, listing and project limits","Organisation administration and audit log","Organisation-wide AI usage analytics","Custom reporting and exports","Arranged directly with Servix"]' WHERE "slug" = 'enterprise';

-- 3. Rename existing plan assignments and copy them onto users.
UPDATE "professional_profiles" SET "plan_slug" = 'pro'  WHERE "plan_slug" = 'professional';
UPDATE "professional_profiles" SET "plan_slug" = 'team' WHERE "plan_slug" = 'business';
UPDATE "plan_subscriptions"    SET "plan_slug" = 'pro'  WHERE "plan_slug" = 'professional';
UPDATE "plan_subscriptions"    SET "plan_slug" = 'team' WHERE "plan_slug" = 'business';
UPDATE "users" u SET "plan_slug" = p."plan_slug", "plan_expires_at" = p."plan_expires_at"
  FROM "professional_profiles" p WHERE p."user_id" = u."id" AND p."plan_slug" <> 'free';

-- 4. Plan subscriptions belong to users (professional link kept for history).
ALTER TABLE "plan_subscriptions" ALTER COLUMN "professional_id" DROP NOT NULL;
ALTER TABLE "plan_subscriptions" ADD COLUMN "user_id" TEXT;
ALTER TABLE "plan_subscriptions" ADD CONSTRAINT "plan_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "plan_subscriptions_user_id_status_idx" ON "plan_subscriptions"("user_id", "status");
UPDATE "plan_subscriptions" s SET "user_id" = p."user_id" FROM "professional_profiles" p WHERE s."professional_id" = p."id" AND s."user_id" IS NULL;

-- 5. Proposal organisation tools.
ALTER TABLE "proposals" ADD COLUMN "label" TEXT;
ALTER TABLE "proposals" ADD COLUMN "private_note" TEXT;

-- 6. Team / enterprise organisations.
CREATE TYPE "OrganizationRole" AS ENUM ('owner', 'admin', 'member');
CREATE TYPE "OrganizationMemberStatus" AS ENUM ('invited', 'active');
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "plan_slug" TEXT,
    "plan_expires_at" TIMESTAMP(3),
    "custom_limits" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX "organizations_owner_id_idx" ON "organizations"("owner_id");
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "role" "OrganizationRole" NOT NULL DEFAULT 'member',
    "status" "OrganizationMemberStatus" NOT NULL DEFAULT 'invited',
    "invited_email" TEXT,
    "invite_token_hash" TEXT,
    "invite_expires_at" TIMESTAMP(3),
    "invited_by_id" TEXT,
    "ai_token_cap" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organization_members_invite_token_hash_key" ON "organization_members"("invite_token_hash");
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");
CREATE INDEX "organization_members_user_id_status_idx" ON "organization_members"("user_id", "status");
CREATE INDEX "organization_members_organization_id_status_idx" ON "organization_members"("organization_id", "status");
-- A user can be an ACTIVE member of at most one organisation.
CREATE UNIQUE INDEX "organization_members_one_active_per_user" ON "organization_members"("user_id") WHERE "status" = 'active' AND "user_id" IS NOT NULL;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. Metered usage counters (AI tokens, exports) with in-flight reservations.
CREATE TABLE "usage_periods" (
    "id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "used" BIGINT NOT NULL DEFAULT 0,
    "reserved" BIGINT NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "usage_periods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "usage_periods_subject_type_subject_id_metric_period_start_key" ON "usage_periods"("subject_type", "subject_id", "metric", "period_start");

-- 8. AI usage events (one per task; never prompts, answers or keys).
CREATE TABLE "ai_usage_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "organization_id" TEXT,
    "plan_slug" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "model_alias" TEXT,
    "model" TEXT,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_usage_events_created_at_idx" ON "ai_usage_events"("created_at");
CREATE INDEX "ai_usage_events_user_id_created_at_idx" ON "ai_usage_events"("user_id", "created_at");
CREATE INDEX "ai_usage_events_organization_id_created_at_idx" ON "ai_usage_events"("organization_id", "created_at");
CREATE INDEX "ai_usage_events_department_created_at_idx" ON "ai_usage_events"("department", "created_at");
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 9. Saved searches.
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "saved_searches_user_id_kind_idx" ON "saved_searches"("user_id", "kind");
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 10. Profile versions.
CREATE TABLE "profile_versions" (
    "id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "profile_versions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "profile_versions_professional_id_created_at_idx" ON "profile_versions"("professional_id", "created_at" DESC);
ALTER TABLE "profile_versions" ADD CONSTRAINT "profile_versions_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    INSERT INTO public._prisma_migrations
      (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
    VALUES (gen_random_uuid()::text, 'f9187a32dfc6ad031f116f67491255a30a51fc9f1b34503b4070054b9026c5ae', '20261004000000_subscriptions_entitlements', now(), now(), 1);
    RAISE NOTICE '20261004000000_subscriptions_entitlements applied.';
  END IF;

  SELECT count(*) INTO applied_count FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
  IF applied_count <> 14 THEN
    RAISE EXCEPTION 'Expected 14 completed migration records after upgrade, found %.', applied_count;
  END IF;
  IF (SELECT count(*) FROM public.plans WHERE slug IN ('free', 'go', 'pro', 'team', 'enterprise') AND is_active) <> 5 THEN
    RAISE EXCEPTION 'Expected the five active plans after upgrade; stop and review.';
  END IF;
  RAISE NOTICE 'Subscriptions & entitlements upgrade complete: 14 migrations recorded, 5 plans active.';
END;
$servix_upgrade$;
