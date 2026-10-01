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
