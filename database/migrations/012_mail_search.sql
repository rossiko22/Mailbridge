-- Up Migration
-- Fast search and paging over saved mail.
--
-- * search_vector: the words of subject, sender and text (the 'simple' configuration: no language-specific stemming,
--   so mail in any language is indexed the same way). Searched with prefix queries, so "board" finds "boarding".
-- * a trigram index on subject and sender, so part of a word or an address ("gmail.com", "nvoice") also matches.
-- * an index in the inbox's own order (newest first, mail without a date last), used by the keyset pages.
--
-- Adding a stored generated column rewrites the emails table once. Saved mail is only a copy of the provider's,
-- so on a large database this can also be done by removing the accounts' saved mail and syncing again.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE emails ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', subject), 'A') ||
    setweight(to_tsvector('simple', sender_name || ' ' || sender_address), 'B') ||
    to_tsvector('simple', left(body_text, 100000))
) STORED;

CREATE INDEX emails_search ON emails USING gin (search_vector);
CREATE INDEX emails_header_trgm ON emails USING gin ((lower(subject || ' ' || sender_name || ' ' || sender_address)) gin_trgm_ops);

CREATE INDEX emails_account_order ON emails (account_id, (COALESCE(received_at, '-infinity')) DESC, email_id DESC);
DROP INDEX emails_account_received;

-- Down Migration
CREATE INDEX emails_account_received ON emails (account_id, received_at DESC, email_id);
DROP INDEX emails_account_order;
DROP INDEX emails_header_trgm;
DROP INDEX emails_search;
ALTER TABLE emails DROP COLUMN search_vector;
DROP EXTENSION IF EXISTS pg_trgm;
