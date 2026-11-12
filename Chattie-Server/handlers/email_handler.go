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

func (h *EmailHandler) SendDataDossier(ctx context.Context, toEmail string, pdfBytes []byte, filename, username string) error {
	fallback := &repository.EmailTemplate{
		Subject:  "Your Requested Data Dossier is Ready",
		BodyHTML: "<p>Your requested data payload is attached as a PDF.</p>",
	}

	attachments := map[string][]byte{
		filename: pdfBytes,
	}

	err := h.processAndQueueEmail(ctx, toEmail, "data_dossier", fallback, map[string]interface{}{
		"Username": username,
	}, attachments)
	if err != nil {
		log.Printf("[EMAIL ERROR] SendDataDossier failed: %v", err)
	}

	return err
}

func (h *EmailHandler) SendAfterDarkDataArchive(ctx context.Context, toEmail string, pdfBytes []byte, filename, username string) error {
	fallback := &repository.EmailTemplate{
		Subject:  "Your After Dark data archive is ready",
		BodyHTML: "<h1>Your After Dark archive is ready</h1><p>Hello {{.Username}}, your requested After Dark data archive is attached.</p>",
	}
	err := h.processAndQueueEmail(ctx, toEmail, "after_dark_data_archive", fallback, map[string]interface{}{
		"Username": username,
	}, map[string][]byte{filename: pdfBytes})
	if err != nil {
		log.Printf("[EMAIL ERROR] SendAfterDarkDataArchive failed: %v", err)
	}
	return err
}

// ============================================================================
// 3. OTP VERIFICATION LOGIC
// ============================================================================

func (h *EmailHandler) SendOTPEmail(ctx context.Context, toEmail, otpCode string) error {
	err := h.SendSecurityCode(ctx, toEmail, "otp_verification_email", otpCode)
	if err != nil {
		log.Printf("[EMAIL ERROR] SendOTPEmail failed: %v", err)
	}

	return err
}

func (h *EmailHandler) SendSecurityCode(ctx context.Context, toEmail, templateName, code string) error {
	subjects := map[string]string{
		"otp_verification_email": "Your Chattie verification code",
		"login_2fa_email":        "Your Chattie sign-in code",
		"password_reset_email":   "Reset your Chattie password",
		"two_factor_setup_email": "Confirm your Chattie security change",
	}
	subject, ok := subjects[templateName]
	if !ok {
		return fmt.Errorf("unsupported security email template %q", templateName)
	}
	fallback := &repository.EmailTemplate{
		Subject: subject,
		BodyHTML: "<h1>Your security code</h1><p style=\"font-size:28px;font-weight:bold;letter-spacing:6px\">{{.Code}}</p>" +
			"<p>This code expires in {{.ExpiresMinutes}} minutes. Do not share it with anyone.</p>",
	}
	return h.processAndQueueEmail(ctx, toEmail, templateName, fallback, map[string]interface{}{
		"Code": code, "ExpiresMinutes": 10,
	}, nil)
}
