-- Up Migration
-- A record of security-relevant actions: sign-ins, password changes, connected mailboxes, sent mail, refused requests.
-- It never holds mail content, passwords or tokens. Rows older than the retention period are deleted by the app.
CREATE TABLE audit_events (
    event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- NULL when the action cannot be tied to an account, such as a sign-in attempt for an unknown address.
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    event TEXT NOT NULL CHECK (char_length(event) <= 40),
    outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','denied')),
    ip INET,
    user_agent TEXT NOT NULL DEFAULT '' CHECK (char_length(user_agent) <= 300),
    request_id UUID,
    target TEXT CHECK (char_length(target) <= 100),
    detail JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_user_time ON audit_events (user_id, occurred_at DESC);
CREATE INDEX audit_events_time ON audit_events (occurred_at);

-- Down Migration
DROP TABLE audit_events;
