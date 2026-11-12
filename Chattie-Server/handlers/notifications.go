package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/go-chi/chi/v5"
)

type NotificationHandler struct {
	Repo *repository.Repository
	Push *services.WebPushService
}

func NewNotificationHandler(repo *repository.Repository, push ...*services.WebPushService) *NotificationHandler {
	handler := &NotificationHandler{Repo: repo}
	if len(push) > 0 {
		handler.Push = push[0]
	}
	return handler
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

func (h *NotificationHandler) GetVAPIDPublicKey(w http.ResponseWriter, r *http.Request) {
	if h.Push == nil || !h.Push.Configured() {
		http.Error(w, `{"error":"Background notifications are not configured"}`, http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"public_key": h.Push.PublicKey()})
}

func (h *NotificationHandler) SavePushSubscription(w http.ResponseWriter, r *http.Request) {
	userID, ok := notificationUserID(r)
	if !ok {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}
	if h.Push == nil || !h.Push.Configured() {
		http.Error(w, `{"error":"Background notifications are not configured"}`, http.StatusServiceUnavailable)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	var req struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256DH string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid subscription payload"}`, http.StatusBadRequest)
		return
	}
	req.Endpoint = strings.TrimSpace(req.Endpoint)
	parsedEndpoint, err := url.ParseRequestURI(req.Endpoint)
	if err != nil || parsedEndpoint.Scheme != "https" || parsedEndpoint.Host == "" ||
		len(req.Endpoint) > 4096 || req.Keys.P256DH == "" || req.Keys.Auth == "" ||
		len(req.Keys.P256DH) > 512 || len(req.Keys.Auth) > 512 {
		http.Error(w, `{"error":"Invalid browser push subscription"}`, http.StatusBadRequest)
		return
	}
	if err := h.Repo.SaveWebPushSubscription(r.Context(), userID, repository.WebPushSubscription{
		Endpoint: req.Endpoint,
		P256DH:   req.Keys.P256DH,
		Auth:     req.Keys.Auth,
	}); err != nil {
		if errors.Is(err, repository.ErrWebPushSubscriptionOwned) {
			http.Error(w, `{"error":"This browser push subscription is associated with another account. Disable it there before transferring it."}`, http.StatusConflict)
			return
		}
		log.Printf("[PUSH ERROR] Failed to save subscription for %s: %v", userID, err)
		http.Error(w, `{"error":"Could not save push subscription"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *NotificationHandler) DeletePushSubscription(w http.ResponseWriter, r *http.Request) {
	userID, ok := notificationUserID(r)
	if !ok {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Endpoint) == "" {
		http.Error(w, `{"error":"Push endpoint is required"}`, http.StatusBadRequest)
		return
	}
	if err := h.Repo.DeleteWebPushSubscription(r.Context(), userID, strings.TrimSpace(req.Endpoint)); err != nil {
		log.Printf("[PUSH ERROR] Failed to remove subscription for %s: %v", userID, err)
		http.Error(w, `{"error":"Could not remove push subscription"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
