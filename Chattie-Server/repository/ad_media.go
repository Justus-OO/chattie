package repository

import (
	"chattie-backend/models"
	"context"
	"database/sql"
	"errors"
	"fmt"
)

type ADMediaRepository struct {
	DB *sql.DB
}

func NewADMediaRepository(db *sql.DB) *ADMediaRepository {
	return &ADMediaRepository{DB: db}
}

// CreateAsset registers a new private file in the database
func (r *ADMediaRepository) CreateAsset(ctx context.Context, asset *models.ADAsset) error {
	query := `
		INSERT INTO ad_assets (id, owner_id, storage_key, mime_type, size_bytes, status, moderation_status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	_, err := r.DB.ExecContext(ctx, query,
		asset.ID, asset.OwnerID, asset.StorageKey, asset.MimeType,
		asset.SizeBytes, asset.Status, asset.ModerationStatus, asset.CreatedAt,
	)
	return err
}

func (r *ADMediaRepository) CreateCreatorImage(ctx context.Context, asset *models.ADAsset, kind string) error {
	var column string
	switch kind {
	case "avatar":
		column = "avatar_asset_id"
	case "cover":
		column = "cover_asset_id"
	default:
		return errors.New("unsupported creator image type")
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO ad_assets (id, owner_id, storage_key, mime_type, size_bytes, status, moderation_status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, asset.ID, asset.OwnerID, asset.StorageKey, asset.MimeType, asset.SizeBytes, asset.Status, asset.ModerationStatus, asset.CreatedAt)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx,
		`UPDATE performer_profiles SET `+column+` = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
		asset.ID, asset.OwnerID,
	)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}

// CreatePost creates a new locked/free post entry in the vault
func (r *ADMediaRepository) CreatePost(ctx context.Context, post *models.ADPost) error {
	query := `
		INSERT INTO ad_posts (id, creator_id, asset_id, caption, access_type, price_cents, is_explicit, status, publish_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`
	_, err := r.DB.ExecContext(ctx, query,
		post.ID, post.CreatorID, post.AssetID, post.Caption, post.AccessType,
		post.PriceCents, post.IsExplicit, post.Status, post.PublishAt, post.CreatedAt, post.UpdatedAt,
	)
	return err
}

func (r *ADMediaRepository) CreatePostWithAsset(ctx context.Context, asset *models.ADAsset, post *models.ADPost) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin post transaction: %w", err)
	}
	defer tx.Rollback()
	var autoApprove bool
	if err := tx.QueryRowContext(ctx, `
		SELECT auto_approve_new_posts
		FROM ad_afterdark_moderation_settings
		WHERE id = 1
	`).Scan(&autoApprove); err != nil {
		return fmt.Errorf("load After Dark auto-moderation setting: %w", err)
	}
	if autoApprove {
		asset.ModerationStatus = "approved"
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_assets (id, owner_id, storage_key, mime_type, size_bytes, status, moderation_status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, asset.ID, asset.OwnerID, asset.StorageKey, asset.MimeType, asset.SizeBytes, asset.Status, asset.ModerationStatus, asset.CreatedAt); err != nil {
		return fmt.Errorf("insert post asset: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_posts (id, creator_id, asset_id, caption, access_type, price_cents, is_explicit, status, publish_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, post.ID, post.CreatorID, post.AssetID, post.Caption, post.AccessType, post.PriceCents,
		post.IsExplicit, post.Status, post.PublishAt, post.CreatedAt, post.UpdatedAt); err != nil {
		return fmt.Errorf("insert post: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit post transaction: %w", err)
	}
	return nil
}

func (r *ADMediaRepository) IsActiveCreator(ctx context.Context, userID string) (bool, error) {
	var active bool
	err := r.DB.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM performer_profiles
			WHERE user_id = $1 AND status = 'active'
		)
	`, userID).Scan(&active)
	return active, err
}

// GetVaultPosts fetches a creator's media vault for the 'My Channel' view
func (r *ADMediaRepository) GetVaultPosts(ctx context.Context, creatorID string, statusFilter string) ([]models.ADPost, error) {
	query := `
		SELECT 
			p.id::text, p.creator_id::text, p.asset_id::text, COALESCE(a.storage_key, ''),
			COALESCE(a.mime_type, ''), COALESCE(p.caption, ''),
			p.access_type, p.price_cents, p.is_explicit, p.status, p.publish_at, p.created_at, p.updated_at
		FROM ad_posts p
		JOIN ad_assets a ON a.id = p.asset_id
		WHERE p.creator_id = $1
	`
	args := []interface{}{creatorID}

	if statusFilter != "" && statusFilter != "all" {
		query += ` AND p.status = $2 `
		args = append(args, statusFilter)
	}

	query += ` ORDER BY p.created_at DESC `

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
			&post.ID, &post.CreatorID, &post.AssetID, &post.MediaURL, &post.MediaType, &post.Caption,
			&post.AccessType, &post.PriceCents, &post.IsExplicit, &post.Status,
			&publishAt, &post.CreatedAt, &post.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if publishAt.Valid {
			post.PublishAt = &publishAt.Time
		}
		posts = append(posts, post)
	}

	if posts == nil {
		posts = []models.ADPost{}
	}
	return posts, rows.Err()
}

func (r *ADMediaRepository) GetAuthorizedPostAsset(ctx context.Context, userID, viewerCountryCode, postID string) (*models.ADAsset, error) {
	var asset models.ADAsset
	err := r.DB.QueryRowContext(ctx, `
		SELECT a.id::text, a.owner_id::text, a.storage_key, a.mime_type,
			a.size_bytes, a.status, a.moderation_status, a.created_at
		FROM ad_posts p
		JOIN ad_assets a ON a.id = p.asset_id
		JOIN performer_profiles pp ON pp.user_id = p.creator_id
		WHERE p.id = $1
		  AND p.status = 'published'
		  AND (p.publish_at IS NULL OR p.publish_at <= CURRENT_TIMESTAMP)
		  AND a.status = 'ready'
		  AND a.moderation_status = 'approved'
		  AND pp.status = 'active'
		  AND COALESCE((
			SELECT s.discoverable FROM ad_creator_settings s
			WHERE s.user_id = p.creator_id
		  ), TRUE)
		  AND (NOT p.is_explicit OR COALESCE((
			SELECT s.show_explicit_content FROM ad_creator_settings s
			WHERE s.user_id = $2::uuid
		  ), FALSE))
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
				(NULLIF(BTRIM($3), '') IS NOT NULL AND UPPER(BTRIM(blocked_region.region)) = UPPER(BTRIM($3)))
				OR UPPER(BTRIM(blocked_region.region)) = UPPER(BTRIM(COALESCE((
					SELECT viewer_location.country FROM user_locations viewer_location
					WHERE viewer_location.user_id = $2::uuid
					LIMIT 1
				), '')))
				OR UPPER(BTRIM(blocked_region.region)) = UPPER(BTRIM(COALESCE((
					SELECT viewer_location.city FROM user_locations viewer_location
					WHERE viewer_location.user_id = $2::uuid
					LIMIT 1
				), '')))
			  )
		  )
		  AND (
			p.creator_id = $2
			OR p.access_type = 'free'
			OR (p.access_type = 'subscriber' AND EXISTS (
				SELECT 1 FROM ad_subscriptions s
				WHERE s.subscriber_id = $2 AND s.creator_id = p.creator_id
				  AND s.status = 'active' AND s.current_period_end > CURRENT_TIMESTAMP
			))
			OR (p.access_type = 'ppv' AND EXISTS (
				SELECT 1 FROM ad_post_entitlements e
				WHERE e.user_id = $2 AND e.post_id = p.id
			))
		  )
	`, postID, userID, viewerCountryCode).Scan(
		&asset.ID, &asset.OwnerID, &asset.StorageKey, &asset.MimeType,
		&asset.SizeBytes, &asset.Status, &asset.ModerationStatus, &asset.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &asset, nil
}

func (r *ADMediaRepository) UpdatePost(ctx context.Context, postID string, creatorID string, caption string, accessType string, priceCents int64) (*models.ADPost, error) {
	var post models.ADPost
	var publishAt sql.NullTime
	err := r.DB.QueryRowContext(ctx, `
		UPDATE ad_posts
		SET caption = $1, access_type = $2, price_cents = $3, updated_at = CURRENT_TIMESTAMP
		WHERE id = $4 AND creator_id = $5 AND status <> 'deleted'
		RETURNING id::text, creator_id::text, asset_id::text, COALESCE(caption, ''),
			access_type, price_cents, is_explicit, status, publish_at, created_at, updated_at
	`, caption, accessType, priceCents, postID, creatorID).Scan(
		&post.ID, &post.CreatorID, &post.AssetID, &post.Caption,
		&post.AccessType, &post.PriceCents, &post.IsExplicit, &post.Status,
		&publishAt, &post.CreatedAt, &post.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if publishAt.Valid {
		post.PublishAt = &publishAt.Time
	}
	err = r.DB.QueryRowContext(ctx, `
		SELECT storage_key, mime_type FROM ad_assets WHERE id = $1
	`, post.AssetID).Scan(&post.MediaURL, &post.MediaType)
	if err != nil {
		return nil, err
	}
	return &post, nil
}

// DeletePost soft-deletes or permanently removes a vault post
func (r *ADMediaRepository) DeletePost(ctx context.Context, postID string, creatorID string) error {
	// Updates status to deleted. A background worker should handle asset cleanup/refund policies.
	query := `UPDATE ad_posts SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND creator_id = $2`
	res, err := r.DB.ExecContext(ctx, query, postID, creatorID)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}
