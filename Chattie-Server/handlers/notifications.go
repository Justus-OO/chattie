package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
)

type NotificationHandler struct {
	Repo *repository.Repository
}

func NewNotificationHandler(repo *repository.Repository) *NotificationHandler {
	return &NotificationHandler{Repo: repo}
}

// Helper to quickly extract and validate the User ID from the JWT context
func notificationUserID(r *http.Request) (string, bool) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	return userID, ok && userID != ""
}

// List returns the user's latest notifications
func (h *NotificationHandler) List(w http.ResponseWriter, r *http.Request) {
	userID, ok := notificationUserID(r)
	if !ok {
		http.Error(w, `{"error": "Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	notifications, err := h.Repo.GetNotifications(userID)
	if err != nil {
		log.Printf("[NOTIF ERROR] Failed to fetch notifications for %s: %v", userID, err)
		http.Error(w, `{"error": "`+localized(r.Context(), "ErrFailedFetchNotifications", "Failed to load notifications")+`"}`, http.StatusInternalServerError)
		return
	}

	// Prevent React frontend crashes by ensuring we send [] instead of null
	if notifications == nil {
		notifications = make([]models.Notification, 0)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(notifications)
}

// MarkRead flags a specific notification as read
func (h *NotificationHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := notificationUserID(r)
	if !ok {
		http.Error(w, `{"error": "Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	notifID := chi.URLParam(r, "id")
	if notifID == "" {
		http.Error(w, `{"error": "`+localized(r.Context(), "ErrNotificationIdRequired", "Notification ID is required")+`"}`, http.StatusBadRequest)
		return
	}

	if err := h.Repo.MarkNotificationsRead(userID, notifID); err != nil {
		log.Printf("[NOTIF ERROR] Failed to mark %s read for %s: %v", notifID, userID, err)
		http.Error(w, `{"error": "`+localized(r.Context(), "ErrFailedMarkNotificationRead", "Failed to mark notification read")+`"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgNotificationRead", "Notification marked as read")})
}

// MarkAllRead instantly clears the user's unread badge
func (h *NotificationHandler) MarkAllRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := notificationUserID(r)
	if !ok {
		http.Error(w, `{"error": "`+localized(r.Context(), "ErrUnauthorized", "Unauthorized")+`"}`, http.StatusUnauthorized)
		return
	}

	if err := h.Repo.MarkAllNotificationsRead(userID); err != nil {
		log.Printf("[NOTIF ERROR] Failed to mark all read for %s: %v", userID, err)
		http.Error(w, `{"error": "`+localized(r.Context(), "ErrFailedMarkNotificationsRead", "Failed to mark notifications read")+`"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgAllNotificationsRead", "All notifications marked as read")})
}

// Delete permanently removes a notification from the tray
func (h *NotificationHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, ok := notificationUserID(r)
	if !ok {
		http.Error(w, `{"error": "Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	notifID := chi.URLParam(r, "id")
	if notifID == "" {
		http.Error(w, `{"error": "`+localized(r.Context(), "ErrNotificationIdRequired", "Notification ID is required")+`"}`, http.StatusBadRequest)
		return
	}

	if err := h.Repo.DeleteNotification(userID, notifID); err != nil {
		log.Printf("[NOTIF ERROR] Failed to delete %s for %s: %v", notifID, userID, err)
		http.Error(w, `{"error": "`+localized(r.Context(), "ErrFailedDeleteNotification", "Failed to delete notification")+`"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgNotificationDeleted", "Notification deleted successfully")})
}
