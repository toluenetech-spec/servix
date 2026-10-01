-- MANUAL ONLY: Neon SQL Editor, servix / production / neondb.
-- Keep AUTH_MFA_ENABLED and AUTH_OAUTH_ENABLED false. Do not run concurrently
-- with another migration command. One DO statement = one atomic transaction.
DO $servix_upgrade$
DECLARE
  recorded integer;
  matched integer;
BEGIN
  IF current_database() <> 'neondb' THEN
    RAISE EXCEPTION 'Wrong database; expected neondb. Stop.';
  END IF;
  PERFORM set_config('search_path', 'public', true);
  PERFORM set_config('lock_timeout', '5s', true);
  IF NOT pg_try_advisory_xact_lock(72492160927001::bigint) THEN
    RAISE EXCEPTION 'Another manual upgrade is running. Stop.';
  END IF;
  LOCK TABLE public._prisma_migrations IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*) INTO recorded FROM public._prisma_migrations;
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
    ('20260926200000_oauth', '4ff252edf47f510e1e56ba683a239f8d6f7593c87ae728b856d31b13a23ec816')
  ) AS expected(name, checksum)
    ON m.migration_name = expected.name AND m.checksum = expected.checksum
  WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL
    AND m.applied_steps_count = 1;
  IF recorded <> matched OR recorded <> (
    SELECT count(DISTINCT migration_name) FROM public._prisma_migrations
  ) THEN
    RAISE EXCEPTION 'Unexpected migration history/checksum; stop and review.';
  END IF;
  IF recorded = 8 THEN
    RAISE NOTICE 'All eight migration records already match. Nothing changed.';
    RETURN;
  END IF;
  IF recorded <> 5 OR EXISTS (
    SELECT 1 FROM public._prisma_migrations WHERE migration_name >= '20260926000000'
  ) THEN
    RAISE EXCEPTION 'Expected exactly the five original migrations. Stop.';
  END IF;

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

INSERT INTO public._prisma_migrations
  (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '291fbc1d08752001e377f73b242d7a14a878524b5dfd265b653740fe849dacf9', '20260926000000_email_verification_otp', now(), now(), 1);

-- MANUAL, APPROVED MIGRATION ONLY. Never run at application startup.
ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE refresh_tokens ADD COLUMN mfa_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE refresh_tokens ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE account_security (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
 method TEXT, totp_secret TEXT, last_totp_step INTEGER NOT NULL DEFAULT -1,
 window_start TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 failures INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 0, last_sent_at TIMESTAMP(3)
);
CREATE TABLE security_flows (
 id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL,
 user_id TEXT REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
 purpose TEXT NOT NULL, stage TEXT NOT NULL, email_digest TEXT,
 email_expires_at TIMESTAMP(3), challenge TEXT, challenge_type TEXT, pending_secret TEXT,
 recovery_envelope TEXT, expires_at TIMESTAMP(3) NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX security_flows_user_id_purpose_idx ON security_flows(user_id, purpose);
CREATE INDEX security_flows_expires_at_idx ON security_flows(expires_at);
CREATE TABLE passkey_credentials (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
 public_key BYTEA NOT NULL, counter BIGINT NOT NULL DEFAULT 0, transports TEXT[] NOT NULL,
 device_type TEXT NOT NULL, backed_up BOOLEAN NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX passkey_credentials_user_id_idx ON passkey_credentials(user_id);
CREATE TABLE recovery_codes (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
 digest TEXT NOT NULL, used_at TIMESTAMP(3), UNIQUE(user_id, digest)
);

INSERT INTO public._prisma_migrations
  (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '9c7bb6b181001728d2a183738077d7e6e4891687b5ec4e9d2c4d12bc5c56ffc2', '20260926100000_security_flows', now(), now(), 1);

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

INSERT INTO public._prisma_migrations
  (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '4ff252edf47f510e1e56ba683a239f8d6f7593c87ae728b856d31b13a23ec816', '20260926200000_oauth', now(), now(), 1);

  RAISE NOTICE 'All three authentication migrations applied successfully.';
END;
$servix_upgrade$;

SELECT count(*) AS migration_records,
       count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS completed
FROM public._prisma_migrations;
