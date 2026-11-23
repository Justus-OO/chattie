package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"

	"database/sql"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

type ADLiveHandler struct {
	Repo          *repository.ADLiveRepository
	FinanceRepo   *repository.ADFinanceRepository
	RoomClient    *lksdk.RoomServiceClient
	APIKey        string
	APISecret     string
	UploadService *services.UploadService
}

// NewADLiveHandler initializes the handler and the LiveKit RoomServiceClient
func NewADLiveHandler(repo *repository.ADLiveRepository, financeRepo *repository.ADFinanceRepository, uploadService *services.UploadService) *ADLiveHandler {
	apiKey := os.Getenv("LIVEKIT_API_KEY")
	apiSecret := os.Getenv("LIVEKIT_API_SECRET")
	livekitURL := os.Getenv("LIVEKIT_URL") // e.g., "https://your-project.livekit.cloud"

	var roomClient *lksdk.RoomServiceClient
	if apiKey != "" && apiSecret != "" && livekitURL != "" {
		roomClient = lksdk.NewRoomServiceClient(livekitURL, apiKey, apiSecret)
	}

	return &ADLiveHandler{
		Repo:          repo,
		FinanceRepo:   financeRepo,
		RoomClient:    roomClient,
		APIKey:        apiKey,
		APISecret:     apiSecret,
		UploadService: uploadService,
	}
}

// POST /api/afterdark/live-sessions
func (h *ADLiveHandler) StartLive(w http.ResponseWriter, r *http.Request) {
	creatorID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || creatorID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	if h.APIKey == "" || h.APISecret == "" || h.RoomClient == nil {
		http.Error(w, localized(r.Context(), "ErrLiveStreamingIsNotConfigured", "Live streaming is not configured"), http.StatusServiceUnavailable)
		return
	}

	var req struct {
		PriceCents int64 `json:"price_cents"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBody", "Invalid request body"), http.StatusBadRequest)
		return
	}
	if req.PriceCents < 0 {
		http.Error(w, localized(r.Context(), "ErrPriceCannotBeNegative", "Price cannot be negative"), http.StatusBadRequest)
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
		http.Error(w, localized(r.Context(), "ErrFailedToGenerateLiveKitToken", "Failed to generate LiveKit token"), http.StatusInternalServerError)
		return
	}
	if err := h.Repo.StartSession(r.Context(), session); err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToStartSessionInDatabase", "Failed to start session in database"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"session_id": session.ID,
		"host_id":    creatorID,
		"sfu_token":  hostToken,
	})
}

// POST /api/afterdark/live-sessions/{sessionId}/join
func (h *ADLiveHandler) JoinLive(w http.ResponseWriter, r *http.Request) {
	viewerID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || viewerID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	sessionID := chi.URLParam(r, "sessionId")
	if _, err := uuid.Parse(sessionID); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidLiveSessionID", "Invalid live session ID"), http.StatusBadRequest)
		return
	}
	if h.APIKey == "" || h.APISecret == "" {
		http.Error(w, localized(r.Context(), "ErrLiveStreamingIsNotConfigured2", "Live streaming is not configured"), http.StatusServiceUnavailable)
		return
	}

	hasAccess, err := h.Repo.VerifyAccess(r.Context(), viewerID, sessionID)
	if err != nil {
		log.Printf("[AFTER DARK LIVE] Failed to verify join access for viewer %s, session %s: %v", viewerID, sessionID, err)
		http.Error(w, localized(r.Context(), "ErrFailedToVerifyAccess", "Failed to verify access"), http.StatusInternalServerError)
		return
	}

	if !hasAccess {
		http.Error(w, localized(r.Context(), "ErrPaymentOrActiveSubscriptionRequiredToJoinThisLiveSessio", "Payment or active subscription required to join this live session"), http.StatusForbidden)
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
		log.Printf("[AFTER DARK LIVE] Failed to generate viewer token for viewer %s, session %s: %v", viewerID, sessionID, err)
		http.Error(w, localized(r.Context(), "ErrFailedToGenerateLiveKitToken2", "Failed to generate LiveKit token"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "joined",
		"sfu_token": viewerToken,
	})
}

// POST /api/afterdark/live-sessions/{sessionId}/tips
func (h *ADLiveHandler) TipLiveSession(w http.ResponseWriter, r *http.Request) {
	senderID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || senderID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	if h.RoomClient == nil || h.FinanceRepo == nil {
		http.Error(w, localized(r.Context(), "ErrLiveTippingIsNotConfigured", "Live tipping is not configured"), http.StatusServiceUnavailable)
		return
	}

	var req struct {
		AmountCents int64  `json:"amount_cents"`
		Message     string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.AmountCents <= 0 {
		http.Error(w, localized(r.Context(), "ErrAValidTipAmountIsRequired", "A valid tip amount is required"), http.StatusBadRequest)
		return
	}
	if len(req.Message) > 120 {
		http.Error(w, localized(r.Context(), "ErrTipMessageIsTooLong", "Tip message is too long"), http.StatusBadRequest)
		return
	}

	sessionID := chi.URLParam(r, "sessionId")
	hasAccess, err := h.Repo.VerifyAccess(r.Context(), senderID, sessionID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToVerifyLiveSessionAccess", "Failed to verify live session access"), http.StatusInternalServerError)
		return
	}
	if !hasAccess {
		http.Error(w, localized(r.Context(), "ErrPaymentOrActiveSubscriptionRequiredToTipInThisLiveSessi", "Payment or active subscription required to tip in this live session"), http.StatusForbidden)
		return
	}

	senderName, err := h.FinanceRepo.GetTipSenderName(r.Context(), senderID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToLoadYourDisplayName", "Failed to load your display name"), http.StatusInternalServerError)
		return
	}

	tipID, err := h.FinanceRepo.SendLiveTip(r.Context(), senderID, sessionID, req.AmountCents, req.Message)
	if err != nil {
		switch err.Error() {
		case "live session not found":
			http.Error(w, localized(r.Context(), "ErrLiveSessionNotFound", "Live session not found"), http.StatusNotFound)
		case "live session access required":
			http.Error(w, localized(r.Context(), "ErrPaymentOrActiveSubscriptionRequiredToTipInThisLiveSessi2", "Payment or active subscription required to tip in this live session"), http.StatusForbidden)
		case "creator not found or unavailable":
			http.Error(w, localized(r.Context(), "ErrCreatorNotFoundOrUnavailable", "Creator not found or unavailable"), http.StatusNotFound)
		case "insufficient funds":
			http.Error(w, localized(r.Context(), "ErrInsufficientWalletFunds", "Insufficient wallet funds"), http.StatusPaymentRequired)
		case "you cannot tip yourself":
			http.Error(w, err.Error(), http.StatusBadRequest)
		default:
			http.Error(w, localized(r.Context(), "ErrFailedToSendLiveTip", "Failed to send live tip"), http.StatusInternalServerError)
		}
		return
	}

	notification := models.ADLiveTipNotification{
		Type:        "tip",
		ID:          tipID,
		SenderID:    senderID,
		SenderName:  senderName,
		AmountCents: req.AmountCents,
		Message:     req.Message,
	}
	payload, err := json.Marshal(notification)
	if err != nil {
		log.Printf("Unable to encode live tip notification for tip %s: %v", tipID, err)
	}
	alertPublished := false
	if err == nil {
		topic := "live-tip"
		_, err = h.RoomClient.SendData(r.Context(), &livekit.SendDataRequest{
			Room:  sessionID,
			Data:  payload,
			Kind:  livekit.DataPacket_RELIABLE,
			Topic: &topic,
		})
		if err != nil {
			log.Printf("Live tip %s was charged but its room alert could not be published: %v", tipID, err)
		} else {
			alertPublished = true
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":                   tipID,
		"status":               "completed",
		"amount_cents":         req.AmountCents,
		"live_alert_published": alertPublished,
	})
}

// POST /api/afterdark/live-sessions/{sessionId}/host-token
func (h *ADLiveHandler) RefreshHostToken(w http.ResponseWriter, r *http.Request) {
	creatorID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || creatorID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	if h.APIKey == "" || h.APISecret == "" {
		http.Error(w, localized(r.Context(), "ErrLiveStreamingIsNotConfigured3", "Live streaming is not configured"), http.StatusServiceUnavailable)
		return
	}

	sessionID := chi.URLParam(r, "sessionId")
	isCreator, err := h.Repo.IsLiveSessionCreator(r.Context(), sessionID, creatorID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToVerifyLiveSessionOwnership", "Failed to verify live session ownership"), http.StatusInternalServerError)
		return
	}
	if !isCreator {
		http.Error(w, localized(r.Context(), "ErrLiveSessionNotFound2", "Live session not found"), http.StatusNotFound)
		return
	}

	t := true
	token, err := auth.NewAccessToken(h.APIKey, h.APISecret).
		AddGrant(&auth.VideoGrant{
			RoomJoin:       true,
			Room:           sessionID,
			CanPublish:     &t,
			CanSubscribe:   &t,
			CanPublishData: &t,
		}).
		SetIdentity(creatorID).
		SetValidFor(time.Hour * 4).
		ToJWT()
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToGenerateLiveKitToken3", "Failed to generate LiveKit token"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"sfu_token": token})
}

// GET /api/afterdark/live-sessions
func (h *ADLiveHandler) GetLiveSessions(w http.ResponseWriter, r *http.Request) {
	creatorID := r.URL.Query().Get("creator_id")
	sessions, err := h.Repo.GetLiveSessions(r.Context(), creatorID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToFetchLiveSessions", "Failed to fetch live sessions"), http.StatusInternalServerError)
		return
	}
	for i := range sessions {
		sessions[i].AvatarURL, err = presignMediaURL(r.Context(), h.UploadService, sessions[i].AvatarURL)
		if err != nil {
			log.Printf("[AFTER DARK MEDIA] Could not sign live-session avatar: %v", err)
			http.Error(w, localized(r.Context(), "ErrCouldNotLoadCreatorImages5", "Could not load creator images"), http.StatusBadGateway)
			return
		}
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}

// POST /api/afterdark/live-sessions/{sessionId}/leave
func (h *ADLiveHandler) LeaveLive(w http.ResponseWriter, r *http.Request) {
	viewerID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || viewerID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	sessionID := chi.URLParam(r, "sessionId")
	err := h.Repo.LeaveSession(r.Context(), sessionID, viewerID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		http.Error(w, localized(r.Context(), "ErrFailedToLeaveLiveSession", "Failed to leave live session"), http.StatusInternalServerError)
		return
	}
	if h.RoomClient != nil {
		if _, err := h.RoomClient.RemoveParticipant(r.Context(), &livekit.RoomParticipantIdentity{
			Room: sessionID, Identity: viewerID,
		}); err != nil {
			http.Error(w, localized(r.Context(), "ErrFailedToLeaveLiveSession2", "Failed to leave live session"), http.StatusBadGateway)
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
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
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
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	sessionID := chi.URLParam(r, "sessionId")

	hasAccess, err := h.Repo.VerifyAccess(r.Context(), viewerID, sessionID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToVerifyLiveSessionAccess2", "Failed to verify live session access"), http.StatusInternalServerError)
		return
	}
	if !hasAccess {
		http.Error(w, localized(r.Context(), "ErrLiveSessionAccessIsRequiredToRequestTheStage", "Live session access is required to request the stage"), http.StatusForbidden)
		return
	}
	if err := h.Repo.UpsertStageRequest(r.Context(), sessionID, viewerID, "requested"); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, localized(r.Context(), "ErrLiveSessionNotFound3", "Live session not found"), http.StatusNotFound)
			return
		}
		http.Error(w, localized(r.Context(), "ErrFailedToRequestStage", "Failed to request stage"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "requested"})
}

// POST /api/afterdark/live-sessions/{sessionId}/guest-requests/{viewerId}/approve
func (h *ADLiveHandler) ApproveGuest(w http.ResponseWriter, r *http.Request) {
	creatorID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || creatorID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	sessionID := chi.URLParam(r, "sessionId")
	guestID := chi.URLParam(r, "viewerId")
	isCreator, err := h.Repo.IsSessionCreator(r.Context(), sessionID, creatorID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToVerifySessionOwnership", "Failed to verify session ownership"), http.StatusInternalServerError)
		return
	}
	if !isCreator {
		http.Error(w, localized(r.Context(), "ErrSessionNotFound", "Session not found"), http.StatusNotFound)
		return
	}
	if h.RoomClient == nil {
		http.Error(w, localized(r.Context(), "ErrLiveStreamingIsNotConfigured4", "Live streaming is not configured"), http.StatusServiceUnavailable)
		return
	}

	// 1. Update Database
	if err := h.Repo.UpsertStageRequest(r.Context(), sessionID, guestID, "approved"); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, localized(r.Context(), "ErrGuestRequestNotFoundOrAlreadyHandled", "Guest request not found or already handled"), http.StatusNotFound)
			return
		}
		http.Error(w, localized(r.Context(), "ErrFailedToApproveGuest", "Failed to approve guest"), http.StatusInternalServerError)
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
			http.Error(w, localized(r.Context(), "ErrFailedToUpdateParticipantPermissionsInLiveKit", "Failed to update participant permissions in LiveKit"), http.StatusInternalServerError)
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
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
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
			http.Error(w, localized(r.Context(), "ErrGuestRequestNotFoundOrAlreadyHandled2", "Guest request not found or already handled"), http.StatusNotFound)
			return
		}
		http.Error(w, localized(r.Context(), "ErrFailedToDenyGuestRequest", "Failed to deny guest request"), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "denied"})
}

// POST /api/afterdark/live-sessions/{sessionId}/stage/{participantId}/remove
func (h *ADLiveHandler) RemoveGuest(w http.ResponseWriter, r *http.Request) {
	creatorID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || creatorID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	sessionID := chi.URLParam(r, "sessionId")
	guestID := chi.URLParam(r, "participantId")
	isCreator, err := h.Repo.IsSessionCreator(r.Context(), sessionID, creatorID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToVerifySessionOwnership2", "Failed to verify session ownership"), http.StatusInternalServerError)
		return
	}
	if !isCreator {
		http.Error(w, localized(r.Context(), "ErrSessionNotFound2", "Session not found"), http.StatusNotFound)
		return
	}
	if h.RoomClient == nil {
		http.Error(w, localized(r.Context(), "ErrLiveStreamingIsNotConfigured5", "Live streaming is not configured"), http.StatusServiceUnavailable)
		return
	}

	// 1. Update Database
	if err := h.Repo.UpsertStageRequest(r.Context(), sessionID, guestID, "removed"); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, localized(r.Context(), "ErrGuestNotFoundOnStage", "Guest not found on stage"), http.StatusNotFound)
			return
		}
		http.Error(w, localized(r.Context(), "ErrFailedToRemoveGuest", "Failed to remove guest"), http.StatusInternalServerError)
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
			http.Error(w, localized(r.Context(), "ErrFailedToRevokeParticipantPermissionsInLiveKit", "Failed to revoke participant permissions in LiveKit"), http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "removed"})
}
