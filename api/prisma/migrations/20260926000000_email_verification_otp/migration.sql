-- MANUAL ONLY. Additive storage; does not alter or reseed existing accounts.
CREATE TABLE "email_verification_otps" (
  "user_id" TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "nonce" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "sent_at" TIMESTAMP(3) NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL,
  "sends" INTEGER NOT NULL DEFAULT 1,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "used_at" TIMESTAMP(3)
);
