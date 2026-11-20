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
	if templateName == "support_ticket_update" {
		if data, ok := templateData.(map[string]interface{}); ok {
			subject, body, err := localizeSupportTicketEmail(ctx, data)
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
