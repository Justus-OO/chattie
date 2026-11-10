package services

import (
	"bytes"
	"context"
	"fmt"
	"html/template"
	"log"
	"sync"

	"chattie-backend/repository"
)

// WSManager defines the methods the service needs to push live data.
type WSManager interface {
	SendToUser(ctx context.Context, userID string, payload interface{}) error
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
