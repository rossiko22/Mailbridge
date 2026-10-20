-- Up Migration
-- A sync claims its account with a short lease instead of holding a transaction (and a pooled database connection)
-- open while the mail provider answers. A crashed sync simply lets its lease run out.
ALTER TABLE mail_accounts
    ADD COLUMN sync_lease_token UUID,
    ADD COLUMN sync_lease_until TIMESTAMPTZ;

-- Down Migration
ALTER TABLE mail_accounts
    DROP COLUMN sync_lease_until,
    DROP COLUMN sync_lease_token;
