package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"chattie-backend/models"
)

type AIChatRepository struct {
	DB *sql.DB
}

type AIReplyJob struct {
	ID              string
	UserID          string
	PartnerID       string
	SourceMessageID string
	Attempts        int
}

func NewAIChatRepository(db *sql.DB) *AIChatRepository {
	return &AIChatRepository{DB: db}
}

func (r *AIChatRepository) GetAutoReplyEnabled(ctx context.Context, userID, partnerID string) (bool, error) {
	var enabled bool
	err := r.DB.QueryRowContext(ctx, `
		SELECT auto_reply_enabled
		FROM ai_dm_preferences
		WHERE user_id = $1 AND partner_id = $2
	`, userID, partnerID).Scan(&enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return enabled, err
}

func (r *AIChatRepository) SetAutoReplyEnabled(ctx context.Context, userID, partnerID string, enabled bool) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin auto-reply preference update: %w", err)
	}
	defer tx.Rollback()

	var hasConversation bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM messages
			WHERE (sender_id = $1 AND recipient_id = $2)
			   OR (sender_id = $2 AND recipient_id = $1)
		)
	`, userID, partnerID).Scan(&hasConversation); err != nil {
		return fmt.Errorf("validate auto-reply conversation: %w", err)
	}
	if !hasConversation {
		return sql.ErrNoRows
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ai_dm_preferences (user_id, partner_id, auto_reply_enabled, updated_at)
		VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
		ON CONFLICT (user_id, partner_id) DO UPDATE
		SET auto_reply_enabled = EXCLUDED.auto_reply_enabled,
		    updated_at = CURRENT_TIMESTAMP
	`, userID, partnerID, enabled); err != nil {
		return fmt.Errorf("save auto-reply preference: %w", err)
	}

	if !enabled {
		if _, err := tx.ExecContext(ctx, `
			UPDATE ai_auto_reply_jobs
			SET status = 'cancelled'
			WHERE user_id = $1 AND partner_id = $2
			  AND status IN ('pending', 'processing')
		`, userID, partnerID); err != nil {
			return fmt.Errorf("cancel auto-reply jobs: %w", err)
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO ai_auto_reply_jobs (user_id, partner_id, source_message_id, due_at)
			SELECT $1, $2, latest.id,
			       GREATEST(latest.created_at + INTERVAL '5 hours', CURRENT_TIMESTAMP)
			FROM (
				SELECT id, sender_id, created_at, is_ai_generated
				FROM messages
				WHERE (sender_id = $1 AND recipient_id = $2)
				   OR (sender_id = $2 AND recipient_id = $1)
				ORDER BY created_at DESC, id DESC
				LIMIT 1
			) latest
			WHERE latest.sender_id = $2
			  AND latest.is_ai_generated = FALSE
			ON CONFLICT (user_id, partner_id, source_message_id) DO NOTHING
		`, userID, partnerID); err != nil {
			return fmt.Errorf("schedule an existing unanswered message: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit auto-reply preference: %w", err)
	}
	return nil
}

func (r *AIChatRepository) ClaimDueReplies(ctx context.Context, limit int) ([]AIReplyJob, error) {
	if limit < 1 || limit > 50 {
		return nil, errors.New("auto-reply batch size is invalid")
	}
	if _, err := r.DB.ExecContext(ctx, `
		UPDATE ai_auto_reply_jobs
		SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
		    claimed_at = NULL
		WHERE status = 'processing'
		  AND claimed_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'
	`); err != nil {
		return nil, fmt.Errorf("recover stale auto-reply jobs: %w", err)
	}

	rows, err := r.DB.QueryContext(ctx, `
		WITH candidates AS (
			SELECT job.id
			FROM ai_auto_reply_jobs job
			JOIN ai_dm_preferences preference
			  ON preference.user_id = job.user_id
			 AND preference.partner_id = job.partner_id
			 AND preference.auto_reply_enabled = TRUE
			WHERE job.status = 'pending'
			  AND job.due_at <= CURRENT_TIMESTAMP
			ORDER BY job.due_at, job.created_at
			LIMIT $1
			FOR UPDATE OF job SKIP LOCKED
		)
		UPDATE ai_auto_reply_jobs job
		SET status = 'processing',
		    attempts = job.attempts + 1,
		    claimed_at = CURRENT_TIMESTAMP
		FROM candidates
		WHERE job.id = candidates.id
		RETURNING job.id::text, job.user_id::text, job.partner_id::text,
		          job.source_message_id::text, job.attempts
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("claim due auto-reply jobs: %w", err)
	}
	defer rows.Close()

	var jobs []AIReplyJob
	for rows.Next() {
		var job AIReplyJob
		if err := rows.Scan(&job.ID, &job.UserID, &job.PartnerID, &job.SourceMessageID, &job.Attempts); err != nil {
			return nil, fmt.Errorf("read claimed auto-reply job: %w", err)
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate claimed auto-reply jobs: %w", err)
	}
	return jobs, nil
}

func (r *AIChatRepository) SetReplyJobStatus(ctx context.Context, jobID, status string) error {
	switch status {
	case "pending", "sent", "cancelled", "failed":
	default:
		return errors.New("auto-reply job status is invalid")
	}
	result, err := r.DB.ExecContext(ctx, `
		UPDATE ai_auto_reply_jobs
		SET status = $2,
		    claimed_at = NULL
		WHERE id = $1 AND status = 'processing'
	`, jobID, status)
	if err != nil {
		return fmt.Errorf("update auto-reply job status: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check auto-reply job update: %w", err)
	}
	if rowsAffected != 1 {
		return errors.New("auto-reply job is no longer processing")
	}
	return nil
}

func (r *AIChatRepository) SaveGeneratedReply(ctx context.Context, job AIReplyJob, content string) (*models.Message, bool, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, fmt.Errorf("begin AI reply transaction: %w", err)
	}
	defer tx.Rollback()

	var status string
	var enabled bool
	err = tx.QueryRowContext(ctx, `
		SELECT job.status, preference.auto_reply_enabled
		FROM ai_auto_reply_jobs job
		JOIN ai_dm_preferences preference
		  ON preference.user_id = job.user_id
		 AND preference.partner_id = job.partner_id
		WHERE job.id = $1
		FOR UPDATE OF job
	`, job.ID).Scan(&status, &enabled)
	if err != nil {
		return nil, false, fmt.Errorf("validate AI reply job: %w", err)
	}
	if status != "processing" || !enabled {
		if status == "processing" {
			if _, err := tx.ExecContext(ctx, `UPDATE ai_auto_reply_jobs SET status = 'cancelled', claimed_at = NULL WHERE id = $1`, job.ID); err != nil {
				return nil, false, fmt.Errorf("cancel disabled AI reply job: %w", err)
			}
		}
		if err := tx.Commit(); err != nil {
			return nil, false, fmt.Errorf("commit cancelled AI reply job: %w", err)
		}
		return nil, false, nil
	}

	var latestMessageID string
	var latestSenderID string
	err = tx.QueryRowContext(ctx, `
		SELECT id::text, sender_id::text
		FROM messages
		WHERE (sender_id = $1 AND recipient_id = $2)
		   OR (sender_id = $2 AND recipient_id = $1)
		ORDER BY created_at DESC, id DESC
		LIMIT 1
	`, job.UserID, job.PartnerID).Scan(&latestMessageID, &latestSenderID)
	if err != nil {
		return nil, false, fmt.Errorf("recheck latest message before AI reply: %w", err)
	}
	if latestMessageID != job.SourceMessageID || latestSenderID != job.PartnerID {
		if _, err := tx.ExecContext(ctx, `UPDATE ai_auto_reply_jobs SET status = 'cancelled', claimed_at = NULL WHERE id = $1`, job.ID); err != nil {
			return nil, false, fmt.Errorf("cancel stale AI reply job: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return nil, false, fmt.Errorf("commit stale AI reply job: %w", err)
		}
		return nil, false, nil
	}

	message := &models.Message{
		SenderID:       job.UserID,
		RecipientID:    job.PartnerID,
		Content:        content,
		Status:         "sent",
		MessageKind:    "chat",
		IsAIGenerated: true,
		Type:           "chat",
	}
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO messages (sender_id, recipient_id, content, status, message_kind, is_ai_generated)
		VALUES ($1, $2, $3, 'sent', 'chat', TRUE)
		RETURNING id::text, created_at
	`, message.SenderID, message.RecipientID, message.Content).Scan(&message.ID, &message.CreatedAt); err != nil {
		return nil, false, fmt.Errorf("save generated chat reply: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE ai_auto_reply_jobs
		SET status = 'sent', claimed_at = NULL
		WHERE id = $1 AND status = 'processing'
	`, job.ID); err != nil {
		return nil, false, fmt.Errorf("complete AI reply job: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, false, fmt.Errorf("commit generated AI reply: %w", err)
	}
	return message, true, nil
}
