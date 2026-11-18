package repository

import (
	"context"
	"errors"
	"strings"

	"chattie-backend/models"
)

var (
	ErrAccountNotRestricted = errors.New("account is not restricted")
	ErrReviewAlreadyPending = errors.New("an account review is already pending")
	ErrInvalidReviewReason  = errors.New("review reason must contain 20 to 2000 characters")
)

func (r *AdminRepository) GetAccountReview(ctx context.Context, userID string) (*models.AccountReviewRequest, error) {
	var review models.AccountReviewRequest
	err := r.DB.QueryRowContext(ctx, `
		SELECT id::text, user_id::text, reason, status,
		       TO_CHAR(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       COALESCE(reviewer_note, '')
		FROM account_review_requests
		WHERE user_id = $1
		ORDER BY submitted_at DESC
		LIMIT 1
	`, userID).Scan(&review.ID, &review.UserID, &review.Reason, &review.Status, &review.SubmittedAt, &review.ReviewerNote)
	if err != nil {
		return nil, err
	}
	return &review, nil
}

func (r *AdminRepository) CreateAccountReview(ctx context.Context, userID, reason string) (*models.AccountReviewRequest, error) {
	reason = strings.TrimSpace(reason)
	if len([]rune(reason)) < 20 || len([]rune(reason)) > 2000 {
		return nil, ErrInvalidReviewReason
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var status string
	if err := tx.QueryRowContext(ctx, `SELECT status FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&status); err != nil {
		return nil, err
	}
	if status != "banned" {
		return nil, ErrAccountNotRestricted
	}

	var pending bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM account_review_requests
			WHERE user_id = $1 AND status = 'pending'
		)
	`, userID).Scan(&pending); err != nil {
		return nil, err
	}
	if pending {
		return nil, ErrReviewAlreadyPending
	}

	var review models.AccountReviewRequest
	err = tx.QueryRowContext(ctx, `
		INSERT INTO account_review_requests (user_id, reason)
		VALUES ($1, $2)
		RETURNING id::text, user_id::text, reason, status,
		          TO_CHAR(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
	`, userID, reason).Scan(&review.ID, &review.UserID, &review.Reason, &review.Status, &review.SubmittedAt)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &review, nil
}

func (r *AdminRepository) GetPendingAccountReviews(ctx context.Context) ([]models.AccountReviewRequest, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT review.id::text, review.user_id::text, users.username, users.email,
		       review.reason, review.status,
		       TO_CHAR(review.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       COALESCE(review.reviewer_note, '')
		FROM account_review_requests review
		JOIN users ON users.id = review.user_id
		WHERE review.status = 'pending'
		ORDER BY review.submitted_at ASC
		LIMIT 100
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	reviews := make([]models.AccountReviewRequest, 0)
	for rows.Next() {
		var review models.AccountReviewRequest
		if err := rows.Scan(
			&review.ID, &review.UserID, &review.Username, &review.Email,
			&review.Reason, &review.Status, &review.SubmittedAt, &review.ReviewerNote,
		); err != nil {
			return nil, err
		}
		reviews = append(reviews, review)
	}
	return reviews, rows.Err()
}

func (r *AdminRepository) ResolveAccountReview(ctx context.Context, adminID, reviewID, decision, note string) (string, error) {
	var reviewStatus string
	switch decision {
	case "reinstate":
		reviewStatus = "reinstated"
	case "uphold":
		reviewStatus = "upheld"
	default:
		return "", errors.New("unsupported account review decision")
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	var userID string
	err = tx.QueryRowContext(ctx, `
		SELECT user_id::text
		FROM account_review_requests
		WHERE id = $1 AND status = 'pending'
		FOR UPDATE
	`, reviewID).Scan(&userID)
	if err != nil {
		return "", err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE account_review_requests
		SET status = $1, reviewed_at = CURRENT_TIMESTAMP,
		    reviewer_id = $2, reviewer_note = NULLIF($3, '')
		WHERE id = $4
	`, reviewStatus, adminID, strings.TrimSpace(note), reviewID); err != nil {
		return "", err
	}

	if decision == "reinstate" {
		result, err := tx.ExecContext(ctx, `
			UPDATE users
			SET status = 'active',
			    token_version = token_version + 1,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $1 AND status = 'banned'
		`, userID)
		if err != nil {
			return "", err
		}
		updated, err := result.RowsAffected()
		if err != nil {
			return "", err
		}
		if updated == 0 {
			return "", ErrAccountNotRestricted
		}
	}

	var adminUsername string
	if adminID == "" {
		adminUsername = "SYSTEM"
	} else if err := tx.QueryRowContext(ctx, `SELECT username FROM users WHERE id = $1`, adminID).Scan(&adminUsername); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO admin_audit_logs (admin_id, admin_username, action, target_id, reason)
		VALUES (NULLIF($1, '')::uuid, $2, $3, $4, $5)
	`, adminID, adminUsername, "ACCOUNT_REVIEW_"+strings.ToUpper(decision), userID, strings.TrimSpace(note)); err != nil {
		return "", err
	}
	message := "Your account appeal was reviewed and the restriction remains in place."
	if decision == "reinstate" {
		message = "Your account appeal was approved and your account has been reinstated."
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO notifications (user_id, event_type, title, message, icon, payload)
		VALUES ($1, 'ACCOUNT_REVIEW_RESOLVED', 'Account review completed', $2, 'shield-check',
		        jsonb_build_object('decision', $3, 'reviewerNote', $4))
	`, userID, message, decision, strings.TrimSpace(note)); err != nil {
		return "", err
	}

	if err := tx.Commit(); err != nil {
		return "", err
	}
	return userID, nil
}
