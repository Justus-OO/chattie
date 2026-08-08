package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Client represents an active WebSocket connection
type Client struct {
	Hub      *Hub
	Conn     *websocket.Conn
	Send     chan []byte
	HubRoom  string // The internal virtual routing string
	RoomID   string // The DB Room UUID (if group chat)
	TargetID string // The DB Recipient UUID (if 1-on-1 DM)
	UserID   string // The Sender UUID
}

type Hub struct {
	Clients    map[*Client]bool
	Rooms      map[string]map[*Client]bool // Maps HubRoom string to Clients
	Broadcast  chan []byte
	Register   chan *Client
	Unregister chan *Client
	Mutex      sync.Mutex
}

func NewHub() *Hub {
	return &Hub{
		Clients:    make(map[*Client]bool),
		Rooms:      make(map[string]map[*Client]bool),
		Broadcast:  make(chan []byte),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
	}
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
			h.Mutex.Unlock()

		case client := <-h.Unregister:
			h.Mutex.Lock()
			if _, ok := h.Clients[client]; ok {
				delete(h.Clients, client)
				delete(h.Rooms[client.HubRoom], client)
				close(client.Send)
			}
			h.Mutex.Unlock()

		case message := <-h.Broadcast:
			var msg models.Message
			if err := json.Unmarshal(message, &msg); err == nil {
				h.Mutex.Lock()

				// ---------------------------------------------------------
				// 1. QUICK DEBUG LOGS
				// ---------------------------------------------------------
				log.Printf("[WS DEBUG] Sender: %s | Type: %s | RoomID: %s | Recipient: %s", msg.SenderID, msg.Type, msg.RoomID, msg.RecipientID)

				// ---------------------------------------------------------
				// 2. 10/10 GLOBAL SendToUser (For Calls & Notifications)
				// ---------------------------------------------------------
				// If this is a signaling message (like a call), find the user ANYWHERE in the app
				if msg.Type != "" && msg.RecipientID != "" {
					delivered := false

					// Scan ALL active sockets globally
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

					if !delivered {
						log.Printf("[WS WARNING] Call failed: User %s has no active WebSockets open.", msg.RecipientID)
					}
				} else {
					// ---------------------------------------------------------
					// 3. STANDARD ROUTING (For standard chat & media messages)
					// ---------------------------------------------------------
					for client := range h.Rooms[msg.RoomID] {

						// ANTI-ECHO BARRIER: Don't send chat messages back to the person who sent them!
						if client.UserID == msg.SenderID {
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
				}
				h.Mutex.Unlock()
			}
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

	// 1. Clean the token
	tokenStr = strings.TrimPrefix(tokenStr, "Bearer ")
	tokenStr = strings.TrimSpace(tokenStr)

	// 2. Extract UserID securely from the JWT
	var userID string
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
			}
		} else {
			log.Printf("WS WARNING: JWT Parsing failed: %v", err)
		}
	}

	if userID == "" {
		log.Println("WS CRITICAL: User connected without a valid UserID!")
		return // Drop connection if unauthenticated
	}

	// === DUAL-MODE ROUTING LOGIC ===
	hubRoom := "default"
	if targetID != "" && targetID != "undefined" {
		// It's a 1-on-1 DM: Create deterministic virtual room
		if userID < targetID {
			hubRoom = "dm_" + userID + "_" + targetID
		} else {
			hubRoom = "dm_" + targetID + "_" + userID
		}
	} else if roomID != "" && roomID != "undefined" {
		// It's a Group Room
		hubRoom = roomID
	} else {
		// GLOBAL NOTIFICATION SOCKET: Assign them to a personal room
		// if they are just browsing the app
		hubRoom = "user_" + userID
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
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
	}
	h.Hub.Register <- client

	go client.writePump()
	go client.readPump(h.Repo)
}

func (c *Client) readPump(repo *repository.ChatRepository) {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()

	for {
		_, messageBytes, err := c.Conn.ReadMessage()
		if err != nil {
			break
		}

		var msg models.Message
		if err := json.Unmarshal(messageBytes, &msg); err != nil {
			continue
		}

		msg.SenderID = c.UserID
		msg.Status = "sent"

		// =======================================================
		// SIGNALING BYPASS: WEBRTC CALLS & REACTIONS
		// =======================================================
		if msg.Type != "" {
			// Extract target user from the raw JSON (React sends 'target_id' or 'to')
			var raw map[string]interface{}
			json.Unmarshal(messageBytes, &raw)

			targetStr, _ := raw["target_id"].(string)
			if targetStr == "" {
				targetStr, _ = raw["to"].(string)
			}

			// Assign the Target to RecipientID so Hub.Run() can route it globally
			msg.RecipientID = targetStr

			payload, _ := json.Marshal(msg)
			c.Hub.Broadcast <- payload

			continue // Skip saving to database!
		}

		// =======================================================
		// STANDARD TEXT & MEDIA CHAT LOGIC
		// =======================================================
		if msg.Content == "" && msg.Text != "" {
			msg.Content = msg.Text
		}
		if msg.Text == "" && msg.Content != "" {
			msg.Text = msg.Content
		}

		// Drop empty ghost messages that aren't signals
		if strings.TrimSpace(msg.Content) == "" && strings.TrimSpace(msg.Media) == "" {
			continue
		}

		if c.TargetID != "" && c.TargetID != "undefined" {
			msg.RecipientID = c.TargetID
			msg.RoomID = "" // DMs
		} else {
			msg.RoomID = c.RoomID
			msg.RecipientID = "" // Group Rooms
		}

		if msg.SenderID == "" {
			continue
		}
		if msg.RoomID == "" && msg.RecipientID == "" {
			continue
		}

		// SAVE MESSAGE & MEDIA TO POSTGRESQL
		if err := repo.SaveMessage(&msg); err != nil {
			log.Printf("DATABASE ERROR saving WS message: %v\n", err)
			continue
		}

		// Broadcast standard message using HubRoom string
		msg.RoomID = c.HubRoom
		payload, _ := json.Marshal(msg)
		c.Hub.Broadcast <- payload
	}
}

func (c *Client) writePump() {
	defer c.Conn.Close()
	for message := range c.Send {
		if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
			break
		}
	}
}

func (h *WebSocketHandler) GetInbox(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)

	if !ok || userID == "" {
		log.Println("CRITICAL 401: user_id missing from request context in GetInbox!")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized: Missing context"})
		return
	}

	inbox, err := h.Repo.GetInbox(userID)
	if err != nil {
		log.Printf("500 Error fetching inbox for %s: %v\n", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to fetch inbox"})
		return
	}

	json.NewEncoder(w).Encode(inbox)
}
