DROP TABLE IF EXISTS idanalyzer_docupass_sessions;

CREATE TABLE IF NOT EXISTS plaid_identity_verification_attempts (
    attempt_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    identity_verification_id VARCHAR(128) UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'creating'
        CHECK (status IN ('creating', 'active', 'pending_review', 'success', 'failed', 'expired', 'canceled')),
    consented_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plaid_idv_attempts_user_created
    ON plaid_identity_verification_attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plaid_idv_attempts_creating
    ON plaid_identity_verification_attempts (user_id, created_at DESC)
    WHERE status = 'creating';
