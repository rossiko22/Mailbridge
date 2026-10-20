-- Up Migration
-- The audit log can only grow. Rows are never changed, and they are only removed in two cases:
--   * retention: the row is older than 90 days (AUDIT_RETENTION_DAYS in src/modules/audit/audit.ts);
--   * erasure: the user the row belongs to has been deleted (the ON DELETE CASCADE from users).
-- Whoever gets the app's database credentials therefore cannot hide what they did by editing recent entries.
-- The table owner can still drop these triggers, which is why the app connects as a separate role that does not own
-- the tables (deploy/db-roles.sql).

CREATE FUNCTION audit_events_guard_row() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'audit_events is insert-only: rows cannot be changed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- DELETE
    IF OLD.occurred_at < NOW() - INTERVAL '90 days' THEN
        RETURN OLD;
    END IF;
    IF OLD.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE user_id = OLD.user_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_events is insert-only: only rows past retention or of deleted users can be removed'
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE FUNCTION audit_events_guard_truncate() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is insert-only: it cannot be truncated' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_events_guard_row
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_guard_row();

CREATE TRIGGER audit_events_guard_truncate
    BEFORE TRUNCATE ON audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION audit_events_guard_truncate();

-- Down Migration
DROP TRIGGER audit_events_guard_truncate ON audit_events;
DROP TRIGGER audit_events_guard_row ON audit_events;
DROP FUNCTION audit_events_guard_truncate();
DROP FUNCTION audit_events_guard_row();
