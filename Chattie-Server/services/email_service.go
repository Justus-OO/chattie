package services

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"chattie-backend/repository"

	"github.com/wneessen/go-mail"
)

type EmailClient struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	Repo     *repository.Repository
}

// NewEmailClient initializes the pure SMTP dialer
func NewEmailClient() *EmailClient {
	portStr := os.Getenv("SMTP_PORT")
	port, err := strconv.Atoi(portStr)
	if err != nil || port == 0 {
		port = 587
	}

	return &EmailClient{
		Host:     os.Getenv("SMTP_HOST"),
		Port:     port,
		Username: os.Getenv("SMTP_USER"),
		Password: os.Getenv("SMTP_PASS"),
		From:     os.Getenv("SMTP_FROM"),
	}
}

func (c *EmailClient) ConfigureQueue(repo *repository.Repository) {
	c.Repo = repo
}

// isConfigured quickly checks if we have enough credentials to attempt a real send
func (c *EmailClient) isConfigured() bool {
	return c.Host != "" && c.Username != ""
}

// ============================================================================
// MESSAGE BUILDER HELPER
// ============================================================================

func (c *EmailClient) buildMessage(to, subject, htmlBody string, attachments map[string][]byte) (*mail.Msg, error) {
	m := mail.NewMsg()

	if err := m.From(c.From); err != nil {
		return nil, fmt.Errorf("invalid from address: %w", err)
	}
	if err := m.To(to); err != nil {
		return nil, fmt.Errorf("invalid to address: %w", err)
	}

	m.Subject(subject)
	m.SetBodyString(mail.TypeTextHTML, htmlBody)

	// go-mail has built-in io.Reader attachment support, eliminating closure hacks
	for filename, fileBytes := range attachments {
		m.AttachReader(filename, bytes.NewReader(fileBytes))
	}

	return m, nil
}

// ============================================================================
// SYNCHRONOUS SENDING (Instant/One-Offs)
// ============================================================================

// SendHTML securely constructs and sends an email immediately (blocks execution)
func (c *EmailClient) SendHTML(ctx context.Context, to, subject, htmlBody string, attachments map[string][]byte) error {
	if !c.isConfigured() {
		log.Printf("[EMAIL STUB] Would have sent '%s' to %s (SMTP not configured)", subject, to)
		return nil
	}

	m, err := c.buildMessage(to, subject, htmlBody, attachments)
	if err != nil {
		return err
	}

	client, err := mail.NewClient(c.Host,
		mail.WithPort(c.Port),
		mail.WithSMTPAuth(mail.SMTPAuthPlain),
		mail.WithUsername(c.Username),
		mail.WithPassword(c.Password),
	)
	if err != nil {
		return fmt.Errorf("failed to create mail client: %w", err)
	}

	// Native context support aborts the dial/send immediately if the request cancels
	if err := client.DialAndSendWithContext(ctx, m); err != nil {
		return fmt.Errorf("send email to %s: %w", to, err)
	}

	log.Printf("[EMAIL SUCCESS] Sent '%s' to %s", subject, to)
	return nil
}

// ============================================================================
// ASYNCHRONOUS QUEUEING & PROCESSING
// ============================================================================

// QueueHTML pushes the email payload into the Postgres durable queue
func (c *EmailClient) QueueHTML(ctx context.Context, to, subject, htmlBody string, attachments map[string][]byte) error {
	if c.Repo == nil {
		// Fallback to instant send if queue isn't configured
		return c.SendHTML(ctx, to, subject, htmlBody, attachments)
	}

	return c.Repo.EnqueueEmailJob(ctx, &repository.EmailJob{
		ToEmail:     to,
		Subject:     subject,
		BodyHTML:    htmlBody,
		Attachments: attachments,
	})
}

// ProcessQueue claims jobs from DB and sends them using SMTP Connection Pooling
func (c *EmailClient) ProcessQueue(ctx context.Context) {
	if c.Repo == nil {
		log.Println("[EMAIL QUEUE] Warning: Repo not configured. Worker exiting.")
		return
	}

	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	// Initialize the client configuration once for the worker
	client, err := mail.NewClient(c.Host,
		mail.WithPort(c.Port),
		mail.WithSMTPAuth(mail.SMTPAuthPlain),
		mail.WithUsername(c.Username),
		mail.WithPassword(c.Password),
	)

	if err != nil {
		log.Printf("[EMAIL QUEUE] Failed to initialize mail client: %v", err)
		return
	}

	for {
		select {
		case <-ctx.Done():
			log.Println("[EMAIL QUEUE] Shutting down gracefully...")
			return
		case <-ticker.C:
			// Claim up to 20 jobs from the DB
			jobs, err := c.Repo.ClaimEmailJobs(ctx, 20)
			if err != nil {
				log.Printf("[EMAIL QUEUE] Claim failed: %v", err)
				continue
			}

			if len(jobs) > 0 {
				c.processBatch(ctx, client, jobs)
			}
		}
	}
}

// processBatch handles sending a group of jobs while reusing a single SMTP connection
func (c *EmailClient) processBatch(ctx context.Context, client *mail.Client, jobs []*repository.EmailJob) {
	if !c.isConfigured() {
		for _, job := range jobs {
			_ = c.Repo.FailEmailJob(ctx, job.ID, job.Attempts, fmt.Errorf("SMTP not configured"))
		}
		return
	}

	// 1. Dial the SMTP server once for the batch. (Returns just 'error')
	if err := client.DialWithContext(ctx); err != nil {
		log.Printf("[EMAIL QUEUE] SMTP dial failed for batch: %v", err)
		for _, job := range jobs {
			_ = c.Repo.FailEmailJob(ctx, job.ID, job.Attempts, fmt.Errorf("SMTP connection failed: %w", err))
		}
		return
	}

	// 2. The client tracks the open connection internally. Close it when the batch finishes.
	defer client.Close()

	// 3. Process jobs over the single open connection
	for _, job := range jobs {
		m, err := c.buildMessage(job.ToEmail, job.Subject, job.BodyHTML, job.Attachments)
		if err != nil {
			log.Printf("[EMAIL QUEUE] Message build failed for %s: %v", job.ID, err)
			_ = c.Repo.FailEmailJob(ctx, job.ID, job.Attempts, err)
			continue
		}

		// client.Send natively reuses the open connection established by DialWithContext
		if err := client.Send(m); err != nil {
			log.Printf("[EMAIL QUEUE] Delivery failed for %s: %v", job.ID, err)
			if queueErr := c.Repo.FailEmailJob(ctx, job.ID, job.Attempts, err); queueErr != nil {
				log.Printf("[EMAIL QUEUE] Failed to record retry for %s: %v", job.ID, queueErr)
			}
		} else {
			if err := c.Repo.CompleteEmailJob(ctx, job.ID); err != nil {
				log.Printf("[EMAIL QUEUE] Failed to complete %s: %v", job.ID, err)
			} else {
				log.Printf("[EMAIL QUEUE] Batched & sent '%s' to %s", job.Subject, job.ToEmail)
			}
		}
	}
}
