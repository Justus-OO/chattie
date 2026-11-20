CREATE TABLE IF NOT EXISTS user_filter_hits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS user_filter_hits_user_time_idx
    ON user_filter_hits (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_chat_mutes (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    muted_until TIMESTAMP WITH TIME ZONE NOT NULL,
    reason TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO firewall_rules (id, name, description, is_active) VALUES
    ('RUL_1', 'Block banned IP addresses', 'Reject requests from IP addresses recorded in the administrator-managed ban list. Trusted proxy CIDRs are required before forwarding headers are used.', TRUE),
    ('RUL_2', 'Block known disposable email domains', 'Reject new registrations using a curated list of disposable email domains, including social sign-ups.', TRUE),
    ('RUL_3', 'Lock tipping after repeated card failures', 'Temporarily prevent tipping when the two most recent Paystack or Stripe payment attempts both failed.', TRUE),
    ('RUL_4', 'Auto-mute repeated profanity filter hits', 'Automatically mute an account for one hour after three profanity-filter matches within one hour.', FALSE)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = CURRENT_TIMESTAMP;
