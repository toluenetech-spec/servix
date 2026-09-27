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
