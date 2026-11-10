package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services" // <-- Imported the event services

	"github.com/go-chi/chi/v5"
	"github.com/livekit/protocol/auth"
)

type RoomHandler struct {
	Repo   *repository.RoomRepository
	Events *services.EventHandler // <-- Injected the notification engine
}

func NewRoomHandler(repo *repository.RoomRepository, events *services.EventHandler) *RoomHandler {
	return &RoomHandler{
		Repo:   repo,
		Events: events,
	}
}

// ============================================================================
// ROOM DIRECTORY & CREATION
// ============================================================================

func (h *RoomHandler) GetRooms(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// PRO ADDITION: Pagination, Search, and Filtering
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20 // Default limit to protect DB
	}

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * limit

	search := r.URL.Query().Get("search")
	category := r.URL.Query().Get("category")

	rooms, err := h.Repo.GetAllRooms(r.Context(), limit, offset, search, category)
	if err != nil {
		log.Printf("[GET ROOMS] DB Error: %v\n", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedFetchRooms", "Failed to fetch rooms")})
		return
	}

	// Return paginated metadata along with the data
	json.NewEncoder(w).Encode(map[string]interface{}{
		"page":  page,
		"limit": limit,
		"data":  rooms,
	})
}

func (h *RoomHandler) CreateRoom(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	var room models.Room
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&room); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrInvalidPayload", "Invalid request payload")})
		return
	}

	// PRO ADDITION: Input Validation & Sanitization
	room.Name = strings.TrimSpace(room.Name)
	room.Description = strings.TrimSpace(room.Description)

	if room.Name == "" || len(room.Name) > 50 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrRoomNameLength", "Room name must be between 1 and 50 characters")})
		return
	}

	room.CreatedBy = userID

	if err := h.Repo.CreateRoom(r.Context(), &room, userID); err != nil {
		if err == repository.ErrRoomLimitReached {
			w.WriteHeader(http.StatusPaymentRequired) // 402 Limit Reached
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		log.Printf("[CREATE ROOM] Error: %v\n", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedCreateRoom", "Failed to create room")})
		return
	}

	// Log room creation action
	ActionLogQueue <- models.ActionLog{
		UserID:     userID,
		ActionType: "ROOM_CREATED",
		TargetID:   room.ID,
		IP:         r.RemoteAddr,
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(room)
}

// PRO ADDITION: Allow room creators/admins to update their room details
func (h *RoomHandler) UpdateRoom(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	roomID := chi.URLParam(r, "roomId")

	var payload models.Room
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrInvalidPayloadShort", "Invalid payload")})
		return
	}

	if err := h.Repo.UpdateRoom(r.Context(), roomID, userID, payload); err != nil {
		if err == repository.ErrUnauthorized {
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrOnlyAdminsEditRoom", "Only admins can edit this room")})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedUpdateRoom", "Failed to update room")})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgRoomUpdated", "Room updated successfully")})
}

// ============================================================================
// JOIN / LEAVE ROOM
// ============================================================================

func (h *RoomHandler) JoinRoom(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	var payload struct {
		RoomCode string `json:"room_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.RoomCode == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrRoomCodeRequired", "room_code is required")})
		return
	}

	room, err := h.Repo.JoinRoomByCode(r.Context(), userID, payload.RoomCode)
	if err != nil {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(room)
}

// PRO ADDITION: Allow users to explicitly leave a room
func (h *RoomHandler) LeaveRoom(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	roomID := chi.URLParam(r, "roomId")

	if err := h.Repo.LeaveRoom(r.Context(), roomID, userID); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgLeftRoom", "Left room successfully")})
}

// ============================================================================
// ZERO-LATENCY VOICE ENGINE (LIVEKIT BOUNCER)
// ============================================================================

type VoiceTokenRequest struct {
	RoomID          string `json:"room_id"`
	ParticipantName string `json:"participant_name"`
}

func (h *RoomHandler) GenerateVoiceToken(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// 1. Verify Authentication
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	var req VoiceTokenRequest
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RoomID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrRoomIdRequired", "room_id is required")})
		return
	}

	// 3. ENFORCE DAILY TRIALS: Check if free user hit their limit
	if err := h.Repo.CheckAndConsumeVoiceTrial(r.Context(), userID); err != nil {
		if err == repository.ErrVoiceLimitReached {
			w.WriteHeader(http.StatusPaymentRequired) // 402
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
	}

	// 4. Load Keys
	apiKey := os.Getenv("LIVEKIT_API_KEY")
	apiSecret := os.Getenv("LIVEKIT_API_SECRET")
	if apiKey == "" || apiSecret == "" {
		apiKey = "devkey"
		apiSecret = "secret"
	}

	// 5. Create the VIP Ticket
	canPublish := true
	canSubscribe := true
	grant := &auth.VideoGrant{
		RoomJoin:     true,
		Room:         req.RoomID,
		CanPublish:   &canPublish,
		CanSubscribe: &canSubscribe,
	}

	at := auth.NewAccessToken(apiKey, apiSecret)
	at.AddGrant(grant).SetIdentity(userID).SetValidFor(time.Hour * 4)
	if req.ParticipantName != "" {
		at.SetName(req.ParticipantName)
	}

	token, err := at.ToJWT()
	if err != nil {
		log.Printf("[LIVEKIT] Token Generation Error: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedGenerateVoiceToken", "Failed to generate secure voice token")})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"token": token})
}

// ============================================================================
// PARTICIPANTS & ROOM MANAGEMENT
// ============================================================================

func (h *RoomHandler) GetRoomParticipants(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	roomID := chi.URLParam(r, "roomId")

	userID, _ := r.Context().Value(middlewares.UserIDKey).(string)

	participants, err := h.Repo.GetRoomParticipants(r.Context(), roomID, userID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedLoadParticipants", "Failed to load participants")})
		return
	}

	json.NewEncoder(w).Encode(participants)
}

// GetRoomAdminDetails returns room data along with invite link and admin panels
func (h *RoomHandler) GetRoomAdminDetails(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, _ := r.Context().Value(middlewares.UserIDKey).(string)
	roomID := chi.URLParam(r, "roomId")

	details, err := h.Repo.GetRoomDetails(r.Context(), roomID, userID)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrRoomNotFound", "Room not found")})
		return
	}

	json.NewEncoder(w).Encode(details)
}

// RequestAccess allows users to knock on a private room
func (h *RoomHandler) RequestAccess(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, _ := r.Context().Value(middlewares.UserIDKey).(string)

	var payload struct {
		RoomCode string `json:"room_code"`
	}
	json.NewDecoder(r.Body).Decode(&payload)

	if err := h.Repo.RequestJoinPrivateRoom(r.Context(), userID, payload.RoomCode); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedRequestAccess", "Failed to request access")})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgJoinRequestSent", "Join request sent. Waiting for admin approval.")})
}

// ManageJoinRequest lets admins approve/reject pending users
func (h *RoomHandler) ManageJoinRequest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, _ := r.Context().Value(middlewares.UserIDKey).(string)
	roomID := chi.URLParam(r, "roomId")

	var payload struct {
		TargetID string `json:"target_id"`
		Approve  bool   `json:"approve"`
	}
	json.NewDecoder(r.Body).Decode(&payload)

	if err := h.Repo.HandleJoinRequest(r.Context(), userID, roomID, payload.TargetID, payload.Approve); err != nil {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	detachedCtx := context.WithoutCancel(r.Context())
	// --- NOTIFICATION TRIGGER ---
	// If approved, notify the user instantly so they can enter without refreshing.
	if payload.Approve {
		go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
			RecipientID:   payload.TargetID,
			WSEventType:   "ROOM_ACCESS_APPROVED",
			WSPayload:     map[string]interface{}{"room_id": roomID, "message": "Your request to join was approved!"},
			EmailTemplate: "room_approved",
		})
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgRequestProcessed", "Request processed successfully")})
}

// PRO ADDITION: Allow room creators to kick or ban abusive users
func (h *RoomHandler) KickOrBanParticipant(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	roomID := chi.URLParam(r, "roomId")

	var payload struct {
		TargetID string `json:"target_id"`
		Ban      bool   `json:"ban"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.TargetID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrTargetIdRequired", "target_id is required")})
		return
	}

	if err := h.Repo.KickOrBanUser(r.Context(), adminID, roomID, payload.TargetID, payload.Ban); err != nil {
		if err == repository.ErrUnauthorized {
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrOnlyAdminsModerateRoom", "Only admins can moderate this room")})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedManageUser", "Failed to manage user")})
		return
	}

	action := "kicked"
	wsEventType := "ROOM_KICKED"
	if payload.Ban {
		action = "banned"
		wsEventType = "ROOM_BANNED"
	}
	detachedCtx := context.WithoutCancel(r.Context())
	// --- NOTIFICATION TRIGGER ---
	// Push a WebSocket event to the kicked/banned user to instantly boot them out of the UI room page.
	go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
		RecipientID: payload.TargetID,
		WSEventType: wsEventType,
		WSPayload:   map[string]interface{}{"room_id": roomID},
	})

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localizedMessage(r.Context(), "TplUserSuccessfullyAction", "User successfully %s", map[string]interface{}{"Action": action})})
}
