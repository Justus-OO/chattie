ALTER TABLE ad_payout_methods
    ADD COLUMN IF NOT EXISTS bank_code TEXT NOT NULL DEFAULT '';

ALTER TABLE ad_withdrawals
    ADD COLUMN IF NOT EXISTS provider VARCHAR(30) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS provider_reference TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS provider_conversation_id TEXT NOT NULL DEFAULT '';

ALTER TABLE ad_ledger_entries
    DROP CONSTRAINT IF EXISTS ad_ledger_entries_transaction_type_check;
ALTER TABLE ad_ledger_entries
    ADD CONSTRAINT ad_ledger_entries_transaction_type_check
    CHECK (transaction_type IN (
        'deposit', 'withdrawal', 'withdrawal_reversal', 'ppv_purchase', 'ppv_earning',
        'subscription_purchase', 'subscription_earning', 'tip_sent', 'tip_received',
        'chat_unlock_purchase', 'chat_unlock_earning'
    ));

CREATE INDEX IF NOT EXISTS idx_ad_withdrawals_provider_reference
    ON ad_withdrawals (provider, provider_reference)
    WHERE provider_reference <> '';

CREATE TABLE IF NOT EXISTS ad_earnings_clearances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    reason TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_earnings_clearances_user
    ON ad_earnings_clearances (user_id, created_at DESC);
