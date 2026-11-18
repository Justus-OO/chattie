CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ad_messages_unread_conversation_sender
    ON ad_messages (conversation_id, sender_id)
    WHERE is_read = FALSE;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_action_jobs_pending_claim
    ON action_jobs (next_attempt_at, created_at)
    WHERE status = 'pending';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_action_jobs_stale_claim
    ON action_jobs (updated_at, next_attempt_at, created_at)
    WHERE status = 'processing';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_export_jobs_pending_claim
    ON export_jobs (next_attempt_at, created_at)
    WHERE status = 'pending';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_export_jobs_stale_claim
    ON export_jobs (updated_at, next_attempt_at, created_at)
    WHERE status = 'processing';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_jobs_pending_claim
    ON email_jobs (next_attempt_at, created_at)
    WHERE status = 'pending';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_jobs_stale_claim
    ON email_jobs (updated_at, next_attempt_at, created_at)
    WHERE status = 'processing';
