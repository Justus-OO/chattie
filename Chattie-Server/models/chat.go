package models

import "time"

type Message struct {
	ID          string    `json:"id"`
	SenderID    string    `json:"sender_id"`
	SenderName  string    `json:"sender_name,omitempty"` // Hydrated from DB for frontend display
	AvatarURL   string    `json:"avatar_url,omitempty"`  // Hydrated from DB for frontend display
	RecipientID string    `json:"recipient_id,omitempty"`
	RoomID      string    `json:"room_id,omitempty"`
	Content     string    `json:"content"`
	Text        string    `json:"text,omitempty"`  // Fallback alias sent by React
	Media       string    `json:"media,omitempty"` // The new media attachment URL
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`

	Type     string `json:"type,omitempty"`      // 'incoming_call', 'call_answered', 'reaction'
	Mode     string `json:"mode,omitempty"`      // 'video' or 'audio'
	FromName string `json:"from_name,omitempty"` // Name of the caller
	Emoji    string `json:"emoji,omitempty"`     // Emoji reaction string
	Reason   string `json:"reason,omitempty"`
}

type InboxItem struct {
	RoomID          string    `json:"room_id"`
	PartnerID       string    `json:"partner_id"`
	PartnerName     string    `json:"partner_name"`
	AvatarURL       string    `json:"avatar_url"`
	LastMessage     string    `json:"last_message"`
	LastMessageTime time.Time `json:"last_message_time"`
	UnreadCount     int       `json:"unread_count"`
	Status          string    `json:"status"`
	IsMuted         bool      `json:"is_muted"`
}
