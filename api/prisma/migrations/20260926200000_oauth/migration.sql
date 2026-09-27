ALTER TABLE "security_flows" ADD COLUMN "pending_identity" TEXT;
CREATE TABLE "oauth_identities" (
 "id" TEXT NOT NULL, "provider" TEXT NOT NULL, "subject" TEXT NOT NULL,
 "user_id" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "oauth_identities_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "oauth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "oauth_identities_provider_subject_key" ON "oauth_identities"("provider", "subject");
CREATE UNIQUE INDEX "oauth_identities_user_id_provider_key" ON "oauth_identities"("user_id", "provider");
CREATE TABLE "oauth_attempts" (
 "id" TEXT NOT NULL, "state_hash" TEXT NOT NULL, "browser_hash" TEXT NOT NULL,
 "provider" TEXT NOT NULL, "envelope" TEXT, "expires_at" TIMESTAMP(3) NOT NULL,
 "used_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "oauth_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "oauth_attempts_state_hash_key" ON "oauth_attempts"("state_hash");
CREATE INDEX "oauth_attempts_expires_at_idx" ON "oauth_attempts"("expires_at");
