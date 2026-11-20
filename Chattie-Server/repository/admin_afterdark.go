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

type AfterDarkSafetyInput struct {
	ID       string
	Caption  string
	Explicit bool
	Status   string
	Asset    string
}

func (r *AdminRepository) ListAfterDarkPosts(ctx context.Context, status string, limit, offset int) ([]models.AdminAfterDarkPost, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT p.id::text, p.creator_id::text, COALESCE(u.username, u.email, 'Deleted creator'),
		       COALESCE(p.caption, ''), p.status, p.access_type, p.price_cents, p.is_explicit,
		       a.status, a.moderation_status, a.mime_type,
		       COALESCE(report_counts.pending_count, 0)::int,
		       p.ai_safety_score, COALESCE(p.ai_safety_reason, ''), p.ai_safety_scored_at,
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
		var safetyScore sql.NullInt64
		var safetyScoredAt sql.NullTime
		if err := rows.Scan(
			&post.ID, &post.CreatorID, &post.CreatorName, &post.Caption, &post.Status,
			&post.AccessType, &post.PriceCents, &post.IsExplicit, &post.AssetStatus,
			&post.ModerationStatus, &post.MediaType, &post.PendingReportCount,
			&safetyScore, &post.AISafetyReason, &safetyScoredAt, &post.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan After Dark admin post: %w", err)
		}
		if safetyScore.Valid {
			score := int(safetyScore.Int64)
			post.AISafetyScore = &score
		}
		if safetyScoredAt.Valid {
			scoredAt := safetyScoredAt.Time
			post.AISafetyScoredAt = &scoredAt
		}
		posts = append(posts, post)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate After Dark admin posts: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close After Dark admin post rows: %w", err)
	}
	if len(posts) == 0 {
		return posts, nil
	}

	postIndexes := make(map[string]int, len(posts))
	args := make([]interface{}, len(posts))
	placeholders := make([]string, len(posts))
	for i := range posts {
		postIndexes[posts[i].ID] = i
		posts[i].Comments = make([]models.AdminAfterDarkComment, 0)
		args[i] = posts[i].ID
		placeholders[i] = fmt.Sprintf("$%d", i+1)
	}
	commentQuery := fmt.Sprintf(`
		SELECT post_id::text, id::text, author, content, created_at, comment_count
		FROM (
			SELECT c.post_id, c.id,
			       COALESCE(NULLIF(profile.display_name, ''), u.username, 'Deleted user') AS author,
			       c.content, c.created_at,
			       COUNT(*) OVER (PARTITION BY c.post_id)::int AS comment_count,
			       ROW_NUMBER() OVER (PARTITION BY c.post_id ORDER BY c.created_at DESC, c.id DESC) AS position
			FROM ad_post_comments c
			LEFT JOIN users u ON u.id = c.user_id
			LEFT JOIN user_profiles profile ON profile.user_id = c.user_id
			WHERE c.post_id IN (%s)
		) recent
		WHERE position <= 5
		ORDER BY post_id, created_at DESC, id DESC
	`, strings.Join(placeholders, ","))
	commentRows, err := r.DB.QueryContext(ctx, commentQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("list comments for After Dark admin posts: %w", err)
	}
	defer commentRows.Close()
	for commentRows.Next() {
		var postID string
		var comment models.AdminAfterDarkComment
		var commentCount int
		if err := commentRows.Scan(&postID, &comment.ID, &comment.Author, &comment.Content, &comment.CreatedAt, &commentCount); err != nil {
			return nil, fmt.Errorf("scan After Dark admin post comment: %w", err)
		}
		if index, exists := postIndexes[postID]; exists {
			posts[index].Comments = append(posts[index].Comments, comment)
			posts[index].CommentsCount = commentCount
		}
	}
	if err := commentRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate After Dark admin post comments: %w", err)
	}
	return posts, nil
}

func (r *AdminRepository) GetAfterDarkSafetyInput(ctx context.Context, postID string) (*AfterDarkSafetyInput, error) {
	var input AfterDarkSafetyInput
	err := r.DB.QueryRowContext(ctx, `
		SELECT p.id::text, COALESCE(p.caption, ''), p.is_explicit, p.status, a.status
		FROM ad_posts p
		JOIN ad_assets a ON a.id = p.asset_id
		WHERE p.id = $1 AND p.status IN ('draft', 'processing') AND a.status = 'ready'
	`, postID).Scan(&input.ID, &input.Caption, &input.Explicit, &input.Status, &input.Asset)
	if err != nil {
		return nil, err
	}
	return &input, nil
}

func (r *AdminRepository) SaveAfterDarkSafetyAssessment(ctx context.Context, postID string, score int, reason string) error {
	result, err := r.DB.ExecContext(ctx, `
		UPDATE ad_posts p
		SET ai_safety_score = $2, ai_safety_reason = $3, ai_safety_scored_at = CURRENT_TIMESTAMP
		FROM ad_assets a
		WHERE p.id = $1 AND p.asset_id = a.id
		  AND p.status IN ('draft', 'processing')
		  AND a.status = 'ready'
	`, postID, score, strings.TrimSpace(reason))
	if err != nil {
		return fmt.Errorf("save After Dark safety assessment: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check After Dark safety assessment update: %w", err)
	}
	if updated != 1 {
		return ErrAdminAfterDarkPostUnavailable
	}
	return nil
}

func (r *AdminRepository) AutoApproveSafeAfterDarkPosts(ctx context.Context, adminID string) ([]string, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin AI-assisted After Dark approval: %w", err)
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
		SELECT p.id::text, p.creator_id::text
		FROM ad_posts p
		JOIN ad_assets a ON a.id = p.asset_id
		JOIN users creator ON creator.id = p.creator_id
		WHERE p.status IN ('draft', 'processing')
		  AND p.ai_safety_score >= 80
		  AND p.ai_safety_scored_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
		  AND p.is_explicit = FALSE
		  AND a.status = 'ready'
		  AND a.moderation_status = 'pending'
		  AND LOWER(creator.status) IN ('active', 'online')
		  AND NOT EXISTS (
		      SELECT 1 FROM ad_reports report
		      WHERE report.target_type = 'post' AND report.target_id = p.id
		        AND report.status IN ('pending', 'reviewed')
		  )
		  AND NOT EXISTS (
		      SELECT 1 FROM ad_post_comments comment
		      JOIN ad_reports report ON report.target_type = 'comment'
		                           AND report.target_id = comment.id
		      WHERE comment.post_id = p.id AND report.status IN ('pending', 'reviewed')
		  )
		ORDER BY p.ai_safety_score DESC, p.created_at
		FOR UPDATE OF p, a SKIP LOCKED
	`)
	if err != nil {
		return nil, fmt.Errorf("find eligible AI-reviewed After Dark posts: %w", err)
	}
	type candidate struct{ id, creatorID string }
	candidates := make([]candidate, 0)
	for rows.Next() {
		var item candidate
		if err := rows.Scan(&item.id, &item.creatorID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan eligible AI-reviewed After Dark post: %w", err)
		}
		candidates = append(candidates, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate eligible AI-reviewed After Dark posts: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close eligible AI-reviewed After Dark posts: %w", err)
	}

	approved := make([]string, 0, len(candidates))
	for _, item := range candidates {
		if _, err := tx.ExecContext(ctx, `
			UPDATE ad_assets SET moderation_status = 'approved'
			WHERE id = (SELECT asset_id FROM ad_posts WHERE id = $1)
		`, item.id); err != nil {
			return nil, fmt.Errorf("approve AI-reviewed After Dark asset %s: %w", item.id, err)
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE ad_posts SET status = 'published', updated_at = CURRENT_TIMESTAMP
			WHERE id = $1 AND status IN ('draft', 'processing')
		`, item.id); err != nil {
			return nil, fmt.Errorf("publish AI-reviewed After Dark post %s: %w", item.id, err)
		}
		reason := "AI safe-confidence score >= 80; caption-only assessment; clear moderation queue; non-explicit content"
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO admin_audit_logs (admin_id, action, target_id, reason)
			VALUES ($1, 'AFTER_DARK_AI_AUTO_APPROVE', $2, $3)
		`, adminID, item.creatorID, fmt.Sprintf("Post %s: %s", item.id, reason)); err != nil {
			return nil, fmt.Errorf("audit AI-reviewed After Dark post %s: %w", item.id, err)
		}
		approved = append(approved, item.id)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit AI-assisted After Dark approval: %w", err)
	}
	return approved, nil
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
