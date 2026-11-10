package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

type EmailTemplate struct {
	Name     string
	Subject  string
	BodyHTML string
}

type EmailJob struct {
	ID          string
	ToEmail     string
	Subject     string
	BodyHTML    string
	Attachments map[string][]byte
	Attempts    int
}

// GetEmailTemplateByName fetches the template from the database using Context
func (r *Repository) GetEmailTemplateByName(ctx context.Context, name string) (*EmailTemplate, error) {
	query := `SELECT name, subject, body_html FROM email_templates WHERE name = $1`

	var tmpl EmailTemplate
	err := r.DB.QueryRowContext(ctx, query, name).Scan(&tmpl.Name, &tmpl.Subject, &tmpl.BodyHTML)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("template not found")
		}
		return nil, err
	}

	return &tmpl, nil
}

// EnqueueEmailJob safely pushes an email to the queue
func (r *Repository) EnqueueEmailJob(ctx context.Context, job *EmailJob) error {
	attachments, err := json.Marshal(job.Attachments)
	if err != nil {
		return err
	}

	_, err = r.DB.ExecContext(ctx, `
       INSERT INTO email_jobs (to_email, subject, body_html, attachments, status, next_attempt_at)
       VALUES ($1, $2, $3, $4, 'pending', CURRENT_TIMESTAMP)`,
		job.ToEmail, job.Subject, job.BodyHTML, attachments)
	return err
}

// ClaimEmailJobs locks and returns pending jobs. Returns pointers to match the worker loop.
func (r *Repository) ClaimEmailJobs(ctx context.Context, limit int) ([]*EmailJob, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
       WITH available AS (
          SELECT id FROM email_jobs
          WHERE (status = 'pending' OR (status = 'processing' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'))
            AND next_attempt_at <= CURRENT_TIMESTAMP
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE email_jobs j
       SET status = 'processing', attempts = j.attempts + 1, updated_at = CURRENT_TIMESTAMP
       FROM available
       WHERE j.id = available.id
       RETURNING j.id, j.to_email, j.subject, j.body_html, j.attachments, j.attempts`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []*EmailJob
	for rows.Next() {
		job := &EmailJob{}
		var attachments []byte
		if err := rows.Scan(&job.ID, &job.ToEmail, &job.Subject, &job.BodyHTML, &attachments, &job.Attempts); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(attachments, &job.Attachments); err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return jobs, nil
}

// CompleteEmailJob marks the job as successfully sent
func (r *Repository) CompleteEmailJob(ctx context.Context, id string) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE email_jobs 
		SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
		WHERE id = $1`, id)
	return err
}

// FailEmailJob applies an exponential backoff using integer minutes directly in the DB
func (r *Repository) FailEmailJob(ctx context.Context, id string, attempts int, deliveryErr error) error {
	status := "pending"
	if attempts >= 8 {
		status = "failed"
	}

	// 1, 2, 4, 8, 16, 32, 64 minutes max delay
	delayMinutes := 1 << min(attempts, 6)

	_, err := r.DB.ExecContext(ctx, `
       UPDATE email_jobs
       SET status = $2, 
           last_error = $3, 
           next_attempt_at = CURRENT_TIMESTAMP + ($4 * INTERVAL '1 minute'), 
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`, id, status, deliveryErr.Error(), delayMinutes)

	return err
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
