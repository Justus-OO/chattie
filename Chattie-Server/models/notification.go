package models

import (
	"encoding/json"
	"time"
)

type Notification struct {
	ID          string          `json:"id"`
	EventType   string          `json:"event_type"`
	Title       string          `json:"title"`
	Message     string          `json:"message"`
	Icon        string          `json:"icon"`
	Read        bool            `json:"read"`
	CreatedAt   time.Time       `json:"created_at"`
	Payload     json.RawMessage `json:"payload,omitempty"` // FIX: Added to hold the dynamic JSONB data
	ActionURL   string          `json:"action_url,omitempty"`
	ActionLabel string          `json:"action_label,omitempty"`
	Category    string          `json:"category,omitempty"`

	// Frontend UI Compatibility fields
	IsRead         bool   `json:"is_read"`
	Body           string `json:"body"`
	NotificationID string `json:"notification_id"`
}
