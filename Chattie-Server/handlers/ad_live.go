package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"

	"database/sql"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

type ADLiveHandler struct {
	Repo       *repository.ADLiveRepository
	RoomClient *lksdk.RoomServiceClient
	APIKey     string
	APISecret  string
}

// NewADLiveHandler initializes the handler and the LiveKit RoomServiceClient
func NewADLiveHandler(repo *repository.ADLiveRepository) *ADLiveHandler {
	apiKey := os.Getenv("LIVEKIT_API_KEY")
	apiSecret := os.Getenv("LIVEKIT_API_SECRET")
	livekitURL := os.Getenv("LIVEKIT_URL") // e.g., "https://your-project.livekit.cloud"

	var roomClient *lksdk.RoomServiceClient
	if apiKey != "" && apiSecret != "" && livekitURL != "" {
		roomClient = lksdk.NewRoomServiceClient(livekitURL, apiKey, apiSecret)
	}

	return &ADLiveHandler{
		Repo:       repo,
		RoomClient: roomClient,
		APIKey:     apiKey,
		APISecret:  apiSecret,
	}
}

// POST /api/afterdark/live-sessions
func (h *ADLiveHandler) StartLive(w http.ResponseWriter, r *http.Request) {
	creatorID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || creatorID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if h.APIKey == "" || h.APISecret == "" || h.RoomClient == nil {
		http.Error(w, "Live streaming is not configured", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		PriceCents int64 `json:"price_cents"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.PriceCents < 0 {
		http.Error(w, "Price cannot be negative", http.StatusBadRequest)
		return
	}

	session := &models.ADLiveSession{
		ID:         uuid.New().String(),
		CreatorID:  creatorID,
		Status:     "live",
		PriceCents: req.PriceCents,
		StartedAt:  time.Now(),
	}

	// 1. Mint Host SFU Token via LiveKit (CanPublish = true)
	t := true
	at := auth.NewAccessToken(h.APIKey, h.APISecret)
	grant := &auth.VideoGrant{
		RoomJoin:       true,
		Room:           session.ID,
		CanPublish:     &t,
		CanSubscribe:   &t,
		CanPublishData: &t,
	}

	hostToken, err := at.
		AddGrant(grant).
		SetIdentity(creatorID).     // The host's user ID is their identity
		SetValidFor(time.Hour * 4). // Max session length
		ToJWT()

	if err != nil {
		http.Error(w, "Failed to generate LiveKit token", http.StatusInternalServerError)
		return
	}
	if err := h.Repo.StartSession(r.Context(), session); err != nil {
		http.Error(w, "Failed to start session in database", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"session_id": session.ID,
		"sfu_token":  hostToken,
	})
}

// POST /api/afterdark/live-sessions/{sessionId}/join
func (h *ADLiveHandler) JoinLive(w http.ResponseWriter, r *http.Request) {
	viewerID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || viewerID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	sessionID := chi.URLParam(r, "sessionId")
	if h.APIKey == "" || h.APISecret == "" {
		http.Error(w, "Live streaming is not configured", http.StatusServiceUnavailable)
		return
	}

	hasAccess, err := h.Repo.VerifyAccess(r.Context(), viewerID, sessionID)
	if err != nil {
		http.Error(w, "Failed to verify access", http.StatusInternalServerError)
		return
	}

	if !hasAccess {
		http.Error(w, "Payment or active subscription required to join this live session", http.StatusForbidden)
		return
	}

	// Mint a viewer token with publish disabled.
	t := true
	f := false
	at := auth.NewAccessToken(h.APIKey, h.APISecret)
	grant := &auth.VideoGrant{
		RoomJoin:       true,
		Room:           sessionID,
		CanPublish:     &f,
		CanSubscribe:   &t,
		CanPublishData: &t,
	}

	viewerToken, err := at.
		AddGrant(grant).
		SetIdentity(viewerID).
		SetValidFor(time.Hour * 4).
		ToJWT()
	if err != nil {
		http.Error(w, "Failed to generate LiveKit token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "joined",
		"sfu_token": viewerToken,
	})
}

// GET /api/afterdark/live-sessions
func (h *ADLiveHandler) GetLiveSessions(w http.ResponseWriter, r *http.Request) {
	creatorID := r.URL.Query().Get("creator_id")
	sessions, err := h.Repo.GetLiveSessions(r.Context(), creatorID)
	if err != nil {
		http.Error(w, "Failed to fetch live sessions", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}

// POST /api/afterdark/live-sessions/{sessionId}/leave
func (h *ADLiveHandler) LeaveLive(w http.ResponseWriter, r *http.Request) {
	viewerID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || viewerID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	sessionID := chi.URLParam(r, "sessionId")
	err := h.Repo.LeaveSession(r.Context(), sessionID, viewerID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "Failed to leave live session", http.StatusInternalServerError)
		return
	}
	if h.RoomClient != nil {
		if _, err := h.RoomClient.RemoveParticipant(r.Context(), &livekit.RoomParticipantIdentity{
			Room: sessionID, Identity: viewerID,
		}); err != nil {
			http.Error(w, "Failed to leave live session", http.StatusBadGateway)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "left"})
}

// POST /api/afterdark/live-sessions/{sessionId}/end
func (h *ADLiveHandler) EndLive(w http.ResponseWriter, r *http.Request) {
	creatorID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || creatorID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	sessionID := chi.URLParam(r, "sessionId")

	// Update the database first
	if err := h.Repo.EndSession(r.Context(), sessionID, creatorID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// 1. Forcefully terminate the room in LiveKit to boot all viewers instantly
	if h.RoomClient != nil {
		_, err := h.RoomClient.DeleteRoom(r.Context(), &livekit.DeleteRoomRequest{
			Room: sessionID,
		})
		if err != nil {
			// Non-fatal, the room might already be empty/deleted
			// log.Printf("Warning: Failed to delete LiveKit room: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ended"})
}

// POST /api/afterdark/live-sessions/{sessionId}/guest-requests
func (h *ADLiveHandler) RequestStage(w http.ResponseWriter, r *http.Request) {
	viewerID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || viewerID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	sessionID := chi.URLParam(r, "sessionId")

	hasAccess, err := h.Repo.VerifyAccess(r.Context(), viewerID, sessionID)
	if err != nil {
		http.Error(w, "Failed to verify live session access", http.StatusInternalServerError)
		return
	}
	if !hasAccess {
		http.Error(w, "Live session access is required to request the stage", http.StatusForbidden)
		return
	}
	if err := h.Repo.UpsertStageRequest(r.Context(), sessionID, viewerID, "requested"); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "Live session not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Failed to request stage", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "requested"})
}

// POST /api/afterdark/live-sessions/{sessionId}/guest-requests/{viewerId}/approve
func (h *ADLiveHandler) ApproveGuest(w http.ResponseWriter, r *http.Request) {
	creatorID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || creatorID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	sessionID := chi.URLParam(r, "sessionId")
	guestID := chi.URLParam(r, "viewerId")
	isCreator, err := h.Repo.IsSessionCreator(r.Context(), sessionID, creatorID)
	if err != nil {
		http.Error(w, "Failed to verify session ownership", http.StatusInternalServerError)
		return
	}
	if !isCreator {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}
	if h.RoomClient == nil {
		http.Error(w, "Live streaming is not configured", http.StatusServiceUnavailable)
		return
	}

	// 1. Update Database
	if err := h.Repo.UpsertStageRequest(r.Context(), sessionID, guestID, "approved"); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "Guest request not found or already handled", http.StatusNotFound)
			return
		}
		http.Error(w, "Failed to approve guest", http.StatusInternalServerError)
		return
	}

	// 2. Use LiveKit Server SDK to dynamically upgrade the viewer's token permissions
	if h.RoomClient != nil {
		_, err := h.RoomClient.UpdateParticipant(r.Context(), &livekit.UpdateParticipantRequest{
			Room:     sessionID,
			Identity: guestID,
			Permission: &livekit.ParticipantPermission{
				CanPublish:     true, // Grant camera/mic access
				CanSubscribe:   true,
				CanPublishData: true,
			},
		})
		if err != nil {
			http.Error(w, "Failed to update participant permissions in LiveKit", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "approved"})
}

// POST /api/afterdark/live-sessions/{sessionId}/guest-requests/{viewerId}/deny
func (h *ADLiveHandler) DenyGuest(w http.ResponseWriter, r *http.Request) {
	creatorID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || creatorID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	err := h.Repo.DenyStageRequest(
		r.Context(),
		chi.URLParam(r, "sessionId"),
		chi.URLParam(r, "viewerId"),
		creatorID,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "Guest request not found or already handled", http.StatusNotFound)
			return
		}
		http.Error(w, "Failed to deny guest request", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "denied"})
}

// POST /api/afterdark/live-sessions/{sessionId}/stage/{participantId}/remove
func (h *ADLiveHandler) RemoveGuest(w http.ResponseWriter, r *http.Request) {
	creatorID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || creatorID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	sessionID := chi.URLParam(r, "sessionId")
	guestID := chi.URLParam(r, "participantId")
	isCreator, err := h.Repo.IsSessionCreator(r.Context(), sessionID, creatorID)
	if err != nil {
		http.Error(w, "Failed to verify session ownership", http.StatusInternalServerError)
		return
	}
	if !isCreator {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}
	if h.RoomClient == nil {
		http.Error(w, "Live streaming is not configured", http.StatusServiceUnavailable)
		return
	}

	// 1. Update Database
	if err := h.Repo.UpsertStageRequest(r.Context(), sessionID, guestID, "removed"); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "Guest not found on stage", http.StatusNotFound)
			return
		}
		http.Error(w, "Failed to remove guest", http.StatusInternalServerError)
		return
	}

	// 2. Use LiveKit Server SDK to dynamically downgrade the viewer's token permissions
	if h.RoomClient != nil {
		_, err := h.RoomClient.UpdateParticipant(r.Context(), &livekit.UpdateParticipantRequest{
			Room:     sessionID,
			Identity: guestID,
			Permission: &livekit.ParticipantPermission{
				CanPublish:     false, // Revoke camera/mic access
				CanSubscribe:   true,  // They can still watch
				CanPublishData: true,
			},
		})
		if err != nil {
			http.Error(w, "Failed to revoke participant permissions in LiveKit", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "removed"})
}
