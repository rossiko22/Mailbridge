-- Up Migration
CREATE TABLE login_attempts (
    key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    window_start TIMESTAMPTZ NOT NULL
);
CREATE INDEX login_attempts_expiry ON login_attempts(window_start);
CREATE TABLE outlook_oauth (
    mailbox TEXT PRIMARY KEY,
    encrypted_cache TEXT NOT NULL,
    account_id TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Down Migration
DROP TABLE outlook_oauth;
DROP TABLE login_attempts;
