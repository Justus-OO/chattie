package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
)

type ExtrasHandler struct {
	Repo *repository.Repository // Using your previous repository structure
}

func NewExtrasHandler(repo *repository.Repository) *ExtrasHandler {
	return &ExtrasHandler{Repo: repo}
}

// =====================================================================
// 1. SECRET ADMIRERS HANDLER
// =====================================================================
func (h *ExtrasHandler) GetSecretAdmirers(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	profiles, isPremium, err := h.Repo.GetSecretAdmirers(r.Context(), userID)
	if err != nil {
		http.Error(w, "Failed to load admirers", http.StatusInternalServerError)
		return
	}

	// Prevent React from crashing if the user has 0 admirers
	if profiles == nil {
		profiles = []models.DiscoverProfile{}
	}

	// SECURITY: If the user is not premium, we MUST obfuscate the data here on the backend.
	if !isPremium {
		for i := range profiles {
			profiles[i].DisplayName = "Hidden Identity"
			profiles[i].Bio = ""
			profiles[i].City = "Nearby"
			profiles[i].Tags = []string{}

			// Leave just the first image so React can blur it, clear the rest
			if len(profiles[i].Images) > 0 {
				profiles[i].Images = []string{profiles[i].Images[0]}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")

	// We can return a wrapper object so React knows if it needs to show the Upgrade Modal
	json.NewEncoder(w).Encode(map[string]interface{}{
		"is_premium": isPremium,
		"admirers":   profiles,
	})
}

// =====================================================================
// 2. UNDO SWIPE HANDLER
// =====================================================================
func (h *ExtrasHandler) UndoAction(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	err := h.Repo.UndoLastAction(r.Context(), userID)
	if err != nil {
		if errors.Is(err, repository.ErrPermissionDenied) {
			http.Error(w, "Upgrade to Premium to Undo actions", http.StatusForbidden)
			return
		}
		if err == sql.ErrNoRows {
			http.Error(w, "Nothing to undo", http.StatusBadRequest)
			return
		}
		http.Error(w, "Failed to undo action", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Action undone successfully"})
}

// =====================================================================
// 3. REPORT USER HANDLER
// =====================================================================
func (h *ExtrasHandler) ReportUser(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var payload struct {
		ReportedID string `json:"reported_id"`
		Reason     string `json:"reason"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	if payload.ReportedID == "" || payload.Reason == "" {
		http.Error(w, "Missing fields", http.StatusBadRequest)
		return
	}

	err := h.Repo.ReportUser(r.Context(), userID, payload.ReportedID, strings.ToUpper(payload.Reason))
	if err != nil {
		http.Error(w, "Failed to submit report", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "User reported and blocked"})
}

// =====================================================================
// 4. VIP UPGRADE HANDLER (NEW)
// =====================================================================
func (h *ExtrasHandler) HandleUpgrade(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req models.UpgradeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	// Default to 1 month if not provided
	months := req.PlanID
	if months <= 0 {
		months = 1
	}

	if err := h.Repo.UpgradeToPremium(r.Context(), userID, months); err != nil {
		http.Error(w, "Failed to process upgrade", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "VIP status activated successfully"})
}

// =====================================================================
// 5. AGREE TO GUIDELINES HANDLER (NEW)
// =====================================================================
func (h *ExtrasHandler) HandleAgreeGuidelines(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.Repo.AgreeToGuidelines(r.Context(), userID); err != nil {
		http.Error(w, "Failed to update settings", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Guidelines acknowledged"})
}
