BEGIN;

CREATE TABLE IF NOT EXISTS account_review_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 20 AND 2000),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'reinstated', 'upheld')),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMPTZ,
    reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewer_note TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_review_requests_pending_user
    ON account_review_requests(user_id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_account_review_requests_queue
    ON account_review_requests(submitted_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_reports_active_target_created
    ON reports(reported_id, created_at DESC)
    WHERE status <> 'dismissed';

COMMIT;
