CREATE TABLE IF NOT EXISTS idanalyzer_docupass_sessions (
    custom_data VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reference VARCHAR(128) UNIQUE,
    hosted_url TEXT NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'creating'
        CHECK (status IN ('creating', 'pending', 'accept', 'review', 'reject', 'failed')),
    transaction_id VARCHAR(128) UNIQUE,
    warning_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    consented_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idanalyzer_docupass_user_created
    ON idanalyzer_docupass_sessions (user_id, created_at DESC);
