BEGIN;

ALTER TABLE ad_withdrawals
    ADD COLUMN IF NOT EXISTS fee_cents BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payout_amount_cents BIGINT;

UPDATE ad_withdrawals
SET payout_amount_cents = amount_cents
WHERE payout_amount_cents IS NULL;

ALTER TABLE ad_withdrawals
    ALTER COLUMN payout_amount_cents SET NOT NULL,
    DROP CONSTRAINT IF EXISTS ad_withdrawals_amounts_check;

ALTER TABLE ad_withdrawals
    ADD CONSTRAINT ad_withdrawals_amounts_check
        CHECK (
            amount_cents > 0
            AND payout_amount_cents > 0
            AND fee_cents >= 0
            AND payout_amount_cents <= amount_cents
            AND fee_cents = amount_cents - payout_amount_cents
        );

CREATE INDEX IF NOT EXISTS idx_ad_withdrawals_user_unresolved
    ON ad_withdrawals (user_id, created_at DESC)
    WHERE status IN ('requested', 'processing');

COMMIT;
