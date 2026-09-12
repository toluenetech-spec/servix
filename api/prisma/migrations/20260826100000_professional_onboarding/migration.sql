-- SERVIX Phase C — professional onboarding

CREATE TYPE "ApplicationStatus" AS ENUM ('pending', 'under_review', 'approved', 'rejected');

CREATE TABLE "professional_applications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "about" TEXT,
    "location_city" TEXT,
    "category_slug" TEXT,
    "skills" JSONB NOT NULL DEFAULT '[]',
    "portfolio" JSONB NOT NULL DEFAULT '[]',
    "submitted_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "professional_applications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "professional_applications_user_id_status_idx"
    ON "professional_applications"("user_id", "status");
ALTER TABLE "professional_applications" ADD CONSTRAINT "professional_applications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Link professional profiles to user accounts (nullable: demo pros have no user)
ALTER TABLE "professional_profiles" ADD COLUMN "user_id" TEXT;
CREATE UNIQUE INDEX "professional_profiles_user_id_key" ON "professional_profiles"("user_id");
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
