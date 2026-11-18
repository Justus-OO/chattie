package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

var ErrOTPRequestRateLimited = errors.New("verification code request rate limited")

type SMSJob struct {
	ID          string
	PhoneNumber string
	Message     string
	Attempts    int
}

// GetSMSTemplate fetches the raw Go text/template string from the database
func (r *Repository) GetSMSTemplate(ctx context.Context, templateName string) (string, error) {
	var content string
	query := `SELECT template_content FROM sms_templates WHERE name = $1 AND is_active = true`

	err := r.DB.QueryRowContext(ctx, query, templateName).Scan(&content)
	if err == sql.ErrNoRows {
		return "", sql.ErrNoRows
	}
	return content, err
}

// EnqueueSMSJob inserts a pre-compiled SMS message into the delivery queue
func (r *Repository) EnqueueSMSJob(ctx context.Context, job *SMSJob) error {
	query := `
		INSERT INTO sms_queue (phone_number, message, status, attempts, created_at) 
		VALUES ($1, $2, 'pending', 0, CURRENT_TIMESTAMP)`

	_, err := r.DB.ExecContext(ctx, query, job.PhoneNumber, job.Message)
	return err
}

// ClaimSMSJobs atomically locks rows for the background worker
func (r *Repository) ClaimSMSJobs(ctx context.Context, limit int) ([]*SMSJob, error) {
	query := `
		UPDATE sms_queue 
		SET status = 'processing', updated_at = CURRENT_TIMESTAMP 
		WHERE id IN (
			SELECT id FROM sms_queue 
			WHERE status = 'pending' OR (status = 'failed' AND attempts < 3) 
			ORDER BY created_at ASC 
			FOR UPDATE SKIP LOCKED 
			LIMIT $1
		) 
		RETURNING id, phone_number, message, attempts`

	rows, err := r.DB.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []*SMSJob
	for rows.Next() {
		job := &SMSJob{}
		if err := rows.Scan(&job.ID, &job.PhoneNumber, &job.Message, &job.Attempts); err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	return jobs, nil
}

func (r *Repository) CompleteSMSJob(ctx context.Context, id string) error {
	_, err := r.DB.ExecContext(ctx, `UPDATE sms_queue SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id)
	return err
}

func (r *Repository) FailSMSJob(ctx context.Context, id string, attempts int, err error) error {
	_, dbErr := r.DB.ExecContext(ctx, `
		UPDATE sms_queue 
		SET status = 'failed', attempts = $1, error_log = $2, updated_at = CURRENT_TIMESTAMP 
		WHERE id = $3`, attempts+1, err.Error(), id)
	return dbErr
}

// SaveOTP stores the generated verification code securely.
func (r *Repository) SaveOTP(ctx context.Context, userID, code string, expiresAt time.Time) error {
	query := `
		INSERT INTO user_otps (user_id, code, expires_at) 
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id) 
		DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at, created_at = CURRENT_TIMESTAMP
		WHERE COALESCE(user_otps.created_at, '-infinity'::timestamptz)
			<= CURRENT_TIMESTAMP - INTERVAL '60 seconds'`

	result, err := r.DB.ExecContext(ctx, query, userID, code, expiresAt)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrOTPRequestRateLimited
	}
	return nil
}

// ValidateOTP checks if the provided code matches and hasn't expired.
func (r *Repository) ValidateOTP(ctx context.Context, userID, code string) (bool, error) {
	var verifiedUserID string
	err := r.DB.QueryRowContext(ctx, `
		WITH consumed AS (
			DELETE FROM user_otps
			WHERE user_id = $1 AND code = $2 AND expires_at > CURRENT_TIMESTAMP
			RETURNING user_id
		)
		UPDATE users
		SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
		    updated_at = CURRENT_TIMESTAMP
		FROM consumed
		WHERE users.id = consumed.user_id
		RETURNING users.id::text
	`, userID, code).Scan(&verifiedUserID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}
