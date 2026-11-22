-- Apply after migrations 001-040 when bringing an existing database up to the
-- current bootstrap schema. This file only adds indexes and missing templates.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_ad_withdrawals_user_unresolved
    ON ad_withdrawals(user_id, created_at DESC)
    WHERE status IN ('requested', 'submitting', 'submission_unknown', 'processing');

CREATE INDEX IF NOT EXISTS idx_users_unverified_onboarding
    ON users(created_at)
    WHERE provider = 'local'
      AND status = 'onboarding'
      AND email_verified_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_user_unread_created_idx
    ON notifications(user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_posts_ai_safety_queue
    ON ad_posts(ai_safety_scored_at DESC, ai_safety_score DESC)
    WHERE status IN ('draft', 'processing');

CREATE INDEX IF NOT EXISTS idx_ad_pending_earnings_source
    ON ad_pending_earnings(source, balance_cents DESC)
    WHERE balance_cents > 0;

INSERT INTO email_templates (name, subject, body_html) VALUES
    ('welcome_email', 'Welcome to Chattie', '<h1>Welcome, {{.Username}}</h1><p>Your Chattie account is ready. Sign in to meet people and start conversations.</p>'),
    ('new_match', 'It is a match!', '<h1>You have a new match</h1><p>Hello {{.Username}}, {{.Message}}</p><p><a href="{{.ActionURL}}">Open Chattie</a></p>'),
    ('new_message', 'You have a new Chattie message', '<h1>New message</h1><p>Hello {{.Username}}, {{.Message}}</p><p><a href="{{.ActionURL}}">View message</a></p>')
ON CONFLICT (name) DO NOTHING;

COMMIT;
