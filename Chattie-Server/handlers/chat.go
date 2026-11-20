package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
)

// =======================================================
// WS CONFIGURATION CONSTANTS (PRODUCTION ADDITIONS)
// =======================================================
const (
	writeWait      = 10 * time.Second    // Time allowed to write a message to the peer.
	pongWait       = 60 * time.Second    // Time allowed to read the next pong message from the peer.
	pingPeriod     = (pongWait * 9) / 10 // Send pings to peer with this period. Must be less than pongWait.
	maxMessageSize = 512 * 1024          // Maximum message size allowed from peer (512 KB).
	rateLimitMsgs  = 20                  // Max messages per rateLimitWindow
	rateLimitWin   = 5 * time.Second     // Window for rate limiting
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true }, // Consider restricting this in production to specific domains
}

// Client represents an active WebSocket connection
type Client struct {
	Hub         *Hub
	Conn        *websocket.Conn
	Send        chan []byte
	HubRoom     string // Internal virtual routing string
	RoomID      string // DB Room UUID (for group chats)
	TargetID    string // DB Recipient UUID (for 1-on-1 DMs)
	UserID      string // Authenticated account UUID
	CountryCode string
	ChatUserID  string // Profile identity used for creator direct messages
	ProfileID   string // Managed profile context for creator direct messages
	Role        string // 'model', 'operator', or 'user'
	RoomRepo    *repository.RoomRepository
}

type Hub struct {
	Clients     map[*Client]bool
	Rooms       map[string]map[*Client]bool // Maps HubRoom string -> Client set
	UserSockets map[string]int              // Tracks total active socket connections per UserID
	Broadcast   chan []byte
	Register    chan *Client
	Unregister  chan *Client
	Mutex       sync.Mutex
	Repo        *repository.ChatRepository
	Events      *services.EventHandler
}

func NewHub(repo *repository.ChatRepository) *Hub {
	return &Hub{
		Clients:     make(map[*Client]bool),
		Rooms:       make(map[string]map[*Client]bool),
		UserSockets: make(map[string]int),
		Broadcast:   make(chan []byte),
		Register:    make(chan *Client),
		Unregister:  make(chan *Client),
		Repo:        repo,
	}
}

// SendToUser delivers an event to every active socket owned by the recipient.
// Global sockets use the user_<id> room, while room sockets are also eligible
// so a user does not miss an event while another view is open.
func (h *Hub) SendToUser(ctx context.Context, userID string, payload interface{}) error {
	if userID == "" {
		return fmt.Errorf("notification recipient is empty")
	}

	message, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	h.Mutex.Lock()
	defer h.Mutex.Unlock()

	delivered := false
	for client := range h.Clients {
		if client.UserID != userID {
			continue
		}
		select {
		case client.Send <- message:
			delivered = true
		default:
		}
	}

	if !delivered {
		return fmt.Errorf("user %s has no active socket", userID)
	}
	return nil
}

func (h *Hub) DisconnectUser(userID string) int {
	h.Mutex.Lock()
	clients := make([]*Client, 0)
	for client := range h.Clients {
		if client.UserID == userID {
			clients = append(clients, client)
		}
	}
	h.Mutex.Unlock()

	for _, client := range clients {
		_ = client.Conn.Close()
	}
	return len(clients)
}

func (h *Hub) DisconnectCountry(countryCode string) int {
	countryCode = strings.ToUpper(strings.TrimSpace(countryCode))
	if countryCode == "" {
		return 0
	}

	h.Mutex.Lock()
	clients := make([]*Client, 0)
	for client := range h.Clients {
		if strings.EqualFold(client.CountryCode, countryCode) {
			clients = append(clients, client)
		}
	}
	h.Mutex.Unlock()

	for _, client := range clients {
		_ = client.Conn.Close()
	}
	return len(clients)
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.Mutex.Lock()
			h.Clients[client] = true
			if h.Rooms[client.HubRoom] == nil {
				h.Rooms[client.HubRoom] = make(map[*Client]bool)
			}
			h.Rooms[client.HubRoom][client] = true

			// Track unique online connections per user
			h.UserSockets[client.UserID]++
			isFirstConnection := (h.UserSockets[client.UserID] == 1)
			h.Mutex.Unlock()

			// Log action asynchronously
			ActionLogQueue <- models.ActionLog{
				UserID:     client.UserID,
				ActionType: "WS_CONNECT",
				Metadata:   `{"room":"` + client.HubRoom + `"}`,
			}

			// If this is the user's first socket, mark them ONLINE globally
			if isFirstConnection {
				go h.Repo.SetUserOnlineStatus(client.UserID, true)
				h.broadcastPresence(client.UserID, true)
			}

		case client := <-h.Unregister:
			h.Mutex.Lock()
			if _, ok := h.Clients[client]; ok {
				delete(h.Clients, client)
				if h.Rooms[client.HubRoom] != nil {
					delete(h.Rooms[client.HubRoom], client)
					if len(h.Rooms[client.HubRoom]) == 0 {
						delete(h.Rooms, client.HubRoom)
					}
				}
				close(client.Send)

				// Decrement user socket counter
				h.UserSockets[client.UserID]--
				isLastConnection := (h.UserSockets[client.UserID] <= 0)
				if isLastConnection {
					delete(h.UserSockets, client.UserID)
				}
				h.Mutex.Unlock()

				// Log action asynchronously
				ActionLogQueue <- models.ActionLog{
					UserID:     client.UserID,
					ActionType: "WS_DISCONNECT",
					Metadata:   `{"room":"` + client.HubRoom + `"}`,
				}

				// If all user sockets disconnected, mark them OFFLINE
				if isLastConnection {
					go h.Repo.SetUserOnlineStatus(client.UserID, false)
					h.broadcastPresence(client.UserID, false)
				}
			} else {
				h.Mutex.Unlock()
			}

		case message := <-h.Broadcast:
			var msg models.Message
			if err := json.Unmarshal(message, &msg); err == nil {
				h.Mutex.Lock()

				// REDIS ADAPTER HOOK (For multi-instance scaling):
				// If you add Redis, you would publish this `message` payload to a Redis channel here,
				// and have a separate goroutine listening to Redis that injects incoming Redis messages
				// back into this block.

				// ---------------------------------------------------------
				// 1. SIGNALING BYPASS (Calls, Typing Indicators, Notifications)
				// ---------------------------------------------------------
				if msg.Type != "" && msg.Type != "chat" && msg.RecipientID != "" {
					delivered := false

					// Scan active sockets for global recipient delivery
					for client := range h.Clients {
						if client.UserID == msg.RecipientID || client.ChatUserID == msg.RecipientID {
							select {
							case client.Send <- message:
								delivered = true
							default:
								close(client.Send)
								delete(h.Clients, client)
								delete(h.Rooms[client.HubRoom], client)
							}
						}
					}

					if !delivered && msg.Type == "incoming_call" {
						log.Printf("[WS WARNING] Call target %s is unreachable.", msg.RecipientID)
					}
				} else {
					// ---------------------------------------------------------
					// 2. STANDARD ROOM CHAT BROADCAST
					// ---------------------------------------------------------
					for client := range h.Rooms[msg.RoomID] {
						// Prevent echoing standard chat back to the sender socket
						if client.ChatUserID == msg.SenderID && msg.Type == "chat" {
							continue
						}

						select {
						case client.Send <- message:
						default:
							close(client.Send)
							delete(h.Clients, client)
							delete(h.Rooms[client.HubRoom], client)
						}
					}

					// ---------------------------------------------------------
					// 3. GLOBAL NOTIFICATIONS (For Users Browsing Other Views)
					// ---------------------------------------------------------
					if msg.RecipientID != "" && msg.Type == "chat" {
						recipientGlobalRoom := "user_" + msg.RecipientID
						if globalClients, ok := h.Rooms[recipientGlobalRoom]; ok {
							notifMsg := models.Message{
								Type:        "notification",
								Content:     "You have a new message",
								RecipientID: msg.RecipientID,
								SenderID:    msg.SenderID,
								CreatedAt:   time.Now(),
							}
							notifPayload, _ := json.Marshal(notifMsg)

							for client := range globalClients {
								if client.HubRoom == msg.RoomID {
									continue // Skip if they are already inside the active room
								}

								select {
								case client.Send <- notifPayload:
								default:
									close(client.Send)
									delete(h.Clients, client)
									delete(h.Rooms[client.HubRoom], client)
								}
							}
						}
					}
				}
				h.Mutex.Unlock()
			}
		}
	}
}

// Helper to notify clients when a user comes online/offline
func (h *Hub) broadcastPresence(userID string, isOnline bool) {
	statusStr := "offline"
	if isOnline {
		statusStr = "online"
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"type":      "presence_update",
		"user_id":   userID,
		"status":    statusStr,
		"timestamp": time.Now(),
	})

	h.Mutex.Lock()
	defer h.Mutex.Unlock()

	for client := range h.Clients {
		select {
		case client.Send <- payload:
		default:
		}
	}
}

type WebSocketHandler struct {
	Hub      *Hub
	Repo     *repository.ChatRepository
	RoomRepo *repository.RoomRepository
}

func NewWebSocketHandler(hub *Hub, repo *repository.ChatRepository, roomRepos ...*repository.RoomRepository) *WebSocketHandler {
	handler := &WebSocketHandler{Hub: hub, Repo: repo}
	if len(roomRepos) > 0 {
		handler.RoomRepo = roomRepos[0]
	}
	return handler
}

func (h *WebSocketHandler) PinDirectMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var payload struct {
		MessageID string `json:"message_id"`
		Pinned    bool   `json:"pinned"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.MessageID == "" {
		http.Error(w, "message_id is required", http.StatusBadRequest)
		return
	}
	targetID := chi.URLParam(r, "target_id")
	if targetID == "" || targetID == userID {
		http.Error(w, "A conversation partner is required", http.StatusBadRequest)
		return
	}
	chatUserID := userID
	if profileID := r.URL.Query().Get("profile_id"); profileID != "" {
		var err error
		chatUserID, err = h.Repo.ResolveManagedProfileChatIdentity(r.Context(), profileID, userID)
		if err != nil {
			if err == sql.ErrNoRows {
				http.Error(w, "Assigned profile not found", http.StatusForbidden)
				return
			}
			log.Printf("[CHAT] Could not validate profile pin request for %s: %v", profileID, err)
			http.Error(w, "Unable to validate profile access", http.StatusInternalServerError)
			return
		}
	}
	if err := h.Repo.PinDirectMessage(chatUserID, targetID, payload.MessageID, payload.Pinned); err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Message not found in this conversation", http.StatusNotFound)
			return
		}
		log.Printf("[CHAT] Failed to pin direct message %s for user %s: %v", payload.MessageID, userID, err)
		http.Error(w, "Unable to update message pin", http.StatusInternalServerError)
		return
	}
	if err := h.Hub.SendToUser(r.Context(), targetID, map[string]interface{}{
		"type": "pin_update", "message_id": payload.MessageID, "is_pinned": payload.Pinned,
	}); err != nil {
		log.Printf("[CHAT] Message pin saved but partner %s is not currently connected: %v", targetID, err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *WebSocketHandler) RecordDirectCallEvent(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var payload struct {
		Event string `json:"event"`
		Mode  string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid call event", http.StatusBadRequest)
		return
	}
	if payload.Mode != "audio" && payload.Mode != "video" {
		http.Error(w, "mode must be audio or video", http.StatusBadRequest)
		return
	}
	targetID := chi.URLParam(r, "target_id")
	if targetID == "" || targetID == userID {
		http.Error(w, "A conversation partner is required", http.StatusBadRequest)
		return
	}
	chatUserID := userID
	if profileID := r.URL.Query().Get("profile_id"); profileID != "" {
		var err error
		chatUserID, err = h.Repo.ResolveManagedProfileChatIdentity(r.Context(), profileID, userID)
		if err != nil {
			if err == sql.ErrNoRows {
				http.Error(w, "Assigned profile not found", http.StatusForbidden)
				return
			}
			log.Printf("[CHAT] Could not validate profile call history request for %s: %v", profileID, err)
			http.Error(w, "Unable to validate profile access", http.StatusInternalServerError)
			return
		}
	}
	eventLabels := map[string]string{
		"started":   "started",
		"connected": "connected",
		"ended":     "ended",
		"missed":    "missed",
		"no_answer": "not answered",
		"declined":  "declined",
	}
	label, validEvent := eventLabels[payload.Event]
	if !validEvent {
		http.Error(w, "Unsupported call event", http.StatusBadRequest)
		return
	}

	message := &models.Message{
		SenderID:    chatUserID,
		RecipientID: targetID,
		Content:     fmt.Sprintf("%s call %s", strings.ToUpper(payload.Mode[:1])+payload.Mode[1:], label),
		Status:      "sent",
		MessageKind: "call_event",
		CallMode:    payload.Mode,
	}
	if err := h.Repo.SaveMessage(message); err != nil {
		log.Printf("[CHAT] Failed to save call event for user %s: %v", chatUserID, err)
		http.Error(w, "Unable to save call history", http.StatusInternalServerError)
		return
	}
	message.Type = "chat"
	if err := h.Hub.SendToUser(r.Context(), message.RecipientID, message); err != nil {
		log.Printf("[CHAT] Call event %s saved but recipient %s is not currently connected: %v", message.ID, message.RecipientID, err)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(message); err != nil {
		log.Printf("[CHAT] Failed to encode call event response for message %s: %v", message.ID, err)
	}
}

func (h *WebSocketHandler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room_id")
	targetID := r.URL.Query().Get("target_id")
	profileID := r.URL.Query().Get("profile_id")
	tokenStr := r.URL.Query().Get("token")

	tokenStr = strings.TrimPrefix(tokenStr, "Bearer ")
	tokenStr = strings.TrimSpace(tokenStr)

	userID, role, err := middlewares.ParseAuthTokenWithDB(r.Context(), tokenStr, h.Repo.DB)
	if err != nil {
		log.Printf("WS WARNING: JWT parsing failed: %v", err)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	countryCode := middlewares.CountryCodeFromContext(r.Context())
	if countryCode != "" {
		_, err = h.Repo.DB.ExecContext(r.Context(), `
			INSERT INTO user_locations (user_id, country_code)
			VALUES ($1, $2)
			ON CONFLICT (user_id) DO UPDATE SET
				country_code = EXCLUDED.country_code,
				last_updated = CURRENT_TIMESTAMP
			WHERE user_locations.country_code IS DISTINCT FROM EXCLUDED.country_code
		`, userID, countryCode)
	} else {
		err = h.Repo.DB.QueryRowContext(r.Context(), `
			SELECT COALESCE(country_code, '')
			FROM user_locations
			WHERE user_id = $1
		`, userID).Scan(&countryCode)
		if err == sql.ErrNoRows {
			err = nil
		}
	}
	if err != nil {
		log.Printf("WS WARNING: could not resolve country for user %s: %v", userID, err)
		http.Error(w, "Unable to verify regional access", http.StatusInternalServerError)
		return
	}
	if countryCode != "" {
		var countryBlocked bool
		if err := h.Repo.DB.QueryRowContext(r.Context(), `
			SELECT EXISTS (
				SELECT 1 FROM regional_country_blocks WHERE country_code = $1
			)
		`, countryCode).Scan(&countryBlocked); err != nil {
			log.Printf("WS WARNING: could not check country access for user %s: %v", userID, err)
			http.Error(w, "Unable to verify regional access", http.StatusInternalServerError)
			return
		}
		if countryBlocked {
			http.Error(w, "This service is not available in your country", http.StatusUnavailableForLegalReasons)
			return
		}
	}
	chatUserID := userID
	if profileID != "" {
		if role != "model" && role != "operator" {
			http.Error(w, "Creator role required for profile chat", http.StatusForbidden)
			return
		}
		chatUserID, err = h.Repo.ResolveManagedProfileChatIdentity(r.Context(), profileID, userID)
		if err != nil {
			if err == sql.ErrNoRows {
				http.Error(w, "Assigned profile not found", http.StatusForbidden)
				return
			}
			log.Printf("WS WARNING: could not validate profile chat for user %s: %v", userID, err)
			http.Error(w, "Unable to validate profile chat access", http.StatusInternalServerError)
			return
		}
	}
	if roomID != "" && roomID != "undefined" {
		isMember, err := h.Repo.IsRoomMember(r.Context(), roomID, userID)
		if err != nil {
			log.Printf("WS WARNING: could not validate room membership for user %s: %v", userID, err)
			http.Error(w, "Unable to validate room access", http.StatusInternalServerError)
			return
		}
		if !isMember {
			http.Error(w, "Room membership required", http.StatusForbidden)
			return
		}
	}

	hubRoom := "default"
	if targetID != "" && targetID != "undefined" {
		if chatUserID < targetID {
			hubRoom = "dm_" + chatUserID + "_" + targetID
		} else {
			hubRoom = "dm_" + targetID + "_" + chatUserID
		}
	} else if roomID != "" && roomID != "undefined" {
		hubRoom = roomID
	} else {
		hubRoom = "user_" + userID
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WS ERROR: Failed to upgrade connection: %v", err)
		return
	}

	client := &Client{
		Hub:         h.Hub,
		Conn:        conn,
		Send:        make(chan []byte, 256),
		HubRoom:     hubRoom,
		RoomID:      roomID,
		TargetID:    targetID,
		UserID:      userID,
		CountryCode: countryCode,
		ChatUserID:  chatUserID,
		ProfileID:   profileID,
		Role:        role,
		RoomRepo:    h.RoomRepo,
	}
	h.Hub.Register <- client

	// ---------------------------------------------------------
	// OFFLINE MESSAGE SYNC HOOK (PRODUCTION ADDITION)
	// ---------------------------------------------------------
	go func() {
		// Small delay ensures client is fully registered in the hub
		time.Sleep(500 * time.Millisecond)

		// If you have a Repo method to fetch unread DB messages for this user, call it here.
		// Example implementation:
		// unreadMsgs, err := h.Repo.GetUnreadMessages(userID)
		// if err == nil {
		//     for _, msg := range unreadMsgs {
		//         payload, _ := json.Marshal(msg)
		//         client.Send <- payload
		//     }
		// }
	}()

	go client.writePump()
	go client.readPump(h.Repo)
}

func (c *Client) readPump(repo *repository.ChatRepository) {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()

	// PRODUCTION ADDITIONS: Size Limits & Ping-Pong Keepalive
	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	// PRODUCTION ADDITION: Rate Limiting variables
	msgCount := 0
	rateTicker := time.NewTicker(rateLimitWin)
	defer rateTicker.Stop()

	for {
		_, messageBytes, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WS ERROR: unexpected close: %v", err)
			}
			break
		}

		// Check Rate Limits
		select {
		case <-rateTicker.C:
			msgCount = 0 // Reset counter every window
		default:
		}

		msgCount++
		if msgCount > rateLimitMsgs {
			log.Printf("WS WARNING: Rate limit exceeded by UserID: %s", c.UserID)
			// Inform user they are rate limited (optional)
			continue // Drop the message to prevent spam
		}

		var msg models.Message
		if err := json.Unmarshal(messageBytes, &msg); err != nil {
			continue
		}

		msg.SenderID = c.ChatUserID
		msg.Status = "sent"
		msg.Role = c.Role

		if msg.Type == "" {
			msg.Type = "chat"
		}

		// =======================================================
		// 1. READ RECEIPT & TYPING SIGNALING BYPASS
		// =======================================================
		if msg.Type == "typing" || msg.Type == "stop_typing" {
			msg.RecipientID = c.TargetID
			msg.RoomID = c.HubRoom
			payload, _ := json.Marshal(msg)
			c.Hub.Broadcast <- payload
			continue
		}

		if msg.Type == "read_receipt" {
			partnerID := c.TargetID
			if partnerID == "" {
				partnerID = msg.RecipientID
			}

			if partnerID != "" {
				go repo.MarkMessagesAsRead(c.ChatUserID, partnerID)
				receiptsEnabled, err := repo.ReadReceiptsEnabled(c.ChatUserID)
				if err != nil {
					log.Printf("[CHAT] Could not load read-receipt preference for %s: %v", c.UserID, err)
					continue
				}
				if !receiptsEnabled {
					continue
				}

				ActionLogQueue <- models.ActionLog{
					UserID:     c.UserID,
					ActionType: "MESSAGES_READ",
					TargetID:   partnerID,
				}

				msg.RoomID = c.HubRoom
				msg.RecipientID = partnerID
				payload, _ := json.Marshal(msg)
				c.Hub.Broadcast <- payload
			}
			continue
		}

		// Other WebRTC signaling bypass
		if msg.Type != "chat" {
			var raw map[string]interface{}
			json.Unmarshal(messageBytes, &raw)

			targetStr, _ := raw["target_id"].(string)
			if targetStr == "" {
				targetStr, _ = raw["to"].(string)
			}

			msg.RecipientID = targetStr
			payload, _ := json.Marshal(msg)
			c.Hub.Broadcast <- payload
			continue
		}

		// =======================================================
		// 2. STANDARD CHAT & MEDIA MESSAGING
		// =======================================================
		if msg.Content == "" && msg.Text != "" {
			msg.Content = msg.Text
		}
		if msg.Text == "" && msg.Content != "" {
			msg.Text = msg.Content
		}

		if strings.TrimSpace(msg.Content) == "" && strings.TrimSpace(msg.Media) == "" {
			continue
		}
		if c.Hub.Repo != nil {
			muteCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			muted, err := c.Hub.Repo.IsUserAutoMuted(muteCtx, c.UserID)
			cancel()
			if err != nil {
				log.Printf("[WS WARNING] could not check chat mute for user %s: %v", c.UserID, err)
				c.sendRoomError(msg.ClientMessageID, "Could not validate chat restrictions")
				continue
			}
			if muted {
				c.sendRoomError(msg.ClientMessageID, "You are temporarily muted for repeated restricted-language violations")
				continue
			}
		}

		if c.TargetID != "" && c.TargetID != "undefined" {
			msg.RecipientID = c.TargetID
			msg.RoomID = ""
		} else {
			msg.RoomID = c.RoomID
			msg.RecipientID = ""
		}

		contentMode := "general"
		if msg.RoomID != "" {
			if c.RoomRepo == nil {
				c.sendRoomError(msg.ClientMessageID, "Room message policy is unavailable")
				continue
			}
			var err error
			contentMode, err = c.RoomRepo.ValidateRoomMessage(context.Background(), msg.RoomID, c.UserID, msg.Content, msg.Media)
			if err != nil {
				c.sendRoomError(msg.ClientMessageID, roomMessageError(err))
				continue
			}
			msg.Role, err = c.RoomRepo.GetRoomMemberRole(context.Background(), msg.RoomID, c.UserID)
			if err != nil {
				log.Printf("[WS WARNING] could not load room role for user %s in room %s: %v", c.UserID, msg.RoomID, err)
				c.sendRoomError(msg.ClientMessageID, "Could not validate room role")
				continue
			}
		}

		// =======================================================
		// MODERATION FILTER ENGINE
		// =======================================================
		originalText := msg.Content
		isFlagged := false
		explicitHit := false

		if c.Role == "model" || c.Role == "operator" {
			cleanText, flagged := MaskSocialInfo(msg.Content)
			msg.Content = cleanText
			isFlagged = flagged
		} else if contentMode != "mature" {
			explicitHit = HasBadWords(msg.Content)
			cleanText, flagged := MaskBadWords(msg.Content)
			msg.Content = cleanText
			isFlagged = flagged
		}
		msg.IsFlagged = isFlagged

		if isFlagged {
			// Pass originalText as the 4th parameter for admin evidence
			go repo.AutoCreateReport(c.UserID, "SYSTEM", "Automated Flag: Restricted Vocabulary Used", originalText)

			ActionLogQueue <- models.ActionLog{
				UserID:     c.UserID,
				ActionType: "MODERATION_FLAG",
				Metadata:   `{"content":"` + originalText + `"}`,
			}
			if explicitHit && c.Hub.Repo != nil {
				muteCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				muted, err := c.Hub.Repo.RecordExplicitFilterHit(muteCtx, c.UserID)
				cancel()
				if err != nil {
					log.Printf("[WS WARNING] could not record restricted-language hit for user %s: %v", c.UserID, err)
					c.sendRoomError(msg.ClientMessageID, "Could not validate chat restrictions")
					continue
				}
				if muted {
					c.sendRoomError(msg.ClientMessageID, "You are temporarily muted for repeated restricted-language violations")
					continue
				}
			}
		}

		if msg.SenderID == "" || (msg.RoomID == "" && msg.RecipientID == "") {
			continue
		}

		// Save to DB
		if c.ProfileID != "" && c.Role == "model" && c.RoomID == "" {
			msg.EarnedByCreatorID = c.UserID
		}
		if err := repo.SaveMessage(&msg); err != nil {
			log.Printf("DATABASE ERROR saving WS message: %v\n", err)
			c.sendRoomError(msg.ClientMessageID, "Message could not be saved")
			continue
		}

		// Log successful message dispatch
		ActionLogQueue <- models.ActionLog{
			UserID:     c.UserID,
			ActionType: "MESSAGE_SENT",
			TargetID:   msg.RecipientID,
			Metadata:   `{"message_id":"` + msg.ID + `","is_media":` + boolStr(msg.Media != "") + `}`,
		}

		if msg.RoomID == "" && msg.RecipientID != "" && c.Hub.Events != nil {
			go c.Hub.Events.ProcessEvent(context.WithoutCancel(context.Background()), services.AppEvent{
				RecipientID: msg.RecipientID,
				WSEventType: "NEW_MESSAGE",
				WSPayload: map[string]interface{}{
					"title": "New message", "message": "You received a new chat message.",
					"sender_id": c.UserID, "action_url": "/messages", "action_label": "Open chat", "category": "messages",
				},
				EmailTemplate:    "new_message",
				EmailNotifColumn: "notif_messages",
				EmailData:        map[string]interface{}{"Message": "You received a new chat message. Open Chattie to reply."},
			})
		}

		msg.RoomID = c.HubRoom
		payload, _ := json.Marshal(msg)
		select {
		case c.Send <- payload:
		default:
			log.Printf("WS WARNING: could not acknowledge message %s to user %s", msg.ID, c.UserID)
		}
		c.Hub.Broadcast <- payload
	}
}

func roomMessageError(err error) string {
	switch err {
	case repository.ErrUnauthorized:
		return "You are not a member of this room"
	case repository.ErrRoomNotFound:
		return "This room is no longer available"
	case repository.ErrRoomBanned:
		return "You are banned from this room"
	case repository.ErrRoomAgeRestricted:
		return "This room is for adults only"
	case repository.ErrRoomMuted:
		return "You are muted in this room"
	case repository.ErrRoomReadOnly:
		return "Only room moderators can post"
	case repository.ErrRoomMediaDisabled:
		return "Media is disabled in this room"
	case repository.ErrRoomLinksDisabled:
		return "Links are disabled in this room"
	case repository.ErrRoomSlowMode:
		return "Slow mode is enabled; wait before posting again"
	default:
		return "Message does not follow this room's posting rules"
	}
}

func (c *Client) sendRoomError(clientMessageID, reason string) {
	payload, err := json.Marshal(models.Message{
		Type:            "error",
		ClientMessageID: clientMessageID,
		Reason:          reason,
	})
	if err != nil {
		log.Printf("WS ERROR: failed to encode room message error: %v", err)
		return
	}
	select {
	case c.Send <- payload:
	default:
		log.Printf("WS WARNING: could not send room message error to user %s", c.UserID)
	}
}

func (c *Client) writePump() {
	// PRODUCTION ADDITION: Ping ticker to keep connection alive
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel.
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Add queued messages to the current websocket message to improve throughput
			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			// Send a ping message periodically to detect dead connections
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (h *WebSocketHandler) GetInbox(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrUnauthorizedMissingContext", "Unauthorized: Missing context")})
		return
	}

	inbox, err := h.Repo.GetInbox(userID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedFetchInbox", "Failed to fetch inbox")})
		return
	}

	json.NewEncoder(w).Encode(inbox)
}

func (h *WebSocketHandler) GetUserInsights(w http.ResponseWriter, r *http.Request) {
	targetUserID := chi.URLParam(r, "userId")

	insight, err := h.Repo.GetUserInsights(r.Context(), targetUserID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedFetchUserInsights", "Failed to fetch user insights"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(insight)
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
