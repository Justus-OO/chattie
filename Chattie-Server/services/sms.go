package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"text/template"
	"time"

	"chattie-backend/repository"
)

type SMSClient struct {
	APIURL   string
	APIKey   string
	SenderID string
	HTTP     *http.Client
	Repo     *repository.Repository
}

// NewSMSClient initializes the SMS HTTP dispatcher
func NewSMSClient() *SMSClient {
	return &SMSClient{
		APIURL:   os.Getenv("SMS_API_URL"),
		APIKey:   os.Getenv("SMS_API_KEY"),
		SenderID: os.Getenv("SMS_SENDER_ID"),
		HTTP: &http.Client{
			Timeout: 10 * time.Second,
			// HTTP connection pooling is handled natively by the default Transport
		},
	}
}

func (c *SMSClient) ConfigureQueue(repo *repository.Repository) {
	c.Repo = repo
}

func (c *SMSClient) isConfigured() bool {
	return c.APIURL != "" && c.APIKey != ""
}

// ============================================================================
// TEMPLATE COMPILER
// ============================================================================

// buildMessage fetches the raw template from the database and compiles it with data
func (c *SMSClient) buildMessage(ctx context.Context, templateName string, data map[string]any) (string, error) {
	if c.Repo == nil {
		return "", fmt.Errorf("repository not configured for DB templates")
	}

	// 1. Fetch the raw template string from Postgres (e.g., "Your OTP is {{.Code}}")
	rawTemplate, err := c.Repo.GetSMSTemplate(ctx, templateName)
	if err != nil {
		return "", fmt.Errorf("failed to fetch template '%s': %w", templateName, err)
	}

	// 2. Parse the raw string into a Go text/template
	tmpl, err := template.New(templateName).Parse(rawTemplate)
	if err != nil {
		return "", fmt.Errorf("failed to parse template '%s': %w", templateName, err)
	}

	// 3. Execute the template with the provided data map
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("failed to execute template '%s': %w", templateName, err)
	}

	return buf.String(), nil
}

// ============================================================================
// SYNCHRONOUS SENDING (Instant/One-Offs)
// ============================================================================

// SendTemplatedSMS compiles a DB template and sends it immediately (blocks execution)
func (c *SMSClient) SendTemplatedSMS(ctx context.Context, to, templateName string, data map[string]any) error {
	message, err := c.buildMessage(ctx, templateName, data)
	if err != nil {
		return err
	}

	return c.dispatchRawSMS(ctx, to, message)
}

// dispatchRawSMS handles the actual HTTP request to your SMS provider
func (c *SMSClient) dispatchRawSMS(ctx context.Context, to, message string) error {
	if !c.isConfigured() {
		log.Printf("[SMS STUB] Would have sent to %s: %s", to, message)
		return nil
	}

	// Example JSON Payload structure (adapt to Twilio, Africa's Talking, Infobip, etc.)
	payload := map[string]string{
		"to":        to,
		"message":   message,
		"sender_id": c.SenderID,
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.APIURL, bytes.NewBuffer(body))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("network error sending SMS to %s: %w", to, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("provider rejected SMS to %s with status: %d", to, resp.StatusCode)
	}

	log.Printf("[SMS SUCCESS] Sent message to %s", to)
	return nil
}

// ============================================================================
// ASYNCHRONOUS QUEUEING & PROCESSING
// ============================================================================

// QueueTemplatedSMS compiles the template and pushes the final string to Postgres
func (c *SMSClient) QueueTemplatedSMS(ctx context.Context, to, templateName string, data map[string]any) error {
	if c.Repo == nil {
		return c.SendTemplatedSMS(ctx, to, templateName, data)
	}

	message, err := c.buildMessage(ctx, templateName, data)
	if err != nil {
		return err
	}

	return c.Repo.EnqueueSMSJob(ctx, &repository.SMSJob{
		PhoneNumber: to,
		Message:     message,
	})
}

// ProcessQueue claims jobs from DB and sends them using the HTTP connection pool
func (c *SMSClient) ProcessQueue(ctx context.Context) {
	if c.Repo == nil {
		log.Println("[SMS QUEUE] Warning: Repo not configured. Worker exiting.")
		return
	}

	ticker := time.NewTicker(5 * time.Second) // SMS queues typically poll faster than email
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[SMS QUEUE] Shutting down gracefully...")
			return
		case <-ticker.C:
			// Claim up to 50 SMS jobs from the DB
			jobs, err := c.Repo.ClaimSMSJobs(ctx, 50)
			if err != nil {
				log.Printf("[SMS QUEUE] Claim failed: %v", err)
				continue
			}

			if len(jobs) > 0 {
				c.processBatch(ctx, jobs)
			}
		}
	}
}

// processBatch handles sending a group of jobs concurrently or sequentially
func (c *SMSClient) processBatch(ctx context.Context, jobs []*repository.SMSJob) {
	if !c.isConfigured() {
		for _, job := range jobs {
			_ = c.Repo.FailSMSJob(ctx, job.ID, job.Attempts, fmt.Errorf("SMS API not configured"))
		}
		return
	}

	for _, job := range jobs {
		// Use dispatchRawSMS since the template was already compiled during enqueue
		err := c.dispatchRawSMS(ctx, job.PhoneNumber, job.Message)

		if err != nil {
			log.Printf("[SMS QUEUE] Delivery failed for %s: %v", job.ID, err)
			if queueErr := c.Repo.FailSMSJob(ctx, job.ID, job.Attempts, err); queueErr != nil {
				log.Printf("[SMS QUEUE] Failed to record retry for %s: %v", job.ID, queueErr)
			}
		} else {
			if err := c.Repo.CompleteSMSJob(ctx, job.ID); err != nil {
				log.Printf("[SMS QUEUE] Failed to complete %s: %v", job.ID, err)
			} else {
				log.Printf("[SMS QUEUE] Batched & sent to %s", job.PhoneNumber)
			}
		}
	}
}
