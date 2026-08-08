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

type CreatorHandler struct {
	Repo *repository.Repository
}

func NewCreatorHandler(repo *repository.Repository) *CreatorHandler {
	return &CreatorHandler{Repo: repo}
}

// helper to send standard JSON responses
func sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// helper to send error responses
func sendError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// GetStats returns the live metrics for the dashboard
func (h *CreatorHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	stats, err := h.Repo.GetCreatorStats(r.Context(), userID)
	if err != nil {
		log.Printf("Error fetching creator stats for user %s: %v", userID, err)
		sendError(w, http.StatusInternalServerError, "Failed to load dashboard data")
		return
	}

	sendJSON(w, http.StatusOK, stats)
}

// ProcessQueueAction handles accepting or rejecting client chat requests
func (h *CreatorHandler) ProcessQueueAction(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	profileID := r.URL.Query().Get("profile_id")
	if profileID == "" {
		sendError(w, http.StatusBadRequest, "Missing profile_id query parameter")
		return
	}
	reqID := chi.URLParam(r, "request_id")
	if reqID == "" {
		sendError(w, http.StatusBadRequest, "Missing request_id URL parameter")
		return
	}

	var payload models.QueueActionRequest
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	if payload.Action != "accept" && payload.Action != "reject" {
		sendError(w, http.StatusBadRequest, "Invalid action type: must be 'accept' or 'reject'")
		return
	}

	err := h.Repo.ProcessQueueAction(r.Context(), reqID, profileID, payload.Action)
	if err != nil {
		log.Printf("Error processing queue action for req %s: %v", reqID, err)
		sendError(w, http.StatusInternalServerError, "Failed to process request")
		return
	}

	sendJSON(w, http.StatusOK, map[string]string{"message": "Queue updated successfully"})
}

// GetLedger returns the transaction history
func (h *CreatorHandler) GetLedger(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	txs, err := h.Repo.GetTransactions(r.Context(), userID)
	if err != nil {
		log.Printf("Error fetching ledger for user %s: %v", userID, err)
		sendError(w, http.StatusInternalServerError, "Failed to load transactions")
		return
	}

	sendJSON(w, http.StatusOK, txs)
}

// RequestPayout processes wire withdrawal requests
func (h *CreatorHandler) RequestPayout(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	var payload models.PayoutRequest
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	err := h.Repo.RequestPayout(r.Context(), userID, payload.Amount)
	if err != nil {
		log.Printf("Payout error for user %s: %v", userID, err)
		sendError(w, http.StatusBadRequest, err.Error()) // Pass through exact reason (e.g., "insufficient funds")
		return
	}

	sendJSON(w, http.StatusOK, map[string]string{"message": "Payout requested successfully"})
}

// GetProfiles handles GET /api/creator/profiles
func (h *CreatorHandler) GetProfiles(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	profiles, err := h.Repo.GetAssignedProfiles(r.Context(), userID)
	if err != nil {
		log.Printf("Error fetching managed profiles for user %s: %v", userID, err)
		sendError(w, http.StatusInternalServerError, "Failed to load profiles")
		return
	}

	sendJSON(w, http.StatusOK, profiles)
}

// UpdateStatus handles PATCH /api/creator/profiles/{profile_id}/status
func (h *CreatorHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	profileID := chi.URLParam(r, "profile_id")
	if profileID == "" {
		sendError(w, http.StatusBadRequest, "Missing profile_id URL parameter")
		return
	}

	var payload models.UpdateStatusRequest
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	if payload.Status != "online" && payload.Status != "offline" && payload.Status != "busy" {
		sendError(w, http.StatusBadRequest, "Invalid status value")
		return
	}

	err := h.Repo.UpdateProfileStatus(r.Context(), profileID, userID, payload.Status)
	if err != nil {
		log.Printf("Error updating status for profile %s: %v", profileID, err)
		sendError(w, http.StatusInternalServerError, "Failed to update profile status")
	}

	sendJSON(w, http.StatusOK, map[string]string{"message": "Status updated successfully"})
}

// GetQueue handles GET /api/creator/queue?profile_id=XYZ
func (h *CreatorHandler) GetQueue(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	profileID := r.URL.Query().Get("profile_id")
	if profileID == "" {
		sendError(w, http.StatusBadRequest, "Missing profile_id query parameter")
		return
	}

	queue, err := h.Repo.GetChatQueueForProfile(r.Context(), profileID)
	if err != nil {
		log.Printf("Error fetching queue for profile %s: %v", profileID, err)
		sendError(w, http.StatusInternalServerError, "Failed to load queue")
		return
	}

	sendJSON(w, http.StatusOK, queue)
}

// GetProfileMedia handles GET /api/creator/profiles/{profile_id}/media
func (h *CreatorHandler) GetProfileMedia(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	profileID := chi.URLParam(r, "profile_id")
	if profileID == "" {
		sendError(w, http.StatusBadRequest, "Missing profile_id URL parameter")
		return
	}

	media, err := h.Repo.GetProfileMedia(r.Context(), profileID, userID)
	if err != nil {
		log.Printf("Error fetching media for profile %s: %v", profileID, err)
		sendError(w, http.StatusInternalServerError, "Failed to load profile media")
		return
	}

	sendJSON(w, http.StatusOK, media)
}

// ToggleOnlineStatus handles POST /api/creator/status
func (h *CreatorHandler) ToggleOnlineStatus(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	var payload struct {
		IsOnline bool `json:"is_online"`
	}
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid payload")
		return
	}

	err := h.Repo.UpdateCreatorOnlineStatus(r.Context(), userID, payload.IsOnline)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to update status")
		return
	}

	sendJSON(w, http.StatusOK, map[string]bool{"is_online": payload.IsOnline})
}
