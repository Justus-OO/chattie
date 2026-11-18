BEGIN;

ALTER TABLE rooms
    ADD COLUMN IF NOT EXISTS is_voice_room BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS rules TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS content_mode VARCHAR(20) NOT NULL DEFAULT 'general',
    ADD COLUMN IF NOT EXISTS allow_media BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS allow_links BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS slow_mode_seconds INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_read_only BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE rooms
    DROP CONSTRAINT IF EXISTS rooms_content_mode_check,
    ADD CONSTRAINT rooms_content_mode_check CHECK (content_mode IN ('general', 'mature'));

ALTER TABLE rooms
    DROP CONSTRAINT IF EXISTS rooms_slow_mode_seconds_check,
    ADD CONSTRAINT rooms_slow_mode_seconds_check CHECK (slow_mode_seconds BETWEEN 0 AND 300);

ALTER TABLE room_members
    ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS is_muted BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE room_members SET is_muted = FALSE WHERE is_muted IS NULL;
ALTER TABLE room_members
    ALTER COLUMN is_muted SET DEFAULT FALSE,
    ALTER COLUMN is_muted SET NOT NULL;

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS pinned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS room_message_reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(16) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id, room_id);
CREATE INDEX IF NOT EXISTS idx_room_join_requests_pending
    ON room_join_requests(room_id, created_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_room_message_reactions_message
    ON room_message_reactions(message_id, emoji);

COMMIT;
