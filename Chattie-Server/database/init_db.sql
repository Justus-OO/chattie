-- =====================================================================
-- MOCK DATA POPULATION SCRIPT FOR AFTER DARK MODULE
-- =====================================================================

-- THE USERS (Already exist in your DB, mapped below):
-- Creator: 744447e0-c401-4348-b02a-785cb5b501a0 (melisa)
-- Viewer 1: 202c1da3-3e77-4047-9914-164c1e31ff4a (jyu)
-- Viewer 2: 6a65db62-abb2-4506-af3b-20291db99272 (havar831)

-- =====================================================================
-- 1. PROFILES & ONBOARDING
-- =====================================================================

-- Auto-provisioned viewer profiles for all users
INSERT INTO ad_viewer_profiles (user_id, alias, explicit_consent_at, age_verified_at) VALUES
                                                                                          ('744447e0-c401-4348-b02a-785cb5b501a0', 'User-MelisaAD', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                                                                                          ('202c1da3-3e77-4047-9914-164c1e31ff4a', 'User-Jyu', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                                                                                          ('6a65db62-abb2-4506-af3b-20291db99272', 'User-Havar', NULL, NULL)
ON CONFLICT (user_id) DO NOTHING;

-- Creator Onboarding (Application & Consent for Melisa)
INSERT INTO performer_applications (id, user_id, status, verification_ref, payout_method_id, policy_version) VALUES
    ('aaaa1111-1111-1111-1111-111111111111', '744447e0-c401-4348-b02a-785cb5b501a0', 'approved', 'KYC-REF-9921', 'MPESA-001', 'v1.0')
ON CONFLICT DO NOTHING;

INSERT INTO performer_consents (user_id, consent_type, policy_version) VALUES
    ('744447e0-c401-4348-b02a-785cb5b501a0', 'explicit_content_creation', 'v1.0');

-- Creator Profile (Melisa becomes an active Creator)
INSERT INTO performer_profiles (user_id, display_name, username, bio, website, location, status, dm_control) VALUES
    ('744447e0-c401-4348-b02a-785cb5b501a0', 'Melisa Nights', 'melisanights', 'Exclusive content and behind the scenes.', 'https://linktr.ee/melisa', 'Nairobi, KE', 'active', 'subscribers')
ON CONFLICT (user_id) DO NOTHING;


-- =====================================================================
-- 2. ASSETS & POSTS
-- =====================================================================

-- Uploaded Media Assets (1 Free Image, 1 PPV Video)
INSERT INTO ad_assets (id, owner_id, storage_key, mime_type, size_bytes, status, moderation_status) VALUES
                                                                                                        ('bbbb1111-1111-1111-1111-111111111111', '744447e0-c401-4348-b02a-785cb5b501a0', 'afterdark/melisa/free_image.jpg', 'image/jpeg', 2048000, 'ready', 'approved'),
                                                                                                        ('bbbb2222-2222-2222-2222-222222222222', '744447e0-c401-4348-b02a-785cb5b501a0', 'afterdark/melisa/ppv_video.mp4', 'video/mp4', 45000000, 'ready', 'approved')
ON CONFLICT (id) DO NOTHING;

-- Published Posts
INSERT INTO ad_posts (id, creator_id, asset_id, caption, access_type, price_cents, status) VALUES
-- Free Teaser Post
('cccc1111-1111-1111-1111-111111111111', '744447e0-c401-4348-b02a-785cb5b501a0', 'bbbb1111-1111-1111-1111-111111111111', 'Welcome to my vault! 🖤', 'free', 0, 'published'),
-- PPV Locked Video (Costs KES 500 = 50000 cents)
('cccc2222-2222-2222-2222-222222222222', '744447e0-c401-4348-b02a-785cb5b501a0', 'bbbb2222-2222-2222-2222-222222222222', 'Exclusive Friday night set 🥂', 'ppv', 50000, 'published')
ON CONFLICT (id) DO NOTHING;


-- =====================================================================
-- 3. WALLETS, LEDGERS & ENTITLEMENTS
-- =====================================================================

-- Give Viewer 1 and Viewer 2 some starting balance (KES 1000 each)
INSERT INTO ad_wallets (user_id, available_balance_cents, pending_balance_cents) VALUES
                                                                                     ('744447e0-c401-4348-b02a-785cb5b501a0', 40000, 0), -- Creator earned 400 (80% of 500 PPV)
                                                                                     ('202c1da3-3e77-4047-9914-164c1e31ff4a', 50000, 0), -- Viewer 1 spent 500 on PPV, has 500 left
                                                                                     ('6a65db62-abb2-4506-af3b-20291db99272', 100000, 0)  -- Viewer 2 has full 1000 balance
ON CONFLICT (user_id) DO UPDATE SET
                                    available_balance_cents = EXCLUDED.available_balance_cents,
                                    pending_balance_cents = EXCLUDED.pending_balance_cents;

-- Ledger History: Deposits and the PPV Purchase
INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description) VALUES
-- Viewer 1 Top Up
('202c1da3-3e77-4047-9914-164c1e31ff4a', 100000, 'deposit', 'MPESA-TXN-001', 'M-Pesa Deposit'),
-- Viewer 2 Top Up
('6a65db62-abb2-4506-af3b-20291db99272', 100000, 'deposit', 'MPESA-TXN-002', 'M-Pesa Deposit'),
-- Viewer 1 Buys PPV
('202c1da3-3e77-4047-9914-164c1e31ff4a', -50000, 'ppv_purchase', 'cccc2222-2222-2222-2222-222222222222', 'Unlocked PPV Post'),
-- Creator Earns from PPV (Assuming 80% payout = 40000 cents)
('744447e0-c401-4348-b02a-785cb5b501a0', 40000, 'ppv_earning', 'cccc2222-2222-2222-2222-222222222222', 'Earning from PPV Post');

-- Unlock Entitlement for Viewer 1 (They can now see the PPV video)
INSERT INTO ad_post_entitlements (user_id, post_id, payment_ref) VALUES
    ('202c1da3-3e77-4047-9914-164c1e31ff4a', 'cccc2222-2222-2222-2222-222222222222', 'LEDGER-REF-AUTO')
ON CONFLICT DO NOTHING;

-- Subscription: Viewer 2 subscribes to Creator 1 for 30 days
INSERT INTO ad_subscriptions (subscriber_id, creator_id, status, current_period_end) VALUES
    ('6a65db62-abb2-4506-af3b-20291db99272', '744447e0-c401-4348-b02a-785cb5b501a0', 'active', CURRENT_TIMESTAMP + INTERVAL '30 days')
ON CONFLICT DO NOTHING;


-- =====================================================================
-- 4. INTERACTIONS (LIKES & COMMENTS)
-- =====================================================================

-- Viewer 1 and Viewer 2 like the Free Teaser Post
INSERT INTO ad_post_likes (user_id, post_id) VALUES
                                                 ('202c1da3-3e77-4047-9914-164c1e31ff4a', 'cccc1111-1111-1111-1111-111111111111'),
                                                 ('6a65db62-abb2-4506-af3b-20291db99272', 'cccc1111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

-- Viewer 1 comments on the PPV Post they unlocked
INSERT INTO ad_post_comments (user_id, post_id, content) VALUES
    ('202c1da3-3e77-4047-9914-164c1e31ff4a', 'cccc2222-2222-2222-2222-222222222222', 'Worth every penny! 🔥');


-- =====================================================================
-- 5. PRIVATE MESSAGES (DMs)
-- =====================================================================

-- Create a thread between Creator 1 and Viewer 2 (Subscriber)
INSERT INTO ad_conversations (id) VALUES ('dddd1111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

INSERT INTO ad_conversation_participants (conversation_id, user_id) VALUES
                                                                        ('dddd1111-1111-1111-1111-111111111111', '744447e0-c401-4348-b02a-785cb5b501a0'),
                                                                        ('dddd1111-1111-1111-1111-111111111111', '6a65db62-abb2-4506-af3b-20291db99272')
ON CONFLICT DO NOTHING;

INSERT INTO ad_messages (conversation_id, sender_id, content, is_read) VALUES
                                                                           ('dddd1111-1111-1111-1111-111111111111', '6a65db62-abb2-4506-af3b-20291db99272', 'Hey! Just subscribed, love your content.', TRUE),
                                                                           ('dddd1111-1111-1111-1111-111111111111', '744447e0-c401-4348-b02a-785cb5b501a0', 'Thank you! Let me know if you want custom requests.', FALSE);


-- =====================================================================
-- 6. PENDING DEPOSITS & WITHDRAWALS
-- =====================================================================

-- A pending STK Push that Viewer 2 hasn't entered their PIN for yet
INSERT INTO ad_deposit_intents (user_id, amount_cents, provider, status) VALUES
    ('6a65db62-abb2-4506-af3b-20291db99272', 200000, 'mpesa', 'pending');

-- Creator requests a withdrawal of KES 300 (30000 cents)
INSERT INTO ad_withdrawals (user_id, amount_cents, payout_method_id, status) VALUES
    ('744447e0-c401-4348-b02a-785cb5b501a0', 30000, 'MPESA-001', 'processing');

-- Adjust Creator Wallet to move 30000 to "pending"
UPDATE ad_wallets
SET available_balance_cents = 10000, pending_balance_cents = 30000
WHERE user_id = '744447e0-c401-4348-b02a-785cb5b501a0';



-- =====================================================================
-- 20. AFTER DARK (AD) AUXILIARY: FOLLOWS, PAYOUTS & LINKS
-- =====================================================================

-- Follows (distinct from paid subscriptions)
CREATE TABLE IF NOT EXISTS ad_follows (
                                          follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                          creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                          PRIMARY KEY (follower_id, creator_id)
);

-- Creator Payout Methods (Bank accounts, M-Pesa numbers)
CREATE TABLE IF NOT EXISTS ad_payout_methods (
                                                 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                 provider VARCHAR(50) NOT NULL, -- e.g., 'mpesa', 'bank_transfer'
                                                 account_number VARCHAR(255) NOT NULL, -- Must be encrypted in a real production env
                                                 account_name VARCHAR(255),
                                                 is_default BOOLEAN DEFAULT FALSE,
                                                 created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Expiring Share Links
CREATE TABLE IF NOT EXISTS ad_share_links (
                                              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                              user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                              target_type VARCHAR(50) NOT NULL, -- 'profile' or 'post'
                                              target_id UUID NOT NULL,
                                              expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                                              created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);




-- Allow 'comment' as a valid report target
ALTER TABLE ad_reports DROP CONSTRAINT IF EXISTS ad_reports_target_type_check;
ALTER TABLE ad_reports ADD CONSTRAINT ad_reports_target_type_check
    CHECK (target_type IN ('creator', 'post', 'message', 'live_session', 'comment'));

-- Tracks read receipts for conversations
CREATE TABLE IF NOT EXISTS ad_conversation_reads (
                                                     conversation_id UUID REFERENCES ad_conversations(id) ON DELETE CASCADE,
                                                     user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                     last_read_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                     PRIMARY KEY (conversation_id, user_id)
);

-- Allow 'comment' as a valid report target
ALTER TABLE ad_reports DROP CONSTRAINT IF EXISTS ad_reports_target_type_check;
ALTER TABLE ad_reports ADD CONSTRAINT ad_reports_target_type_check
    CHECK (target_type IN ('creator', 'post', 'message', 'live_session', 'comment'));

-- Tracks read receipts for conversations
CREATE TABLE IF NOT EXISTS ad_conversation_reads (
                                                     conversation_id UUID REFERENCES ad_conversations(id) ON DELETE CASCADE,
                                                     user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                     last_read_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                     PRIMARY KEY (conversation_id, user_id)
);

-- =====================================================================
-- 19. AFTER DARK (AD) SETTINGS & LIFECYCLE
-- =====================================================================

CREATE TABLE IF NOT EXISTS ad_creator_settings (
                                                   user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                                   watermark_enabled BOOLEAN DEFAULT TRUE,
                                                   watermark_text VARCHAR(100),
                                                   geo_block_enabled BOOLEAN DEFAULT FALSE,
                                                   blocked_regions JSONB DEFAULT '[]'::jsonb, -- Store list of blocked country codes/cities
                                                   show_explicit_content BOOLEAN NOT NULL DEFAULT FALSE,
                                                   discoverable BOOLEAN NOT NULL DEFAULT TRUE,
                                                   notification_email JSONB NOT NULL DEFAULT '{"subs":true,"tips":true,"messages":false,"marketing":false}'::jsonb,
                                                   notification_push JSONB NOT NULL DEFAULT '{"subs":true,"tips":true,"messages":true,"mentions":true}'::jsonb,
                                                   default_ppv_cents BIGINT NOT NULL DEFAULT 0,
                                                   auto_withdraw BOOLEAN NOT NULL DEFAULT FALSE,
                                                   withdraw_threshold_cents BIGINT NOT NULL DEFAULT 0,
                                                   updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE ad_creator_settings ADD COLUMN IF NOT EXISTS show_explicit_content BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ad_creator_settings ADD COLUMN IF NOT EXISTS discoverable BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE ad_creator_settings ADD COLUMN IF NOT EXISTS notification_email JSONB NOT NULL DEFAULT '{"subs":true,"tips":true,"messages":false,"marketing":false}'::jsonb;
ALTER TABLE ad_creator_settings ADD COLUMN IF NOT EXISTS notification_push JSONB NOT NULL DEFAULT '{"subs":true,"tips":true,"messages":true,"mentions":true}'::jsonb;
ALTER TABLE ad_creator_settings ADD COLUMN IF NOT EXISTS default_ppv_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ad_creator_settings ADD COLUMN IF NOT EXISTS auto_withdraw BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ad_creator_settings ADD COLUMN IF NOT EXISTS withdraw_threshold_cents BIGINT NOT NULL DEFAULT 0;


-- =====================================================================
-- 18. AFTER DARK (AD) LIVE SESSIONS & CO-STREAMING
-- =====================================================================

-- Tracks active and historical live broadcasts
CREATE TABLE IF NOT EXISTS ad_live_sessions (
                                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                status VARCHAR(20) DEFAULT 'live' CHECK (status IN ('live', 'ended', 'suspended')),
                                                price_cents BIGINT DEFAULT 0, -- Price for a one-time pass
                                                started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                ended_at TIMESTAMP WITH TIME ZONE
);

-- Tracks one-time purchases scoped exactly to one specific session (Invariant #5)
CREATE TABLE IF NOT EXISTS ad_live_entitlements (
                                                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                    session_id UUID NOT NULL REFERENCES ad_live_sessions(id) ON DELETE CASCADE,
                                                    payment_ref VARCHAR(255),
                                                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                    PRIMARY KEY (user_id, session_id)
);

-- State machine for viewers requesting to join the stage (co-stream)
CREATE TABLE IF NOT EXISTS ad_live_stage_requests (
                                                      session_id UUID NOT NULL REFERENCES ad_live_sessions(id) ON DELETE CASCADE,
                                                      viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                      status VARCHAR(20) DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'denied', 'on_stage', 'removed', 'left')),
                                                      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                      PRIMARY KEY (session_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_live_sessions_creator ON ad_live_sessions(creator_id, status);
select * from users;

-- =====================================================================
-- 17. AFTER DARK (AD) DEPOSITS & WITHDRAWALS
-- =====================================================================

-- Tracks deposit attempts before the provider webhook confirms them
CREATE TABLE IF NOT EXISTS ad_deposit_intents (
                                                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                  amount_cents BIGINT NOT NULL,
                                                  provider VARCHAR(50) NOT NULL, -- e.g., 'mpesa', 'paystack'
                                                  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
                                                  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tracks creator withdrawal requests and reserved funds
CREATE TABLE IF NOT EXISTS ad_withdrawals (
                                              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                              user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                              amount_cents BIGINT NOT NULL,
                                              payout_method_id VARCHAR(255) NOT NULL,
                                              status VARCHAR(20) DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'paid', 'failed', 'reversed')),
                                              failure_reason TEXT,
                                              created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                              updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_withdrawals_user ON ad_withdrawals(user_id, created_at DESC);




-- =====================================================================
-- 16. AFTER DARK (AD) PRIVATE CHATS
-- =====================================================================

-- Stable conversation thread
CREATE TABLE IF NOT EXISTS ad_conversations (
                                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Links users to conversations safely
CREATE TABLE IF NOT EXISTS ad_conversation_participants (
                                                            conversation_id UUID REFERENCES ad_conversations(id) ON DELETE CASCADE,
                                                            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                            joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                            PRIMARY KEY (conversation_id, user_id)
);

-- The messages within the thread
CREATE TABLE IF NOT EXISTS ad_messages (
                                           id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                           conversation_id UUID NOT NULL REFERENCES ad_conversations(id) ON DELETE CASCADE,
                                           sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                           content TEXT,
                                           media_asset_id UUID REFERENCES ad_assets(id) ON DELETE SET NULL,
                                           is_explicit BOOLEAN DEFAULT FALSE,
                                           is_read BOOLEAN DEFAULT FALSE,
                                           created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_conv_participants ON ad_conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_messages_conv ON ad_messages(conversation_id, created_at DESC);







-- =====================================================================
-- 15. AFTER DARK (AD) INTERACTIONS & MODERATION
-- =====================================================================

-- Post Likes (Composite Primary Key ensures idempotency)
CREATE TABLE IF NOT EXISTS ad_post_likes (
                                             user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                             post_id UUID NOT NULL REFERENCES ad_posts(id) ON DELETE CASCADE,
                                             created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                             PRIMARY KEY (user_id, post_id)
);

-- Post Comments
CREATE TABLE IF NOT EXISTS ad_post_comments (
                                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                post_id UUID NOT NULL REFERENCES ad_posts(id) ON DELETE CASCADE,
                                                content TEXT NOT NULL,
                                                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Moderation Reports
CREATE TABLE IF NOT EXISTS ad_reports (
                                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                          reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                          target_type VARCHAR(50) NOT NULL CHECK (target_type IN ('creator', 'post', 'message', 'live_session')),
                                          target_id UUID NOT NULL,
                                          reason VARCHAR(100) NOT NULL,
                                          details TEXT,
                                          status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
                                          reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
                                          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_post_comments_post ON ad_post_comments(post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ad_reports_target ON ad_reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_ad_reports_status ON ad_reports(status);





-- =====================================================================
-- 14. AFTER DARK (AD) BILLING, WALLETS & ENTITLEMENTS
-- =====================================================================

-- Immutable Ledger for all financial movements
CREATE TABLE IF NOT EXISTS ad_ledger_entries (
                                                 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                 amount_cents BIGINT NOT NULL, -- Positive for deposits/earnings, Negative for purchases/withdrawals
                                                 transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('deposit', 'withdrawal', 'ppv_purchase', 'ppv_earning', 'subscription_purchase', 'subscription_earning', 'tip_sent', 'tip_received')),
                                                 reference_id VARCHAR(255), -- e.g., Provider Payment ID or Post ID
                                                 description TEXT,
                                                 created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Cached Wallet Balance (Rebuilt from ledger if necessary)
CREATE TABLE IF NOT EXISTS ad_wallets (
                                          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                          available_balance_cents BIGINT DEFAULT 0,
                                          pending_balance_cents BIGINT DEFAULT 0,
                                          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tracks who unlocked which PPV post
CREATE TABLE IF NOT EXISTS ad_post_entitlements (
                                                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                    post_id UUID NOT NULL REFERENCES ad_posts(id) ON DELETE CASCADE,
                                                    payment_ref VARCHAR(255),
                                                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                    PRIMARY KEY (user_id, post_id)
);

-- Tracks active creator subscriptions
CREATE TABLE IF NOT EXISTS ad_subscriptions (
                                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                subscriber_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'expired', 'past_due')),
                                                current_period_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
                                                UNIQUE (subscriber_id, creator_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_ledger_user ON ad_ledger_entries(user_id, created_at DESC);





-- =====================================================================
-- 13. AFTER DARK (AD) MEDIA & POSTS
-- =====================================================================

-- Represents raw uploaded files in a private storage bucket
CREATE TABLE IF NOT EXISTS ad_assets (
                                         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                         owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                         storage_key TEXT NOT NULL, -- Private B2/S3 Storage key
                                         mime_type VARCHAR(100) NOT NULL,
                                         size_bytes BIGINT NOT NULL,
                                         status VARCHAR(20) DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'rejected', 'deleted')),
                                         moderation_status VARCHAR(20) DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'flagged')),
                                         created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Represents the content exposed to the feed/profile
CREATE TABLE IF NOT EXISTS ad_posts (
                                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                        creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                        asset_id UUID NOT NULL REFERENCES ad_assets(id) ON DELETE CASCADE,
                                        caption TEXT,
                                        access_type VARCHAR(20) DEFAULT 'free' CHECK (access_type IN ('free', 'subscriber', 'ppv')),
                                        price_cents BIGINT DEFAULT 0, -- Stored in minor units (e.g., KES cents)
                                        is_explicit BOOLEAN DEFAULT TRUE,
                                        status VARCHAR(20) DEFAULT 'published' CHECK (status IN ('draft', 'processing', 'published', 'scheduled', 'rejected', 'deleted')),
                                        publish_at TIMESTAMP WITH TIME ZONE,
                                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_assets_owner ON ad_assets(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_posts_creator ON ad_posts(creator_id, status, created_at DESC);





-- =====================================================================
-- 13. AFTER DARK (AD) MEDIA & POSTS
-- =====================================================================

-- Represents raw uploaded files in a private storage bucket
CREATE TABLE IF NOT EXISTS ad_assets (
                                         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                         owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                         storage_key TEXT NOT NULL, -- Private S3/Cloud Storage key
                                         mime_type VARCHAR(100) NOT NULL,
                                         size_bytes BIGINT NOT NULL,
                                         status VARCHAR(20) DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'rejected', 'deleted')),
                                         moderation_status VARCHAR(20) DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'flagged')),
                                         created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Represents the content exposed to the feed/profile
CREATE TABLE IF NOT EXISTS ad_posts (
                                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                        creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                        asset_id UUID NOT NULL REFERENCES ad_assets(id) ON DELETE CASCADE,
                                        caption TEXT,
                                        access_type VARCHAR(20) DEFAULT 'free' CHECK (access_type IN ('free', 'subscriber', 'ppv')),
                                        price_cents BIGINT DEFAULT 0, -- Stored in minor units to prevent float precision issues
                                        is_explicit BOOLEAN DEFAULT TRUE,
                                        status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'published', 'scheduled', 'rejected', 'deleted')),
                                        publish_at TIMESTAMP WITH TIME ZONE,
                                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_assets_owner ON ad_assets(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_posts_creator ON ad_posts(creator_id, status, created_at DESC);




-- =====================================================================
-- 12. AFTER DARK (AD) MODULE
-- =====================================================================

-- Auto-provisioned viewer profile for frictionless feed scrolling
CREATE TABLE IF NOT EXISTS ad_viewer_profiles (
                                                  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                                  alias VARCHAR(255) UNIQUE NOT NULL,
                                                  explicit_consent_at TIMESTAMP WITH TIME ZONE,
                                                  age_verified_at TIMESTAMP WITH TIME ZONE,
                                                  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Approved After Dark Creators
CREATE TABLE IF NOT EXISTS performer_profiles (
                                                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                  display_name VARCHAR(100) NOT NULL,
                                                  username VARCHAR(100) UNIQUE NOT NULL,
                                                  bio TEXT,
                                                  website VARCHAR(255),
                                                  location VARCHAR(100),
                                                  avatar_asset_id UUID,
                                                  cover_asset_id UUID,
                                                  subscription_price_cents BIGINT NOT NULL DEFAULT 50000,
                                                  welcome_message TEXT NOT NULL DEFAULT '',
                                                  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'suspended')),
                                                  dm_control VARCHAR(20) DEFAULT 'all' CHECK (dm_control IN ('all', 'subscribers', 'none')),
                                                  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE performer_profiles ADD COLUMN IF NOT EXISTS subscription_price_cents BIGINT NOT NULL DEFAULT 50000;
ALTER TABLE performer_profiles ADD COLUMN IF NOT EXISTS welcome_message TEXT NOT NULL DEFAULT '';
ALTER TABLE performer_profiles DROP CONSTRAINT IF EXISTS performer_profiles_status_check;
ALTER TABLE performer_profiles ADD CONSTRAINT performer_profiles_status_check
	CHECK (status IN ('pending', 'active', 'paused', 'suspended', 'deactivated'));

-- KYC & Onboarding Applications Tracker
CREATE TABLE IF NOT EXISTS performer_applications (
                                                      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                      status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
                                                      verification_ref VARCHAR(255),
                                                      payout_method_id VARCHAR(255),
                                                      policy_version VARCHAR(50),
                                                      decision_reason_code VARCHAR(255),
                                                      submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                      reviewed_at TIMESTAMP WITH TIME ZONE
);

-- Legal & Explicit Content Acknowledgements
CREATE TABLE IF NOT EXISTS performer_consents (
                                                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                  consent_type VARCHAR(100) NOT NULL,
                                                  policy_version VARCHAR(50) NOT NULL,
                                                  accepted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for After Dark
CREATE INDEX IF NOT EXISTS idx_performer_applications_user ON performer_applications(user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_performer_profiles_status ON performer_profiles(status);










-- =====================================================================
-- KYC DYNAMIC CONFIGURATION TABLES
-- =====================================================================

CREATE TABLE IF NOT EXISTS kyc_countries (
                                             id SERIAL PRIMARY KEY,
                                             name VARCHAR(100) UNIQUE NOT NULL,
                                             is_active BOOLEAN DEFAULT TRUE,
                                             sort_order INT DEFAULT 99
);

CREATE TABLE IF NOT EXISTS kyc_documents (
                                             id SERIAL PRIMARY KEY,
                                             code VARCHAR(50) UNIQUE NOT NULL,
                                             label VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS kyc_country_documents (
                                                     country_id INT REFERENCES kyc_countries(id) ON DELETE CASCADE,
                                                     document_id INT REFERENCES kyc_documents(id) ON DELETE CASCADE,
                                                     PRIMARY KEY (country_id, document_id)
);

CREATE TABLE IF NOT EXISTS kyc_poses (
                                         id SERIAL PRIMARY KEY,
                                         instruction TEXT UNIQUE NOT NULL,
                                         is_active BOOLEAN DEFAULT TRUE
);

-- ---------------------------------------------------------------------
-- SEED DATA
-- ---------------------------------------------------------------------

-- 1. Seed Documents
INSERT INTO kyc_documents (code, label) VALUES
                                            ('drivers_license', 'Driver''s License'),
                                            ('passport', 'Passport'),
                                            ('national_id', 'National ID Card'),
                                            ('voters_card', 'Voter''s Card')
ON CONFLICT (code) DO NOTHING;

-- 2. Seed Countries (Ordered for the UI dropdown)
INSERT INTO kyc_countries (name, sort_order) VALUES
                                                 ('United States', 1),
                                                 ('Canada', 2),
                                                 ('United Kingdom', 3),
                                                 ('Australia', 4),
                                                 ('India', 5),
                                                 ('Kenya', 6),
                                                 ('South Africa', 7),
                                                 ('Nigeria', 8),
                                                 ('Other', 99)
ON CONFLICT (name) DO NOTHING;

-- 3. Seed Country-to-Document Relationships
INSERT INTO kyc_country_documents (country_id, document_id)
SELECT c.id, d.id FROM kyc_countries c, kyc_documents d
WHERE c.name IN ('United States', 'Canada', 'United Kingdom', 'Australia')
  AND d.code IN ('drivers_license', 'passport', 'national_id')
ON CONFLICT DO NOTHING;

INSERT INTO kyc_country_documents (country_id, document_id)
SELECT c.id, d.id FROM kyc_countries c, kyc_documents d
WHERE c.name = 'India' AND d.code IN ('national_id', 'passport', 'drivers_license')
ON CONFLICT DO NOTHING;

INSERT INTO kyc_country_documents (country_id, document_id)
SELECT c.id, d.id FROM kyc_countries c, kyc_documents d
WHERE c.name IN ('Kenya', 'South Africa') AND d.code IN ('national_id', 'passport')
ON CONFLICT DO NOTHING;

INSERT INTO kyc_country_documents (country_id, document_id)
SELECT c.id, d.id FROM kyc_countries c, kyc_documents d
WHERE c.name = 'Nigeria' AND d.code IN ('national_id', 'passport', 'voters_card')
ON CONFLICT DO NOTHING;

INSERT INTO kyc_country_documents (country_id, document_id)
SELECT c.id, d.id FROM kyc_countries c, kyc_documents d
WHERE c.name = 'Other' AND d.code IN ('national_id', 'passport', 'drivers_license')
ON CONFLICT DO NOTHING;

-- 4. Seed Poses
INSERT INTO kyc_poses (instruction) VALUES
                                        ('Look straight at the camera and blink twice'),
                                        ('Turn your head slightly to the left'),
                                        ('Turn your head slightly to the right'),
                                        ('Smile widely showing teeth')
ON CONFLICT (instruction) DO NOTHING;


ALTER TABLE billing_plans DROP COLUMN stripe_price_id;
-- =====================================================================
-- CHATTIE DATABASE INITIALIZATION SCRIPT (V2)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================================
-- 1. CORE AUTH & USERS
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
                                     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                     email VARCHAR(255) UNIQUE NOT NULL,
                                     username VARCHAR(255) UNIQUE NOT NULL,
                                     password_hash VARCHAR(255) NOT NULL,
                                     role VARCHAR(20) NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'model', 'admin', 'persona')),
                                     status VARCHAR(20) NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding', 'active', 'suspended', 'banned', 'flagged', 'ONLINE', 'OFFLINE')),
                                     reset_token VARCHAR(255),
                                     reset_token_expires_at TIMESTAMP WITH TIME ZONE,
                                     last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                     updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 2. SUBSCRIPTION TIERS & BILLING PLANS (Must be created early)
-- =====================================================================
CREATE TABLE IF NOT EXISTS subscription_tiers (
                                                  id SERIAL PRIMARY KEY,
                                                  name VARCHAR(50) UNIQUE NOT NULL,
                                                  max_daily_swipes INT NOT NULL DEFAULT 50,
                                                  max_daily_super_likes INT NOT NULL DEFAULT 1,
                                                  can_see_likes BOOLEAN DEFAULT FALSE,
                                                  can_use_advanced_filters BOOLEAN DEFAULT FALSE,
                                                  can_undo BOOLEAN DEFAULT FALSE,
                                                  max_daily_voice_joins INT DEFAULT 1,
                                                  max_rooms_created INT DEFAULT 0,
                                                  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO subscription_tiers (name, max_daily_swipes, max_daily_super_likes, can_see_likes, can_use_advanced_filters, can_undo, max_daily_voice_joins, max_rooms_created)
VALUES
    ('free', 40, 1, FALSE, FALSE, FALSE, 1, 0),
    ('premium', -1, 5, TRUE, TRUE, TRUE, -1, -1),
    ('vip', -1, 10, TRUE, TRUE, TRUE, -1, -1)
ON CONFLICT (name) DO UPDATE SET
                                 max_daily_voice_joins = EXCLUDED.max_daily_voice_joins,
                                 max_rooms_created = EXCLUDED.max_rooms_created;

-- THE NEW DYNAMIC PRICING TABLE
CREATE TABLE IF NOT EXISTS billing_plans (
                                             id SERIAL PRIMARY KEY,
                                             tier_id INT REFERENCES subscription_tiers(id) ON DELETE CASCADE,
                                             duration_months INT NOT NULL,
                                             price DECIMAL(10, 2) NOT NULL,
                                             monthly_breakdown DECIMAL(10, 2) NOT NULL,
                                             save_percentage INT DEFAULT 0,
                                             is_popular BOOLEAN DEFAULT FALSE,
                                             stripe_price_id VARCHAR(100),
                                             paystack_plan_code VARCHAR(100),
                                             is_active BOOLEAN DEFAULT TRUE,
                                             UNIQUE(tier_id, duration_months) -- Prevents duplicates on script re-run
);

-- Seed the dynamic pricing plans
INSERT INTO billing_plans (tier_id, duration_months, price, monthly_breakdown, save_percentage, is_popular)
VALUES
    ((SELECT id FROM subscription_tiers WHERE name = 'premium'), 1, 14.99, 14.99, 0, FALSE),
    ((SELECT id FROM subscription_tiers WHERE name = 'premium'), 6, 53.94, 8.99, 40, TRUE),
    ((SELECT id FROM subscription_tiers WHERE name = 'premium'), 12, 71.88, 5.99, 60, FALSE)
ON CONFLICT (tier_id, duration_months) DO NOTHING;

-- =====================================================================
-- 3. USER METADATA, PREFERENCES & CONSENT
-- =====================================================================
CREATE TABLE IF NOT EXISTS user_profiles (
                                             user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                             display_name VARCHAR(50) NOT NULL,
                                             date_of_birth DATE NOT NULL,
                                             gender VARCHAR(20) NOT NULL,
                                             bio TEXT,
                                             height_cm INT,
                                             avatar_url VARCHAR(500),
                                             cover_url VARCHAR(1024) DEFAULT '',
                                             job_title VARCHAR(255) DEFAULT '',
                                             phone_number VARCHAR(20) DEFAULT '',
                                             intent VARCHAR(50) DEFAULT 'All',
                                             verified BOOLEAN DEFAULT FALSE,
                                             created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_locations (
                                              user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                              latitude DECIMAL(10, 8),
                                              longitude DECIMAL(11, 8),
                                              city VARCHAR(100),
                                              country VARCHAR(100),
                                              last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_preferences (
                                                user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                                interested_in VARCHAR(20) NOT NULL,
                                                min_age INT DEFAULT 18,
                                                max_age INT DEFAULT 99,
                                                max_distance_km INT DEFAULT 50
);

CREATE TABLE IF NOT EXISTS user_settings (
                                             user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                             global_mode BOOLEAN DEFAULT FALSE,
                                             show_me VARCHAR(20) DEFAULT 'Everyone',
                                             notif_new_matches BOOLEAN DEFAULT TRUE,
                                             notif_messages BOOLEAN DEFAULT TRUE,
                                             notif_super_likes BOOLEAN DEFAULT TRUE,
                                             notif_promotions BOOLEAN DEFAULT FALSE,
                                             privacy_incognito BOOLEAN DEFAULT FALSE,
                                             privacy_read_receipts BOOLEAN DEFAULT TRUE,
                                             conn_spotify BOOLEAN DEFAULT FALSE,
                                             conn_instagram BOOLEAN DEFAULT FALSE,
                                             guidelines_agreed BOOLEAN DEFAULT FALSE,
                                             updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_tags (
                                         user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                         tag VARCHAR(50) NOT NULL,
                                         created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                         PRIMARY KEY (user_id, tag)
);

CREATE TABLE IF NOT EXISTS user_media (
                                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                          url TEXT NOT NULL,
                                          is_primary BOOLEAN DEFAULT FALSE,
                                          sort_order INT DEFAULT 0,
                                          size_bytes BIGINT DEFAULT 0,
                                          mime_type VARCHAR(100) DEFAULT 'image/jpeg',
                                          watermarked BOOLEAN DEFAULT TRUE,
                                          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
                                                  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                                  tier_id INT REFERENCES subscription_tiers(id),
                                                  status VARCHAR(20) DEFAULT 'active',
                                                  expires_at TIMESTAMP WITH TIME ZONE,
                                                  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_daily_usage (
                                                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
                                                swipes_used INT DEFAULT 0,
                                                super_likes_used INT DEFAULT 0,
                                                voice_joins_used INT DEFAULT 0,
                                                rooms_created_used INT DEFAULT 0,
                                                PRIMARY KEY (user_id, usage_date)
);

CREATE TABLE IF NOT EXISTS user_consent_logs (
                                                 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                 terms_accepted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                 ip_address VARCHAR(45),
                                                 user_agent TEXT
);

CREATE TABLE IF NOT EXISTS user_otps (
                                         user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                         code VARCHAR(10) NOT NULL,
                                         expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                                         created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_devices (
                                            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                            device_token VARCHAR(255) NOT NULL UNIQUE,
                                            platform VARCHAR(20) CHECK (platform IN ('ios', 'android', 'web')),
                                            last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 4. INTERACTIONS, VIEWS, & REPORTS
-- =====================================================================
CREATE TABLE IF NOT EXISTS interactions (
                                            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                            actor_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                            target_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                            action_type VARCHAR(20) NOT NULL CHECK (action_type IN ('LIKE', 'PASS', 'SUPER_LIKE', 'FLIRT')),
                                            is_match BOOLEAN DEFAULT FALSE,
                                            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                            UNIQUE (actor_id, target_id)
);

CREATE TABLE IF NOT EXISTS blocks (
                                      blocker_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                      blocked_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                      PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS profile_views (
                                             viewer_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                             viewed_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                             viewed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                             PRIMARY KEY (viewer_id, viewed_id)
);

CREATE TABLE IF NOT EXISTS reports (
                                       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                       reporter_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                       reported_id UUID REFERENCES users(id) ON DELETE SET NULL,
                                       reported_username VARCHAR(255),
                                       reason VARCHAR(100) NOT NULL,
                                       description TEXT,
                                       status VARCHAR(20) DEFAULT 'pending',
                                       created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 5. ROOMS & MESSAGING
-- =====================================================================
CREATE TABLE IF NOT EXISTS rooms (
                                     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                     name VARCHAR(255) NOT NULL,
                                     room_code VARCHAR(20) UNIQUE,
                                     icon VARCHAR(50),
                                     category VARCHAR(100),
                                     description TEXT,
                                     tags JSONB DEFAULT '[]'::jsonb,
                                     is_private BOOLEAN DEFAULT FALSE,
                                     status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WARNING', 'SUSPENDED')),
                                     warning_level INT DEFAULT 0,
                                     created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                                     active_count INT DEFAULT 0,
                                     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS room_members (
                                            room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
                                            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                            role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('creator', 'admin', 'speaker', 'member', 'host')),
                                            is_muted BOOLEAN DEFAULT FALSE,
                                            joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                            last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                            PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_join_requests (
                                                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
                                                  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                  status VARCHAR(20) DEFAULT 'PENDING',
                                                  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                  UNIQUE (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
                                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                        sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                        recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                        room_id VARCHAR(255) DEFAULT 'default',
                                        content TEXT NOT NULL,
                                        media TEXT,
                                        status VARCHAR(20) DEFAULT 'sent',
                                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 6. CREATOR, OPERATOR, & CLIENT LOGIC
-- =====================================================================
CREATE TABLE IF NOT EXISTS managed_profiles (
                                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                manager_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                name VARCHAR(100) NOT NULL,
                                                avatar_url TEXT,
                                                status VARCHAR(20) DEFAULT 'offline',
                                                archetype VARCHAR(100) DEFAULT 'General',
                                                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_requests (
                                             id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                             model_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                             client_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                             managed_profile_id UUID REFERENCES managed_profiles(id) ON DELETE CASCADE,
                                             tip_amount DECIMAL(10, 2) DEFAULT 0.00,
                                             status VARCHAR(20) DEFAULT 'PENDING',
                                             created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                             updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
                                            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                            model_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                            client_id UUID REFERENCES users(id) ON DELETE SET NULL,
                                            tx_type VARCHAR(50) NOT NULL,
                                            amount DECIMAL(10, 2) NOT NULL,
                                            status VARCHAR(20) DEFAULT 'COMPLETED',
                                            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Model/Operator Specific
CREATE TABLE IF NOT EXISTS creator_stats (
                                             user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                             current_balance DECIMAL(10, 2) DEFAULT 0.00,
                                             total_earned DECIMAL(10, 2) DEFAULT 0.00,
                                             is_online BOOLEAN DEFAULT FALSE,
                                             auto_pilot_active BOOLEAN DEFAULT FALSE,
                                             updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS operator_profiles (
                                                 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                                 commission_rate DECIMAL(5, 2) DEFAULT 50.00,
                                                 auto_pilot BOOLEAN DEFAULT FALSE,
                                                 updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS operator_security (
                                                 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                                 last_ip VARCHAR(45) DEFAULT 'Unknown',
                                                 mfa_enabled BOOLEAN DEFAULT FALSE,
                                                 mfa_secret VARCHAR(255),
                                                 updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS operator_performance (
                                                    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                                    msgs_sent INT DEFAULT 0,
                                                    active_sessions INT DEFAULT 0,
                                                    rating DECIMAL(3, 2) DEFAULT 0.00,
                                                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Client Specific
CREATE TABLE IF NOT EXISTS client_security (
                                               user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                               last_ip VARCHAR(45) DEFAULT 'Unknown',
                                               device_type VARCHAR(100) DEFAULT 'Unknown',
                                               location VARCHAR(255) DEFAULT 'Unknown',
                                               updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS client_behavior (
                                               user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                               risk_score INT DEFAULT 0,
                                               flags_count INT DEFAULT 0,
                                               last_flagged_at TIMESTAMP,
                                               created_at TIMESTAMP DEFAULT NOW(),
                                               updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS client_billing (
                                              user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                              payment_method VARCHAR(100) DEFAULT 'None',
                                              is_recurring BOOLEAN DEFAULT FALSE,
                                              next_billing_date DATE,
                                              stripe_customer_id VARCHAR(255),
                                              paystack_customer_code VARCHAR(255),
                                              active_gateway VARCHAR(20),
                                              updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 7. BACKGROUND WORKERS & DURABLE QUEUES
-- =====================================================================
CREATE TABLE IF NOT EXISTS action_jobs (
                                           id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                           user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                           action_type VARCHAR(50) NOT NULL,
                                           target_id UUID,
                                           metadata JSONB,
                                           ip_address VARCHAR(45),
                                           status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
                                           attempts INTEGER NOT NULL DEFAULT 0,
                                           next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                           last_error TEXT,
                                           created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                           updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS export_jobs (
                                           id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                           user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                           export_type VARCHAR(50) NOT NULL DEFAULT 'data_dossier',
                                           status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
                                           download_url TEXT,
                                           attempts INTEGER NOT NULL DEFAULT 0,
                                           next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                           last_error TEXT,
                                           created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                           updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_jobs (
                                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                          to_email VARCHAR(255) NOT NULL,
                                          subject VARCHAR(255) NOT NULL,
                                          body_html TEXT NOT NULL,
                                          attachments JSONB NOT NULL DEFAULT '{}'::jsonb,
                                          status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
                                          attempts INTEGER NOT NULL DEFAULT 0,
                                          next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                          last_error TEXT,
                                          sent_at TIMESTAMP WITH TIME ZONE,
                                          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sms_queue (
                                         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                         phone_number VARCHAR(20) NOT NULL,
                                         message TEXT NOT NULL,
                                         status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
                                         attempts INTEGER NOT NULL DEFAULT 0,
                                         error_log TEXT,
                                         created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                         updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 8. ADMIN, NOTIFICATIONS & TEMPLATES
-- =====================================================================
CREATE TABLE IF NOT EXISTS notifications (
                                             id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                             user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                             event_type VARCHAR(50) NOT NULL,
                                             title VARCHAR(255) NOT NULL,
                                             message TEXT NOT NULL,
                                             icon VARCHAR(100),
                                             payload JSONB DEFAULT '{}'::jsonb,
                                             is_read BOOLEAN DEFAULT FALSE,
                                             created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_templates (
                                               id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                               name VARCHAR(100) UNIQUE NOT NULL,
                                               subject VARCHAR(255) NOT NULL,
                                               body_html TEXT NOT NULL,
                                               created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                               updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sms_templates (
                                             id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                             name VARCHAR(100) UNIQUE NOT NULL,
                                             template_content TEXT NOT NULL,
                                             is_active BOOLEAN DEFAULT TRUE,
                                             created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                             updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS banned_ips (
                                          ip_address VARCHAR(45) PRIMARY KEY,
                                          banned_at TIMESTAMP DEFAULT NOW(),
                                          reason TEXT
);

CREATE TABLE IF NOT EXISTS flagged_words (
                                             id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                             word VARCHAR(255) NOT NULL UNIQUE,
                                             category VARCHAR(50) NOT NULL CHECK (category IN ('social', 'profanity')),
                                             created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS firewall_rules (
                                              id VARCHAR(50) PRIMARY KEY,
                                              name VARCHAR(255) NOT NULL,
                                              description TEXT,
                                              is_active BOOLEAN DEFAULT FALSE,
                                              updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_action_logs (
                                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                                                action_type VARCHAR(50) NOT NULL,
                                                target_id UUID,
                                                metadata JSONB,
                                                ip_address VARCHAR(45),
                                                created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
                                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
                                                admin_username VARCHAR(100) DEFAULT 'SYSTEM',
                                                action VARCHAR(50) NOT NULL,
                                                target_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                target_username VARCHAR(100),
                                                reason TEXT,
                                                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_audit_logs (
                                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                action VARCHAR(50) NOT NULL,
                                                target_profile_id UUID REFERENCES managed_profiles(id) ON DELETE CASCADE,
                                                admin_identifier VARCHAR(100) NOT NULL,
                                                filename TEXT,
                                                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 9. INDEXES
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_users_status_active ON users(status, last_active);
CREATE INDEX IF NOT EXISTS idx_user_locations_coords ON user_locations(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_user_media_sort ON user_media(user_id, is_primary DESC, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_profiles_dob ON user_profiles(date_of_birth);
CREATE INDEX IF NOT EXISTS idx_interactions_target ON interactions(target_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_profile_views_viewed ON profile_views(viewed_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_rooms_category ON rooms(category);
CREATE INDEX IF NOT EXISTS idx_room_members_active ON room_members(room_id, last_active DESC);
CREATE INDEX IF NOT EXISTS idx_room_requests_status ON room_join_requests(room_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_direct ON messages(sender_id, recipient_id);
CREATE INDEX IF NOT EXISTS idx_chat_requests_model ON chat_requests(model_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_model ON transactions(model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_behavior_risk_score ON client_behavior(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_operator_profiles_user ON operator_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_action_logs_user_id ON user_action_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_action_logs_action_type ON user_action_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_media_audit_logs_time ON media_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_consent_logs_user ON user_consent_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_action_jobs_ready ON action_jobs(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_action_jobs_user ON action_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_jobs_ready ON export_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_export_jobs_user ON export_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_jobs_ready ON email_jobs(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_queue_ready ON sms_queue(status, created_at) WHERE status IN ('pending', 'failed');

-- =====================================================================
-- 10. TRIGGERS & FUNCTIONS
-- =====================================================================
DROP TRIGGER IF EXISTS trigger_initialize_client_behavior ON users;
DROP TRIGGER IF EXISTS trigger_initialize_new_user_defaults ON users;

CREATE OR REPLACE FUNCTION initialize_new_user_defaults()
    RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO client_behavior (user_id) VALUES (NEW.id);
    INSERT INTO user_settings (user_id) VALUES (NEW.id);

    INSERT INTO user_subscriptions (user_id, tier_id, status)
    VALUES (NEW.id, (SELECT id FROM subscription_tiers WHERE name = 'free' LIMIT 1), 'active');

    INSERT INTO user_daily_usage (user_id, usage_date)
    VALUES (NEW.id, CURRENT_DATE);

    IF NEW.role = 'model' THEN
        INSERT INTO creator_stats (user_id) VALUES (NEW.id);
        INSERT INTO operator_profiles (user_id) VALUES (NEW.id);
        INSERT INTO operator_security (user_id) VALUES (NEW.id);
        INSERT INTO operator_performance (user_id) VALUES (NEW.id);
    ELSIF NEW.role = 'client' THEN
        INSERT INTO client_security (user_id) VALUES (NEW.id);
        INSERT INTO client_billing (user_id) VALUES (NEW.id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_initialize_new_user_defaults
    AFTER INSERT ON users
    FOR EACH ROW
EXECUTE FUNCTION initialize_new_user_defaults();

-- =====================================================================
-- 11. STATIC SEED DATA
-- =====================================================================
INSERT INTO flagged_words (word, category) VALUES
                                               ('snapchat', 'social'), ('ig', 'social'), ('instagram', 'social'),
                                               ('whatsapp', 'social'), ('kik', 'social'), ('telegram', 'social'),
                                               ('fb', 'social'), ('facebook', 'social'), ('onlyfans', 'social'),
                                               ('bannedword1', 'profanity'), ('bannedword2', 'profanity')
ON CONFLICT (word) DO NOTHING;

INSERT INTO firewall_rules (id, name, description, is_active) VALUES
                                                                  ('RUL_1', 'Auto-Ban High Risk Datacenter IPs', 'Instantly ban signups from known AWS/DO/GCP datacenters.', TRUE),
                                                                  ('RUL_2', 'Block Disposable Email Domains', 'Reject signups from 10minutemail, temp-mail, etc.', TRUE),
                                                                  ('RUL_3', 'Chargeback Prevention Lockout', 'Freeze tipping after 2 consecutive card failures.', TRUE),
                                                                  ('RUL_4', 'Auto-Mute on Explicit Filter Hit', 'Mute users for 1 hour automatically if they trigger the banned word list 3 times.', FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO rooms (name, room_code, icon, category, description, tags, is_private)
VALUES
    ('The Main Lounge', 'MAINX1', 'coffee', 'General', 'The official Chattie welcome room. Grab a coffee and say hi!', '["chill", "welcome", "general"]', false),
    ('Late Night Coders', 'CODE99', 'moon', 'Tech', 'For the night owls pushing commits at 3 AM.', '["tech", "coding", "nightowl"]', false),
    ('Gaming Hub', 'GGWP77', 'gamepad', 'Gaming', 'LFG, strats, and general gaming chat.', '["gaming", "pc", "console"]', false)
ON CONFLICT (room_code) DO NOTHING;

INSERT INTO email_templates (name, subject, body_html) VALUES
                                                           ('welcome_email', 'Welcome to Chattie Premium ⚡', '...'),
                                                           ('data_dossier', 'Your Requested Data Dossier is Ready', '...'),
                                                           ('unread_messages', 'You have unread messages! 💬', '...'),
                                                           ('miss_you', 'We miss you on Chattie 🥺', '...'),
                                                           ('premium_welcome', 'Welcome to Chattie VIP! 👑', '...'),
                                                           ('new_like', 'Someone likes you! ❤️', '...'),
                                                           ('report_received', 'We received your report 🛡️', '...'),
                                                           ('account_banned', 'Account Termination Notice 🚫', '...'),
                                                           ('moderation_action', 'Moderation Notice on your Account', '...'),
                                                           ('operator_suspended', 'Operator Account Suspended ⚠️', '...'),
                                                           ('otp_verification_email', 'Your Verification Code', '...')
ON CONFLICT (name) DO NOTHING;

INSERT INTO sms_templates (name, template_content) VALUES
    ('otp_verification_sms', 'Your verification code is: {{.Code}}. It expires in 10 minutes. Do not share this with anyone.')
ON CONFLICT (name) DO NOTHING;