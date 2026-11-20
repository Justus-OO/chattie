ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS action_url VARCHAR(512),
    ADD COLUMN IF NOT EXISTS action_label VARCHAR(100),
    ADD COLUMN IF NOT EXISTS category VARCHAR(50);

CREATE INDEX IF NOT EXISTS notifications_user_unread_created_idx
    ON notifications (user_id, is_read, created_at DESC);

INSERT INTO email_templates (name, subject, body_html) VALUES
    ('new_match', 'It is a match!', '<h1>You have a new match</h1><p>Hello {{.Username}}, {{.Message}}</p><p><a href="{{.ActionURL}}">Open Chattie</a></p>'),
    ('new_message', 'You have a new Chattie message', '<h1>New message</h1><p>Hello {{.Username}}, {{.Message}}</p><p><a href="{{.ActionURL}}">View message</a></p>'),
    ('new_like', 'Someone noticed you on Chattie', '<h1>New profile interaction</h1><p>Hello {{.Username}}, someone interacted with your profile.</p><p><a href="{{.ActionURL}}">View profile</a></p>'),
    ('premium_welcome', 'Welcome to Chattie Premium', '<h1>Premium is active</h1><p>Hello {{.Username}}, your Premium upgrade was successful.</p><p>Plan duration: {{.Months}} month(s)</p>')
ON CONFLICT (name) DO UPDATE SET subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, updated_at = CURRENT_TIMESTAMP;
