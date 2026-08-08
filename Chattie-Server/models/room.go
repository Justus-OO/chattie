package models

import "time"

type Room struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Icon        string    `json:"icon"`
	Category    string    `json:"category"`
	Description string    `json:"desc"`
	Tags        []string  `json:"tags"`
	IsPrivate   bool      `json:"isPrivate"`
	RoomCode    string    `json:"roomCode,omitempty"` // Shareable Room Code
	CreatedBy   string    `json:"created_by,omitempty"`
	ActiveCount int       `json:"active"`
	CreatedAt   time.Time `json:"created_at"`
}

// RoomDetails extends Room with admin controls, roles, and waiting lists
type RoomDetails struct {
	Room
	UserRole     string `json:"userRole"`     // 'creator', 'admin', 'speaker', 'member'
	InviteLink   string `json:"inviteLink"`   // Full shareable URL
	PendingCount int    `json:"pendingCount"` // Number of users waiting to enter private room
}

type RoomParticipant struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Avatar   string `json:"avatar"`
	Status   string `json:"status"`
	MatchPct int    `json:"matchPct"`
	Role     string `json:"role,omitempty"` // 'creator', 'admin', 'speaker', 'member'
}

type RoomJoinRequest struct {
	ID        string    `json:"id"`
	RoomID    string    `json:"room_id"`
	UserID    string    `json:"user_id"`
	Status    string    `json:"status"` // 'PENDING', 'APPROVED', 'REJECTED'
	CreatedAt time.Time `json:"created_at"`
	UserName  string    `json:"user_name,omitempty"`
	Avatar    string    `json:"avatar,omitempty"`
}
