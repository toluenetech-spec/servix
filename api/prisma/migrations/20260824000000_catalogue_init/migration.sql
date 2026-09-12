-- SERVIX Phase A — catalogue domain initial migration

CREATE TYPE "VerificationStatus" AS ENUM ('unverified', 'pending', 'verified', 'rejected');
CREATE TYPE "AvailabilityState" AS ENUM ('available', 'limited', 'unavailable');
CREATE TYPE "ServiceStatus" AS ENUM ('draft', 'pending_review', 'active', 'paused', 'archived');

CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "service_count" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

CREATE TABLE "professional_profiles" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "about" TEXT,
    "location_city" TEXT,
    "location_country" TEXT NOT NULL DEFAULT 'NG',
    "category_id" TEXT,
    "verification" "VerificationStatus" NOT NULL DEFAULT 'unverified',
    "availability" "AvailabilityState" NOT NULL DEFAULT 'available',
    "response_time_label" TEXT,
    "member_since" TEXT,
    "image_url" TEXT,
    "rating_avg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "completed_projects" INTEGER NOT NULL DEFAULT 0,
    "starting_price" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "professional_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "professional_profiles_slug_key" ON "professional_profiles"("slug");
CREATE INDEX "professional_profiles_category_id_verification_availability_idx"
    ON "professional_profiles"("category_id", "verification", "availability");

CREATE TABLE "professional_skills" (
    "professional_id" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "professional_skills_pkey" PRIMARY KEY ("professional_id", "skill")
);

CREATE TABLE "portfolio_items" (
    "id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "media_url" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "portfolio_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "portfolio_items_professional_id_idx" ON "portfolio_items"("professional_id");

CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "short_description" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "price_unit" TEXT NOT NULL DEFAULT 'per project',
    "duration_label" TEXT,
    "location_label" TEXT,
    "is_remote" BOOLEAN NOT NULL DEFAULT true,
    "availability" "AvailabilityState" NOT NULL DEFAULT 'available',
    "status" "ServiceStatus" NOT NULL DEFAULT 'active',
    "included" JSONB NOT NULL DEFAULT '[]',
    "requirements" JSONB NOT NULL DEFAULT '[]',
    "rating_avg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "services_slug_key" ON "services"("slug");
CREATE INDEX "services_category_id_status_price_idx" ON "services"("category_id", "status", "price");
CREATE INDEX "services_professional_id_status_idx" ON "services"("professional_id", "status");

CREATE TABLE "service_media" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt_text" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_cover" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "service_media_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "service_media_service_id_idx" ON "service_media"("service_id");

CREATE TABLE "service_faqs" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "service_faqs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "service_faqs_service_id_idx" ON "service_faqs"("service_id");

CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "reviewed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reviews_service_id_is_published_reviewed_at_idx"
    ON "reviews"("service_id", "is_published", "reviewed_at" DESC);
CREATE INDEX "reviews_professional_id_is_published_reviewed_at_idx"
    ON "reviews"("professional_id", "is_published", "reviewed_at" DESC);

CREATE TABLE "testimonials" (
    "id" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "role" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "price" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "period" TEXT NOT NULL DEFAULT 'per month',
    "cta" TEXT NOT NULL DEFAULT 'Get Started',
    "highlighted" BOOLEAN NOT NULL DEFAULT false,
    "features" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plans_slug_key" ON "plans"("slug");

CREATE TABLE "faqs" (
    "id" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "faqs_context_is_published_position_idx" ON "faqs"("context", "is_published", "position");

CREATE TABLE "contact_messages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "professional_skills" ADD CONSTRAINT "professional_skills_professional_id_fkey"
    FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_professional_id_fkey"
    FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "services" ADD CONSTRAINT "services_professional_id_fkey"
    FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_media" ADD CONSTRAINT "service_media_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_faqs" ADD CONSTRAINT "service_faqs_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_professional_id_fkey"
    FOREIGN KEY ("professional_id") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
