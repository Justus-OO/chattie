ALTER TABLE room_members ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'member';
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS is_muted BOOLEAN DEFAULT FALSE;





-- =====================================================================
-- ADMIN T&S MODERATION SCHEMA
-- =====================================================================

-- 1. Generic Admin Audit Logs (Extends your existing media_audit_logs concept)
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

-- 2. Firewall Rules (For Automod)
CREATE TABLE IF NOT EXISTS firewall_rules (
                                              id VARCHAR(50) PRIMARY KEY,
                                              name VARCHAR(255) NOT NULL,
                                              description TEXT,
                                              is_active BOOLEAN DEFAULT FALSE,
                                              updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert the default rules expected by the frontend
INSERT INTO firewall_rules (id, name, description, is_active) VALUES
                                                                  ('RUL_1', 'Auto-Ban High Risk Datacenter IPs', 'Instantly ban signups from known AWS/DO/GCP datacenters.', TRUE),
                                                                  ('RUL_2', 'Block Disposable Email Domains', 'Reject signups from 10minutemail, temp-mail, etc.', TRUE),
                                                                  ('RUL_3', 'Chargeback Prevention Lockout', 'Freeze tipping after 2 consecutive card failures.', TRUE),
                                                                  ('RUL_4', 'Auto-Mute on Explicit Filter Hit', 'Mute users for 1 hour automatically if they trigger the banned word list 3 times.', FALSE)
ON CONFLICT (id) DO NOTHING;









-- =====================================================================
-- ADMIN ROOM MANAGER UPGRADES
-- =====================================================================

-- 1. Add status and warning tracking to rooms if missing
ALTER TABLE rooms
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WARNING', 'SUSPENDED')),
    ADD COLUMN IF NOT EXISTS warning_level INT DEFAULT 0;

-- 2. Ensure room_members tracks active participant states and mute toggles
CREATE TABLE IF NOT EXISTS room_members (
                                            room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
                                            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                            role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('creator', 'admin', 'speaker', 'member', 'host')),
                                            is_muted BOOLEAN DEFAULT FALSE,
                                            joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                            last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                            PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_members_active ON room_members(room_id, last_active DESC);







ALTER TABLE managed_profiles
    ADD COLUMN IF NOT EXISTS archetype VARCHAR(100) DEFAULT 'General';


-- =====================================================================
-- ADMIN MEDIA VAULTS & AUDIT LOGS UPGRADE
-- =====================================================================

-- 1. Add security / watermark settings to user_media if missing
ALTER TABLE user_media
    ADD COLUMN IF NOT EXISTS size_bytes BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100) DEFAULT 'image/jpeg',
    ADD COLUMN IF NOT EXISTS watermarked BOOLEAN DEFAULT TRUE;

-- 2. Create Media Audit Logs Table
CREATE TABLE IF NOT EXISTS media_audit_logs (
                                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                action VARCHAR(50) NOT NULL, -- 'INJECT_MEDIA', 'SET_PRIMARY', 'DELETE_MEDIA', 'VAULT_LOCKED'
                                                target_profile_id UUID REFERENCES managed_profiles(id) ON DELETE CASCADE,
                                                admin_identifier VARCHAR(100) NOT NULL,
                                                filename TEXT,
                                                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_audit_logs_time ON media_audit_logs (created_at DESC);





-- =====================================================================
-- ADMIN CLIENT ENGINE TABLES
-- =====================================================================

-- 1. Client Security & Hardware Tracking
CREATE TABLE IF NOT EXISTS client_security (
                                               user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                               last_ip VARCHAR(45) DEFAULT 'Unknown',
                                               device_type VARCHAR(100) DEFAULT 'Unknown',
                                               location VARCHAR(255) DEFAULT 'Unknown',
                                               updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Client Behavior & Moderation Metrics
CREATE TABLE IF NOT EXISTS client_behavior (
                                               user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                               risk_score INT DEFAULT 0, -- 0 to 100
                                               flags_count INT DEFAULT 0,
                                               updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Client Billing Meta (Actual txns are in the 'transactions' table)
CREATE TABLE IF NOT EXISTS client_billing (
                                              user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                              payment_method VARCHAR(100) DEFAULT 'None',
                                              is_recurring BOOLEAN DEFAULT FALSE,
                                              next_billing_date DATE,
                                              updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Update users table check constraint to allow 'flagged' and 'banned'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
    CHECK (status IN ('onboarding', 'active', 'suspended', 'banned', 'flagged'));

-- OPTIONAL: Insert mock metadata for existing clients so the UI isn't empty
INSERT INTO client_security (user_id, last_ip, device_type, location)
SELECT id, '192.168.1.' || floor(random() * 255)::text, 'iOS App', 'New York, NY' FROM users WHERE role = 'client'
ON CONFLICT DO NOTHING;

INSERT INTO client_behavior (user_id, risk_score, flags_count)
SELECT id, floor(random() * 15)::int, 0 FROM users WHERE role = 'client'
ON CONFLICT DO NOTHING;

INSERT INTO client_billing (user_id, payment_method, is_recurring)
SELECT id, 'Card ending in ' || floor(random() * 8999 + 1000)::text, true FROM users WHERE role = 'client'
ON CONFLICT DO NOTHING;














-- =====================================================================
-- MISSING ADMIN OPERATOR ENGINE TABLES
-- =====================================================================

-- 1. Add auto_pilot to operator_profiles
-- (You previously added it to creator_stats, but the Go backend expects it
-- on the operator_profiles table for isolation)
ALTER TABLE operator_profiles
    ADD COLUMN IF NOT EXISTS auto_pilot BOOLEAN DEFAULT FALSE;

-- 2. Create the operator_security table
-- (Required for the 'SECURITY & OVERRIDES' drawer in the React UI)
CREATE TABLE IF NOT EXISTS operator_security (
                                                 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                                 last_ip VARCHAR(45) DEFAULT 'Unknown',
                                                 mfa_enabled BOOLEAN DEFAULT FALSE,
                                                 updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create the operator_performance table
-- (Required for the 'OPERATOR TELEMETRY' tab and live speed metrics)
CREATE TABLE IF NOT EXISTS operator_performance (
                                                    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                                    msgs_sent INT DEFAULT 0,
                                                    active_sessions INT DEFAULT 0,
                                                    rating DECIMAL(3, 2) DEFAULT 0.00, -- e.g., 4.95
                                                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- (OPTIONAL) INSERT MOCK TELEMETRY FOR TESTING
-- Run this if you want the charts to look populated immediately
-- =====================================================================
INSERT INTO operator_security (user_id, last_ip, mfa_enabled)
SELECT id, '192.168.1.100', true FROM users WHERE role = 'model'
ON CONFLICT DO NOTHING;

INSERT INTO operator_performance (user_id, msgs_sent, active_sessions, rating)
SELECT id, floor(random() * 50000)::int, floor(random() * 5)::int, (random() * 2 + 3)::decimal
FROM users WHERE role = 'model'
ON CONFLICT DO NOTHING;
















-- =====================================================================
-- ADMIN CREATOR & OPERATOR ENGINE UPGRADES
-- =====================================================================

-- 1. Create operator_profiles to track individual revenue splits/cuts per operator
CREATE TABLE IF NOT EXISTS operator_profiles (
                                                 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                                 commission_rate DECIMAL(5, 2) DEFAULT 50.00, -- e.g., 65.00 for 65% creator cut
                                                 updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Add auto_pilot_active flag to creator_stats so AI/Manual toggle state persists
ALTER TABLE creator_stats
    ADD COLUMN IF NOT EXISTS auto_pilot_active BOOLEAN DEFAULT FALSE;

-- 3. Ensure index exists for fast lookup of operator commission profiles
CREATE INDEX IF NOT EXISTS idx_operator_profiles_user ON operator_profiles(user_id);






-- =====================================================================
-- 1. CORE AUTH & USERS
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
                                     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                     email VARCHAR(255) UNIQUE NOT NULL,
                                     username VARCHAR(255) UNIQUE NOT NULL,
                                     password_hash VARCHAR(255) NOT NULL,
                                     role VARCHAR(20) NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'model', 'admin')),
                                     status VARCHAR(20) NOT NULL DEFAULT 'onboarding', -- 'onboarding', 'active', 'suspended'
                                     last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, -- Required for status filtering
                                     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                     updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- Represents individual creator/model profiles that can be managed
CREATE TABLE IF NOT EXISTS managed_profiles (
                                                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                manager_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                name VARCHAR(100) NOT NULL,
                                                avatar_url TEXT,
                                                status VARCHAR(20) DEFAULT 'offline', -- 'online', 'offline'
                                                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Update chat_requests to target specific managed profiles instead of just the user_id
ALTER TABLE chat_requests
    ADD COLUMN IF NOT EXISTS managed_profile_id UUID REFERENCES managed_profiles(id) ON DELETE CASCADE;

-- =====================================================================
-- 2. USER PROFILES
-- =====================================================================
CREATE TABLE IF NOT EXISTS user_profiles (
                                             user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                             display_name VARCHAR(50) NOT NULL,
                                             date_of_birth DATE NOT NULL,
                                             gender VARCHAR(20) NOT NULL,
                                             bio TEXT,
                                             height_cm INT,
                                             avatar_url VARCHAR(500),
                                             intent VARCHAR(50) DEFAULT 'All', -- Required for the Grid intent filter
                                             verified BOOLEAN DEFAULT FALSE,
                                             created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 3. USER LOCATIONS
-- =====================================================================
CREATE TABLE IF NOT EXISTS user_locations (
                                              user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                              latitude DECIMAL(10, 8),
                                              longitude DECIMAL(11, 8),
                                              city VARCHAR(100),
                                              country VARCHAR(100),
                                              last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 4. MATCH PREFERENCES
-- =====================================================================
CREATE TABLE IF NOT EXISTS user_preferences (
                                                user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                                interested_in VARCHAR(20) NOT NULL,
                                                min_age INT DEFAULT 18,
                                                max_age INT DEFAULT 99,
                                                max_distance_km INT DEFAULT 50
);

-- =====================================================================
-- 5. USER MEDIA
-- =====================================================================
CREATE TABLE IF NOT EXISTS user_media (
                                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                          media_url TEXT NOT NULL,
                                          is_primary BOOLEAN DEFAULT FALSE,
                                          sort_order INT DEFAULT 0,
                                          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 6. USER TAGS (Crucial for Match % Algorithm)
-- =====================================================================
CREATE TABLE IF NOT EXISTS user_tags (
                                         user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                         tag VARCHAR(50) NOT NULL,
                                         created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                         PRIMARY KEY (user_id, tag)
);

-- =====================================================================
-- 7. SUBSCRIPTION TIERS (Business Rules)
-- =====================================================================
CREATE TABLE IF NOT EXISTS subscription_tiers (
                                                  id SERIAL PRIMARY KEY,
                                                  name VARCHAR(50) UNIQUE NOT NULL, -- 'free', 'premium', 'vip'
                                                  max_daily_swipes INT NOT NULL DEFAULT 50, -- -1 means unlimited
                                                  max_daily_super_likes INT NOT NULL DEFAULT 1,
                                                  can_see_likes BOOLEAN DEFAULT FALSE, -- Unlocks "Secret Admirers"
                                                  can_use_advanced_filters BOOLEAN DEFAULT FALSE, -- Unlocks Grid filters
                                                  can_undo BOOLEAN DEFAULT FALSE, -- Unlocks Rewind button
                                                  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert base subscription tiers
INSERT INTO subscription_tiers (name, max_daily_swipes, max_daily_super_likes, can_see_likes, can_use_advanced_filters, can_undo)
VALUES
    ('free', 40, 1, FALSE, FALSE, FALSE),
    ('premium', -1, 5, TRUE, TRUE, TRUE)
ON CONFLICT (name) DO NOTHING;

-- =====================================================================
-- 8. USER SUBSCRIPTIONS
-- =====================================================================
CREATE TABLE IF NOT EXISTS user_subscriptions (
                                                  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                                  tier_id INT REFERENCES subscription_tiers(id),
                                                  status VARCHAR(20) DEFAULT 'active', -- 'active', 'cancelled', 'expired'
                                                  expires_at TIMESTAMP WITH TIME ZONE, -- NULL for 'free' tier
                                                  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 9. DAILY USAGE TRACKING
-- =====================================================================
CREATE TABLE IF NOT EXISTS user_daily_usage (
                                                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
                                                swipes_used INT DEFAULT 0,
                                                super_likes_used INT DEFAULT 0,
                                                PRIMARY KEY (user_id, usage_date)
);

-- =====================================================================
-- 10. INTERACTIONS (Swipes & Matches)
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

-- =====================================================================
-- 11. PRODUCTION PERFORMANCE INDEXES
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_user_locations_coords ON user_locations (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_user_media_sort ON user_media (user_id, is_primary DESC, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_interactions_target ON interactions (target_id);
CREATE INDEX IF NOT EXISTS idx_users_status_active ON users (status, last_active);
CREATE INDEX IF NOT EXISTS idx_profiles_dob ON user_profiles (date_of_birth);


CREATE TABLE IF NOT EXISTS messages (
                                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                        sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                        recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                        room_id VARCHAR(255) DEFAULT 'default', -- Used for public rooms or direct IDs
                                        content TEXT NOT NULL,
                                        status VARCHAR(20) DEFAULT 'sent', -- 'sent', 'read'
                                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS rooms (
                                     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                     name VARCHAR(255) NOT NULL,
                                     icon VARCHAR(50),
                                     category VARCHAR(100),
                                     description TEXT,
                                     tags JSONB DEFAULT '[]'::jsonb,
                                     is_private BOOLEAN DEFAULT FALSE,
                                     created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                                     active_count INT DEFAULT 0,
                                     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- Create the missing reports table
CREATE TABLE IF NOT EXISTS reports (
                                       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                       reporter_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                       reported_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Can be null if username wasn't found
                                       reported_username VARCHAR(255), -- Stored in case the user deletes their account
                                       reason VARCHAR(100) NOT NULL,
                                       description TEXT,
                                       status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'reviewed', 'resolved'
                                       created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- CREATOR STATS & BALANCE
-- =====================================================================
CREATE TABLE IF NOT EXISTS creator_stats (
                                             user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                             current_balance DECIMAL(10, 2) DEFAULT 0.00,
                                             total_earned DECIMAL(10, 2) DEFAULT 0.00,
                                             is_online BOOLEAN DEFAULT FALSE,
                                             updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- CHAT REQUESTS (The Queue)
-- =====================================================================
CREATE TABLE IF NOT EXISTS chat_requests (
                                             id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                             model_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                             client_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                             tip_amount DECIMAL(10, 2) DEFAULT 0.00,
                                             status VARCHAR(20) DEFAULT 'PENDING', -- 'PENDING', 'ACTIVE', 'REJECTED', 'COMPLETED'
                                             created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                             updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- FINANCIAL LEDGER (Transactions)
-- =====================================================================
CREATE TABLE IF NOT EXISTS transactions (
                                            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                            model_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                            client_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Null for system payouts
                                            tx_type VARCHAR(50) NOT NULL, -- 'DIRECT_TIP', 'SUBSCRIPTION', 'PAYOUT_WIRE', etc.
                                            amount DECIMAL(10, 2) NOT NULL, -- Positive for earnings, negative for payouts
                                            status VARCHAR(20) DEFAULT 'COMPLETED', -- 'PENDING', 'COMPLETED', 'FAILED'
                                            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast ledger and queue lookups
CREATE INDEX IF NOT EXISTS idx_chat_requests_model ON chat_requests (model_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_model ON transactions (model_id, created_at DESC);

-- Add a flag to track if the user agreed to the guidelines
ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS guidelines_agreed BOOLEAN DEFAULT FALSE;

-- Optional: Insert some default public rooms so your directory isn't empty!
INSERT INTO rooms (name, icon, category, description, tags, is_private)
VALUES
    ('The Main Lounge', 'coffee', 'General', 'The official Chattie welcome room. Grab a coffee and say hi!', '["chill", "welcome", "general"]', false),
    ('Late Night Coders', 'moon', 'Tech', 'For the night owls pushing commits at 3 AM.', '["tech", "coding", "nightowl"]', false),
    ('Gaming Hub', 'gamepad', 'Gaming', 'LFG, strats, and general gaming chat.', '["gaming", "pc", "console"]', false)
ON CONFLICT DO NOTHING;

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS media TEXT;


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
                                             updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings for existing users
INSERT INTO user_settings (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_rooms_category ON rooms (category);

CREATE INDEX IF NOT EXISTS idx_messages_room ON messages (room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_direct ON messages (sender_id, recipient_id);





-- =====================================================================
-- SYSTEM UPGRADES & MISSING TABLES (ADDED FOR PREMIUM FEATURES)
-- =====================================================================

-- 1. FIX THE MEDIA URL COLUMN BUG
-- Renames the column so the Go backend can find the user photos without crashing
ALTER TABLE user_media RENAME COLUMN media_url TO url;

-- 2. FIX THE ROOMS TYPO
-- Your original script accidentally named the table "roomsrooms". This ensures the correct "rooms" table exists.
CREATE TABLE IF NOT EXISTS rooms (
                                     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                     name VARCHAR(255) NOT NULL,
                                     icon VARCHAR(50),
                                     category VARCHAR(100),
                                     description TEXT,
                                     tags JSONB DEFAULT '[]'::jsonb,
                                     is_private BOOLEAN DEFAULT FALSE,
                                     created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                                     active_count INT DEFAULT 0,
                                     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. THE BLOCKS TABLE (Required for the Block User feature)
-- Creates a permanent wall between two users
CREATE TABLE IF NOT EXISTS blocks (
                                      blocker_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                      blocked_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                      PRIMARY KEY (blocker_id, blocked_id)
);

-- 4. THE PROFILE VIEWS TABLE (Required for "Secret Admirers" / "Who Viewed Me")
-- Silently tracks every time a user clicks on someone's full profile
CREATE TABLE IF NOT EXISTS profile_views (
                                             viewer_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                             viewed_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                             viewed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                             PRIMARY KEY (viewer_id, viewed_id)
);

-- 5. PERFORMANCE INDEXES FOR NEW TABLES
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_profile_views_viewed ON profile_views(viewed_id, viewed_at DESC);




-- =====================================================================
-- ROOMS & VOICE SUBSCRIPTION UPGRADES
-- =====================================================================

-- 1. Add Daily Voice & Room Limits to Subscription Tiers
ALTER TABLE subscription_tiers
    ADD COLUMN IF NOT EXISTS max_daily_voice_joins INT DEFAULT 1, -- Free users get 1 trial join per day
    ADD COLUMN IF NOT EXISTS max_rooms_created INT DEFAULT 0;     -- Free users cannot create rooms

-- Update existing tiers
UPDATE subscription_tiers SET max_daily_voice_joins = 1, max_rooms_created = 0 WHERE name = 'free';
UPDATE subscription_tiers SET max_daily_voice_joins = -1, max_rooms_created = -1 WHERE name = 'premium';
UPDATE subscription_tiers SET max_daily_voice_joins = -1, max_rooms_created = -1 WHERE name = 'vip';

-- 2. Track daily usage for voice and room creation
ALTER TABLE user_daily_usage
    ADD COLUMN IF NOT EXISTS voice_joins_used INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rooms_created_used INT DEFAULT 0;
truncate table room_members


CREATE INDEX IF NOT EXISTS idx_room_members_active ON room_members(room_id, last_active DESC);





-- =====================================================================
-- ROOM ADMIN & MODERATION UPGRADES
-- =====================================================================

-- 1. Add Roles to room_members ('creator', 'admin', 'speaker', 'member')
ALTER TABLE room_members
    ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'member'
        CHECK (role IN ('creator', 'admin', 'speaker', 'member'));

-- 2. Room Access Requests (For Private "Knock to Join" Rooms)
CREATE TABLE IF NOT EXISTS room_join_requests (
                                                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
                                                  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                                  status VARCHAR(20) DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED'
                                                  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                                  UNIQUE (room_id, user_id)
);

-- Index for fast requests lookup
CREATE INDEX IF NOT EXISTS idx_room_requests_status ON room_join_requests(room_id, status);








-- Add unique room codes
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS room_code VARCHAR(20) UNIQUE;

-- Generate random 6-character codes for any existing rooms
UPDATE rooms
SET room_code = UPPER(SUBSTRING(MD5(RANDOM()::TEXT), 1, 6))
WHERE room_code IS NULL;

-- Ensure room_members table exists (from our last upgrade)
CREATE TABLE IF NOT EXISTS room_members (
                                            room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
                                            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                                            joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                            last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                                            PRIMARY KEY (room_id, user_id)
);