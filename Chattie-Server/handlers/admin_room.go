package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
)

type AdminRoomHandler struct {
	Repo *repository.Repository
	Hub  *Hub // Injected so admin actions can trigger real-time websocket disconnects
}

func NewAdminRoomHandler(repo *repository.Repository, hub *Hub) *AdminRoomHandler {
	return &AdminRoomHandler{
		Repo: repo,
		Hub:  hub,
	}
}

func (h *AdminRoomHandler) GetRooms(w http.ResponseWriter, r *http.Request) {
	rooms, err := h.Repo.GetAdminRooms(r.Context())
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to load active spaces")
		return
	}
	sendAdminJSON(w, http.StatusOK, rooms)
}

func (h *AdminRoomHandler) TerminateRoom(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "id")

	// 1. Delete from database
	if err := h.Repo.TerminateRoom(r.Context(), roomID); err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to terminate space")
		return
	}

	// 2. Real-time WebSockets: Disconnect everyone in the room
	if h.Hub != nil {
		h.Hub.TerminateRoomLive(roomID, "Room closed by administrator")
	}

	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Space terminated successfully"})
}

func (h *AdminRoomHandler) UpdateRoomStatus(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		sendAdminError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	var payload struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if payload.Status != "ACTIVE" && payload.Status != "WARNING" && payload.Status != "SUSPENDED" {
		sendAdminError(w, http.StatusBadRequest, "Invalid room status")
		return
	}
	if err := h.Repo.UpdateAdminRoomStatus(r.Context(), chi.URLParam(r, "id"), adminID, payload.Status); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			sendAdminError(w, http.StatusNotFound, "Room not found")
			return
		}
		log.Printf("Failed to update room %s status: %v", chi.URLParam(r, "id"), err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to update room status")
		return
	}
	sendAdminJSON(w, http.StatusOK, map[string]string{"status": payload.Status})
}

func (h *AdminRoomHandler) GetParticipants(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "id")
	participants, err := h.Repo.GetRoomParticipants(r.Context(), roomID)
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to load participants")
		return
	}
	sendAdminJSON(w, http.StatusOK, participants)
}

func (h *AdminRoomHandler) GetKnocks(w http.ResponseWriter, r *http.Request) {
	knocks, err := h.Repo.GetAdminKnocks(r.Context())
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to load access queue")
		return
	}
	sendAdminJSON(w, http.StatusOK, knocks)
}

func (h *AdminRoomHandler) ResolveKnock(w http.ResponseWriter, r *http.Request) {
	knockID := chi.URLParam(r, "knockId")
	var payload struct {
		Action string `json:"action"` // APPROVE, REJECT
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid payload")
		return
	}

	status := "APPROVED"
	if payload.Action == "REJECT" {
		status = "REJECTED"
	}

	// Update DB and retrieve the target user/room IDs
	userID, roomID, err := h.Repo.ResolveKnock(r.Context(), knockID, status)
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to resolve knock")
		return
	}

	// Send a real-time websocket notification to the user letting them know if they got in
	if h.Hub != nil && userID != "" {
		h.Hub.NotifyUser(userID, map[string]interface{}{
			"type":     "knock_resolved",
			"knock_id": knockID,
			"room_id":  roomID,
			"status":   status,
		})
	}

	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Access request updated"})
}

func (h *AdminRoomHandler) KickParticipant(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "id")
	userID := chi.URLParam(r, "userId")

	// 1. Remove from Database
	if err := h.Repo.KickUserFromRoom(r.Context(), roomID, userID); err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to kick user")
		return
	}

	// 2. Real-time WebSockets: Forcefully disconnect just this user from the room
	if h.Hub != nil {
		h.Hub.KickUserLive(roomID, userID, "You were kicked by an administrator")
	}

	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "User kicked successfully"})
}

// =========================================================================
// LIVE DISCONNECT / KICK CONTROLLERS FOR ADMIN ACTIONS
// =========================================================================

// TerminateRoomLive sends a disconnect payload to all room participants and closes their room subscriptions
func (h *Hub) TerminateRoomLive(roomID string, reason string) {
	h.Mutex.Lock()
	defer h.Mutex.Unlock()

	clients, exists := h.Rooms[roomID]
	if !exists {
		return
	}

	disconnectPayload, _ := json.Marshal(map[string]interface{}{
		"type":      "room_terminated",
		"room_id":   roomID,
		"reason":    reason,
		"timestamp": time.Now(),
	})

	for client := range clients {
		select {
		case client.Send <- disconnectPayload:
		default:
		}

		// Re-route the client back to their personal default room
		delete(h.Rooms[roomID], client)
		client.HubRoom = "user_" + client.UserID
		client.RoomID = ""

		if h.Rooms[client.HubRoom] == nil {
			h.Rooms[client.HubRoom] = make(map[*Client]bool)
		}
		h.Rooms[client.HubRoom][client] = true
	}

	delete(h.Rooms, roomID)
	log.Printf("[WS HUB] Room %s terminated in real-time. All clients evicted.", roomID)
}

// KickUserLive ejects a specific user from a live room and routes them to their personal channel
func (h *Hub) KickUserLive(roomID string, userID string, reason string) {
	h.Mutex.Lock()
	defer h.Mutex.Unlock()

	clients, exists := h.Rooms[roomID]
	if !exists {
		return
	}

	kickPayload, _ := json.Marshal(map[string]interface{}{
		"type":      "user_kicked",
		"room_id":   roomID,
		"user_id":   userID,
		"reason":    reason,
		"timestamp": time.Now(),
	})

	for client := range clients {
		if client.UserID == userID {
			// Notify the kicked user directly
			select {
			case client.Send <- kickPayload:
			default:
			}

			// Evict client from room
			delete(h.Rooms[roomID], client)
			client.HubRoom = "user_" + client.UserID
			client.RoomID = ""

			if h.Rooms[client.HubRoom] == nil {
				h.Rooms[client.HubRoom] = make(map[*Client]bool)
			}
			h.Rooms[client.HubRoom][client] = true
		} else {
			// Notify other room participants that this user was removed
			select {
			case client.Send <- kickPayload:
			default:
			}
		}
	}

	if len(h.Rooms[roomID]) == 0 {
		delete(h.Rooms, roomID)
	}
	log.Printf("[WS HUB] User %s kicked in real-time from Room %s.", userID, roomID)
}

// NotifyUser sends a real-time message/notification to all sockets owned by a specific user
func (h *Hub) NotifyUser(userID string, payload interface{}) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}

	h.Mutex.Lock()
	defer h.Mutex.Unlock()

	for client := range h.Clients {
		if client.UserID == userID {
			select {
			case client.Send <- data:
			default:
			}
		}
	}
}
