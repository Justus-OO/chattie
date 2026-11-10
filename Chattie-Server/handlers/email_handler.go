package handlers

import (
	"bytes"
	"context"
	"fmt"
	"html/template"
	"log"

	"chattie-backend/repository"
	"chattie-backend/services"
)

type EmailHandler struct {
	Repo   *repository.Repository
	Client *services.EmailClient
}

func NewEmailHandler(repo *repository.Repository, client *services.EmailClient) *EmailHandler {
	return &EmailHandler{
		Repo:   repo,
		Client: client,
	}
}

// ============================================================================
// INTERNAL HELPER
// ============================================================================

// processAndQueueEmail DRYs up the boilerplate of fetching, parsing, executing, and queuing emails.
func (h *EmailHandler) processAndQueueEmail(
	ctx context.Context,
	toEmail string,
	templateName string,
	fallback *repository.EmailTemplate,
	templateData interface{},
	attachments map[string][]byte,
) error {
	// FIX: Pass ctx to GetEmailTemplateByName
	dbTmpl, err := h.Repo.GetEmailTemplateByName(ctx, templateName)
	if err != nil {
		log.Printf("[EMAIL WARNING] Missing DB template '%s', using fallback. Err: %v", templateName, err)
		dbTmpl = fallback
	}

	// 2. Parse HTML string
	t, err := template.New(templateName).Parse(dbTmpl.BodyHTML)
	if err != nil {
		return fmt.Errorf("failed to parse %s template HTML: %w", templateName, err)
	}

	// 3. Inject data
	var bodyBuffer bytes.Buffer
	if err := t.Execute(&bodyBuffer, templateData); err != nil {
		return fmt.Errorf("failed to execute %s template: %w", templateName, err)
	}

	// FIX: Pass ctx to QueueHTML
	if err := h.Client.QueueHTML(ctx, toEmail, dbTmpl.Subject, bodyBuffer.String(), attachments); err != nil {
		return fmt.Errorf("failed to queue %s email: %w", templateName, err)
	}

	return nil
}

// ============================================================================
// 1. WELCOME EMAIL LOGIC
// ============================================================================

func (h *EmailHandler) SendWelcomeEmail(ctx context.Context, toEmail, username string) error {
	fallback := &repository.EmailTemplate{
		Subject:  "Welcome to Chattie Premium ⚡",
		BodyHTML: "<h1>Welcome, {{.Username}}</h1>",
	}

	data := map[string]interface{}{
		"Username": username,
	}

	err := h.processAndQueueEmail(ctx, toEmail, "welcome_email", fallback, data, nil)
	if err != nil {
		log.Printf("[EMAIL ERROR] SendWelcomeEmail failed: %v", err)
	}

	return err
}

// ============================================================================
// 2. DATA DOSSIER LOGIC
// ============================================================================

func (h *EmailHandler) SendDataDossier(ctx context.Context, toEmail string, pdfBytes []byte, filename string) error {
	fallback := &repository.EmailTemplate{
		Subject:  "Your Requested Data Dossier is Ready",
		BodyHTML: "<p>Your requested data payload is attached as a PDF.</p>",
	}

	attachments := map[string][]byte{
		filename: pdfBytes,
	}

	err := h.processAndQueueEmail(ctx, toEmail, "data_dossier", fallback, nil, attachments)
	if err != nil {
		log.Printf("[EMAIL ERROR] SendDataDossier failed: %v", err)
	}

	return err
}

// ============================================================================
// 3. OTP VERIFICATION LOGIC
// ============================================================================

func (h *EmailHandler) SendOTPEmail(ctx context.Context, toEmail, otpCode string) error {
	fallback := &repository.EmailTemplate{
		Subject:  "Your Verification Code",
		BodyHTML: "<h2>Your verification code is: {{.Code}}</h2><p>This code is valid for 10 minutes.</p>",
	}

	data := map[string]interface{}{
		"Code": otpCode,
	}

	err := h.processAndQueueEmail(ctx, toEmail, "otp_verification_email", fallback, data, nil)
	if err != nil {
		log.Printf("[EMAIL ERROR] SendOTPEmail failed: %v", err)
	}

	return err
}
