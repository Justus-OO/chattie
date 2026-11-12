CREATE TABLE IF NOT EXISTS ad_payment_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payment_type VARCHAR(30) NOT NULL CHECK (payment_type IN ('deposit', 'subscription', 'ppv', 'tip', 'live_tip', 'live_pass')),
    target_id TEXT,
    creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'KES',
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('paystack', 'mpesa')),
    provider_session_id TEXT,
    merchant_request_id TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    message TEXT NOT NULL DEFAULT '',
    receipt_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ad_payment_provider_session_idx
    ON ad_payment_intents (provider, provider_session_id)
    WHERE provider_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ad_payment_user_status_idx
    ON ad_payment_intents (user_id, status, created_at DESC);
