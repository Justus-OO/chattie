package services

import (
	"context"
	"fmt"
	"log"

	"chattie-backend/repository"
)

// AppEvent holds the placeholders. The "Action" (HTTP handler) fills these in.
type AppEvent struct {
	RecipientID      string
	WSEventType      string      // e.g., "NEW_MATCH". If empty, skips WS.
	WSPayload        interface{} // Data sent to the frontend
	EmailTemplate    string      // e.g., "new_match". If empty, skips Email.
	EmailNotifColumn string      // e.g., "notif_new_matches". Which DB setting to check.
}

type EventHandler struct {
	Repo         *repository.Repository
	NotifService *NotificationService
}

func NewEventHandler(repo *repository.Repository, ns *NotificationService) *EventHandler {
	return &EventHandler{
		Repo:         repo,
		NotifService: ns,
	}
}

// ProcessEvent is the single, generic engine that handles ALL notifications
func (h *EventHandler) ProcessEvent(ctx context.Context, event AppEvent) {
	// 1. Process Database & WebSocket (Instantly, if a WS Event Type was provided)
	if event.WSEventType != "" {
		title, message, icon := notificationDetails(event.WSEventType, event.WSPayload)

		// Note: Assuming CreateNotification hasn't been updated to take ctx yet based on the compiler logs.
		// If you update it later, add `ctx` as the first argument here too.
		notificationID, err := h.Repo.CreateNotification(event.RecipientID, event.WSEventType, title, message, icon, event.WSPayload)
		if err != nil {
			log.Printf("[NOTIF ERROR] Failed to persist %s for %s: %v", event.WSEventType, event.RecipientID, err)
		} else {
			// Safely merge the DB ID and display strings into the live WebSocket payload
			livePayload := map[string]interface{}{
				"id":              notificationID,
				"notification_id": notificationID,
				"title":           title,
				"message":         message,
				"body":            message, // fallback for older frontends
				"icon":            icon,
			}

			// Safely assert and merge existing payload data if it's a map
			if data, ok := event.WSPayload.(map[string]interface{}); ok {
				for key, value := range data {
					livePayload[key] = value
				}
			} else if event.WSPayload != nil {
				// If it's a string or other struct, just attach it raw
				livePayload["data"] = event.WSPayload
			}

			event.WSPayload = livePayload
		}

		// Fix 1: Pass ctx down to the WebSocket sender
		h.NotifService.SendWebSocketMessage(ctx, event.RecipientID, event.WSEventType, event.WSPayload)
	}

	// 2. Process Email (If an Email Template was provided)
	if event.EmailTemplate != "" {

		// Check user preferences safely (Opts-out are respected)
		if event.EmailNotifColumn != "" {
			if !h.userWantsEmail(ctx, event.RecipientID, event.EmailNotifColumn) {
				return // User opted out, stop here.
			}
		}

		// Fix 2: Pass ctx down to GetUserByID
		user, err := h.Repo.GetUserByID(ctx, event.RecipientID)
		if err != nil || user.Email == "" {
			return
		}

		// Fix 3: Pass ctx and the proper flexible data map down to SendTemplatedEmail
		templateData := map[string]interface{}{
			"Username": user.Username,
		}
		h.NotifService.SendTemplatedEmail(ctx, user.Email, event.EmailTemplate, templateData)
	}
}

// notificationDetails translates raw system events into beautiful UI strings and icons
func notificationDetails(eventType string, payload interface{}) (string, string, string) {
	// 1. Defaults
	title := "New Notification"
	message := fmt.Sprintf("You have a new %s alert", eventType)
	icon := "bell"

	// 2. Attempt to extract a custom message provided by the HTTP handler
	if data, ok := payload.(map[string]interface{}); ok {
		if val, ok := data["title"].(string); ok && val != "" {
			title = val
		}
		if val, ok := data["message"].(string); ok && val != "" {
			message = val
		}
	}

	// 3. System Event Dictionary (Overwrites defaults based on type)
	switch eventType {
	case "NEW_INTERACTION":
		title, icon = "Someone noticed you!", "heart"
	case "NEW_MATCH":
		title, icon = "It's a Match! 🎉", "sparkles"
	case "NEW_MESSAGE", "MESSAGE":
		title, icon = "New Message", "message-circle"
	case "VIP_UPGRADE_SUCCESS":
		title, icon = "Welcome to Premium 👑", "crown"
	case "PROFILE_VERIFIED":
		title, icon = "Profile Verified ✓", "shield-check"
	case "SYSTEM_ALERT":
		title, icon = "System Alert", "info"
	case "ROOM_ACCESS_APPROVED":
		title, icon = "Room Request Approved", "door-open"
	case "ROOM_KICKED", "ROOM_BANNED":
		title, icon = "Room Access Revoked", "user-x"
	case "MODERATION_ACTION", "USER_BANNED", "USER_SUSPENDED", "OPERATOR_SUSPENDED":
		title, icon = "Account Action Notice", "alert-triangle"
	}

	return title, message, icon
}

// userWantsEmail safely maps the requested column to a database query to prevent SQL injection.
func (h *EventHandler) userWantsEmail(ctx context.Context, userID string, notifColumn string) bool {
	var wantsNotifs bool
	var err error

	// Upgraded to use QueryRowContext to respect request cancellation
	switch notifColumn {
	case "notif_messages":
		err = h.Repo.DB.QueryRowContext(ctx, "SELECT notif_messages FROM user_settings WHERE user_id = $1", userID).Scan(&wantsNotifs)
	case "notif_new_matches":
		err = h.Repo.DB.QueryRowContext(ctx, "SELECT notif_new_matches FROM user_settings WHERE user_id = $1", userID).Scan(&wantsNotifs)
	case "notif_super_likes":
		err = h.Repo.DB.QueryRowContext(ctx, "SELECT notif_super_likes FROM user_settings WHERE user_id = $1", userID).Scan(&wantsNotifs)
	case "notif_promotions":
		err = h.Repo.DB.QueryRowContext(ctx, "SELECT notif_promotions FROM user_settings WHERE user_id = $1", userID).Scan(&wantsNotifs)
	default:
		// If an invalid column is passed, default to true for system-critical emails, false for marketing
		log.Printf("[EVENT WARN] Unknown notification setting column: %s. Defaulting to true.", notifColumn)
		return true
	}

	return err == nil && wantsNotifs
}
