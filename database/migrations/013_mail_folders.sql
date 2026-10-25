-- Up Migration
-- Sent and Junk next to the Inbox.
--
-- * folder: where the provider keeps the message (Gmail labels INBOX / SENT / SPAM, Outlook Inbox / Sent Items /
--   Junk Email). Existing rows are all inbox mail, which is the default.
-- * recipients: the To line as people read it, shown instead of the sender for sent mail.
-- * The list index gains the folder so each folder is read straight from it, as the inbox was before.
-- * Every sync checkpoint is cleared so the next sync also fetches the last 90 days of Sent and Junk. Saved mail
--   is kept and updated in place; only the checkpoints are rebuilt.

ALTER TABLE emails
    ADD COLUMN folder TEXT NOT NULL DEFAULT 'inbox' CHECK (folder IN ('inbox', 'sent', 'junk')),
    ADD COLUMN recipients TEXT NOT NULL DEFAULT '' CHECK (char_length(recipients) <= 500);

CREATE INDEX emails_account_folder_order ON emails (account_id, folder, (COALESCE(received_at, '-infinity')) DESC, email_id DESC);
DROP INDEX emails_account_order;

UPDATE mail_accounts SET sync_cursor = NULL;

-- Down Migration
-- Sent and junk copies would show up as inbox mail, so they are removed; the inbox itself is kept.
-- The checkpoints are cleared because the old code reads a different cursor format.
DELETE FROM emails WHERE folder <> 'inbox';
CREATE INDEX emails_account_order ON emails (account_id, (COALESCE(received_at, '-infinity')) DESC, email_id DESC);
DROP INDEX emails_account_folder_order;
ALTER TABLE emails DROP COLUMN recipients, DROP COLUMN folder;
UPDATE mail_accounts SET sync_cursor = NULL;
