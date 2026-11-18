DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'users'
          AND column_name = 'email_verified_at'
    ) THEN
        ALTER TABLE users
            ADD COLUMN email_verified_at TIMESTAMP WITH TIME ZONE;

        -- Preserve accounts created before verification tracking was introduced.
        UPDATE users
        SET email_verified_at = COALESCE(created_at, CURRENT_TIMESTAMP);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_unverified_onboarding
    ON users (created_at)
    WHERE provider = 'local'
      AND status = 'onboarding'
      AND email_verified_at IS NULL;
