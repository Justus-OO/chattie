package handlers

import (
	"encoding/json"
	"net/http"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"

	"github.com/google/uuid"
)

type ADSettingsHandler struct {
	Repo *repository.ADSettingsRepository
}

func NewADSettingsHandler(repo *repository.ADSettingsRepository) *ADSettingsHandler {
	return &ADSettingsHandler{Repo: repo}
}

// POST /api/afterdark/me/creator-pause
func (h *ADSettingsHandler) PauseCreator(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.Repo.UpdateCreatorStatus(r.Context(), userID, "paused"); err != nil {
		http.Error(w, "Failed to pause creator profile", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "paused", "message": "Creator profile paused successfully"})
}

// DELETE /api/afterdark/me/creator-pause
func (h *ADSettingsHandler) ResumeCreator(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.Repo.UpdateCreatorStatus(r.Context(), userID, "active"); err != nil {
		http.Error(w, "Failed to resume creator profile", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "active", "message": "Creator profile resumed successfully"})
}

// DELETE /api/afterdark/me/creator-status
func (h *ADSettingsHandler) DeactivateCreator(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Sets status to deactivated, keeping historical ledger/chat data intact
	if err := h.Repo.UpdateCreatorStatus(r.Context(), userID, "deactivated"); err != nil {
		http.Error(w, "Failed to deactivate creator profile", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deactivated", "message": "Creator profile permanently deactivated"})
}

// PATCH /api/afterdark/me/settings
func (h *ADSettingsHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var settings models.ADCreatorSettings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	settings.UserID = userID

	if err := h.Repo.UpsertCreatorSettings(r.Context(), &settings); err != nil {
		http.Error(w, "Failed to update settings", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success", "message": "Settings saved"})
}

// POST /api/afterdark/me/data-export
func (h *ADSettingsHandler) RequestDataExport(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	jobID := uuid.New().String()
	if err := h.Repo.QueueDataExport(r.Context(), jobID, userID); err != nil {
		http.Error(w, "Failed to queue export job", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"job_id":  jobID,
		"status":  "pending",
		"message": "Data export archive queued",
	})
}

// GET /api/afterdark/me/settings
func (h *ADSettingsHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	settings, err := h.Repo.GetSettings(r.Context(), userID)
	if err != nil {
		http.Error(w, "Failed to fetch settings", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}
