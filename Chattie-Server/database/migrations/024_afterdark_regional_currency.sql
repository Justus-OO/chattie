ALTER TABLE ad_payment_intents
    ADD COLUMN IF NOT EXISTS settlement_amount_cents BIGINT;

ALTER TABLE ad_payment_intents
    ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(3) NOT NULL DEFAULT 'KES';

ALTER TABLE ad_payment_intents
    ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18, 8) NOT NULL DEFAULT 1;

UPDATE ad_payment_intents
SET settlement_amount_cents = amount_cents
WHERE settlement_amount_cents IS NULL;

ALTER TABLE ad_payment_intents
    ALTER COLUMN settlement_amount_cents SET NOT NULL;

ALTER TABLE ad_payment_intents
    DROP CONSTRAINT IF EXISTS ad_payment_intents_provider_check;

ALTER TABLE ad_payment_intents
    ADD CONSTRAINT ad_payment_intents_provider_check
        CHECK (provider IN ('paystack', 'mpesa', 'stripe'));

ALTER TABLE ad_payment_intents
    DROP CONSTRAINT IF EXISTS ad_payment_intents_settlement_currency_check;

ALTER TABLE ad_payment_intents
    ADD CONSTRAINT ad_payment_intents_settlement_currency_check
        CHECK (settlement_currency = 'KES');
