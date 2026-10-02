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
