ALTER TABLE ad_posts
    ADD COLUMN IF NOT EXISTS ai_safety_score SMALLINT
        CHECK (ai_safety_score BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS ai_safety_reason TEXT,
    ADD COLUMN IF NOT EXISTS ai_safety_scored_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_ad_posts_ai_safety_queue
    ON ad_posts (ai_safety_scored_at DESC, ai_safety_score DESC)
    WHERE status IN ('draft', 'processing');
