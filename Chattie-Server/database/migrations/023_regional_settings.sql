ALTER TABLE user_locations
    ADD COLUMN IF NOT EXISTS country_code CHAR(2);

CREATE INDEX IF NOT EXISTS idx_user_locations_country_code
    ON user_locations(country_code);

CREATE TABLE IF NOT EXISTS regional_country_blocks (
    country_code CHAR(2) PRIMARY KEY,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
