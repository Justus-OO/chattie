BEGIN;

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS language VARCHAR(10);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_settings_language_supported'
          AND conrelid = 'user_settings'::regclass
    ) THEN
        ALTER TABLE user_settings
            ADD CONSTRAINT user_settings_language_supported
            CHECK (language IS NULL OR language IN ('en', 'es', 'fr', 'de', 'pt', 'ja', 'sw', 'hi', 'zh-CN'));
    END IF;
END $$;

COMMIT;
