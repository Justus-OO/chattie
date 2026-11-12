ALTER TABLE ad_creator_settings
    ADD COLUMN IF NOT EXISTS show_explicit_content BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS discoverable BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS notification_email JSONB NOT NULL DEFAULT '{"subs":true,"tips":true,"sales":true,"likes":false,"messages":false,"marketing":false}'::jsonb,
    ADD COLUMN IF NOT EXISTS notification_push JSONB NOT NULL DEFAULT '{"subs":true,"tips":true,"messages":true,"mentions":true}'::jsonb,
    ADD COLUMN IF NOT EXISTS default_ppv_cents BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS auto_withdraw BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS withdraw_threshold_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE performer_profiles
    ADD COLUMN IF NOT EXISTS subscription_price_cents BIGINT NOT NULL DEFAULT 50000,
    ADD COLUMN IF NOT EXISTS welcome_message TEXT NOT NULL DEFAULT '';

ALTER TABLE performer_profiles DROP CONSTRAINT IF EXISTS performer_profiles_status_check;
ALTER TABLE performer_profiles
    ADD CONSTRAINT performer_profiles_status_check
    CHECK (status IN ('pending', 'active', 'paused', 'suspended', 'deactivated'));


ALTER TABLE performer_applications
ADD COLUMN IF NOT EXISTS creator_alias VARCHAR(100) NOT NULL DEFAULT '';