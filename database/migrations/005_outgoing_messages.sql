-- Up Migration
CREATE TABLE mailbox_outgoing (
    request_id UUID PRIMARY KEY,
    mailbox TEXT NOT NULL,
    actor_id UUID NOT NULL REFERENCES users(user_id),
    message JSONB NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending','accepted','failed','unknown')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX mailbox_outgoing_actor ON mailbox_outgoing(mailbox, actor_id, created_at DESC);

-- Down Migration
DROP TABLE mailbox_outgoing;
