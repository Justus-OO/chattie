ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS ai_dm_preferences (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    partner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    auto_reply_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, partner_id),
    CHECK (user_id <> partner_id)
);

CREATE TABLE IF NOT EXISTS ai_auto_reply_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    partner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    due_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'sent', 'cancelled', 'failed')),
    attempts SMALLINT NOT NULL DEFAULT 0,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, partner_id, source_message_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_auto_reply_jobs_due
    ON ai_auto_reply_jobs(due_at)
    WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    subject VARCHAR(160) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'waiting_human', 'in_progress', 'resolved')),
    priority VARCHAR(12) NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    category VARCHAR(60) NOT NULL DEFAULT 'general',
    ai_summary TEXT NOT NULL DEFAULT '',
    human_requested BOOLEAN NOT NULL DEFAULT FALSE,
    ai_triaged_at TIMESTAMPTZ,
    ai_triage_claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_updated
    ON support_tickets(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_queue
    ON support_tickets(status, priority, updated_at DESC)
    WHERE status <> 'resolved';

ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS ai_triaged_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ai_triage_claimed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS support_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    sender_type VARCHAR(12) NOT NULL
        CHECK (sender_type IN ('user', 'assistant', 'admin', 'system')),
    content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 10000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created
    ON support_messages(ticket_id, created_at, id);

ALTER TABLE support_messages
    DROP CONSTRAINT IF EXISTS support_messages_sender_type_check;
ALTER TABLE support_messages
    ADD CONSTRAINT support_messages_sender_type_check
    CHECK (sender_type IN ('user', 'assistant', 'admin', 'system'));

ALTER TABLE performer_applications
    ADD COLUMN IF NOT EXISTS ai_triage_summary TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS ai_triaged_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ai_triage_claimed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS ai_triage_summary TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS ai_triaged_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ai_triage_claimed_at TIMESTAMPTZ;
