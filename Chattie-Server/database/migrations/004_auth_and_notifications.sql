-- Account security, recovery, and notification templates.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS provider VARCHAR(30) NOT NULL DEFAULT 'local',
    ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS two_factor_channel VARCHAR(10) NOT NULL DEFAULT 'email';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_two_factor_channel_check'
    ) THEN
        ALTER TABLE user_settings
            ADD CONSTRAINT user_settings_two_factor_channel_check
            CHECK (two_factor_channel IN ('email', 'sms'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth_verification_codes (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('login_2fa', 'enable_2fa', 'disable_2fa', 'password_reset')),
    channel VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'sms')),
    code_hash VARCHAR(100) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS auth_verification_codes_user_purpose_idx
    ON auth_verification_codes (user_id, purpose, created_at DESC);

INSERT INTO email_templates (name, subject, body_html) VALUES
    ('login_2fa_email', 'Your Chattie sign-in code', '<h1>Confirm your sign-in</h1><p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{.Code}}</p><p>This code expires in {{.ExpiresMinutes}} minutes. If you did not try to sign in, change your password.</p>'),
    ('password_reset_email', 'Reset your Chattie password', '<h1>Password reset code</h1><p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{.Code}}</p><p>This code expires in {{.ExpiresMinutes}} minutes. If you did not request a reset, ignore this message.</p>'),
    ('two_factor_setup_email', 'Confirm your Chattie security change', '<h1>Confirm your security change</h1><p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{.Code}}</p><p>This code expires in {{.ExpiresMinutes}} minutes. If you did not request this change, secure your account.</p>'),
    ('data_dossier', 'Your Chattie data archive is ready', '<h1>Your Chattie archive is ready</h1><p>Hello {{.Username}}, your requested Chattie data archive is attached to this email.</p><p>If you did not request this, secure your account and contact support.</p>'),
    ('after_dark_data_archive', 'Your After Dark data archive is ready', '<h1>Your After Dark archive is ready</h1><p>Hello {{.Username}}, your requested After Dark data archive is attached. It contains information from your After Dark account only.</p><p>If you did not request this, secure your account and contact support.</p>'),
    ('premium_payment_receipt', 'Chattie Premium payment receipt', '<h1>Payment received</h1><p>Hello {{.Username}}, your Premium payment was successful.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Plan: {{.Months}} month(s)<br>Reference: {{.Reference}}<br>Payment date: {{.PaidAt}}</p>'),
    ('ad_creator_subscription', 'New After Dark subscriber', '<h1>New subscriber</h1><p>Hello {{.Username}}, {{.CustomerName}} subscribed to your creator account.</p>'),
    ('ad_creator_sale', 'New After Dark purchase', '<h1>New purchase</h1><p>Hello {{.Username}}, you received a new After Dark purchase.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Reference: {{.Reference}}</p>'),
    ('ad_creator_tip', 'You received an After Dark tip', '<h1>New tip</h1><p>Hello {{.Username}}, {{.CustomerName}} sent you a tip.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Reference: {{.Reference}}</p>'),
    ('ad_payment_receipt', 'After Dark payment receipt', '<h1>Payment received</h1><p>Hello {{.Username}}, your After Dark payment was successful.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Item: {{.PaymentType}}<br>Reference: {{.Reference}}<br>Receipt: {{.ReceiptNumber}}<br>Payment date: {{.PaidAt}}</p>'),
    ('ad_action_required', 'Action needed for your After Dark payment', '<h1>Payment needs attention</h1><p>Hello {{.Username}}, your After Dark payment could not be completed.</p><p>{{.ActionMessage}}</p><p>Reference: {{.Reference}}</p>'),
    ('afterdark_notification', 'After Dark account notification', '<h1>{{.Title}}</h1><p>Hello {{.Username}}, {{.Message}}</p>'),
    ('premium_action_required', 'Action needed for your Chattie Premium payment', '<h1>Payment needs attention</h1><p>Hello {{.Username}}, your Premium payment could not be completed.</p><p>{{.ActionMessage}}</p><p>Reference: {{.Reference}}</p>')
ON CONFLICT (name) DO UPDATE SET subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, updated_at = CURRENT_TIMESTAMP;

ALTER TABLE ad_creator_settings
    ALTER COLUMN notification_email SET DEFAULT '{"subs":true,"tips":true,"sales":true,"likes":false,"messages":false,"marketing":false}'::jsonb;
UPDATE ad_creator_settings
SET notification_email = jsonb_set(notification_email, '{sales}', 'true'::jsonb, true)
WHERE NOT (notification_email ? 'sales');
UPDATE ad_creator_settings
SET notification_email = jsonb_set(notification_email, '{likes}', 'false'::jsonb, true)
WHERE NOT (notification_email ? 'likes');

INSERT INTO sms_templates (name, template_content) VALUES
    ('login_2fa_sms', 'Your Chattie sign-in code is {{.Code}}. It expires in {{.ExpiresMinutes}} minutes. Do not share it.'),
    ('password_reset_sms', 'Your Chattie password reset code is {{.Code}}. It expires in {{.ExpiresMinutes}} minutes. Do not share it.'),
    ('two_factor_setup_sms', 'Your Chattie security confirmation code is {{.Code}}. It expires in {{.ExpiresMinutes}} minutes. Do not share it.')
ON CONFLICT (name) DO UPDATE SET template_content = EXCLUDED.template_content, is_active = TRUE, updated_at = CURRENT_TIMESTAMP;
