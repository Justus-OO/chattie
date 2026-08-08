package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
	"github.com/livekit/protocol/auth"
)

type RoomHandler struct {
	Repo *repository.RoomRepository
}

func NewRoomHandler(repo *repository.RoomRepository) *RoomHandler {
	return &RoomHandler{Repo: repo}
}

// ============================================================================
// ROOM DIRECTORY & CREATION
// ============================================================================

func (h *RoomHandler) GetRooms(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	rooms, err := h.Repo.GetAllRooms(r.Context())
	if err != nil {
		log.Printf("500 Error fetching rooms: %v\n", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to fetch rooms"})
		return
	}

	json.NewEncoder(w).Encode(rooms)
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
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request payload"})
		return
	}

	room.CreatedBy = userID

	if err := h.Repo.CreateRoom(r.Context(), &room, userID); err != nil {
		if err == repository.ErrRoomLimitReached {
			w.WriteHeader(http.StatusPaymentRequired) // 402 Limit Reached
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		log.Printf("DATABASE ERROR creating room: %v\n", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create room"})
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(room)
}

// ============================================================================
// JOIN BY CODE / LINK
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
		json.NewEncoder(w).Encode(map[string]string{"error": "room_code is required"})
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
		json.NewEncoder(w).Encode(map[string]string{"error": "room_id is required"})
		return
	}

	// 2. ENFORCE MEMBERSHIP: Only members can generate a voice ticket
	isMember, err := h.Repo.IsRoomMember(r.Context(), req.RoomID, userID)
	if err != nil || !isMember {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": "You must join this room before entering the voice lounge."})
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
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to generate voice token"})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"token": token})
}

// ============================================================================
// PARTICIPANTS
// ============================================================================

func (h *RoomHandler) GetRoomParticipants(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	roomID := chi.URLParam(r, "roomId")

	userID, _ := r.Context().Value(middlewares.UserIDKey).(string)

	participants, err := h.Repo.GetRoomParticipants(r.Context(), roomID, userID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to fetch participants"})
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
		json.NewEncoder(w).Encode(map[string]string{"error": "Room not found"})
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
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to request access"})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Join request sent. Waiting for admin approval."})
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

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Request processed successfully"})
}
