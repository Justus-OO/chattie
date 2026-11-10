package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"chattie-backend/middlewares"
	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
)

type ADSubscriptionHandler struct {
	Repo *repository.ADSubscriptionRepository
}

func NewADSubscriptionHandler(repo *repository.ADSubscriptionRepository) *ADSubscriptionHandler {
	return &ADSubscriptionHandler{Repo: repo}
}

// POST /api/afterdark/creators/{creatorId}/subscriptions
func (h *ADSubscriptionHandler) Subscribe(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	creatorID := chi.URLParam(r, "creatorId")

	err := h.Repo.Subscribe(r.Context(), userID, creatorID)
	if err != nil {
		if err.Error() == "insufficient funds" {
			http.Error(w, "Insufficient wallet balance", http.StatusPaymentRequired)
			return
		}
		if err == sql.ErrNoRows {
			http.Error(w, "Creator not found", http.StatusNotFound)
			return
		}
		if err.Error() == "cannot subscribe to yourself" || err.Error() == "creator subscription is not available" {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		http.Error(w, "Subscription failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "success",
		"message": "Subscribed successfully",
	})
}

// GET /api/afterdark/me/subscriptions
func (h *ADSubscriptionHandler) GetMySubscriptions(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	subs, err := h.Repo.GetMySubscriptions(r.Context(), userID)
	if err != nil {
		http.Error(w, "Failed to fetch subscriptions", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(subs)
}
