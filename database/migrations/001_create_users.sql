-- Up Migration

CREATE TABLE users (
                       user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                       email TEXT NOT NULL,
                       password_hash TEXT NOT NULL,

    -- 1 = SOFTWARE_DEVELOPER, 2 = IT_MANAGER
                       role SMALLINT NOT NULL CHECK (role IN (1, 2)),

                       avatar_path TEXT NOT NULL,

                       is_active BOOLEAN NOT NULL DEFAULT TRUE,

                       created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                       updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

                       CONSTRAINT users_email_not_blank CHECK (btrim(email) <> '')
);

-- Treat differently capitalized versions of an email as duplicates.
CREATE UNIQUE INDEX users_email_unique
    ON users (lower(email));

-- Automatically refresh updated_at whenever a row changes.
CREATE FUNCTION set_users_updated_at()
    RETURNS TRIGGER
    LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_users_updated_at();
