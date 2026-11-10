package repository

import (
	"context"
	"database/sql"
	"time"

	"chattie-backend/models"
)

type ADProfileRepository struct {
	DB *sql.DB
}

func NewADProfileRepository(db *sql.DB) *ADProfileRepository {
	return &ADProfileRepository{DB: db}
}

// GetViewerProfile fetches the auto-generated viewer profile used for scrolling
func (r *ADProfileRepository) GetViewerProfile(ctx context.Context, userID string) (*models.ADViewerProfile, error) {
	query := `
		SELECT 
			user_id::text, 
			alias, 
			explicit_consent_at, 
			age_verified_at, 
			created_at, 
			updated_at
		FROM ad_viewer_profiles
		WHERE user_id = $1
	`
	var profile models.ADViewerProfile
	var explicitConsentAt, ageVerifiedAt sql.NullTime

	err := r.DB.QueryRowContext(ctx, query, userID).Scan(
		&profile.UserID,
		&profile.Alias,
		&explicitConsentAt,
		&ageVerifiedAt,
		&profile.CreatedAt,
		&profile.UpdatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // No profile exists yet
		}
		return nil, err
	}

	if explicitConsentAt.Valid {
		profile.ExplicitConsentAt = &explicitConsentAt.Time
	}
	if ageVerifiedAt.Valid {
		profile.AgeVerifiedAt = &ageVerifiedAt.Time
	}

	return &profile, nil
}

// GetPerformerProfile fetches the After Dark creator persona
func (r *ADProfileRepository) GetPerformerProfile(ctx context.Context, userID string) (*models.PerformerProfile, error) {
	query := `
		SELECT 
			performer_profiles.id::text, 
			user_id::text, 
			display_name, 
			username, 
			COALESCE(bio, ''), 
			COALESCE(website, ''), 
			COALESCE(location, ''), 
			COALESCE(avatar_asset_id::text, ''), 
			COALESCE(cover_asset_id::text, ''),
			COALESCE(avatar.storage_key, ''),
			COALESCE(cover.storage_key, ''),
			performer_profiles.status,
			performer_profiles.dm_control,
			performer_profiles.subscription_price_cents,
			performer_profiles.welcome_message,
			performer_profiles.created_at,
			performer_profiles.updated_at
		FROM performer_profiles
		LEFT JOIN ad_assets avatar ON avatar.id = performer_profiles.avatar_asset_id
		LEFT JOIN ad_assets cover ON cover.id = performer_profiles.cover_asset_id
		WHERE performer_profiles.user_id = $1
	`
	var profile models.PerformerProfile
	var avatarID, coverID sql.NullString

	err := r.DB.QueryRowContext(ctx, query, userID).Scan(
		&profile.ID,
		&profile.UserID,
		&profile.DisplayName,
		&profile.Username,
		&profile.Bio,
		&profile.Website,
		&profile.Location,
		&avatarID,
		&coverID,
		&profile.AvatarURL,
		&profile.CoverURL,
		&profile.Status,
		&profile.DMControl,
		&profile.SubscriptionPriceCents,
		&profile.WelcomeMessage,
		&profile.CreatedAt,
		&profile.UpdatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // Not a creator yet
		}
		return nil, err
	}

	if avatarID.Valid && avatarID.String != "" {
		profile.AvatarAssetID = avatarID.String
	}
	if coverID.Valid && coverID.String != "" {
		profile.CoverAssetID = coverID.String
	}

	return &profile, nil
}

// UpsertPerformerProfile creates a new creator profile or updates an existing one
func (r *ADProfileRepository) UpsertPerformerProfile(ctx context.Context, p *models.PerformerProfile) error {
	// Using ON CONFLICT to make this idempotent.
	// If they don't have a profile, it creates one. If they do, it updates it.
	query := `
		INSERT INTO performer_profiles (
		user_id, display_name, username, bio, website, location, dm_control,
		subscription_price_cents, welcome_message, updated_at
	) VALUES (
		$1, $2, $3, $4, $5, $6, COALESCE(NULLIF($7, ''), 'all'),
		COALESCE($8, 50000), COALESCE($9, ''), CURRENT_TIMESTAMP
	)
		ON CONFLICT (user_id) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			username = EXCLUDED.username,
			bio = EXCLUDED.bio,
			website = EXCLUDED.website,
			location = EXCLUDED.location,
			dm_control = CASE
				WHEN NULLIF($7, '') IS NULL THEN performer_profiles.dm_control
				ELSE EXCLUDED.dm_control
			END,
			subscription_price_cents = CASE WHEN $10 THEN $8 ELSE performer_profiles.subscription_price_cents END,
			welcome_message = CASE WHEN $11 THEN $9 ELSE performer_profiles.welcome_message END,
			updated_at = CURRENT_TIMESTAMP
	`
	var price interface{}
	if p.SubscriptionPriceCentsProvided {
		price = p.SubscriptionPriceCents
	}
	_, err := r.DB.ExecContext(ctx, query,
		p.UserID, p.DisplayName, p.Username, p.Bio, p.Website, p.Location, p.DMControl,
		price, p.WelcomeMessage, p.SubscriptionPriceCentsProvided, p.WelcomeMessageProvided,
	)
	return err
}

// GetSubscribers fetches the list of active subscribers for a creator
func (r *ADProfileRepository) GetSubscribers(ctx context.Context, creatorID string) ([]map[string]interface{}, error) {
	query := `
		SELECT id, subscriber_id, status, current_period_start, current_period_end 
		FROM ad_subscriptions 
		WHERE creator_id = $1 AND status = 'active'
		ORDER BY current_period_start DESC
	`
	rows, err := r.DB.QueryContext(ctx, query, creatorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subscribers []map[string]interface{}
	for rows.Next() {
		var id, subID, status string
		var periodStart, periodEnd time.Time

		if err := rows.Scan(&id, &subID, &status, &periodStart, &periodEnd); err == nil {
			subscribers = append(subscribers, map[string]interface{}{
				"id":                   id,
				"subscriber_id":        subID,
				"status":               status,
				"current_period_start": periodStart,
				"current_period_end":   periodEnd,
			})
		}
	}

	if subscribers == nil {
		subscribers = []map[string]interface{}{}
	}
	return subscribers, nil
}
