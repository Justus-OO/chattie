package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"time"

	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"
)

var ActionLogQueue = make(chan models.ActionLog, 1000)

// StartActionLogger enqueues actions into the durable queue (non-blocking)
func StartActionLogger(repo *repository.Repository) {
	go func() {
		for logEntry := range ActionLogQueue {
			metadata, _ := json.Marshal(map[string]interface{}{
				"metadata": logEntry.Metadata,
			})
			job := &repository.ActionJob{
				UserID:     logEntry.UserID,
				ActionType: logEntry.ActionType,
				TargetID:   &logEntry.TargetID,
				Metadata:   map[string]interface{}{"data": string(metadata)},
				IPAddress:  logEntry.IP,
			}
			if err := repo.EnqueueActionJob(job); err != nil {
				log.Printf("[LOGGER ERROR] Failed to enqueue action %s for user %s: %v", logEntry.ActionType, logEntry.UserID, err)
			}
		}
	}()
}

// ProcessExportJobs claims and processes data exports from the durable queue
func ProcessExportJobs(ctx context.Context, repo *repository.Repository, settingsRepo *repository.SettingsRepository, emailHandler *EmailHandler) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[EXPORT WORKER] Shutting down gracefully...")
			return
		case <-ticker.C:
			jobs, err := repo.ClaimExportJobs(10)
			if err != nil {
				log.Printf("[EXPORT WORKER] Claim failed: %v", err)
				continue
			}

			for _, job := range jobs {
				if err := processExportJob(ctx, repo, settingsRepo, emailHandler, job); err != nil {
					log.Printf("[EXPORT WORKER] Failed to process export %s: %v", job.ID, err)
					if failErr := repo.FailExportJob(job.ID, job.Attempts, err); failErr != nil {
						log.Printf("[EXPORT WORKER] Failed to record retry for %s: %v", job.ID, failErr)
					}
				} else {
					log.Printf("[EXPORT WORKER] Successfully exported %s for user %s", job.ID, job.UserID)
				}
			}
		}
	}
}

func processExportJob(ctx context.Context, repo *repository.Repository, settingsRepo *repository.SettingsRepository, emailHandler *EmailHandler, job repository.ExportJob) error {
	// Fetch user details
	user, err := repo.GetUserByID(ctx, job.UserID)
	if err != nil || user.Email == "" {
		return fmt.Errorf("fetch user: %w", err)
	}

	// Fetch all user data
	settings, err1 := settingsRepo.GetSettings(job.UserID)
	messages, err2 := settingsRepo.GetAllUserMessages(job.UserID)
	matches, err3 := settingsRepo.GetUserMatches(job.UserID)

	if err1 != nil || err2 != nil || err3 != nil {
		return fmt.Errorf("fetch data: settings=%v, messages=%v, matches=%v", err1, err2, err3)
	}

	// Prepare template payload
	data := map[string]interface{}{
		"ExportDate": time.Now().Format("January 02, 2006 at 15:04:05 MST"),
		"UserID":     job.UserID,
		"Settings":   settings,
		"Messages":   messages,
		"Matches":    matches,
		"MsgCount":   len(messages),
		"MatchCount": len(matches),
	}

	// Render HTML template
	tmpl, err := template.ParseFiles("templates/data_export.html")
	if err != nil {
		return fmt.Errorf("parse template: %w", err)
	}

	var htmlBuffer bytes.Buffer
	if err := tmpl.Execute(&htmlBuffer, data); err != nil {
		return fmt.Errorf("execute template: %w", err)
	}

	// Generate PDF
	pdfBytes, err := services.GeneratePDF(htmlBuffer.String())
	if err != nil {
		return fmt.Errorf("generate pdf: %w", err)
	}

	// Send email with attachment
	filename := fmt.Sprintf("chattie_data_dossier_%s.pdf", job.UserID[:8])
	if err := emailHandler.SendDataDossier(ctx, user.Email, pdfBytes, filename); err != nil {
		return fmt.Errorf("send email: %w", err)
	}

	// Mark job as completed
	return repo.CompleteExportJob(job.ID, "")
}

func ProcessActionJobs(ctx context.Context, repo *repository.Repository) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[ACTION WORKER] Shutting down gracefully...")
			return
		case <-ticker.C:
			jobs, err := repo.ClaimActionJobs(50)
			if err != nil {
				log.Printf("[ACTION WORKER] Claim failed: %v", err)
				continue
			}

			for _, job := range jobs {
				query := `INSERT INTO user_action_logs (user_id, action_type, target_id, metadata, ip_address) 
                          VALUES (NULLIF($1, '')::uuid, $2, NULLIF($3, '')::uuid, NULLIF($4, '')::jsonb, $5)`

				// FIX: Convert the Go map to a JSON byte array before sending it to PostgreSQL
				metaBytes, _ := json.Marshal(job.Metadata)

				// FIX: Use ExecContext and pass string(metaBytes) instead of the raw map
				_, err := repo.DB.ExecContext(ctx, query, job.UserID, job.ActionType, job.TargetID, string(metaBytes), job.IPAddress)

				if err != nil {
					log.Printf("[ACTION WORKER] Failed to insert action %s: %v", job.ID, err)
					if failErr := repo.FailActionJob(job.ID, job.Attempts, err); failErr != nil {
						log.Printf("[ACTION WORKER] Failed to record retry for %s: %v", job.ID, failErr)
					}
				} else {
					if completeErr := repo.CompleteActionJob(job.ID); completeErr != nil {
						log.Printf("[ACTION WORKER] Failed to complete %s: %v", job.ID, completeErr)
					}
				}
			}
		}
	}
}
