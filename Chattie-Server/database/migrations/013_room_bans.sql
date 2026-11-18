BEGIN;

CREATE TABLE IF NOT EXISTS room_bans (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    banned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    banned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_bans_user ON room_bans(user_id, room_id);

COMMIT;
