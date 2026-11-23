package repository

import (
	"context"
	"encoding/json"

	"chattie-backend/models"
)

// CreateNotification saves a notification and its actionable payload to the database
func (r *Repository) CreateNotification(userID, eventType, title, message, icon string, payload interface{}) (string, error) {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	actionURL := ""
	actionLabel := ""
	category := ""
	if data, ok := payload.(map[string]interface{}); ok {
		actionURL, _ = data["action_url"].(string)
		actionLabel, _ = data["action_label"].(string)
		category, _ = data["category"].(string)
	}

	var id string
	err = r.DB.QueryRowContext(context.TODO(), `
       INSERT INTO notifications (user_id, event_type, title, message, icon, payload, action_url, action_label, category)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''))
       RETURNING id
    `, userID, eventType, title, message, icon, string(payloadJSON), actionURL, actionLabel, category).Scan(&id)

	return id, err
}

// GetNotifications retrieves the user's latest notifications, INCLUDING the payload
func (r *Repository) GetNotifications(userID string) ([]models.Notification, error) {
	rows, err := r.DB.QueryContext(context.TODO(), `
       SELECT id, event_type, title, message, icon, payload, is_read, created_at,
              COALESCE(action_url, ''), COALESCE(action_label, ''), COALESCE(category, '')
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100
    `, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notifications := make([]models.Notification, 0)
	for rows.Next() {
		var n models.Notification
		var rawPayload []byte // Temporary buffer for the JSONB payload

		if err := rows.Scan(
			&n.ID,
			&n.EventType,
			&n.Title,
			&n.Message,
			&n.Icon,
			&rawPayload, // FIX: Scan the payload
			&n.Read,
			&n.CreatedAt,
			&n.ActionURL,
			&n.ActionLabel,
			&n.Category,
		); err != nil {
			return nil, err
		}

		// Attach the raw payload bytes if they exist
		if len(rawPayload) > 0 {
			n.Payload = rawPayload
		}

		// Hydrate redundant compatibility fields for the frontend
		n.NotificationID = n.ID
		n.Body = n.Message
		n.IsRead = n.Read

		notifications = append(notifications, n)
	}
	return notifications, rows.Err()
}

// MarkNotificationsRead flags a single notification as read
func (r *Repository) MarkNotificationsRead(userID string, notificationID string) error {
	_, err := r.DB.ExecContext(context.TODO(), `
		UPDATE notifications 
		SET is_read = TRUE 
		WHERE id = $1 AND user_id = $2
	`, notificationID, userID)
	return err
}

// MarkAllNotificationsRead flags all of a user's notifications as read instantly
func (r *Repository) MarkAllNotificationsRead(userID string) error {
	_, err := r.DB.ExecContext(context.TODO(), `
		UPDATE notifications 
		SET is_read = TRUE 
		WHERE user_id = $1 AND is_read = FALSE
	`, userID)
	return err
}

// DeleteNotification removes a notification permanently
func (r *Repository) DeleteNotification(userID string, notificationID string) error {
	_, err := r.DB.ExecContext(context.TODO(), `
		DELETE FROM notifications 
		WHERE id = $1 AND user_id = $2
	`, notificationID, userID)
	return err
}
