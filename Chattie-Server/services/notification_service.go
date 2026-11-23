package services

import (
	"bytes"
	"context"
	"fmt"
	"html"
	"html/template"
	"log"
	"strings"
	"sync"
	texttemplate "text/template"

	"chattie-backend/repository"
	"github.com/nicksnyder/go-i18n/v2/i18n"
)

// WSManager defines the methods the service needs to push live data.
type WSManager interface {
	SendToUser(ctx context.Context, userID string, payload interface{}) error
}

type WSDisconnectManager interface {
	DisconnectUser(userID string) int
}

type WSCountryDisconnectManager interface {
	DisconnectCountry(countryCode string) int
}

// CachedTemplate holds the pre-compiled Go template to save CPU and DB overhead
type CachedTemplate struct {
	Subject string
	Tmpl    *template.Template
}

type NotificationService struct {
	Repo          *repository.Repository
	Email         *EmailClient
	WS            WSManager
	templateCache map[string]CachedTemplate
	cacheMutex    sync.RWMutex
}

func NewNotificationService(repo *repository.Repository, email *EmailClient, ws WSManager) *NotificationService {
	return &NotificationService{
		Repo:          repo,
		Email:         email,
		WS:            ws,
		templateCache: make(map[string]CachedTemplate),
	}
}

// ============================================================================
// DELIVERY METHODS (Blind Execution)
// ============================================================================

// SendTemplatedEmail utilizes an in-memory thread-safe cache to render templates instantly
func (s *NotificationService) SendTemplatedEmail(ctx context.Context, toEmail, templateName string, templateData interface{}) error {
	if toEmail == "" {
		return fmt.Errorf("recipient email required")
	}
	recipientLanguage := "en"
	if storedLanguage, err := s.Repo.GetUserLanguageByEmail(ctx, toEmail); err == nil && storedLanguage.Valid {
		if isSupportedRecipientLanguage(storedLanguage.String) {
			recipientLanguage = storedLanguage.String
		}
	}

	if templateName == "support_ticket_update" {
		if data, ok := templateData.(map[string]interface{}); ok {
			recipientCtx := context.WithValue(ctx, localizerKey, GetOfflineLocalizer(recipientLanguage))
			subject, body, err := localizeSupportTicketEmail(recipientCtx, data)
			if err != nil {
				return fmt.Errorf("localize support ticket email: %w", err)
			}
			if err := s.Email.QueueHTML(ctx, toEmail, subject, body, nil); err != nil {
				return fmt.Errorf("queue template %s: %w", templateName, err)
			}
			log.Printf("[NOTIF] Queued localized template %s to %s", templateName, toEmail)
			return nil
		}
		return fmt.Errorf("support ticket email data must be a string map")
	}

	if recipientLanguage != "en" {
		subject, body, err := renderLocalizedEmailTemplate(recipientLanguage, templateName, templateData)
		if err == nil {
			if err := s.Email.QueueHTML(ctx, toEmail, subject, body, nil); err != nil {
				return fmt.Errorf("queue template %s: %w", templateName, err)
			}
			log.Printf("[NOTIF] Queued recipient-localized template %s to %s", templateName, toEmail)
			return nil
		}
		log.Printf("[NOTIF WARN] Built-in locale template %s unavailable for %s: %v", templateName, recipientLanguage, err)
	}

	// 1. Try to load the compiled template from RAM (Read Lock)
	s.cacheMutex.RLock()
	cachedTmpl, exists := s.templateCache[templateName]
	s.cacheMutex.RUnlock()

	// 2. If it's not in RAM, safely fetch and compile it
	if !exists {
		s.cacheMutex.Lock()

		// Double-check existence after acquiring the write lock to prevent "thundering herd" DB queries
		cachedTmpl, exists = s.templateCache[templateName]
		if !exists {
			dbTmpl, err := s.Repo.GetEmailTemplateByName(ctx, templateName)
			if err != nil {
				s.cacheMutex.Unlock()
				return fmt.Errorf("missing template %s: %w", templateName, err)
			}

			parsedTmpl, err := template.New(templateName).Parse(dbTmpl.BodyHTML)
			if err != nil {
				s.cacheMutex.Unlock()
				return fmt.Errorf("failed to parse template %s: %w", templateName, err)
			}

			cachedTmpl = CachedTemplate{
				Subject: dbTmpl.Subject,
				Tmpl:    parsedTmpl,
			}

			// Save it back to RAM for future use
			s.templateCache[templateName] = cachedTmpl
		}

		s.cacheMutex.Unlock()
	}

	// 3. Execute the cached, compiled template directly
	var bodyBuffer bytes.Buffer
	if err := cachedTmpl.Tmpl.Execute(&bodyBuffer, templateData); err != nil {
		return fmt.Errorf("execute template %s: %w", templateName, err)
	}

	// 4. Hand off to the SMTP client Queue
	if err := s.Email.QueueHTML(ctx, toEmail, cachedTmpl.Subject, bodyBuffer.String(), nil); err != nil {
		return fmt.Errorf("queue template %s: %w", templateName, err)
	}

	log.Printf("[NOTIF] Queued template %s to %s", templateName, toEmail)
	return nil
}

func localizeSupportTicketEmail(ctx context.Context, data map[string]interface{}) (string, string, error) {
	localizer := GetLocalizer(ctx)
	localize := func(id, fallback string) (string, error) {
		return localizer.Localize(&i18n.LocalizeConfig{
			MessageID: id,
			DefaultMessage: &i18n.Message{
				ID:    id,
				Other: fallback,
			},
		})
	}
	subject, err := localize("SupportTicketEmailSubject", "Update to your Chattie support ticket")
	if err != nil {
		return "", "", err
	}

	status := stringValue(data["TicketStatus"])
	statusID := map[string]string{
		"open":          "SupportStatusOpen",
		"waiting_human": "SupportStatusWaitingHuman",
		"in_progress":   "SupportStatusInProgress",
		"resolved":      "SupportStatusResolved",
	}[status]
	if statusID != "" {
		status, err = localize(statusID, status)
		if err != nil {
			return "", "", err
		}
	}

	actionID := "SupportEmailOpen"
	if strings.HasPrefix(stringValue(data["ActionURL"]), "/admin/") {
		actionID = "SupportEmailOpenAdmin"
	}
	actionLabel, err := localize(actionID, "Open support")
	if err != nil {
		return "", "", err
	}
	body, err := localize("SupportTicketEmailBody", `<h1>Support ticket update</h1><p>Your ticket &quot;[[TICKET_SUBJECT]]&quot; is now [[TICKET_STATUS]].</p><p><a href="[[ACTION_URL]]">[[ACTION_LABEL]]</a></p>`)
	if err != nil {
		return "", "", err
	}
	body = strings.NewReplacer(
		"[[TICKET_SUBJECT]]", html.EscapeString(stringValue(data["TicketSubject"])),
		"[[TICKET_STATUS]]", html.EscapeString(status),
		"[[ACTION_URL]]", html.EscapeString(stringValue(data["ActionURL"])),
		"[[ACTION_LABEL]]", html.EscapeString(actionLabel),
	).Replace(body)
	return subject, body, nil
}

func stringValue(value interface{}) string {
	text, _ := value.(string)
	return text
}

func isSupportedRecipientLanguage(language string) bool {
	switch language {
	case "en", "es", "fr", "de", "pt", "ja", "sw", "hi", "zh-CN":
		return true
	default:
		return false
	}
}

func pascalEmailTemplateName(templateName string) string {
	parts := strings.FieldsFunc(templateName, func(r rune) bool {
		return r == '_' || r == '-' || r == ' '
	})
	var name strings.Builder
	for _, part := range parts {
		if part == "" {
			continue
		}
		name.WriteString(strings.ToUpper(part[:1]))
		name.WriteString(part[1:])
	}
	return name.String()
}

func renderLocalizedEmailTemplate(language, templateName string, templateData interface{}) (string, string, error) {
	localizer := GetOfflineLocalizer(language)
	suffix := pascalEmailTemplateName(templateName)
	if suffix == "" {
		return "", "", fmt.Errorf("invalid template name")
	}
	subject, err := localizer.Localize(&i18n.LocalizeConfig{
		MessageID: "EmailSubject" + suffix,
		DefaultMessage: &i18n.Message{
			ID:    "EmailSubject" + suffix,
			Other: "",
		},
	})
	if err != nil || subject == "" {
		return "", "", fmt.Errorf("missing localized subject for %s", templateName)
	}
	body, err := localizer.Localize(&i18n.LocalizeConfig{
		MessageID: "EmailBody" + suffix,
		DefaultMessage: &i18n.Message{
			ID:    "EmailBody" + suffix,
			Other: "",
		},
	})
	if err != nil || body == "" {
		return "", "", fmt.Errorf("missing localized body for %s", templateName)
	}

	var subjectBuffer bytes.Buffer
	subjectTemplate, err := texttemplate.New(templateName + "_subject").Option("missingkey=zero").Parse(subject)
	if err != nil {
		return "", "", fmt.Errorf("parse localized subject %s: %w", templateName, err)
	}
	if err := subjectTemplate.Execute(&subjectBuffer, templateData); err != nil {
		return "", "", fmt.Errorf("execute localized subject %s: %w", templateName, err)
	}

	var bodyBuffer bytes.Buffer
	bodyTemplate, err := template.New(templateName + "_body").Option("missingkey=zero").Parse(body)
	if err != nil {
		return "", "", fmt.Errorf("parse localized body %s: %w", templateName, err)
	}
	if err := bodyTemplate.Execute(&bodyBuffer, templateData); err != nil {
		return "", "", fmt.Errorf("execute localized body %s: %w", templateName, err)
	}
	return subjectBuffer.String(), bodyBuffer.String(), nil
}

// SendWebSocketMessage pushes a JSON payload to an active connection
func (s *NotificationService) SendWebSocketMessage(ctx context.Context, userID string, eventType string, data interface{}) error {
	if s.WS == nil {
		return fmt.Errorf("ws manager not configured")
	}

	if userID == "" {
		return fmt.Errorf("user id required")
	}

	payload := map[string]interface{}{
		"type": eventType,
		"data": data,
	}

	err := s.WS.SendToUser(ctx, userID, payload)
	if err != nil {
		log.Printf("[NOTIF DEBUG] WS message not sent to %s (user offline)", userID)
		return nil
	}

	log.Printf("[NOTIF] WS event %s sent to %s", eventType, userID)
	return nil
}

func (s *NotificationService) DisconnectUser(userID string) int {
	manager, ok := s.WS.(WSDisconnectManager)
	if !ok {
		return 0
	}
	return manager.DisconnectUser(userID)
}

func (s *NotificationService) DisconnectCountry(countryCode string) int {
	manager, ok := s.WS.(WSCountryDisconnectManager)
	if !ok {
		return 0
	}
	return manager.DisconnectCountry(countryCode)
}

// ProcessInactivityAlert sends an inactivity reminder and returns error context
func (s *NotificationService) ProcessInactivityAlert(ctx context.Context, id string) error {
	if id == "" {
		return fmt.Errorf("user id required for inactivity alert")
	}

	// Assuming GetUserByID was also updated to accept context
	user, err := s.Repo.GetUserByID(ctx, id)
	if err != nil {
		return fmt.Errorf("fetch user %s: %w", id, err)
	}

	if user.Email == "" {
		return fmt.Errorf("user %s has no email", id)
	}

	data := map[string]interface{}{
		"Username": user.Username,
	}

	return s.SendTemplatedEmail(ctx, user.Email, "miss_you", data)
}
