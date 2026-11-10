package repository

import (
	"encoding/json"
	"time"
)

// ActionJob represents a durable action log entry for retry
type ActionJob struct {
	ID         string
	UserID     string
	ActionType string
	TargetID   *string
	Metadata   map[string]interface{}
	IPAddress  string
	Attempts   int
}

// ExportJob represents a durable data export for retry
type ExportJob struct {
	ID          string
	UserID      string
	ExportType  string
	Status      string
	DownloadURL *string
	Attempts    int
}

// Helper to ensure compatibility with Go versions older than 1.21
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// EnqueueActionJob inserts an action into the durable queue
func (r *Repository) EnqueueActionJob(job *ActionJob) error {
	metaBytes, _ := json.Marshal(job.Metadata)

	_, err := r.DB.Exec(`
       INSERT INTO action_jobs (user_id, action_type, target_id, metadata, ip_address, status, next_attempt_at)
       VALUES ($1, $2, NULLIF($3, '')::uuid, NULLIF($4, '')::jsonb, $5, 'pending', CURRENT_TIMESTAMP)`,
		job.UserID, job.ActionType, job.TargetID, metaBytes, job.IPAddress)
	return err
}

// ClaimActionJobs claims up to N pending action jobs for processing
func (r *Repository) ClaimActionJobs(limit int) ([]ActionJob, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	rows, err := tx.Query(`
       WITH available AS (
          SELECT id FROM action_jobs
          WHERE (status = 'pending' OR (status = 'processing' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'))
            AND next_attempt_at <= CURRENT_TIMESTAMP
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE action_jobs j
       SET status = 'processing', attempts = j.attempts + 1, updated_at = CURRENT_TIMESTAMP
       FROM available
       WHERE j.id = available.id
       RETURNING j.id, j.user_id, j.action_type, j.target_id, j.metadata, j.ip_address, j.attempts`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []ActionJob
	for rows.Next() {
		var job ActionJob
		var metadata []byte
		if err := rows.Scan(&job.ID, &job.UserID, &job.ActionType, &job.TargetID, &metadata, &job.IPAddress, &job.Attempts); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(metadata, &job.Metadata); err != nil {
			job.Metadata = map[string]interface{}{}
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

// CompleteActionJob marks a job as completed
func (r *Repository) CompleteActionJob(id string) error {
	_, err := r.DB.Exec(`UPDATE action_jobs SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id)
	return err
}

// FailActionJob records a failure and schedules next attempt
func (r *Repository) FailActionJob(id string, attempts int, deliveryErr error) error {
	status := "pending"
	if attempts >= 5 {
		status = "failed"
	}
	// Exponential backoff
	delay := time.Duration(1<<minInt(attempts, 5)) * time.Minute

	_, err := r.DB.Exec(`
       UPDATE action_jobs
       SET status = $2, last_error = $3, next_attempt_at = CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second'), updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`, id, status, deliveryErr.Error(), int64(delay.Seconds()))
	return err
}

// EnqueueExportJob inserts an export job into the durable queue
func (r *Repository) EnqueueExportJob(userID, exportType string) (string, error) {
	var jobID string
	err := r.DB.QueryRow(`
       INSERT INTO export_jobs (user_id, export_type, status, next_attempt_at)
       VALUES ($1, $2, 'pending', CURRENT_TIMESTAMP)
       RETURNING id`, userID, exportType).Scan(&jobID)
	return jobID, err
}

// ClaimExportJobs claims up to N pending export jobs for processing
func (r *Repository) ClaimExportJobs(limit int) ([]ExportJob, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	rows, err := tx.Query(`
       WITH available AS (
          SELECT id FROM export_jobs
          WHERE (status = 'pending' OR (status = 'processing' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes'))
            AND next_attempt_at <= CURRENT_TIMESTAMP
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE export_jobs j
       SET status = 'processing', attempts = j.attempts + 1, updated_at = CURRENT_TIMESTAMP
       FROM available
       WHERE j.id = available.id
       RETURNING j.id, j.user_id, j.export_type, j.status, j.download_url, j.attempts`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []ExportJob
	for rows.Next() {
		var job ExportJob
		if err := rows.Scan(&job.ID, &job.UserID, &job.ExportType, &job.Status, &job.DownloadURL, &job.Attempts); err != nil {
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

// CompleteExportJob marks an export as completed with download URL
func (r *Repository) CompleteExportJob(id string, downloadURL string) error {
	_, err := r.DB.Exec(`UPDATE export_jobs SET status = 'completed', download_url = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, downloadURL)
	return err
}

// FailExportJob records a failure and schedules next attempt
func (r *Repository) FailExportJob(id string, attempts int, deliveryErr error) error {
	status := "pending"
	if attempts >= 3 {
		status = "failed"
	}
	// Exponential backoff
	delay := time.Duration(1<<minInt(attempts, 4)) * time.Minute

	_, err := r.DB.Exec(`
       UPDATE export_jobs
       SET status = $2, last_error = $3, next_attempt_at = CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second'), updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`, id, status, deliveryErr.Error(), int64(delay.Seconds()))
	return err
}
