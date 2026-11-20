ALTER TABLE ad_payment_intents
    ADD COLUMN IF NOT EXISTS wallet_amount_cents BIGINT NOT NULL DEFAULT 0
        CHECK (wallet_amount_cents >= 0);

ALTER TABLE ad_payment_intents
    DROP CONSTRAINT IF EXISTS ad_payment_intents_provider_check;

ALTER TABLE ad_payment_intents
    ADD CONSTRAINT ad_payment_intents_provider_check
        CHECK (provider IN ('paystack', 'mpesa', 'stripe', 'wallet'));

ALTER TABLE ad_ledger_entries
    DROP CONSTRAINT IF EXISTS ad_ledger_entries_transaction_type_check;

ALTER TABLE ad_ledger_entries
    ADD CONSTRAINT ad_ledger_entries_transaction_type_check
        CHECK (transaction_type IN (
            'deposit', 'withdrawal', 'withdrawal_reversal', 'ppv_purchase', 'ppv_earning',
            'subscription_purchase', 'subscription_earning', 'tip_sent', 'tip_received',
            'chat_unlock_purchase', 'chat_unlock_earning', 'wallet_reserve', 'wallet_release'
        ));

UPDATE email_templates
SET body_html = '<h1>New purchase</h1><p>Hello {{.Username}}, you received a new After Dark purchase.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Payment method: {{.PaymentMethod}}<br>Wallet contribution: KES {{.WalletContribution}}<br>Reference: {{.Reference}}</p>',
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'ad_creator_sale'
  AND body_html = '<h1>New purchase</h1><p>Hello {{.Username}}, you received a new After Dark purchase.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Reference: {{.Reference}}</p>';

UPDATE email_templates
SET body_html = '<h1>Payment received</h1><p>Hello {{.Username}}, your After Dark payment was successful.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Payment method: {{.PaymentMethod}}<br>Wallet contribution: KES {{.WalletContribution}}<br>Item: {{.PaymentType}}<br>Reference: {{.Reference}}<br>Receipt: {{.ReceiptNumber}}<br>Payment date: {{.PaidAt}}</p>',
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'ad_payment_receipt'
  AND body_html = '<h1>Payment received</h1><p>Hello {{.Username}}, your After Dark payment was successful.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Item: {{.PaymentType}}<br>Reference: {{.Reference}}<br>Receipt: {{.ReceiptNumber}}<br>Payment date: {{.PaidAt}}</p>';
