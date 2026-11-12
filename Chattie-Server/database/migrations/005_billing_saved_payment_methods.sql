-- Configure PAYMENT_METHOD_ENCRYPTION_KEY as a stable base64-encoded 32-byte secret before enabling Paystack card storage.
CREATE TABLE IF NOT EXISTS billing_saved_payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('stripe', 'paystack')),
    provider_method_id TEXT NOT NULL,
    provider_customer_id TEXT,
    authorization_ciphertext BYTEA,
    card_brand VARCHAR(40) NOT NULL DEFAULT '',
    last4 CHAR(4) NOT NULL,
    exp_month SMALLINT NOT NULL DEFAULT 0,
    exp_year SMALLINT NOT NULL DEFAULT 0,
    bank_name VARCHAR(120) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, provider, provider_method_id),
    CHECK (
        (provider = 'stripe' AND provider_customer_id IS NOT NULL AND authorization_ciphertext IS NULL)
        OR
        (provider = 'paystack' AND authorization_ciphertext IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS billing_saved_payment_methods_user_idx
    ON billing_saved_payment_methods (user_id, created_at DESC);
