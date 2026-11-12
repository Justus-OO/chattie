CREATE TABLE IF NOT EXISTS billing_payment_intents (
    reference UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('stripe', 'paystack', 'mpesa')),
    provider_session_id TEXT,
    merchant_request_id TEXT,
    months INT NOT NULL CHECK (months > 0),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency VARCHAR(3) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
    receipt_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_provider_session_idx
    ON billing_payment_intents (provider, provider_session_id)
    WHERE provider_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_payment_user_status_idx
    ON billing_payment_intents (user_id, status, created_at DESC);
