package repository

import (
	"chattie-backend/models"
	"context"
	"database/sql"
	"errors"
	"fmt"
)

var ErrInvalidDirectoryPriceRange = errors.New("invalid directory price range")

type ADDiscoveryRepository struct {
	DB *sql.DB
}

func NewADDiscoveryRepository(db *sql.DB) *ADDiscoveryRepository {
	return &ADDiscoveryRepository{DB: db}
}

// GetDirectory fetches creators for AfterDarkDirectory.jsx with search and filters
func (r *ADDiscoveryRepository) GetDirectory(ctx context.Context, viewerID string, searchQuery string, location string, verifiedOnly bool, onlineOnly bool, minPriceCents, maxPriceCents *int64, sortBy string, limit int, offset int) ([]models.PerformerProfile, int, error) {
	where := `
		WHERE performer_profiles.status = 'active'
		  AND COALESCE((
			SELECT s.discoverable FROM ad_creator_settings s
			WHERE s.user_id = performer_profiles.user_id
		  ), TRUE)
		  AND (
			NOT EXISTS (
				SELECT 1 FROM user_locations viewer_location
				WHERE viewer_location.user_id = $1 AND viewer_location.country_code IS NOT NULL
			)
			OR COALESCE((SELECT global_mode FROM user_settings WHERE user_id = $1), FALSE)
			OR COALESCE((SELECT global_mode FROM user_settings WHERE user_id = performer_profiles.user_id), FALSE)
			OR EXISTS (
				SELECT 1 FROM user_locations viewer_location
				JOIN user_locations creator_location
				  ON creator_location.country_code = viewer_location.country_code
				WHERE viewer_location.user_id = $1
				  AND creator_location.user_id = performer_profiles.user_id
			)
		  )
	`
	args := []interface{}{viewerID}
	argID := 2
	if searchQuery != "" {
		where += fmt.Sprintf(` AND (performer_profiles.display_name ILIKE $%d OR performer_profiles.username ILIKE $%d OR up.display_name ILIKE $%d OR u.username ILIKE $%d OR performer_profiles.bio ILIKE $%d)`, argID, argID, argID, argID, argID)
		args = append(args, "%"+searchQuery+"%")
		argID++
	}
	if location != "" && location != "Global" {
		where += fmt.Sprintf(` AND performer_profiles.location ILIKE $%d`, argID)
		args = append(args, "%"+location+"%")
		argID++
	}
	if minPriceCents != nil && maxPriceCents != nil && *minPriceCents > *maxPriceCents {
		return nil, 0, ErrInvalidDirectoryPriceRange
	}
	if minPriceCents != nil {
		where += fmt.Sprintf(` AND performer_profiles.subscription_price_cents >= $%d`, argID)
		args = append(args, *minPriceCents)
		argID++
	}
	if maxPriceCents != nil {
		where += fmt.Sprintf(` AND performer_profiles.subscription_price_cents <= $%d`, argID)
		args = append(args, *maxPriceCents)
		argID++
	}
	if verifiedOnly {
		where += ` AND COALESCE(up.verified, FALSE)`
	}
	if onlineOnly {
		where += ` AND EXISTS (
			SELECT 1 FROM ad_live_sessions ls
			WHERE ls.creator_id = performer_profiles.user_id AND ls.status = 'live'
		)`
	}

	var total int
	countQuery := `SELECT COUNT(*) FROM performer_profiles LEFT JOIN user_profiles up ON up.user_id = performer_profiles.user_id LEFT JOIN users u ON u.id = performer_profiles.user_id ` + where
	if err := r.DB.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	orderBy := `(
		SELECT COUNT(*) FROM ad_subscriptions s
		WHERE s.creator_id = performer_profiles.user_id
		  AND s.status = 'active'
		  AND s.current_period_end > CURRENT_TIMESTAMP
	) DESC, performer_profiles.created_at DESC`
	switch sortBy {
	case "newest":
		orderBy = `performer_profiles.created_at DESC`
	case "price_low":
		orderBy = `performer_profiles.subscription_price_cents ASC, performer_profiles.created_at DESC`
	case "price_high":
		orderBy = `performer_profiles.subscription_price_cents DESC, performer_profiles.created_at DESC`
	case "most_subscribers":
		orderBy = `(SELECT COUNT(*) FROM ad_subscriptions s WHERE s.creator_id = performer_profiles.user_id AND s.status = 'active' AND s.current_period_end > CURRENT_TIMESTAMP) DESC, performer_profiles.created_at DESC`
	case "most_content":
		orderBy = `(SELECT COUNT(*) FROM ad_posts p WHERE p.creator_id = performer_profiles.user_id AND p.status = 'published' AND (p.publish_at IS NULL OR p.publish_at <= CURRENT_TIMESTAMP)) DESC, performer_profiles.created_at DESC`
	case "most_liked":
		orderBy = `(SELECT COUNT(*) FROM ad_post_likes l JOIN ad_posts p ON p.id = l.post_id WHERE p.creator_id = performer_profiles.user_id AND p.status = 'published') DESC, performer_profiles.created_at DESC`
	}

	query := `
		SELECT
			performer_profiles.id::text, performer_profiles.user_id::text,
			COALESCE(NULLIF(BTRIM(performer_profiles.display_name), ''), NULLIF(BTRIM(performer_profiles.username), ''), NULLIF(BTRIM(up.display_name), ''), NULLIF(BTRIM(u.username), ''), 'Creator'),
			COALESCE(NULLIF(BTRIM(performer_profiles.username), ''), NULLIF(BTRIM(u.username), ''), ''), COALESCE(performer_profiles.bio, ''),
			COALESCE(performer_profiles.website, ''), COALESCE(performer_profiles.location, ''),
			COALESCE(performer_profiles.avatar_asset_id::text, ''),
			COALESCE(performer_profiles.cover_asset_id::text, ''),
			performer_profiles.status, performer_profiles.dm_control,
			performer_profiles.subscription_price_cents, performer_profiles.welcome_message,
			COALESCE(avatar.storage_key, ''), COALESCE(cover.storage_key, ''),
			performer_profiles.created_at, performer_profiles.updated_at,
			COALESCE(up.verified, FALSE),
			EXISTS (SELECT 1 FROM ad_live_sessions ls WHERE ls.creator_id = performer_profiles.user_id AND ls.status = 'live'),
			(SELECT COUNT(*) FROM ad_subscriptions s WHERE s.creator_id = performer_profiles.user_id AND s.status = 'active' AND s.current_period_end > CURRENT_TIMESTAMP),
			(SELECT COUNT(*) FROM ad_posts p WHERE p.creator_id = performer_profiles.user_id AND p.status = 'published' AND (p.publish_at IS NULL OR p.publish_at <= CURRENT_TIMESTAMP)),
			(SELECT COUNT(*) FROM ad_post_likes l JOIN ad_posts p ON p.id = l.post_id WHERE p.creator_id = performer_profiles.user_id AND p.status = 'published')
		FROM performer_profiles
		LEFT JOIN ad_assets avatar ON avatar.id = performer_profiles.avatar_asset_id
		LEFT JOIN ad_assets cover ON cover.id = performer_profiles.cover_asset_id
		LEFT JOIN user_profiles up ON up.user_id = performer_profiles.user_id
		LEFT JOIN users u ON u.id = performer_profiles.user_id
	`
	query += where
	query += fmt.Sprintf(` ORDER BY %s LIMIT $%d OFFSET $%d`, orderBy, argID, argID+1)
	args = append(args, limit, offset)

	rows, err := r.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var profiles []models.PerformerProfile
	for rows.Next() {
		var p models.PerformerProfile
		var avatarID, coverID sql.NullString

		if err := rows.Scan(
			&p.ID, &p.UserID, &p.DisplayName, &p.Username, &p.Bio, &p.Website,
			&p.Location, &avatarID, &coverID, &p.Status, &p.DMControl,
			&p.SubscriptionPriceCents, &p.WelcomeMessage, &p.AvatarURL, &p.CoverURL,
			&p.CreatedAt, &p.UpdatedAt, &p.IsVerified, &p.IsLive,
			&p.SubscriberCount, &p.PostCount, &p.LikeCount,
		); err != nil {
			return nil, 0, err
		}

		if avatarID.Valid {
			p.AvatarAssetID = avatarID.String
		}
		if coverID.Valid {
			p.CoverAssetID = coverID.String
		}
		profiles = append(profiles, p)
	}

	if profiles == nil {
		profiles = []models.PerformerProfile{}
	}
	return profiles, total, rows.Err()
}

// GetPublicFeed fetches posts for AfterDarkFeed.jsx
func (r *ADDiscoveryRepository) GetPublicFeed(ctx context.Context, viewerID, viewerCountryCode, creatorID, searchQuery, mediaType, accessType string, followingOnly bool, limit, offset int) ([]models.ADPost, error) {
	query := `
		SELECT 
			p.id::text, p.creator_id::text, p.asset_id::text,
			CASE WHEN entitlement.is_unlocked THEN COALESCE(p.caption, '') ELSE '' END,
			''::text,
			a.mime_type, p.access_type, p.price_cents,
			entitlement.is_unlocked,
			EXISTS (
				SELECT 1 FROM ad_post_likes l
				WHERE l.user_id = $1::uuid AND l.post_id = p.id
			),
			(SELECT COUNT(*) FROM ad_post_likes l WHERE l.post_id = p.id),
			(SELECT COUNT(*) FROM ad_post_comments c WHERE c.post_id = p.id),
			EXISTS (
				SELECT 1 FROM ad_follows f
				WHERE f.follower_id = $1::uuid AND f.creator_id = p.creator_id
			),
			pp.id::text,
			COALESCE(NULLIF(BTRIM(pp.display_name), ''), NULLIF(BTRIM(pp.username), ''), NULLIF(BTRIM(up.display_name), ''), NULLIF(BTRIM(u.username), ''), 'Creator'),
			COALESCE(NULLIF(BTRIM(pp.username), ''), NULLIF(BTRIM(u.username), ''), ''),
			COALESCE(avatar.storage_key, ''), pp.subscription_price_cents, pp.dm_control,
			p.is_explicit, p.status, p.publish_at, p.created_at, p.updated_at
		FROM ad_posts p
		JOIN ad_assets a ON p.asset_id = a.id
		JOIN performer_profiles pp ON pp.user_id = p.creator_id
		LEFT JOIN user_profiles up ON up.user_id = pp.user_id
		LEFT JOIN users u ON u.id = pp.user_id
		LEFT JOIN ad_assets avatar ON avatar.id = pp.avatar_asset_id
		CROSS JOIN LATERAL (
			SELECT (p.access_type = 'free' OR p.creator_id = $1::uuid OR
			 (p.access_type = 'subscriber' AND EXISTS (
				SELECT 1 FROM ad_subscriptions s
				WHERE s.subscriber_id = $1::uuid AND s.creator_id = p.creator_id
				  AND s.status = 'active' AND s.current_period_end > CURRENT_TIMESTAMP
			 )) OR
			 (p.access_type = 'ppv' AND EXISTS (
				SELECT 1 FROM ad_post_entitlements e
				WHERE e.user_id = $1::uuid AND e.post_id = p.id
			 ))) AS is_unlocked
		) entitlement
		WHERE p.status = 'published'
		  AND (p.publish_at IS NULL OR p.publish_at <= CURRENT_TIMESTAMP)
		  AND a.status = 'ready'
		  AND a.moderation_status = 'approved'
		  AND (NOT p.is_explicit OR COALESCE((
			SELECT s.show_explicit_content FROM ad_creator_settings s
			WHERE s.user_id = $1::uuid
		  ), FALSE))
		  AND EXISTS (
			SELECT 1 FROM performer_profiles pp
			WHERE pp.user_id = p.creator_id
			  AND pp.status = 'active'
			  AND COALESCE((
				SELECT s.discoverable FROM ad_creator_settings s
				WHERE s.user_id = pp.user_id
			  ), TRUE)
		  )
		  AND (
			NOT EXISTS (
				SELECT 1 FROM user_locations viewer_location
				WHERE viewer_location.user_id = $1::uuid AND viewer_location.country_code IS NOT NULL
			)
			OR COALESCE((SELECT global_mode FROM user_settings WHERE user_id = $1::uuid), FALSE)
			OR COALESCE((SELECT global_mode FROM user_settings WHERE user_id = p.creator_id), FALSE)
			OR EXISTS (
				SELECT 1 FROM user_locations viewer_location
				JOIN user_locations creator_location
				  ON creator_location.country_code = viewer_location.country_code
				WHERE viewer_location.user_id = $1::uuid
				  AND creator_location.user_id = p.creator_id
			)
		  )
		  AND NOT EXISTS (
			SELECT 1
			FROM ad_creator_settings creator_settings
			CROSS JOIN LATERAL jsonb_array_elements_text(
				CASE
					WHEN jsonb_typeof(creator_settings.blocked_regions) = 'array'
					THEN creator_settings.blocked_regions
					ELSE '[]'::jsonb
				END
			) blocked_region(region)
			WHERE creator_settings.user_id = p.creator_id
			  AND COALESCE(creator_settings.geo_block_enabled, FALSE)
			  AND NULLIF(BTRIM(blocked_region.region), '') IS NOT NULL
			  AND (
				(NULLIF(BTRIM($2), '') IS NOT NULL AND UPPER(BTRIM(blocked_region.region)) = UPPER(BTRIM($2)))
				OR UPPER(BTRIM(blocked_region.region)) = UPPER(BTRIM(COALESCE((
					SELECT viewer_location.country FROM user_locations viewer_location
					WHERE viewer_location.user_id = $1::uuid
					LIMIT 1
				), '')))
				OR UPPER(BTRIM(blocked_region.region)) = UPPER(BTRIM(COALESCE((
					SELECT viewer_location.city FROM user_locations viewer_location
					WHERE viewer_location.user_id = $1::uuid
					LIMIT 1
				), '')))
			  )
		  )
	`
	args := []interface{}{viewerID, viewerCountryCode}
	argId := 3

	// Filter by free, subscriber, or PPV
	if accessType != "" && accessType != "all" {
		query += fmt.Sprintf(` AND p.access_type = $%d`, argId)
		args = append(args, accessType)
		argId++
	}

	if creatorID != "" {
		query += fmt.Sprintf(` AND p.creator_id = COALESCE(
			(SELECT pp.user_id FROM performer_profiles pp WHERE pp.id = $%d::uuid OR pp.user_id = $%d::uuid LIMIT 1),
			$%d::uuid
		)`, argId, argId, argId)
		args = append(args, creatorID)
		argId++
	}

	if searchQuery != "" {
		query += fmt.Sprintf(` AND (
			(entitlement.is_unlocked AND p.caption ILIKE $%d) OR EXISTS (
				SELECT 1 FROM performer_profiles pp
				LEFT JOIN user_profiles profile ON profile.user_id = pp.user_id
				LEFT JOIN users creator_user ON creator_user.id = pp.user_id
				WHERE pp.user_id = p.creator_id
				  AND (pp.display_name ILIKE $%d OR pp.username ILIKE $%d OR profile.display_name ILIKE $%d OR creator_user.username ILIKE $%d)
			)
		)`, argId, argId, argId, argId, argId)
		args = append(args, "%"+searchQuery+"%")
		argId++
	}

	if followingOnly {
		query += ` AND EXISTS (
			SELECT 1 FROM ad_follows f
			WHERE f.follower_id = $1::uuid AND f.creator_id = p.creator_id
		)`
	}

	// Filter by image or video
	if mediaType == "image" {
		query += ` AND a.mime_type LIKE 'image/%'`
	} else if mediaType == "video" {
		query += ` AND a.mime_type LIKE 'video/%'`
	}

	query += fmt.Sprintf(` ORDER BY p.created_at DESC, p.id DESC LIMIT $%d OFFSET $%d`, argId, argId+1)
	args = append(args, limit, offset)

	rows, err := r.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var posts []models.ADPost
	for rows.Next() {
		var post models.ADPost
		var publishAt sql.NullTime

		if err := rows.Scan(
			&post.ID, &post.CreatorID, &post.AssetID, &post.Caption, &post.MediaURL,
			&post.MediaType, &post.AccessType, &post.PriceCents, &post.IsUnlocked,
			&post.IsLiked, &post.LikeCount, &post.CommentCount, &post.IsFollowing,
			&post.Creator.ID, &post.Creator.DisplayName, &post.Creator.Username,
			&post.Creator.AvatarURL, &post.Creator.SubscriptionPriceCents, &post.Creator.DMControl,
			&post.IsExplicit, &post.Status,
			&publishAt, &post.CreatedAt, &post.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan feed post: %w", err)
		}
		post.Creator.UserID = post.CreatorID
		post.Creator.Status = "active"
		post.PricingStrategy = post.AccessType

		if publishAt.Valid {
			post.PublishAt = &publishAt.Time
		}
		posts = append(posts, post)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate feed rows: %w", err)
	}

	if posts == nil {
		posts = []models.ADPost{}
	}
	return posts, nil
}

// GetPublicCreatorProfile fetches a specific creator for AfterDarkCreatorProfile.jsx
func (r *ADDiscoveryRepository) GetPublicCreatorProfile(ctx context.Context, viewerID, creatorID string) (*models.PerformerProfile, error) {
	query := `
		SELECT 
			performer_profiles.id::text, performer_profiles.user_id::text,
			COALESCE(NULLIF(BTRIM(performer_profiles.display_name), ''), NULLIF(BTRIM(performer_profiles.username), ''), NULLIF(BTRIM(up.display_name), ''), NULLIF(BTRIM(u.username), ''), 'Creator'),
			COALESCE(NULLIF(BTRIM(performer_profiles.username), ''), NULLIF(BTRIM(u.username), ''), ''), COALESCE(performer_profiles.bio, ''),
			COALESCE(performer_profiles.website, ''), COALESCE(performer_profiles.location, ''),
			COALESCE(performer_profiles.avatar_asset_id::text, ''),
			COALESCE(performer_profiles.cover_asset_id::text, ''),
			performer_profiles.status, performer_profiles.dm_control,
			performer_profiles.subscription_price_cents, performer_profiles.welcome_message,
			COALESCE(avatar.storage_key, ''), COALESCE(cover.storage_key, ''),
			performer_profiles.created_at, performer_profiles.updated_at
		FROM performer_profiles
		LEFT JOIN user_profiles up ON up.user_id = performer_profiles.user_id
		LEFT JOIN users u ON u.id = performer_profiles.user_id
		LEFT JOIN ad_assets avatar ON avatar.id = performer_profiles.avatar_asset_id
		LEFT JOIN ad_assets cover ON cover.id = performer_profiles.cover_asset_id
		WHERE performer_profiles.id = $1 AND performer_profiles.status = 'active'
		  AND COALESCE((
			SELECT s.discoverable FROM ad_creator_settings s
			WHERE s.user_id = performer_profiles.user_id
		  ), TRUE)
		  AND (
			NOT EXISTS (
				SELECT 1 FROM user_locations viewer_location
				WHERE viewer_location.user_id = $2::uuid AND viewer_location.country_code IS NOT NULL
			)
			OR COALESCE((SELECT global_mode FROM user_settings WHERE user_id = $2::uuid), FALSE)
			OR COALESCE((SELECT global_mode FROM user_settings WHERE user_id = performer_profiles.user_id), FALSE)
			OR EXISTS (
				SELECT 1 FROM user_locations viewer_location
				JOIN user_locations creator_location
				  ON creator_location.country_code = viewer_location.country_code
				WHERE viewer_location.user_id = $2::uuid
				  AND creator_location.user_id = performer_profiles.user_id
			)
		  )
	`
	var p models.PerformerProfile
	var avatarID, coverID sql.NullString

	err := r.DB.QueryRowContext(ctx, query, creatorID, viewerID).Scan(
		&p.ID, &p.UserID, &p.DisplayName, &p.Username, &p.Bio, &p.Website,
		&p.Location, &avatarID, &coverID, &p.Status, &p.DMControl,
		&p.SubscriptionPriceCents, &p.WelcomeMessage, &p.AvatarURL, &p.CoverURL,
		&p.CreatedAt, &p.UpdatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	if avatarID.Valid {
		p.AvatarAssetID = avatarID.String
	}
	if coverID.Valid {
		p.CoverAssetID = coverID.String
	}

	return &p, nil
}

// GetActiveStories fetches live sessions for the story circles
func (r *ADDiscoveryRepository) GetActiveStories(ctx context.Context, viewerID string) ([]models.ADLiveSession, error) {
	query := `
		SELECT ls.id::text, COALESCE(pp.id::text, ls.creator_id::text), ls.creator_id::text,
			COALESCE(NULLIF(BTRIM(pp.display_name), ''), NULLIF(BTRIM(pp.username), ''), NULLIF(BTRIM(up.display_name), ''), NULLIF(BTRIM(u.username), ''), 'Creator'),
			COALESCE(NULLIF(BTRIM(pp.username), ''), NULLIF(BTRIM(u.username), ''), ''), COALESCE(avatar.storage_key, ''),
			ls.status, ls.price_cents, COALESCE(pp.subscription_price_cents, 0),
			ls.started_at, ls.ended_at
		FROM ad_live_sessions ls
		JOIN users u ON u.id = ls.creator_id
		LEFT JOIN performer_profiles pp ON pp.user_id = ls.creator_id
		LEFT JOIN user_profiles up ON up.user_id = ls.creator_id
		LEFT JOIN ad_assets avatar ON avatar.id = pp.avatar_asset_id
		WHERE ls.status = 'live'
		  AND (
			NOT EXISTS (
				SELECT 1 FROM user_locations viewer_location
				WHERE viewer_location.user_id = $1::uuid AND viewer_location.country_code IS NOT NULL
			)
			OR COALESCE((SELECT global_mode FROM user_settings WHERE user_id = $1::uuid), FALSE)
			OR COALESCE((SELECT global_mode FROM user_settings WHERE user_id = ls.creator_id), FALSE)
			OR EXISTS (
				SELECT 1 FROM user_locations viewer_location
				JOIN user_locations creator_location
				  ON creator_location.country_code = viewer_location.country_code
				WHERE viewer_location.user_id = $1::uuid
				  AND creator_location.user_id = ls.creator_id
			)
		  )
		ORDER BY ls.started_at DESC
	`
	rows, err := r.DB.QueryContext(ctx, query, viewerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stories []models.ADLiveSession
	for rows.Next() {
		var s models.ADLiveSession
		var endedAt sql.NullTime
		if err := rows.Scan(
			&s.ID, &s.CreatorID, &s.HostID, &s.DisplayName, &s.Username, &s.AvatarURL,
			&s.Status, &s.PriceCents, &s.SubscriptionPriceCents, &s.StartedAt, &endedAt,
		); err != nil {
			return nil, fmt.Errorf("scan active live session: %w", err)
		}
		if endedAt.Valid {
			s.EndedAt = &endedAt.Time
		}
		stories = append(stories, s)
	}
	if stories == nil {
		stories = []models.ADLiveSession{}
	}
	return stories, rows.Err()
}

func (r *ADDiscoveryRepository) ToggleFollow(ctx context.Context, followerID string, creatorID string) (bool, error) {
	var creatorUserID string
	err := r.DB.QueryRowContext(ctx, `
		SELECT user_id::text FROM performer_profiles
		WHERE id::text = $1 AND status = 'active'
	`, creatorID).Scan(&creatorUserID)
	if err != nil {
		return false, err
	}
	if followerID == creatorUserID {
		return false, fmt.Errorf("cannot follow yourself")
	}

	var exists bool
	err = r.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM ad_follows WHERE follower_id = $1 AND creator_id = $2)`, followerID, creatorUserID).Scan(&exists)
	if err != nil {
		return false, err
	}

	if exists {
		_, err = r.DB.ExecContext(ctx, `DELETE FROM ad_follows WHERE follower_id = $1 AND creator_id = $2`, followerID, creatorUserID)
		return false, err
	}

	_, err = r.DB.ExecContext(ctx, `INSERT INTO ad_follows (follower_id, creator_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, followerID, creatorUserID)
	return true, err
}

// CreateShareLink generates an expiring link record in the database
func (r *ADDiscoveryRepository) CreateShareLink(ctx context.Context, linkID string, userID string, targetType string, targetID string) error {
	query := `
		INSERT INTO ad_share_links (id, user_id, target_type, target_id, expires_at) 
		VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '7 days')
	`
	_, err := r.DB.ExecContext(ctx, query, linkID, userID, targetType, targetID)
	return err
}
