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

type InteractionHandler struct {
	Repo *repository.Repository
}

// NewInteractionHandler creates a new instance of the handler
func NewInteractionHandler(repo *repository.Repository) *InteractionHandler {
	return &InteractionHandler{Repo: repo}
}

// =====================================================================
// 1. SWIPES & INTERACTIONS
// =====================================================================

// HandleAction processes a swipe, flirt, or pass from the frontend
func (h *InteractionHandler) HandleAction(w http.ResponseWriter, r *http.Request) {
	// 1. Get user ID from JWT middleware context
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// 2. Parse the request body
	var req models.InteractionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request payload", http.StatusBadRequest)
		return
	}

	// 3. Basic validation
	if req.TargetID == "" || req.ActionType == "" {
		http.Error(w, "Missing required fields: target_id and action_type are required", http.StatusBadRequest)
		return
	}

	// Validate action types
	validActions := map[string]bool{"LIKE": true, "PASS": true, "SUPER_LIKE": true, "FLIRT": true}
	if !validActions[req.ActionType] {
		http.Error(w, "Invalid action type", http.StatusBadRequest)
		return
	}

	// Prevent swiping on yourself
	if req.TargetID == userID {
		http.Error(w, "Cannot interact with yourself", http.StatusBadRequest)
		return
	}

	// 4. Process through Repository
	resp, err := h.Repo.ProcessAction(r.Context(), userID, req)
	if err != nil {
		http.Error(w, "Failed to process action", http.StatusInternalServerError)
		return
	}

	// Safety guard: ensure resp is never nil if err is nil
	if resp == nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// 5. Send JSON response
	w.Header().Set("Content-Type", "application/json")

	// FIXED: Prevent the "Double-Swipe Upgrade Modal" bug
	if !resp.Allowed {
		if resp.Message == "Already interacted with this user" {
			// Send 409 Conflict if they just mashed the button twice
			w.WriteHeader(http.StatusConflict)
		} else {
			// Send 402 Payment Required ONLY if they hit their actual swipe limits
			w.WriteHeader(http.StatusPaymentRequired)
		}
	} else {
		w.WriteHeader(http.StatusOK)
	}

	json.NewEncoder(w).Encode(resp)
}

// =====================================================================
// 2. MATCH LISTING
// =====================================================================

func (h *InteractionHandler) GetMatches(w http.ResponseWriter, r *http.Request) {
	// 1. Get user ID from JWT middleware context
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// 2. Fetch matches from database
	matches, err := h.Repo.GetMatches(r.Context(), userID)
	if err != nil {
		log.Printf("CRITICAL: Failed to load matches for user %s: %v\n", userID, err)
		http.Error(w, "Failed to load matches", http.StatusInternalServerError)
		return
	}

	// 3. Send JSON response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(matches)
}

// =====================================================================
// 3. GET FULL PROFILE (For Chat/Grid Avatars)
// =====================================================================

func (h *InteractionHandler) GetFullProfile(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Extract target_id from the URL (e.g., /api/interactions/profile/{target_id})
	targetID := chi.URLParam(r, "target_id")
	if targetID == "" {
		http.Error(w, "Target ID is required", http.StatusBadRequest)
		return
	}

	profile, err := h.Repo.GetFullProfile(r.Context(), userID, targetID)
	if err != nil {
		if err == repository.ErrUserNotFound {
			http.Error(w, "User profile not found", http.StatusNotFound)
			return
		}
		log.Printf("Failed to load profile for %s: %v\n", targetID, err)
		http.Error(w, "Failed to load profile", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(profile)
}

// =====================================================================
// 4. DESTRUCTIVE ACTIONS (Unmatch & Block)
// =====================================================================

func (h *InteractionHandler) UnmatchUser(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// We expect a JSON body like: { "target_id": "uuid-here" }
	var payload struct {
		TargetID string `json:"target_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.TargetID == "" {
		http.Error(w, "Invalid payload. 'target_id' is required.", http.StatusBadRequest)
		return
	}

	if err := h.Repo.UnmatchUser(r.Context(), userID, payload.TargetID); err != nil {
		log.Printf("Failed to unmatch %s and %s: %v\n", userID, payload.TargetID, err)
		http.Error(w, "Failed to unmatch user", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "User unmatched successfully"})
}

func (h *InteractionHandler) BlockUser(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var payload struct {
		TargetID string `json:"target_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.TargetID == "" {
		http.Error(w, "Invalid payload. 'target_id' is required.", http.StatusBadRequest)
		return
	}

	if err := h.Repo.BlockUser(r.Context(), userID, payload.TargetID); err != nil {
		log.Printf("Failed to block %s by %s: %v\n", payload.TargetID, userID, err)
		http.Error(w, "Failed to block user", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "User permanently blocked"})
}
