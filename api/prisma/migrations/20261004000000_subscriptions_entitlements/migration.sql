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
