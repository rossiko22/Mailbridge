-- Up Migration
CREATE TABLE email_bodies (
    email_id uuid PRIMARY KEY REFERENCES emails(email_id) ON DELETE CASCADE,
    content_type text NOT NULL CHECK (content_type IN ('html','text')),
    content text NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT NOW()
);

-- Down Migration
DROP TABLE email_bodies;
