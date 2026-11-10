package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"

	"github.com/google/uuid"
)

type ADPerformerHandler struct {
	Repo *repository.ADPerformerRepository
}

func NewADPerformerHandler(repo *repository.ADPerformerRepository) *ADPerformerHandler {
	return &ADPerformerHandler{Repo: repo}
}

func (h *ADPerformerHandler) SubmitApplication(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		VerificationRef string `json:"verification_ref"`
		PayoutMethodID  string `json:"payout_method_id"`
		PolicyVersion   string `json:"policy_version"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	app := &models.PerformerApplication{
		ID:              uuid.New().String(),
		UserID:          userID,
		Status:          "pending",
		VerificationRef: req.VerificationRef,
		PayoutMethodID:  req.PayoutMethodID,
		PolicyVersion:   req.PolicyVersion,
		SubmittedAt:     time.Now(),
	}

	consents := []models.PerformerConsent{
		{
			ID:            uuid.New().String(),
			UserID:        userID,
			ConsentType:   "explicit_content_creation",
			PolicyVersion: req.PolicyVersion,
			AcceptedAt:    time.Now(),
		},
	}

	if err := h.Repo.SubmitApplication(r.Context(), app, consents); err != nil {
		http.Error(w, "Failed to submit application", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Creator application submitted successfully",
		"status":  app.Status,
		"id":      app.ID,
	})
}
