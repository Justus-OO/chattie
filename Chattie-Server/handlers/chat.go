package handlers

import (
	"context"
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

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
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
	Hub      *Hub
	Conn     *websocket.Conn
	Send     chan []byte
	HubRoom  string // Internal virtual routing string
	RoomID   string // DB Room UUID (for group chats)
	TargetID string // DB Recipient UUID (for 1-on-1 DMs)
	UserID   string // Sender UUID
	Role     string // 'model', 'operator', or 'user'
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
						if client.UserID == msg.RecipientID {
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
						if client.UserID == msg.SenderID && msg.Type == "chat" {
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
	Hub  *Hub
	Repo *repository.ChatRepository
}

func NewWebSocketHandler(hub *Hub, repo *repository.ChatRepository) *WebSocketHandler {
	return &WebSocketHandler{Hub: hub, Repo: repo}
}

func (h *WebSocketHandler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room_id")
	targetID := r.URL.Query().Get("target_id")
	tokenStr := r.URL.Query().Get("token")

	tokenStr = strings.TrimPrefix(tokenStr, "Bearer ")
	tokenStr = strings.TrimSpace(tokenStr)

	var userID string
	var role string
	if tokenStr != "" {
		token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
			return []byte("super_secret_chattie_key_do_not_leak"), nil
		})

		if err == nil && token != nil && token.Valid {
			if claims, ok := token.Claims.(jwt.MapClaims); ok {
				if id, ok := claims["user_id"].(string); ok {
					userID = id
				} else if id, ok := claims["sub"].(string); ok {
					userID = id
				} else if id, ok := claims["userID"].(string); ok {
					userID = id
				}
				if r, ok := claims["role"].(string); ok {
					role = r
				}
			}
		} else {
			log.Printf("WS WARNING: JWT Parsing failed: %v", err)
		}
	}

	if userID == "" {
		log.Println("WS CRITICAL: User connected without a valid UserID!")
		return
	}

	hubRoom := "default"
	if targetID != "" && targetID != "undefined" {
		if userID < targetID {
			hubRoom = "dm_" + userID + "_" + targetID
		} else {
			hubRoom = "dm_" + targetID + "_" + userID
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
		Hub:      h.Hub,
		Conn:     conn,
		Send:     make(chan []byte, 256),
		HubRoom:  hubRoom,
		RoomID:   roomID,
		TargetID: targetID,
		UserID:   userID,
		Role:     role,
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

		msg.SenderID = c.UserID
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
				go repo.MarkMessagesAsRead(c.UserID, partnerID)
				receiptsEnabled, err := repo.ReadReceiptsEnabled(c.UserID)
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

		// =======================================================
		// MODERATION FILTER ENGINE
		// =======================================================
		originalText := msg.Content // Store the original text before masking
		isFlagged := false

		if c.Role == "model" || c.Role == "operator" {
			cleanText, flagged := MaskSocialInfo(msg.Content)
			msg.Content = cleanText
			isFlagged = flagged
		} else {
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
		}

		if c.TargetID != "" && c.TargetID != "undefined" {
			msg.RecipientID = c.TargetID
			msg.RoomID = ""
		} else {
			msg.RoomID = c.RoomID
			msg.RecipientID = ""
		}

		if msg.SenderID == "" || (msg.RoomID == "" && msg.RecipientID == "") {
			continue
		}

		// Save to DB
		if err := repo.SaveMessage(&msg); err != nil {
			log.Printf("DATABASE ERROR saving WS message: %v\n", err)
			continue
		}

		// Log successful message dispatch
		ActionLogQueue <- models.ActionLog{
			UserID:     c.UserID,
			ActionType: "MESSAGE_SENT",
			TargetID:   msg.RecipientID,
			Metadata:   `{"message_id":"` + msg.ID + `","is_media":` + boolStr(msg.Media != "") + `}`,
		}

		msg.RoomID = c.HubRoom
		payload, _ := json.Marshal(msg)
		c.Hub.Broadcast <- payload
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
