CREATE TABLE IF NOT EXISTS ad_afterdark_moderation_settings (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    auto_approve_new_posts BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO ad_afterdark_moderation_settings (id, auto_approve_new_posts)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;
