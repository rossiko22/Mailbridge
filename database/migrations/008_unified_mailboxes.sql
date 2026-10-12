-- Up Migration
-- v2: a personal, multi-account mail client. Every user connects their own Outlook and
-- Gmail accounts. The ticket workflow and the single server-wide mailbox are removed.
-- Cached emails are only copies of provider mail and are rebuilt by the next sync.

DROP TABLE email_activity;
DROP TABLE email_outgoing;
DROP TABLE mailbox_outgoing;
DROP TABLE outlook_connections;
DROP TABLE outlook_oauth;
DROP TABLE mailbox_sync;

DELETE FROM emails;
ALTER TABLE emails DROP CONSTRAINT email_assignment_state;
DROP INDEX emails_workflow;
ALTER TABLE emails
    DROP COLUMN status,
    DROP COLUMN assigned_to,
    DROP COLUMN closed_by,
    DROP COLUMN closed_at,
    DROP COLUMN version,
    DROP COLUMN mailbox;
ALTER TABLE emails RENAME COLUMN graph_id TO provider_id;

-- Roles and the stored avatar path belonged to the ticket team model.
ALTER TABLE users
    DROP COLUMN role,
    DROP COLUMN avatar_path,
    ADD COLUMN display_name TEXT NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 80);

CREATE TABLE user_avatars (
    user_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    content_type TEXT NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
    data BYTEA NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 524288),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX password_resets_user ON password_resets(user_id);

CREATE TABLE mail_accounts (
    account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('outlook','gmail')),
    email TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'blue',
    -- Encrypted OAuth credentials; NULL only for demo accounts.
    credentials TEXT,
    sync_cursor TEXT,
    synced_at TIMESTAMPTZ,
    last_error TEXT,
    needs_reconnect BOOLEAN NOT NULL DEFAULT FALSE,
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT mail_accounts_email_not_blank CHECK (btrim(email) <> '')
);
CREATE UNIQUE INDEX mail_accounts_user_provider_email ON mail_accounts (user_id, provider, lower(email));

ALTER TABLE emails
    ADD COLUMN account_id UUID NOT NULL REFERENCES mail_accounts(account_id) ON DELETE CASCADE,
    ADD CONSTRAINT emails_account_provider_unique UNIQUE (account_id, provider_id);
CREATE INDEX emails_account_received ON emails (account_id, received_at DESC, email_id);
CREATE INDEX emails_account_unread ON emails (account_id) WHERE NOT is_read;

-- Idempotency and history for everything sent through the app.
CREATE TABLE outgoing_messages (
    request_id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES mail_accounts(account_id) ON DELETE CASCADE,
    email_id UUID REFERENCES emails(email_id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action IN ('compose','reply','forward')),
    payload JSONB NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending','accepted','failed','unknown')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX outgoing_messages_account ON outgoing_messages (account_id, created_at DESC);
CREATE INDEX outgoing_messages_email ON outgoing_messages (email_id, created_at DESC);

-- Down Migration
DO $$ BEGIN
    RAISE EXCEPTION 'Migration 008 removes the ticket schema and cannot be reversed. Restore a database backup instead.';
END $$;
