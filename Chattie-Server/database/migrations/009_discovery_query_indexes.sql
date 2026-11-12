CREATE INDEX IF NOT EXISTS idx_interactions_target_actor_action
    ON interactions (target_id, actor_id, action_type);

CREATE INDEX IF NOT EXISTS idx_blocks_blocked_blocker
    ON blocks (blocked_id, blocker_id);
