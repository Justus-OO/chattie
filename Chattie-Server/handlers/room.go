package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services" // <-- Imported the event services

	"github.com/go-chi/chi/v5"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

type RoomHandler struct {
	Repo       *repository.RoomRepository
	Events     *services.EventHandler // <-- Injected the notification engine
	RoomClient *lksdk.RoomServiceClient
}

func NewRoomHandler(repo *repository.RoomRepository, events *services.EventHandler) *RoomHandler {
	apiKey := os.Getenv("LIVEKIT_API_KEY")
	apiSecret := os.Getenv("LIVEKIT_API_SECRET")
	livekitURL := os.Getenv("LIVEKIT_URL")
	var roomClient *lksdk.RoomServiceClient
	if apiKey != "" && apiSecret != "" && livekitURL != "" {
		roomClient = lksdk.NewRoomServiceClient(livekitURL, apiKey, apiSecret)
	}
	return &RoomHandler{
		Repo:       repo,
		Events:     events,
		RoomClient: roomClient,
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

func (h *RoomHandler) GetMyRooms(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	rooms, err := h.Repo.GetMyRooms(r.Context(), userID)
	if err != nil {
		log.Printf("[GET MY ROOMS] DB Error: %v", err)
		http.Error(w, localized(r.Context(), "ErrFailedToFetchJoinedRooms", "Failed to fetch joined rooms"), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(rooms); err != nil {
		log.Printf("[GET MY ROOMS] Failed to encode response: %v", err)
	}
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
		if err == repository.ErrRoomAgeRestricted {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		if err == repository.ErrInvalidRoomSettings {
			http.Error(w, err.Error(), http.StatusBadRequest)
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

	var payload models.RoomUpdate
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
		if err == repository.ErrRoomAgeRestricted {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		if err == repository.ErrInvalidRoomSettings {
			http.Error(w, err.Error(), http.StatusBadRequest)
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

func (h *RoomHandler) JoinRoomByID(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	room, err := h.Repo.JoinRoom(r.Context(), userID, chi.URLParam(r, "roomId"))
	if err != nil {
		writeRoomError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(room); err != nil {
		log.Printf("[JOIN ROOM] Failed to encode response: %v", err)
	}
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
		writeRoomError(w, err)
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

	isMember, err := h.Repo.IsRoomMember(r.Context(), req.RoomID, userID)
	if err != nil {
		log.Printf("[LIVEKIT] Failed to validate room membership for user %s: %v", userID, err)
		http.Error(w, localized(r.Context(), "ErrUnableToValidateRoomAccess2", "Unable to validate room access"), http.StatusInternalServerError)
		return
	}
	if !isMember {
		http.Error(w, localized(r.Context(), "ErrRoomMembershipRequired2", "Room membership required"), http.StatusForbidden)
		return
	}

	// 3. ENFORCE DAILY TRIALS: Check if free user hit their limit
	roomDetails, err := h.Repo.GetRoomDetails(r.Context(), req.RoomID, userID)
	if err != nil {
		writeRoomError(w, err)
		return
	}
	if !roomDetails.IsVoiceRoom {
		http.Error(w, localized(r.Context(), "ErrVoiceIsNotEnabledForThisRoom", "Voice is not enabled for this room"), http.StatusBadRequest)
		return
	}

	voiceSession, err := h.Repo.GetRoomVoiceSession(r.Context(), req.RoomID)
	if err != nil {
		log.Printf("[LIVEKIT] Failed to validate active voice session for room %s: %v", req.RoomID, err)
		http.Error(w, localized(r.Context(), "ErrUnableToValidateVoiceSession", "Unable to validate voice session"), http.StatusInternalServerError)
		return
	}
	if !voiceSession.Active {
		http.Error(w, localized(r.Context(), "ErrTheRoomHostHasNotStartedAVoiceSession", "The room host has not started a voice session"), http.StatusConflict)
		return
	}

	if err := h.Repo.CheckAndConsumeVoiceTrial(r.Context(), userID); err != nil {
		if err == repository.ErrVoiceLimitReached {
			w.WriteHeader(http.StatusPaymentRequired) // 402
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		log.Printf("[LIVEKIT] Failed to validate voice eligibility for user %s: %v", userID, err)
		http.Error(w, localized(r.Context(), "ErrUnableToValidateVoiceEligibility", "Unable to validate voice eligibility"), http.StatusInternalServerError)
		return
	}

	// 4. Load Keys
	apiKey := os.Getenv("LIVEKIT_API_KEY")
	apiSecret := os.Getenv("LIVEKIT_API_SECRET")
	if apiKey == "" || apiSecret == "" {
		apiKey = "devkey"
		apiSecret = "secret"
	}

	// 5. Create the VIP Ticket
	role, err := h.Repo.GetRoomMemberRole(r.Context(), req.RoomID, userID)
	if err != nil {
		log.Printf("[LIVEKIT] Failed to load room role for user %s: %v", userID, err)
		http.Error(w, localized(r.Context(), "ErrUnableToValidateVoicePermissions", "Unable to validate voice permissions"), http.StatusInternalServerError)
		return
	}
	canPublish := role == "creator" || role == "admin" || role == "moderator" || role == "speaker"
	canSubscribe := true
	grant := &auth.VideoGrant{
		RoomJoin:     true,
		Room:         req.RoomID,
		CanPublish:   &canPublish,
		CanSubscribe: &canSubscribe,
	}

	at := auth.NewAccessToken(apiKey, apiSecret)
	at.AddGrant(grant).SetIdentity(userID).SetValidFor(time.Minute * 10)
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

func (h *RoomHandler) GenerateDirectCallToken(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	targetID := chi.URLParam(r, "target_id")
	if targetID == "" || targetID == userID {
		http.Error(w, localized(r.Context(), "ErrAConversationPartnerIsRequired6", "A conversation partner is required"), http.StatusBadRequest)
		return
	}
	chatUserID := userID
	if profileID := r.URL.Query().Get("profile_id"); profileID != "" {
		var err error
		chatUserID, err = repository.NewChatRepository(h.Repo.DB).ResolveManagedProfileChatIdentity(r.Context(), profileID, userID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				http.Error(w, localized(r.Context(), "ErrAssignedProfileNotFound8", "Assigned profile not found"), http.StatusForbidden)
				return
			}
			log.Printf("[LIVEKIT] Could not validate profile call for %s: %v", profileID, err)
			http.Error(w, localized(r.Context(), "ErrUnableToValidateProfileAccess3", "Unable to validate profile access"), http.StatusInternalServerError)
			return
		}
	}
	if targetID == chatUserID {
		http.Error(w, localized(r.Context(), "ErrAConversationPartnerIsRequired7", "A conversation partner is required"), http.StatusBadRequest)
		return
	}
	var targetExists bool
	if err := h.Repo.DB.QueryRowContext(r.Context(),
		`SELECT EXISTS (SELECT 1 FROM users WHERE id::text = $1)`, targetID,
	).Scan(&targetExists); err != nil {
		log.Printf("[LIVEKIT] Failed to validate direct call target %s: %v", targetID, err)
		http.Error(w, localized(r.Context(), "ErrUnableToValidateCallParticipant", "Unable to validate call participant"), http.StatusInternalServerError)
		return
	}
	if !targetExists {
		http.Error(w, localized(r.Context(), "ErrCallParticipantNotFound", "Call participant not found"), http.StatusNotFound)
		return
	}

	var request struct {
		ParticipantName string `json:"participant_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidCallTokenRequest2", "Invalid call token request"), http.StatusBadRequest)
		return
	}

	participants := []string{chatUserID, targetID}
	sort.Strings(participants)
	roomID := "dm_call_" + strings.Join(participants, "_")
	apiKey := os.Getenv("LIVEKIT_API_KEY")
	apiSecret := os.Getenv("LIVEKIT_API_SECRET")
	if apiKey == "" || apiSecret == "" {
		apiKey = "devkey"
		apiSecret = "secret"
	}
	canPublish := true
	canSubscribe := true
	grant := &auth.VideoGrant{
		RoomJoin:     true,
		Room:         roomID,
		CanPublish:   &canPublish,
		CanSubscribe: &canSubscribe,
	}
	accessToken := auth.NewAccessToken(apiKey, apiSecret)
	accessToken.AddGrant(grant).SetIdentity(chatUserID).SetValidFor(10 * time.Minute)
	if request.ParticipantName != "" {
		accessToken.SetName(request.ParticipantName)
	}
	token, err := accessToken.ToJWT()
	if err != nil {
		log.Printf("[LIVEKIT] Failed to create direct call token for user %s: %v", chatUserID, err)
		http.Error(w, localized(r.Context(), "ErrFailedToGenerateSecureCallToken2", "Failed to generate secure call token"), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]string{"token": token, "room_id": roomID}); err != nil {
		log.Printf("[LIVEKIT] Failed to encode direct call token response for user %s: %v", chatUserID, err)
	}
}

func (h *RoomHandler) GetRoomVoiceSession(w http.ResponseWriter, r *http.Request) {
	h.writeRoomVoiceSession(w, r)
}

func (h *RoomHandler) StartRoomVoiceSession(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	roomID := chi.URLParam(r, "roomId")
	details, err := h.Repo.GetRoomDetails(r.Context(), roomID, userID)
	if err != nil {
		writeRoomError(w, err)
		return
	}
	if !details.IsMember || (details.UserRole != "creator" && details.UserRole != "admin") {
		http.Error(w, localized(r.Context(), "ErrOnlyRoomAdminsCanStartVoice", "Only room admins can start voice"), http.StatusForbidden)
		return
	}
	if !details.IsVoiceRoom {
		http.Error(w, localized(r.Context(), "ErrVoiceIsNotEnabledForThisRoom2", "Voice is not enabled for this room"), http.StatusBadRequest)
		return
	}
	session, err := h.Repo.StartRoomVoiceSession(r.Context(), roomID, userID)
	if err != nil {
		if errors.Is(err, repository.ErrVoiceSessionUnavailable) {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		log.Printf("[LIVEKIT] Failed to start voice session for room %s: %v", roomID, err)
		http.Error(w, localized(r.Context(), "ErrUnableToStartVoiceSession", "Unable to start voice session"), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(session); err != nil {
		log.Printf("[LIVEKIT] Failed to encode voice session for room %s: %v", roomID, err)
	}
}

func (h *RoomHandler) EndRoomVoiceSession(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	roomID := chi.URLParam(r, "roomId")
	details, err := h.Repo.GetRoomDetails(r.Context(), roomID, userID)
	if err != nil {
		writeRoomError(w, err)
		return
	}
	if !details.IsMember || (details.UserRole != "creator" && details.UserRole != "admin") {
		http.Error(w, localized(r.Context(), "ErrOnlyRoomAdminsCanEndVoice", "Only room admins can end voice"), http.StatusForbidden)
		return
	}
	if err := h.Repo.EndRoomVoiceSession(r.Context(), roomID, userID); err != nil {
		if errors.Is(err, repository.ErrVoiceSessionNotActive) {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		log.Printf("[LIVEKIT] Failed to end voice session for room %s: %v", roomID, err)
		http.Error(w, localized(r.Context(), "ErrUnableToEndVoiceSession", "Unable to end voice session"), http.StatusInternalServerError)
		return
	}
	if h.RoomClient != nil {
		if _, err := h.RoomClient.DeleteRoom(r.Context(), &livekit.DeleteRoomRequest{Room: roomID}); err != nil {
			log.Printf("[LIVEKIT] Failed to close LiveKit room %s after host ended voice: %v", roomID, err)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(&models.RoomVoiceSession{Active: false})
}

func (h *RoomHandler) writeRoomVoiceSession(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	roomID := chi.URLParam(r, "roomId")
	isMember, err := h.Repo.IsRoomMember(r.Context(), roomID, userID)
	if err != nil {
		log.Printf("[LIVEKIT] Failed to validate voice session access for user %s: %v", userID, err)
		http.Error(w, localized(r.Context(), "ErrUnableToValidateRoomAccess3", "Unable to validate room access"), http.StatusInternalServerError)
		return
	}
	if !isMember {
		http.Error(w, localized(r.Context(), "ErrRoomMembershipRequired3", "Room membership required"), http.StatusForbidden)
		return
	}
	session, err := h.Repo.GetRoomVoiceSession(r.Context(), roomID)
	if err != nil {
		log.Printf("[LIVEKIT] Failed to load voice session for room %s: %v", roomID, err)
		http.Error(w, localized(r.Context(), "ErrUnableToLoadVoiceSession", "Unable to load voice session"), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(session); err != nil {
		log.Printf("[LIVEKIT] Failed to encode voice session for room %s: %v", roomID, err)
	}
}

// ============================================================================
// PARTICIPANTS & ROOM MANAGEMENT
// ============================================================================

func (h *RoomHandler) GetRoomParticipants(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	roomID := chi.URLParam(r, "roomId")

	userID, _ := r.Context().Value(middlewares.UserIDKey).(string)
	isMember, err := h.Repo.IsRoomMember(r.Context(), roomID, userID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrUnableToValidateRoomAccess4", "Unable to validate room access"), http.StatusInternalServerError)
		return
	}
	if !isMember {
		http.Error(w, localized(r.Context(), "ErrRoomMembershipRequired4", "Room membership required"), http.StatusForbidden)
		return
	}

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
		RoomID   string `json:"room_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidRequestPayload", "Invalid request payload"), http.StatusBadRequest)
		return
	}

	var err error
	if payload.RoomID != "" {
		err = h.Repo.RequestJoinPrivateRoomByID(r.Context(), userID, payload.RoomID)
	} else if payload.RoomCode != "" {
		err = h.Repo.RequestJoinPrivateRoom(r.Context(), userID, payload.RoomCode)
	} else {
		http.Error(w, localized(r.Context(), "ErrRoomIdOrRoomCodeIsRequired", "room_id or room_code is required"), http.StatusBadRequest)
		return
	}
	if err != nil {
		writeRoomError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgJoinRequestSent", "Join request sent. Waiting for admin approval.")})
}

func (h *RoomHandler) GetRoomJoinRequests(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	requests, err := h.Repo.GetPendingJoinRequests(r.Context(), chi.URLParam(r, "roomId"), userID)
	if err != nil {
		writeRoomError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(requests); err != nil {
		log.Printf("[ROOM REQUESTS] Failed to encode response: %v", err)
	}
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
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.TargetID == "" {
		http.Error(w, localized(r.Context(), "ErrTargetIdAndApproveAreRequired", "target_id and approve are required"), http.StatusBadRequest)
		return
	}

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
			WSPayload:     map[string]interface{}{"room_id": roomID, "message": localized(r.Context(), "MsgJoinRequestApproved", "Your request to join was approved!")},
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
	json.NewEncoder(w).Encode(map[string]string{"message": localizedMessage(r.Context(), "TplUserSuccessfullyAction", "User successfully {{.Action}}", map[string]interface{}{"Action": action})})
}

func (h *RoomHandler) PinMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	var payload struct {
		MessageID string `json:"message_id"`
		Pinned    bool   `json:"pinned"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.MessageID == "" {
		http.Error(w, localized(r.Context(), "ErrMessageIdIsRequired2", "message_id is required"), http.StatusBadRequest)
		return
	}
	if err := h.Repo.PinRoomMessage(r.Context(), chi.URLParam(r, "roomId"), userID, payload.MessageID, payload.Pinned); err != nil {
		writeRoomError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *RoomHandler) ToggleMessageReaction(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	var payload struct {
		MessageID string `json:"message_id"`
		Emoji     string `json:"emoji"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.MessageID == "" || payload.Emoji == "" || len(payload.Emoji) > 16 {
		http.Error(w, localized(r.Context(), "ErrMessageIdAndEmojiAreRequired2", "message_id and emoji are required"), http.StatusBadRequest)
		return
	}
	added, err := h.Repo.ToggleRoomMessageReaction(r.Context(), chi.URLParam(r, "roomId"), userID, payload.MessageID, payload.Emoji)
	if err != nil {
		writeRoomError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]bool{"added": added}); err != nil {
		log.Printf("[ROOM REACTION] Failed to encode response: %v", err)
	}
}

func (h *RoomHandler) SetMemberRole(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	var payload struct {
		TargetID string `json:"target_id"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.TargetID == "" {
		http.Error(w, localized(r.Context(), "ErrTargetIdAndRoleAreRequired", "target_id and role are required"), http.StatusBadRequest)
		return
	}
	if err := h.Repo.SetRoomMemberRole(r.Context(), chi.URLParam(r, "roomId"), userID, payload.TargetID, payload.Role); err != nil {
		writeRoomError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *RoomHandler) SetMemberMuted(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	var payload struct {
		TargetID string `json:"target_id"`
		Muted    bool   `json:"muted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.TargetID == "" {
		http.Error(w, localized(r.Context(), "ErrTargetIdIsRequired", "target_id is required"), http.StatusBadRequest)
		return
	}
	if err := h.Repo.SetRoomMemberMuted(r.Context(), chi.URLParam(r, "roomId"), userID, payload.TargetID, payload.Muted); err != nil {
		writeRoomError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeRoomError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch err {
	case repository.ErrUnauthorized:
		status = http.StatusForbidden
	case repository.ErrRoomNotFound, repository.ErrInvalidRoomCode:
		status = http.StatusNotFound
	case repository.ErrRoomPrivate, repository.ErrRoomBanned, repository.ErrRoomAgeRestricted,
		repository.ErrRoomMuted, repository.ErrRoomReadOnly, repository.ErrRoomMediaDisabled,
		repository.ErrRoomLinksDisabled, repository.ErrRoomSlowMode:
		status = http.StatusForbidden
	case repository.ErrRoomCreatorRequired:
		status = http.StatusConflict
	case repository.ErrInvalidRoomSettings:
		status = http.StatusBadRequest
	}
	http.Error(w, err.Error(), status)
}
