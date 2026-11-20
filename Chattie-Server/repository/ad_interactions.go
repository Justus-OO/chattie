package repository

import (
	"chattie-backend/models"
	"context"
	"database/sql"
)

type ADInteractionsRepository struct {
	DB *sql.DB
}

func NewADInteractionsRepository(db *sql.DB) *ADInteractionsRepository {
	return &ADInteractionsRepository{DB: db}
}

// ToggleLike adds or removes a like idempotently and returns the current like status
func (r *ADInteractionsRepository) ToggleLike(ctx context.Context, userID string, postID string) (bool, error) {
	// First, check if the like exists
	var exists bool
	err := r.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM ad_post_likes WHERE user_id = $1 AND post_id = $2)`, userID, postID).Scan(&exists)
	if err != nil {
		return false, err
	}

	if exists {
		// Unlike
		_, err = r.DB.ExecContext(ctx, `DELETE FROM ad_post_likes WHERE user_id = $1 AND post_id = $2`, userID, postID)
		return false, err
	} else {
		// Like
		_, err = r.DB.ExecContext(ctx, `INSERT INTO ad_post_likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, userID, postID)
		return true, err
	}
}

// AddComment inserts a new comment
func (r *ADInteractionsRepository) AddComment(ctx context.Context, comment *models.ADComment) error {
	query := `
		INSERT INTO ad_post_comments (id, user_id, post_id, content, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`
	_, err := r.DB.ExecContext(ctx, query,
		comment.ID, comment.UserID, comment.PostID, comment.Content, comment.CreatedAt, comment.UpdatedAt,
	)
	return err
}

// GetComments fetches paginated comments for a post
func (r *ADInteractionsRepository) GetComments(ctx context.Context, postID string, limit int, offset int) ([]models.ADComment, error) {
	query := `
		SELECT id::text, user_id::text, post_id::text, content, created_at, updated_at
		FROM ad_post_comments
		WHERE post_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT $2 OFFSET $3
	`
	rows, err := r.DB.QueryContext(ctx, query, postID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var comments []models.ADComment
	for rows.Next() {
		var c models.ADComment
		if err := rows.Scan(&c.ID, &c.UserID, &c.PostID, &c.Content, &c.CreatedAt, &c.UpdatedAt); err != nil {
			continue
		}
		comments = append(comments, c)
	}

	if comments == nil {
		comments = []models.ADComment{}
	}
	return comments, nil
}

// SubmitReport creates a new reviewable moderation report
func (r *ADInteractionsRepository) SubmitReport(ctx context.Context, report *models.ADReport) error {
	query := `
		INSERT INTO ad_reports (id, reporter_id, target_type, target_id, reason, details, status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	_, err := r.DB.ExecContext(ctx, query,
		report.ID, report.ReporterID, report.TargetType, report.TargetID,
		report.Reason, report.Details, report.Status, report.CreatedAt,
	)
	return err
}
