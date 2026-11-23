-- Chattie database bootstrap for a new PostgreSQL database.
-- Do not use this fresh-install script to upgrade a populated production database.
-- Use the ordered scripts in database/migrations for existing databases.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Base table must exist before After Dark and core foreign keys are declared.
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'model', 'admin', 'persona')),
    status VARCHAR(20) NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding', 'active', 'suspended', 'banned', 'flagged', 'ONLINE', 'OFFLINE')),
    reset_token VARCHAR(255),
    reset_token_expires_at TIMESTAMP WITH TIME ZONE,
    provider VARCHAR(30) NOT NULL DEFAULT 'local',
    email_verified_at TIMESTAMP WITH TIME ZONE,
    token_version INTEGER NOT NULL DEFAULT 1,
    last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- These foundational After Dark tables are declared before dependent tables.
CREATE TABLE IF NOT EXISTS ad_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ad_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL,
    status VARCHAR(20) DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'rejected', 'deleted')),
    moderation_status VARCHAR(20) DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'flagged')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ad_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES ad_assets(id) ON DELETE CASCADE,
    caption TEXT,
    access_type VARCHAR(20) DEFAULT 'free' CHECK (access_type IN ('free', 'subscriber', 'ppv')),
    price_cents BIGINT DEFAULT 0,
    is_explicit BOOLEAN DEFAULT TRUE,
    ai_safety_score SMALLINT CHECK (ai_safety_score BETWEEN 0 AND 100),
    ai_safety_reason TEXT,
    ai_safety_scored_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'published', 'scheduled', 'rejected', 'deleted')),
    publish_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_assets_owner ON ad_assets(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_posts_creator ON ad_posts(creator_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_posts_published_feed ON ad_posts(created_at DESC, id DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_ad_posts_ai_safety_queue
    ON ad_posts (ai_safety_scored_at DESC, ai_safety_score DESC)
    WHERE status IN ('draft', 'processing');

CREATE TABLE IF NOT EXISTS ad_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(50) NOT NULL CHECK (target_type IN ('creator', 'post', 'message', 'live_session', 'comment')),
    target_id UUID NOT NULL,
    reason VARCHAR(100) NOT NULL,
    details TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
    reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

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
                                                 provider VARCHAR(50) NOT NULL,
                                                 account_number VARCHAR(255) NOT NULL, -- Must be encrypted in a real production env
                                                 account_name VARCHAR(255),
                                                 bank_code TEXT NOT NULL DEFAULT '',
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
                                                   notification_email JSONB NOT NULL DEFAULT '{"subs":true,"tips":true,"sales":true,"likes":false,"messages":false,"marketing":false}'::jsonb,
                                                   notification_push JSONB NOT NULL DEFAULT '{"subs":true,"tips":true,"messages":true,"mentions":true}'::jsonb,
                                                   default_ppv_cents BIGINT NOT NULL DEFAULT 0,
                                                   auto_withdraw BOOLEAN NOT NULL DEFAULT FALSE,
                                                   withdraw_threshold_cents BIGINT NOT NULL DEFAULT 0,
                                                   updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


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

-- Tracks one-time purchases scoped exactly to one specific session.
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

CREATE TABLE IF NOT EXISTS ad_payment_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payment_type VARCHAR(30) NOT NULL CHECK (payment_type IN ('deposit', 'subscription', 'ppv', 'tip', 'live_tip', 'live_pass')),
    target_id TEXT,
    creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    settlement_amount_cents BIGINT NOT NULL CHECK (settlement_amount_cents > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'KES',
    settlement_currency VARCHAR(3) NOT NULL DEFAULT 'KES' CHECK (settlement_currency = 'KES'),
    wallet_amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (wallet_amount_cents >= 0),
    exchange_rate NUMERIC(18, 8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('paystack', 'mpesa', 'stripe', 'wallet')),
    provider_session_id TEXT,
    merchant_request_id TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    message TEXT NOT NULL DEFAULT '',
    receipt_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ad_payment_provider_session_idx
    ON ad_payment_intents (provider, provider_session_id)
    WHERE provider_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ad_payment_user_status_idx
    ON ad_payment_intents (user_id, status, created_at DESC);

-- Tracks creator withdrawal requests and reserved funds
CREATE TABLE IF NOT EXISTS ad_withdrawals (
                                              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                              user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                              amount_cents BIGINT NOT NULL,
                                              payout_amount_cents BIGINT NOT NULL,
                                              fee_cents BIGINT NOT NULL DEFAULT 0,
                                              payout_method_id VARCHAR(255) NOT NULL,
                                              status VARCHAR(24) DEFAULT 'requested' CHECK (status IN ('requested', 'submitting', 'submission_unknown', 'processing', 'paid', 'failed', 'reversed')),
                                              failure_reason TEXT,
                                              provider VARCHAR(30) NOT NULL DEFAULT '',
                                              provider_reference TEXT NOT NULL DEFAULT '',
                                              provider_conversation_id TEXT NOT NULL DEFAULT '',
                                              created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                              updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                              CHECK (amount_cents > 0),
                                              CHECK (payout_amount_cents > 0),
                                              CHECK (fee_cents >= 0),
                                              CHECK (payout_amount_cents <= amount_cents AND fee_cents = amount_cents - payout_amount_cents)
);

CREATE INDEX IF NOT EXISTS idx_ad_withdrawals_user ON ad_withdrawals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_withdrawals_provider_reference
    ON ad_withdrawals(provider, provider_reference) WHERE provider_reference <> '';
CREATE INDEX IF NOT EXISTS idx_ad_withdrawals_user_unresolved
    ON ad_withdrawals(user_id, created_at DESC)
    WHERE status IN ('requested', 'submitting', 'submission_unknown', 'processing');

CREATE TABLE IF NOT EXISTS ad_earnings_clearances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    source VARCHAR(30) NOT NULL DEFAULT 'legacy',
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    reason TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ad_earnings_clearances_user
    ON ad_earnings_clearances(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ad_pending_earnings (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source VARCHAR(30) NOT NULL
        CHECK (source IN ('ppv', 'tips', 'subscriptions', 'live_pass', 'chat', 'legacy')),
    balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, source)
);
CREATE INDEX IF NOT EXISTS idx_ad_pending_earnings_source
    ON ad_pending_earnings (source, balance_cents DESC)
    WHERE balance_cents > 0;




-- =====================================================================
-- 16. AFTER DARK (AD) PRIVATE CHATS
-- =====================================================================

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
                                           message_kind VARCHAR(30) NOT NULL DEFAULT 'chat',
                                           call_mode VARCHAR(10),
                                           reply_to_message_id UUID REFERENCES ad_messages(id) ON DELETE SET NULL,
                                           is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
                                           pinned_by UUID REFERENCES users(id) ON DELETE SET NULL,
                                           pinned_at TIMESTAMP WITH TIME ZONE,
                                           created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_conv_participants ON ad_conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_messages_conv ON ad_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_messages_unread_conversation_sender
    ON ad_messages (conversation_id, sender_id)
    WHERE is_read = FALSE;
CREATE TABLE IF NOT EXISTS ad_message_reactions (
    message_id UUID NOT NULL REFERENCES ad_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(16) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id, emoji)
);







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
CREATE INDEX IF NOT EXISTS idx_ad_post_likes_post ON ad_post_likes(post_id);

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
                                                 transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('deposit', 'withdrawal', 'withdrawal_reversal', 'ppv_purchase', 'ppv_earning', 'subscription_purchase', 'subscription_earning', 'tip_sent', 'tip_received', 'chat_unlock_purchase', 'chat_unlock_earning', 'wallet_reserve', 'wallet_release')),
                                                 reference_id VARCHAR(255), -- e.g., Provider Payment ID or Post ID
                                                 description TEXT,
                                                 created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exchange_rates (
    base_currency CHAR(3) NOT NULL,
    quote_currency CHAR(3) NOT NULL,
    rate NUMERIC(18, 8) NOT NULL CHECK (rate > 0),
    provider VARCHAR(100) NOT NULL,
    provider_updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (base_currency, quote_currency)
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

-- A single wallet purchase grants ongoing DM access to a creator's chat.
CREATE TABLE IF NOT EXISTS ad_chat_entitlements (
                                                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                    payment_ref VARCHAR(255) NOT NULL,
                                                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                    PRIMARY KEY (user_id, creator_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_ledger_user ON ad_ledger_entries(user_id, created_at DESC);





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
                                                  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'suspended', 'deactivated')),
                                                  dm_control VARCHAR(20) DEFAULT 'all' CHECK (dm_control IN ('all', 'subscribers', 'none')),
                                                  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- KYC & Onboarding Applications Tracker
CREATE TABLE IF NOT EXISTS performer_applications (
                                                      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                      creator_alias VARCHAR(100) NOT NULL DEFAULT '',
                                                      status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
                                                      verification_ref VARCHAR(255),
                                                      payout_method_id VARCHAR(255),
                                                      policy_version VARCHAR(50),
                                                      decision_reason_code VARCHAR(255),
                                                      submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                      reviewed_at TIMESTAMP WITH TIME ZONE,
                                                      reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
                                                      ai_triage_summary TEXT NOT NULL DEFAULT '',
                                                      ai_triaged_at TIMESTAMPTZ,
                                                      ai_triage_claimed_at TIMESTAMPTZ
);
ALTER TABLE performer_applications
    ADD COLUMN IF NOT EXISTS creator_alias VARCHAR(100) NOT NULL DEFAULT '';

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


-- =====================================================================
-- CHATTIE DATABASE INITIALIZATION SCRIPT (V2)
-- =====================================================================

-- =====================================================================
-- 1. CORE AUTH & USERS (users is created before After Dark above)
-- =====================================================================
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
                                             phone_verified_at TIMESTAMP WITH TIME ZONE,
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
                                              country_code CHAR(2),
                                              last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_locations_country_code
    ON user_locations(country_code);

CREATE TABLE IF NOT EXISTS regional_country_blocks (
    country_code CHAR(2) PRIMARY KEY,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
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
                                             language VARCHAR(10) NULL CHECK (language IN ('en', 'es', 'fr', 'de', 'pt', 'ja', 'sw', 'hi', 'zh-CN')),
                                             global_mode BOOLEAN DEFAULT FALSE,
                                             show_me VARCHAR(20) DEFAULT 'Everyone',
                                             notif_new_matches BOOLEAN DEFAULT TRUE,
                                             notif_messages BOOLEAN DEFAULT TRUE,
                                             notif_super_likes BOOLEAN DEFAULT TRUE,
                                             notif_promotions BOOLEAN DEFAULT FALSE,
                                             privacy_incognito BOOLEAN DEFAULT FALSE,
                                             privacy_read_receipts BOOLEAN DEFAULT TRUE,
                                             two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                                             two_factor_channel VARCHAR(10) NOT NULL DEFAULT 'email' CHECK (two_factor_channel IN ('email', 'sms')),
                                             conn_spotify BOOLEAN DEFAULT FALSE,
                                             conn_instagram BOOLEAN DEFAULT FALSE,
                                             guidelines_agreed BOOLEAN DEFAULT FALSE,
                                             updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

UPDATE user_preferences
SET interested_in = 'All'
WHERE LOWER(BTRIM(interested_in)) IN ('men', 'women', 'everyone', 'other', 'male', 'female', 'man', 'woman', 'nonbinary', 'non-binary');

UPDATE user_profiles
SET gender = 'other'
WHERE LOWER(BTRIM(gender)) = 'everyone';

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

CREATE TABLE IF NOT EXISTS billing_payment_intents (
    reference UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('stripe', 'paystack', 'mpesa')),
    provider_session_id TEXT,
    merchant_request_id TEXT,
    months INT NOT NULL CHECK (months > 0),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency VARCHAR(3) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
    receipt_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_provider_session_idx
    ON billing_payment_intents (provider, provider_session_id)
    WHERE provider_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_payment_user_status_idx
    ON billing_payment_intents (user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_saved_payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('stripe', 'paystack')),
    provider_method_id TEXT NOT NULL,
    provider_customer_id TEXT,
    authorization_ciphertext BYTEA,
    card_brand VARCHAR(40) NOT NULL DEFAULT '',
    last4 CHAR(4) NOT NULL,
    exp_month SMALLINT NOT NULL DEFAULT 0,
    exp_year SMALLINT NOT NULL DEFAULT 0,
    bank_name VARCHAR(120) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, provider, provider_method_id),
    CHECK (
        (provider = 'stripe' AND provider_customer_id IS NOT NULL AND authorization_ciphertext IS NULL)
        OR
        (provider = 'paystack' AND authorization_ciphertext IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS billing_saved_payment_methods_user_idx
    ON billing_saved_payment_methods (user_id, created_at DESC);

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
                                       created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                       ai_triage_summary TEXT NOT NULL DEFAULT '',
                                       ai_triaged_at TIMESTAMPTZ,
                                       ai_triage_claimed_at TIMESTAMPTZ
);

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
                                     is_voice_room BOOLEAN NOT NULL DEFAULT FALSE,
                                     rules TEXT NOT NULL DEFAULT '',
                                     content_mode VARCHAR(20) NOT NULL DEFAULT 'general' CHECK (content_mode IN ('general', 'mature')),
                                     allow_media BOOLEAN NOT NULL DEFAULT TRUE,
                                     allow_links BOOLEAN NOT NULL DEFAULT TRUE,
                                     slow_mode_seconds INT NOT NULL DEFAULT 0 CHECK (slow_mode_seconds BETWEEN 0 AND 300),
                                     is_read_only BOOLEAN NOT NULL DEFAULT FALSE,
                                     status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WARNING', 'SUSPENDED')),
                                     warning_level INT DEFAULT 0,
                                     created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                                     active_count INT DEFAULT 0,
                                     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                     updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS room_members (
                                            room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
                                            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                            role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('creator', 'admin', 'moderator', 'speaker', 'member', 'host')),
                                            is_muted BOOLEAN NOT NULL DEFAULT FALSE,
                                            joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                            last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                            last_message_at TIMESTAMP WITH TIME ZONE,
                                            PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_voice_sessions (
    room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    started_by UUID REFERENCES users(id) ON DELETE SET NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS room_bans (
                                         room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                                         user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                         banned_by UUID REFERENCES users(id) ON DELETE SET NULL,
                                         banned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
                                        is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
                                        pinned_by UUID REFERENCES users(id) ON DELETE SET NULL,
                                        pinned_at TIMESTAMP WITH TIME ZONE,
                                        message_kind VARCHAR(30) NOT NULL DEFAULT 'chat',
                                        call_mode VARCHAR(10),
                                        status VARCHAR(20) DEFAULT 'sent',
                                        client_message_id VARCHAR(128),
                                        is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
                                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_client_message
    ON messages(sender_id, client_message_id)
    WHERE client_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS room_message_reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(16) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id, room_id);
CREATE INDEX IF NOT EXISTS idx_room_bans_user ON room_bans(user_id, room_id);
CREATE INDEX IF NOT EXISTS idx_room_join_requests_pending ON room_join_requests(room_id, created_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_room_message_reactions_message ON room_message_reactions(message_id, emoji);

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
    ai_triaged_at TIMESTAMPTZ,
    ai_triage_claimed_at TIMESTAMPTZ,
    human_requested BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_updated
    ON support_tickets(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_queue
    ON support_tickets(status, priority, updated_at DESC)
    WHERE status <> 'resolved';

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

-- =====================================================================
-- 6. CREATOR, OPERATOR, & CLIENT LOGIC
-- =====================================================================
CREATE TABLE IF NOT EXISTS managed_profiles (
                                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                manager_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                name VARCHAR(100) NOT NULL,
                                                avatar_url TEXT,
                                                bio TEXT NOT NULL DEFAULT '',
                                                status VARCHAR(20) DEFAULT 'offline',
                                                archetype VARCHAR(100) DEFAULT 'General',
                                                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
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
                                            message_id UUID REFERENCES messages(id) ON DELETE RESTRICT,
                                            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_message_id
    ON transactions(message_id)
    WHERE message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS creator_payout_methods (
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_network VARCHAR(32) NOT NULL CHECK (asset_network IN ('USDT-TRC20', 'USDT-ERC20')),
    wallet_address VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (creator_id, asset_network)
);

CREATE TABLE IF NOT EXISTS creator_payout_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key UUID NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents >= 5000),
    asset_network VARCHAR(32) NOT NULL CHECK (asset_network IN ('USDT-TRC20', 'USDT-ERC20')),
    wallet_address VARCHAR(255) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'PAID')),
    crypto_amount NUMERIC(30, 12) CHECK (crypto_amount IS NULL OR crypto_amount > 0),
    transaction_hash VARCHAR(128),
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP WITH TIME ZONE,
    CHECK (status <> 'PAID' OR (crypto_amount IS NOT NULL AND transaction_hash IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_payout_requests_idempotency
    ON creator_payout_requests(creator_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_payout_requests_transaction_hash
    ON creator_payout_requests(asset_network, LOWER(transaction_hash))
    WHERE transaction_hash IS NOT NULL;

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS payout_request_id UUID
    REFERENCES creator_payout_requests(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_creator_payout_request
    ON transactions(payout_request_id)
    WHERE payout_request_id IS NOT NULL AND tx_type = 'CRYPTO_PAYOUT';
CREATE INDEX IF NOT EXISTS idx_creator_payout_requests_status_created
    ON creator_payout_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_payout_requests_creator_created
    ON creator_payout_requests(creator_id, created_at DESC);

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
                                                 ai_drafts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE INDEX IF NOT EXISTS idx_action_jobs_pending_claim
    ON action_jobs (next_attempt_at, created_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_action_jobs_stale_claim
    ON action_jobs (updated_at, next_attempt_at, created_at)
    WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_export_jobs_pending_claim
    ON export_jobs (next_attempt_at, created_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_export_jobs_stale_claim
    ON export_jobs (updated_at, next_attempt_at, created_at)
    WHERE status = 'processing';

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

CREATE INDEX IF NOT EXISTS idx_email_jobs_pending_claim
    ON email_jobs (next_attempt_at, created_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_email_jobs_stale_claim
    ON email_jobs (updated_at, next_attempt_at, created_at)
    WHERE status = 'processing';

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
                                             action_url VARCHAR(512),
                                             action_label VARCHAR(100),
                                             category VARCHAR(50),
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

CREATE TABLE IF NOT EXISTS auth_verification_codes (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('login_2fa', 'enable_2fa', 'disable_2fa', 'password_reset')),
    channel VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'sms')),
    code_hash VARCHAR(100) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS auth_verification_codes_user_purpose_idx
    ON auth_verification_codes (user_id, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_version INTEGER NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_active_idx
    ON auth_sessions (user_id, last_seen_at DESC)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_idx
    ON web_push_subscriptions (user_id);

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

CREATE TABLE IF NOT EXISTS user_filter_hits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS user_filter_hits_user_time_idx
    ON user_filter_hits (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_chat_mutes (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    muted_until TIMESTAMP WITH TIME ZONE NOT NULL,
    reason TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE IF NOT EXISTS plaid_identity_verification_attempts (
    attempt_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    identity_verification_id VARCHAR(128) UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'creating'
        CHECK (status IN ('creating', 'active', 'pending_review', 'success', 'failed', 'expired', 'canceled')),
    consented_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plaid_idv_attempts_user_created
    ON plaid_identity_verification_attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plaid_idv_attempts_creating
    ON plaid_identity_verification_attempts (user_id, created_at DESC)
    WHERE status = 'creating';

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

CREATE TABLE IF NOT EXISTS ad_afterdark_moderation_settings (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    auto_approve_new_posts BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO ad_afterdark_moderation_settings (id, auto_approve_new_posts)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

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
CREATE INDEX IF NOT EXISTS idx_users_unverified_onboarding
    ON users (created_at)
    WHERE provider = 'local'
      AND status = 'onboarding'
      AND email_verified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_locations_coords ON user_locations(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_user_media_sort ON user_media(user_id, is_primary DESC, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_profiles_dob ON user_profiles(date_of_birth);
CREATE INDEX IF NOT EXISTS idx_interactions_target ON interactions(target_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_interactions_target_actor_action ON interactions(target_id, actor_id, action_type);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked_blocker ON blocks(blocked_id, blocker_id);
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
CREATE INDEX IF NOT EXISTS notifications_user_unread_created_idx
    ON notifications (user_id, is_read, created_at DESC);
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
                                                                  ('RUL_1', 'Block banned IP addresses', 'Reject requests from IP addresses recorded in the administrator-managed ban list. Trusted proxy CIDRs are required before forwarding headers are used.', TRUE),
                                                                  ('RUL_2', 'Block known disposable email domains', 'Reject new registrations using a curated list of disposable email domains, including social sign-ups.', TRUE),
                                                                  ('RUL_3', 'Lock tipping after repeated card failures', 'Temporarily prevent tipping when the two most recent Paystack or Stripe payment attempts both failed.', TRUE),
                                                                  ('RUL_4', 'Auto-mute repeated profanity filter hits', 'Automatically mute an account for one hour after three profanity-filter matches within one hour.', FALSE)
ON CONFLICT (id) DO NOTHING;


INSERT INTO email_templates (name, subject, body_html) VALUES
    ('welcome_email', 'Welcome to Chattie', '<h1>Welcome, {{.Username}}</h1><p>Your Chattie account is ready. Sign in to meet people and start conversations.</p>'),
    ('new_match', 'It is a match!', '<h1>You have a new match</h1><p>Hello {{.Username}}, {{.Message}}</p><p><a href="{{.ActionURL}}">Open Chattie</a></p>'),
    ('new_message', 'You have a new Chattie message', '<h1>New message</h1><p>Hello {{.Username}}, {{.Message}}</p><p><a href="{{.ActionURL}}">View message</a></p>'),
    ('data_dossier', 'Your Chattie data archive is ready', '<h1>Your Chattie archive is ready</h1><p>Hello {{.Username}}, your requested Chattie data archive is attached to this email.</p><p>If you did not request this, secure your account and contact support.</p>'),
    ('after_dark_data_archive', 'Your After Dark data archive is ready', '<h1>Your After Dark archive is ready</h1><p>Hello {{.Username}}, your requested After Dark data archive is attached. It contains information from your After Dark account only.</p><p>If you did not request this, secure your account and contact support.</p>'),
    ('unread_messages', 'You have unread messages', '<h1>Hello {{.Username}}</h1><p>You have unread messages waiting for you on Chattie.</p>'),
    ('miss_you', 'We miss you on Chattie', '<h1>We miss you, {{.Username}}</h1><p>Come back to Chattie when you are ready to connect again.</p>'),
    ('premium_welcome', 'Welcome to Chattie Premium', '<h1>Premium is active</h1><p>Hello {{.Username}}, your Premium upgrade was successful.</p><p>Plan duration: {{.Months}} month(s)</p>'),
    ('premium_payment_receipt', 'Chattie Premium payment receipt', '<h1>Payment received</h1><p>Hello {{.Username}}, your Premium payment was successful.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Plan: {{.Months}} month(s)<br>Reference: {{.Reference}}<br>Payment date: {{.PaidAt}}</p>'),
    ('premium_action_required', 'Action needed for your Chattie Premium payment', '<h1>Payment needs attention</h1><p>Hello {{.Username}}, your Premium payment could not be completed.</p><p>{{.ActionMessage}}</p><p>Reference: {{.Reference}}</p>'),
    ('new_like', 'Someone noticed you on Chattie', '<h1>New profile interaction</h1><p>Hello {{.Username}}, someone interacted with your profile.</p><p><a href="{{.ActionURL}}">View profile</a></p>'),
    ('report_received', 'We received your report', '<h1>Thank you, {{.Username}}</h1><p>Your report has been received and will be reviewed by our safety team.</p>'),
    ('account_banned', 'Account action notice', '<h1>Account notice</h1><p>Hello {{.Username}}, an account action was taken. Sign in to Chattie or contact support if you believe this is a mistake.</p>'),
    ('moderation_action', 'Moderation notice on your account', '<h1>Account notice</h1><p>Hello {{.Username}}, a moderation action was taken.</p><p>Reason: {{.Reason}}</p>'),
    ('operator_suspended', 'Operator account suspended', '<h1>Operator account notice</h1><p>Hello {{.Username}}, your operator account has been suspended.</p>'),
    ('otp_verification_email', 'Your Chattie verification code', '<h1>Your verification code</h1><p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{.Code}}</p><p>This code expires in {{.ExpiresMinutes}} minutes. Do not share it with anyone.</p>'),
    ('login_2fa_email', 'Your Chattie sign-in code', '<h1>Confirm your sign-in</h1><p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{.Code}}</p><p>This code expires in {{.ExpiresMinutes}} minutes. If you did not try to sign in, change your password.</p>'),
    ('password_reset_email', 'Reset your Chattie password', '<h1>Password reset code</h1><p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{.Code}}</p><p>This code expires in {{.ExpiresMinutes}} minutes. If you did not request a reset, ignore this message.</p>'),
    ('two_factor_setup_email', 'Confirm your Chattie security change', '<h1>Confirm your security change</h1><p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{.Code}}</p><p>This code expires in {{.ExpiresMinutes}} minutes. If you did not request this change, secure your account.</p>'),
    ('ad_creator_subscription', 'New After Dark subscriber', '<h1>New subscriber</h1><p>Hello {{.Username}}, {{.CustomerName}} subscribed to your creator account.</p>'),
    ('ad_creator_sale', 'New After Dark purchase', '<h1>New purchase</h1><p>Hello {{.Username}}, you received a new After Dark purchase.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Payment method: {{.PaymentMethod}}<br>Wallet contribution: KES {{.WalletContribution}}<br>Reference: {{.Reference}}</p>'),
    ('ad_creator_tip', 'You received an After Dark tip', '<h1>New tip</h1><p>Hello {{.Username}}, {{.CustomerName}} sent you a tip.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Reference: {{.Reference}}</p>'),
    ('ad_payment_receipt', 'After Dark payment receipt', '<h1>Payment received</h1><p>Hello {{.Username}}, your After Dark payment was successful.</p><p>Amount: {{.Currency}} {{.Amount}}<br>Payment method: {{.PaymentMethod}}<br>Wallet contribution: KES {{.WalletContribution}}<br>Item: {{.PaymentType}}<br>Reference: {{.Reference}}<br>Receipt: {{.ReceiptNumber}}<br>Payment date: {{.PaidAt}}</p>'),
    ('ad_action_required', 'Action needed for your After Dark payment', '<h1>Payment needs attention</h1><p>Hello {{.Username}}, your After Dark payment could not be completed.</p><p>{{.ActionMessage}}</p><p>Reference: {{.Reference}}</p>'),
    ('afterdark_notification', 'After Dark account notification', '<h1>{{.Title}}</h1><p>Hello {{.Username}}, {{.Message}}</p>'),
    ('support_ticket_update', 'Update to your Chattie support ticket', '<h1>Support ticket update</h1><p>Your ticket "{{.TicketSubject}}" is now {{.TicketStatus}}.</p><p><a href="{{.ActionURL}}">{{.ActionLabel}}</a></p>')
ON CONFLICT (name) DO UPDATE SET subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, updated_at = CURRENT_TIMESTAMP;

INSERT INTO sms_templates (name, template_content) VALUES
    ('otp_verification_sms', 'Your Chattie verification code is {{.Code}}. It expires in {{.ExpiresMinutes}} minutes. Do not share it.'),
    ('login_2fa_sms', 'Your Chattie sign-in code is {{.Code}}. It expires in {{.ExpiresMinutes}} minutes. Do not share it.'),
    ('password_reset_sms', 'Your Chattie password reset code is {{.Code}}. It expires in {{.ExpiresMinutes}} minutes. Do not share it.'),
    ('two_factor_setup_sms', 'Your Chattie security confirmation code is {{.Code}}. It expires in {{.ExpiresMinutes}} minutes. Do not share it.')
ON CONFLICT (name) DO UPDATE SET template_content = EXCLUDED.template_content, is_active = TRUE, updated_at = CURRENT_TIMESTAMP;

-- Development-only sample data includes synthetic consent and verification values.
-- The referenced accounts must already exist; do not enable these records in production.
DO $$
BEGIN
    IF (
        SELECT COUNT(*)
        FROM users
        WHERE id IN (
            '744447e0-c401-4348-b02a-785cb5b501a0',
            '202c1da3-3e77-4047-9914-164c1e31ff4a',
            '6a65db62-abb2-4506-af3b-20291db99272'
        )
    ) < 3 THEN
        RAISE NOTICE 'Skipping After Dark sample data: one or more sample users do not exist.';
    ELSE
        INSERT INTO ad_viewer_profiles (user_id, alias, explicit_consent_at, age_verified_at) VALUES
            ('744447e0-c401-4348-b02a-785cb5b501a0', 'User-MelisaAD', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('202c1da3-3e77-4047-9914-164c1e31ff4a', 'User-Jyu', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('6a65db62-abb2-4506-af3b-20291db99272', 'User-Havar', NULL, NULL)
        ON CONFLICT (user_id) DO NOTHING;

        INSERT INTO performer_applications (id, user_id, status, verification_ref, payout_method_id, policy_version)
        VALUES ('aaaa1111-1111-1111-1111-111111111111', '744447e0-c401-4348-b02a-785cb5b501a0', 'approved', 'KYC-REF-9921', 'MPESA-001', 'v1.0')
        ON CONFLICT DO NOTHING;

        INSERT INTO performer_consents (user_id, consent_type, policy_version)
        SELECT '744447e0-c401-4348-b02a-785cb5b501a0', 'explicit_content_creation', 'v1.0'
        WHERE NOT EXISTS (
            SELECT 1 FROM performer_consents
            WHERE user_id = '744447e0-c401-4348-b02a-785cb5b501a0'
              AND consent_type = 'explicit_content_creation'
              AND policy_version = 'v1.0'
        );

        INSERT INTO performer_profiles (user_id, display_name, username, bio, website, location, status, dm_control)
        VALUES ('744447e0-c401-4348-b02a-785cb5b501a0', 'Melisa Nights', 'melisanights', 'Exclusive content and behind the scenes.', 'https://linktr.ee/melisa', 'Nairobi, KE', 'active', 'subscribers')
        ON CONFLICT (user_id) DO NOTHING;

        INSERT INTO ad_wallets (user_id, available_balance_cents, pending_balance_cents) VALUES
            ('744447e0-c401-4348-b02a-785cb5b501a0', 40000, 0),
            ('202c1da3-3e77-4047-9914-164c1e31ff4a', 50000, 0),
            ('6a65db62-abb2-4506-af3b-20291db99272', 100000, 0)
        ON CONFLICT (user_id) DO NOTHING;

        INSERT INTO ad_ledger_entries (id, user_id, amount_cents, transaction_type, reference_id, description)
        SELECT seed.id, seed.user_id, seed.amount_cents, seed.transaction_type, seed.reference_id, seed.description
        FROM (VALUES
            ('eeee1111-1111-1111-1111-111111111111'::uuid, '202c1da3-3e77-4047-9914-164c1e31ff4a'::uuid, 100000::bigint, 'deposit', 'MPESA-TXN-001', 'M-Pesa Deposit'),
            ('eeee2222-2222-2222-2222-222222222222'::uuid, '6a65db62-abb2-4506-af3b-20291db99272'::uuid, 100000::bigint, 'deposit', 'MPESA-TXN-002', 'M-Pesa Deposit'),
            ('eeee3333-3333-3333-3333-333333333333'::uuid, '202c1da3-3e77-4047-9914-164c1e31ff4a'::uuid, -50000::bigint, 'ppv_purchase', 'cccc2222-2222-2222-2222-222222222222', 'Unlocked PPV Post'),
            ('eeee4444-4444-4444-4444-444444444444'::uuid, '744447e0-c401-4348-b02a-785cb5b501a0'::uuid, 40000::bigint, 'ppv_earning', 'cccc2222-2222-2222-2222-222222222222', 'Earning from PPV Post')
        ) AS seed(id, user_id, amount_cents, transaction_type, reference_id, description)
        WHERE NOT EXISTS (
            SELECT 1 FROM ad_ledger_entries existing
            WHERE existing.user_id = seed.user_id
              AND existing.transaction_type = seed.transaction_type
              AND existing.reference_id = seed.reference_id
        );

        INSERT INTO ad_post_entitlements (user_id, post_id, payment_ref)
        VALUES ('202c1da3-3e77-4047-9914-164c1e31ff4a', 'cccc2222-2222-2222-2222-222222222222', 'LEDGER-REF-AUTO')
        ON CONFLICT DO NOTHING;

        INSERT INTO ad_subscriptions (subscriber_id, creator_id, status, current_period_end)
        VALUES ('6a65db62-abb2-4506-af3b-20291db99272', '744447e0-c401-4348-b02a-785cb5b501a0', 'active', CURRENT_TIMESTAMP + INTERVAL '30 days')
        ON CONFLICT (subscriber_id, creator_id) DO NOTHING;

        INSERT INTO ad_post_likes (user_id, post_id) VALUES
            ('202c1da3-3e77-4047-9914-164c1e31ff4a', 'cccc1111-1111-1111-1111-111111111111'),
            ('6a65db62-abb2-4506-af3b-20291db99272', 'cccc1111-1111-1111-1111-111111111111')
        ON CONFLICT DO NOTHING;

        INSERT INTO ad_post_comments (id, user_id, post_id, content)
        SELECT 'ffff1111-1111-1111-1111-111111111111', '202c1da3-3e77-4047-9914-164c1e31ff4a', 'cccc2222-2222-2222-2222-222222222222', 'Worth every penny! 🔥'
        WHERE NOT EXISTS (
            SELECT 1 FROM ad_post_comments
            WHERE user_id = '202c1da3-3e77-4047-9914-164c1e31ff4a'
              AND post_id = 'cccc2222-2222-2222-2222-222222222222'
              AND content = 'Worth every penny! 🔥'
        )
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO ad_conversations (id) VALUES ('dddd1111-1111-1111-1111-111111111111')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO ad_conversation_participants (conversation_id, user_id) VALUES
            ('dddd1111-1111-1111-1111-111111111111', '744447e0-c401-4348-b02a-785cb5b501a0'),
            ('dddd1111-1111-1111-1111-111111111111', '6a65db62-abb2-4506-af3b-20291db99272')
        ON CONFLICT DO NOTHING;

        INSERT INTO ad_messages (id, conversation_id, sender_id, content, is_read)
        SELECT 'dddd2222-2222-2222-2222-222222222222', 'dddd1111-1111-1111-1111-111111111111', '6a65db62-abb2-4506-af3b-20291db99272', 'Hey! Just subscribed, love your content.', TRUE
        WHERE NOT EXISTS (
            SELECT 1 FROM ad_messages
            WHERE conversation_id = 'dddd1111-1111-1111-1111-111111111111'
              AND sender_id = '6a65db62-abb2-4506-af3b-20291db99272'
              AND content = 'Hey! Just subscribed, love your content.'
        )
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO ad_messages (id, conversation_id, sender_id, content, is_read)
        SELECT 'dddd3333-3333-3333-3333-333333333333', 'dddd1111-1111-1111-1111-111111111111', '744447e0-c401-4348-b02a-785cb5b501a0', 'Thank you! Let me know if you want custom requests.', FALSE
        WHERE NOT EXISTS (
            SELECT 1 FROM ad_messages
            WHERE conversation_id = 'dddd1111-1111-1111-1111-111111111111'
              AND sender_id = '744447e0-c401-4348-b02a-785cb5b501a0'
              AND content = 'Thank you! Let me know if you want custom requests.'
        )
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO ad_deposit_intents (id, user_id, amount_cents, provider, status)
        SELECT 'aaaa2222-2222-2222-2222-222222222222', '6a65db62-abb2-4506-af3b-20291db99272', 200000, 'mpesa', 'pending'
        WHERE NOT EXISTS (
            SELECT 1 FROM ad_deposit_intents
            WHERE user_id = '6a65db62-abb2-4506-af3b-20291db99272'
              AND amount_cents = 200000
              AND provider = 'mpesa'
              AND status = 'pending'
        )
        ON CONFLICT (id) DO NOTHING;

        WITH new_withdrawal AS (
            INSERT INTO ad_withdrawals (
                id, user_id, amount_cents, payout_amount_cents, fee_cents,
                payout_method_id, status, provider
            )
            SELECT 'aaaa3333-3333-3333-3333-333333333333',
                   '744447e0-c401-4348-b02a-785cb5b501a0', 30000, 30000, 0,
                   'MPESA-001', 'processing', 'mpesa'
            WHERE NOT EXISTS (
                SELECT 1 FROM ad_withdrawals
                WHERE user_id = '744447e0-c401-4348-b02a-785cb5b501a0'
                  AND amount_cents = 30000
                  AND payout_method_id = 'MPESA-001'
                  AND status = 'processing'
            )
            ON CONFLICT (id) DO NOTHING
            RETURNING user_id
        )
        UPDATE ad_wallets
        SET available_balance_cents = 10000, pending_balance_cents = 30000
        WHERE user_id = '744447e0-c401-4348-b02a-785cb5b501a0'
          AND available_balance_cents = 40000
          AND pending_balance_cents = 0
          AND EXISTS (SELECT 1 FROM new_withdrawal);
    END IF;
END;
$$;

COMMIT;