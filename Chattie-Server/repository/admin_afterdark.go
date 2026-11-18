package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"chattie-backend/models"
)

var (
	ErrAdminAfterDarkPostUnavailable = errors.New("After Dark post unavailable for moderation")
	ErrAdminAfterDarkAssetNotReady   = errors.New("After Dark post asset is not ready")
)

func (r *AdminRepository) ListAfterDarkPosts(ctx context.Context, status string, limit, offset int) ([]models.AdminAfterDarkPost, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT p.id::text, p.creator_id::text, COALESCE(u.username, u.email, 'Deleted creator'),
		       COALESCE(p.caption, ''), p.status, p.access_type, p.price_cents, p.is_explicit,
		       a.status, a.moderation_status, a.mime_type,
		       COALESCE(report_counts.pending_count, 0)::int,
		       p.created_at
		FROM ad_posts p
		JOIN ad_assets a ON a.id = p.asset_id
		LEFT JOIN users u ON u.id = p.creator_id
		LEFT JOIN (
			SELECT target_id, COUNT(*) AS pending_count
			FROM ad_reports
			WHERE target_type = 'post' AND status = 'pending'
			GROUP BY target_id
		) report_counts ON report_counts.target_id = p.id
		WHERE ($1 = 'all' OR p.status = $1)
		ORDER BY
			COALESCE(report_counts.pending_count, 0) DESC,
			CASE WHEN p.status IN ('published', 'scheduled') THEN 1 ELSE 0 END,
			p.created_at DESC
		LIMIT $2 OFFSET $3
	`, status, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list After Dark posts for admin: %w", err)
	}
	defer rows.Close()

	posts := make([]models.AdminAfterDarkPost, 0)
	for rows.Next() {
		var post models.AdminAfterDarkPost
		if err := rows.Scan(
			&post.ID, &post.CreatorID, &post.CreatorName, &post.Caption, &post.Status,
			&post.AccessType, &post.PriceCents, &post.IsExplicit, &post.AssetStatus,
			&post.ModerationStatus, &post.MediaType, &post.PendingReportCount, &post.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan After Dark admin post: %w", err)
		}
		posts = append(posts, post)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate After Dark admin posts: %w", err)
	}
	return posts, nil
}

func (r *AdminRepository) GetAfterDarkPostAsset(ctx context.Context, postID string) (*models.ADAsset, error) {
	var asset models.ADAsset
	err := r.DB.QueryRowContext(ctx, `
		SELECT a.id::text, a.owner_id::text, a.storage_key, a.mime_type,
		       a.size_bytes, a.status, a.moderation_status, a.created_at
		FROM ad_posts p
		JOIN ad_assets a ON a.id = p.asset_id
		WHERE p.id = $1 AND p.status <> 'deleted' AND a.status = 'ready'
	`, postID).Scan(
		&asset.ID, &asset.OwnerID, &asset.StorageKey, &asset.MimeType,
		&asset.SizeBytes, &asset.Status, &asset.ModerationStatus, &asset.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &asset, nil
}

func (r *AdminRepository) ModerateAfterDarkPost(ctx context.Context, adminID, postID, action, reason string) error {
	action = strings.ToLower(strings.TrimSpace(action))
	if action != "approve" && action != "reject" {
		return fmt.Errorf("unsupported After Dark post moderation action")
	}
	if strings.TrimSpace(reason) == "" {
		return fmt.Errorf("moderation reason is required")
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin After Dark post moderation: %w", err)
	}
	defer tx.Rollback()

	var creatorID, status, assetStatus string
	err = tx.QueryRowContext(ctx, `
		SELECT p.creator_id::text, p.status, a.status
		FROM ad_posts p
		JOIN ad_assets a ON a.id = p.asset_id
		WHERE p.id = $1
		FOR UPDATE OF p, a
	`, postID).Scan(&creatorID, &status, &assetStatus)
	if errors.Is(err, sql.ErrNoRows) || status == "deleted" {
		return ErrAdminAfterDarkPostUnavailable
	}
	if err != nil {
		return fmt.Errorf("load After Dark post for moderation: %w", err)
	}

	if action == "approve" {
		if assetStatus != "ready" {
			return ErrAdminAfterDarkAssetNotReady
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE ad_assets SET moderation_status = 'approved'
			WHERE id = (SELECT asset_id FROM ad_posts WHERE id = $1)
		`, postID); err != nil {
			return fmt.Errorf("approve After Dark post asset: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE ad_posts SET status = 'published', updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, postID); err != nil {
			return fmt.Errorf("publish approved After Dark post: %w", err)
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
			UPDATE ad_assets SET moderation_status = 'flagged'
			WHERE id = (SELECT asset_id FROM ad_posts WHERE id = $1)
		`, postID); err != nil {
			return fmt.Errorf("flag After Dark post asset: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE ad_posts SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, postID); err != nil {
			return fmt.Errorf("reject After Dark post: %w", err)
		}
	}
	reportStatus := "dismissed"
	if action == "reject" {
		reportStatus = "resolved"
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE ad_reports
		SET status = $3, reviewer_id = $1, updated_at = CURRENT_TIMESTAMP
		WHERE target_type = 'post' AND target_id = $2 AND status = 'pending'
	`, adminID, postID, reportStatus); err != nil {
		return fmt.Errorf("resolve pending After Dark post reports: %w", err)
	}

	auditReason := fmt.Sprintf("After Dark post %s: %s", postID, strings.TrimSpace(reason))
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO admin_audit_logs (admin_id, action, target_id, reason)
		VALUES ($1, $2, $3, $4)
	`, adminID, "AFTER_DARK_POST_"+strings.ToUpper(action), creatorID, auditReason); err != nil {
		return fmt.Errorf("audit After Dark post moderation: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit After Dark post moderation: %w", err)
	}
	return nil
}
