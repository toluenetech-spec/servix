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
