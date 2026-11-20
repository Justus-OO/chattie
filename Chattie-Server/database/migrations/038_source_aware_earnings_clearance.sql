ALTER TABLE ad_earnings_clearances
    ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'legacy';

CREATE TABLE IF NOT EXISTS ad_pending_earnings (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source VARCHAR(30) NOT NULL
        CHECK (source IN ('ppv', 'tips', 'subscriptions', 'live_pass', 'chat', 'legacy')),
    balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, source)
);

INSERT INTO ad_pending_earnings (user_id, source, balance_cents)
SELECT user_id, 'legacy', pending_balance_cents
FROM ad_wallets
WHERE pending_balance_cents > 0
ON CONFLICT (user_id, source) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_ad_pending_earnings_source
    ON ad_pending_earnings (source, balance_cents DESC)
    WHERE balance_cents > 0;
