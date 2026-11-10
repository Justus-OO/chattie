package repository

import (
	"chattie-backend/models"
	"context"
	"database/sql"
	"errors"
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
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_assets (id, owner_id, storage_key, mime_type, size_bytes, status, moderation_status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, asset.ID, asset.OwnerID, asset.StorageKey, asset.MimeType, asset.SizeBytes, asset.Status, asset.ModerationStatus, asset.CreatedAt); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_posts (id, creator_id, asset_id, caption, access_type, price_cents, is_explicit, status, publish_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, post.ID, post.CreatorID, post.AssetID, post.Caption, post.AccessType, post.PriceCents,
		post.IsExplicit, post.Status, post.PublishAt, post.CreatedAt, post.UpdatedAt); err != nil {
		return err
	}
	return tx.Commit()
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

func (r *ADMediaRepository) GetAuthorizedPostAsset(ctx context.Context, userID string, postID string) (*models.ADAsset, error) {
	var asset models.ADAsset
	err := r.DB.QueryRowContext(ctx, `
		SELECT a.id::text, a.owner_id::text, a.storage_key, a.mime_type,
			a.size_bytes, a.status, a.moderation_status, a.created_at
		FROM ad_posts p
		JOIN ad_assets a ON a.id = p.asset_id
		WHERE p.id = $1
		  AND p.status = 'published'
		  AND (p.publish_at IS NULL OR p.publish_at <= CURRENT_TIMESTAMP)
		  AND a.status = 'ready'
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
	`, postID, userID).Scan(
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
