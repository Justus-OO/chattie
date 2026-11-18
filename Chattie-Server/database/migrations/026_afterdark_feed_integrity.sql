CREATE INDEX IF NOT EXISTS idx_ad_posts_published_feed
    ON ad_posts(created_at DESC, id DESC)
    WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_ad_post_likes_post
    ON ad_post_likes(post_id);
