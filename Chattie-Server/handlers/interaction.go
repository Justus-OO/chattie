package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services" // <-- Imported the new services package

	"github.com/go-chi/chi/v5"
)

type InteractionHandler struct {
	Repo   *repository.Repository
	Events *services.EventHandler // <-- Injected the generic notification engine
}

// NewInteractionHandler creates a new instance of the handler
func NewInteractionHandler(repo *repository.Repository, events *services.EventHandler) *InteractionHandler {
	return &InteractionHandler{
		Repo:   repo,
		Events: events,
	}
}

func (h *InteractionHandler) HandleAction(w http.ResponseWriter, r *http.Request) {
	// 1. Get user ID from JWT middleware context
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	// 2. Parse the request body
	var req models.InteractionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidPayload", "Invalid request payload"), http.StatusBadRequest)
		return
	}

	// 3. Basic validation
	if req.TargetID == "" || req.ActionType == "" {
		http.Error(w, localized(r.Context(), "ErrMissingInteractionFields", "Missing required fields: target_id and action_type are required"), http.StatusBadRequest)
		return
	}

	// Validate action types
	validActions := map[string]bool{"LIKE": true, "PASS": true, "SUPER_LIKE": true, "FLIRT": true}
	if !validActions[req.ActionType] {
		http.Error(w, localized(r.Context(), "ErrInvalidActionType", "Invalid action type"), http.StatusBadRequest)
		return
	}

	// Prevent swiping on yourself
	if req.TargetID == userID {
		http.Error(w, localized(r.Context(), "ErrCannotInteractSelf", "Cannot interact with yourself"), http.StatusBadRequest)
		return
	}

	// 4. Process through Repository
	resp, err := h.Repo.ProcessAction(r.Context(), userID, req)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedProcessAction", "Failed to process action"), http.StatusInternalServerError)
		return
	}

	// Safety guard: ensure resp is never nil if err is nil
	if resp == nil {
		http.Error(w, localized(r.Context(), "ErrInternalServer", "Internal server error"), http.StatusInternalServerError)
		return
	}

	// 5. Send JSON response
	w.Header().Set("Content-Type", "application/json")

	// Prevent the "Double-Swipe Upgrade Modal" bug
	if !resp.Allowed {
		if resp.Message == "Already interacted with this user" {
			// Send 409 Conflict if they just mashed the button twice
			w.WriteHeader(http.StatusConflict)
		} else {
			// Send 402 Payment Required ONLY if they hit their actual swipe limits
			w.WriteHeader(http.StatusPaymentRequired)
		}
	} else {
		// --- NOTIFICATION TRIGGER ---
		// If the action was allowed, and it's a positive interaction, feed the event engine.
		if req.ActionType == "LIKE" || req.ActionType == "SUPER_LIKE" || req.ActionType == "FLIRT" {

			detachedCtx := context.WithoutCancel(r.Context())
			go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
				RecipientID:      req.TargetID,
				WSEventType:      "NEW_INTERACTION",
				WSPayload:        map[string]interface{}{"type": req.ActionType},
				EmailTemplate:    "new_like",
				EmailNotifColumn: "notif_likes",
			})
		}

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
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	// 2. Fetch matches from database
	matches, err := h.Repo.GetMatches(r.Context(), userID)
	if err != nil {
		log.Printf("CRITICAL: Failed to load matches for user %s: %v\n", userID, err)
		http.Error(w, localized(r.Context(), "ErrFailedLoadMatches", "Failed to load matches"), http.StatusInternalServerError)
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
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	// Extract target_id from the URL (e.g., /api/interactions/profile/{target_id})
	targetID := chi.URLParam(r, "target_id")
	if targetID == "" {
		http.Error(w, localized(r.Context(), "ErrTargetIdRequired", "Target ID is required"), http.StatusBadRequest)
		return
	}

	profile, err := h.Repo.GetFullProfile(r.Context(), userID, targetID)
	if err != nil {
		if err == repository.ErrUserNotFound {
			http.Error(w, localized(r.Context(), "ErrUserProfileNotFound", "User profile not found"), http.StatusNotFound)
			return
		}
		log.Printf("Failed to load profile for %s: %v\n", targetID, err)
		http.Error(w, localized(r.Context(), "ErrFailedLoadProfile", "Failed to load profile"), http.StatusInternalServerError)
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
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	// We expect a JSON body like: { "target_id": "uuid-here" }
	var payload struct {
		TargetID string `json:"target_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.TargetID == "" {
		http.Error(w, localized(r.Context(), "ErrInvalidTargetIdPayload", "Invalid payload. 'target_id' is required."), http.StatusBadRequest)
		return
	}

	if err := h.Repo.UnmatchUser(r.Context(), userID, payload.TargetID); err != nil {
		log.Printf("Failed to unmatch %s and %s: %v\n", userID, payload.TargetID, err)
		http.Error(w, localized(r.Context(), "ErrFailedUnmatchUser", "Failed to unmatch user"), http.StatusInternalServerError)
		return
	}

	// Log the unmatch action for audit trail
	ActionLogQueue <- models.ActionLog{
		UserID:     userID,
		ActionType: "UNMATCH",
		TargetID:   payload.TargetID,
		IP:         r.RemoteAddr,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgUserUnmatched", "User unmatched successfully")})
}

func (h *InteractionHandler) BlockUser(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	var payload struct {
		TargetID string `json:"target_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.TargetID == "" {
		http.Error(w, localized(r.Context(), "ErrInvalidTargetIdPayload", "Invalid payload. 'target_id' is required."), http.StatusBadRequest)
		return
	}

	if err := h.Repo.BlockUser(r.Context(), userID, payload.TargetID); err != nil {
		log.Printf("Failed to block %s by %s: %v\n", payload.TargetID, userID, err)
		http.Error(w, localized(r.Context(), "ErrFailedBlockUser", "Failed to block user"), http.StatusInternalServerError)
		return
	}

	// Log the block action for audit trail
	ActionLogQueue <- models.ActionLog{
		UserID:     userID,
		ActionType: "BLOCK_USER",
		TargetID:   payload.TargetID,
		IP:         r.RemoteAddr,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgUserPermanentlyBlocked", "User permanently blocked")})
}
