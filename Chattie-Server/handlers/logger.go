package handlers

import (
	"bytes"
	"context"
	"database/sql"
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
	if job.ExportType == "after_dark_archive" {
		return processAfterDarkExportJob(ctx, repo, emailHandler, job)
	}

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
	if err := emailHandler.SendDataDossier(ctx, user.Email, pdfBytes, filename, user.Username); err != nil {
		return fmt.Errorf("send email: %w", err)
	}

	// Mark job as completed
	return repo.CompleteExportJob(job.ID, "")
}

func processAfterDarkExportJob(ctx context.Context, repo *repository.Repository, emailHandler *EmailHandler, job repository.ExportJob) error {
	user, err := repo.GetUserByID(ctx, job.UserID)
	if err != nil {
		return fmt.Errorf("fetch After Dark archive user: %w", err)
	}
	if user.Email == "" {
		return fmt.Errorf("After Dark archive user has no email")
	}

	type archiveProfile struct {
		DisplayName string
		Username    string
		Bio         string
		Website     string
		Location    string
		Status      string
	}
	type archivePayment struct {
		Reference   string
		PaymentType string
		Amount      float64
		Currency    string
		Status      string
		CreatedAt   time.Time
	}
	type archiveLedgerEntry struct {
		Type        string
		Amount      float64
		Reference   string
		Description string
		CreatedAt   time.Time
	}
	var profile archiveProfile
	err = repo.DB.QueryRowContext(ctx, `
		SELECT COALESCE(display_name, ''), COALESCE(username, ''), COALESCE(bio, ''),
		       COALESCE(website, ''), COALESCE(location, ''), COALESCE(status, '')
		FROM performer_profiles WHERE user_id = $1`,
		job.UserID).Scan(&profile.DisplayName, &profile.Username, &profile.Bio, &profile.Website, &profile.Location, &profile.Status)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("fetch After Dark creator profile: %w", err)
	}

	var explicitContent, discoverable bool
	var notificationEmail, notificationPush string
	err = repo.DB.QueryRowContext(ctx, `
		SELECT COALESCE(show_explicit_content, FALSE), COALESCE(discoverable, TRUE),
		       COALESCE(notification_email, '{}'::jsonb)::text,
		       COALESCE(notification_push, '{}'::jsonb)::text
		FROM ad_creator_settings WHERE user_id = $1`,
		job.UserID).Scan(&explicitContent, &discoverable, &notificationEmail, &notificationPush)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("fetch After Dark settings: %w", err)
	}

	paymentRows, err := repo.DB.QueryContext(ctx, `
		SELECT id::text, payment_type, amount_cents, currency, status, created_at
		FROM ad_payment_intents
		WHERE user_id = $1 OR creator_id = $1
		ORDER BY created_at DESC LIMIT 500`, job.UserID)
	if err != nil {
		return fmt.Errorf("fetch After Dark payment records: %w", err)
	}
	var payments []archivePayment
	for paymentRows.Next() {
		var item archivePayment
		var amountCents int64
		if err := paymentRows.Scan(&item.Reference, &item.PaymentType, &amountCents, &item.Currency, &item.Status, &item.CreatedAt); err != nil {
			paymentRows.Close()
			return fmt.Errorf("read After Dark payment record: %w", err)
		}
		item.Amount = float64(amountCents) / 100
		payments = append(payments, item)
	}
	if err := paymentRows.Err(); err != nil {
		paymentRows.Close()
		return fmt.Errorf("iterate After Dark payment records: %w", err)
	}
	paymentRows.Close()

	ledgerRows, err := repo.DB.QueryContext(ctx, `
		SELECT transaction_type, amount_cents, COALESCE(reference_id, ''),
		       COALESCE(description, ''), created_at
		FROM ad_ledger_entries WHERE user_id = $1
		ORDER BY created_at DESC LIMIT 500`, job.UserID)
	if err != nil {
		return fmt.Errorf("fetch After Dark wallet records: %w", err)
	}
	var ledger []archiveLedgerEntry
	for ledgerRows.Next() {
		var item archiveLedgerEntry
		var amountCents int64
		if err := ledgerRows.Scan(&item.Type, &amountCents, &item.Reference, &item.Description, &item.CreatedAt); err != nil {
			ledgerRows.Close()
			return fmt.Errorf("read After Dark wallet record: %w", err)
		}
		item.Amount = float64(amountCents) / 100
		ledger = append(ledger, item)
	}
	if err := ledgerRows.Err(); err != nil {
		ledgerRows.Close()
		return fmt.Errorf("iterate After Dark wallet records: %w", err)
	}
	ledgerRows.Close()

	data := map[string]interface{}{
		"UserID":            job.UserID,
		"ExportDate":        time.Now().Format("January 02, 2006 at 15:04:05 MST"),
		"Profile":           profile,
		"ShowExplicit":      explicitContent,
		"Discoverable":      discoverable,
		"NotificationEmail": notificationEmail,
		"NotificationPush":  notificationPush,
		"Payments":          payments,
		"PaymentCount":      len(payments),
		"Ledger":            ledger,
		"LedgerCount":       len(ledger),
	}
	tmpl, err := template.ParseFiles("templates/after_dark_data_export.html")
	if err != nil {
		return fmt.Errorf("parse After Dark archive template: %w", err)
	}
	var htmlBuffer bytes.Buffer
	if err := tmpl.Execute(&htmlBuffer, data); err != nil {
		return fmt.Errorf("render After Dark archive: %w", err)
	}
	pdfBytes, err := services.GeneratePDF(htmlBuffer.String())
	if err != nil {
		return fmt.Errorf("generate After Dark archive PDF: %w", err)
	}
	filename := fmt.Sprintf("after_dark_archive_%s.pdf", job.UserID[:8])
	if err := emailHandler.SendAfterDarkDataArchive(ctx, user.Email, pdfBytes, filename, user.Username); err != nil {
		return fmt.Errorf("send After Dark archive email: %w", err)
	}
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
