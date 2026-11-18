BEGIN;

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_client_message
    ON messages(sender_id, client_message_id)
    WHERE client_message_id IS NOT NULL;

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_message_id
    ON transactions(message_id)
    WHERE message_id IS NOT NULL;

COMMIT;
