BEGIN;

CREATE TABLE IF NOT EXISTS creator_payout_methods (
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_network VARCHAR(32) NOT NULL CHECK (asset_network IN ('USDT-TRC20', 'USDT-ERC20')),
    wallet_address VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (creator_id, asset_network)
);

CREATE TABLE IF NOT EXISTS creator_payout_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key UUID NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents >= 5000),
    asset_network VARCHAR(32) NOT NULL CHECK (asset_network IN ('USDT-TRC20', 'USDT-ERC20')),
    wallet_address VARCHAR(255) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'PAID')),
    crypto_amount NUMERIC(30, 12) CHECK (crypto_amount IS NULL OR crypto_amount > 0),
    transaction_hash VARCHAR(128),
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP WITH TIME ZONE,
    CHECK (status <> 'PAID' OR (crypto_amount IS NOT NULL AND transaction_hash IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_payout_requests_idempotency
    ON creator_payout_requests(creator_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_payout_requests_transaction_hash
    ON creator_payout_requests(asset_network, LOWER(transaction_hash))
    WHERE transaction_hash IS NOT NULL;

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS payout_request_id UUID
    REFERENCES creator_payout_requests(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_creator_payout_request
    ON transactions(payout_request_id)
    WHERE payout_request_id IS NOT NULL AND tx_type = 'CRYPTO_PAYOUT';
CREATE INDEX IF NOT EXISTS idx_creator_payout_requests_status_created
    ON creator_payout_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_payout_requests_creator_created
    ON creator_payout_requests(creator_id, created_at DESC);

COMMIT;
