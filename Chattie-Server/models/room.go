package models

import "time"

type Room struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Icon            string    `json:"icon"`
	Category        string    `json:"category"`
	Description     string    `json:"desc"`
	Tags            []string  `json:"tags"`
	IsPrivate       bool      `json:"isPrivate"`
	RoomCode        string    `json:"roomCode,omitempty"`
	CreatedBy       string    `json:"created_by,omitempty"`
	ActiveCount     int       `json:"active"`
	MemberCount     int       `json:"member_count"`
	IsVoiceRoom     bool      `json:"isVoiceRoom"`
	Rules           string    `json:"rules"`
	ContentMode     string    `json:"content_mode"`
	AllowMedia      bool      `json:"allow_media"`
	AllowLinks      bool      `json:"allow_links"`
	SlowModeSeconds int       `json:"slow_mode_seconds"`
	IsReadOnly      bool      `json:"is_read_only"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	UserRole        string    `json:"userRole,omitempty"`
}

type RoomDetails struct {
	Room
	UserRole          string `json:"userRole"`
	IsMember          bool   `json:"isMember"`
	HasPendingRequest bool   `json:"hasPendingRequest"`
	InviteLink        string `json:"inviteLink,omitempty"`
	PendingCount      int    `json:"pendingCount"`
}

type RoomVoiceSession struct {
	Active    bool       `json:"active"`
	StartedBy string     `json:"started_by,omitempty"`
	StartedAt *time.Time `json:"started_at,omitempty"`
}

type RoomUpdate struct {
	Name            *string   `json:"name"`
	Description     *string   `json:"description"`
	Desc            *string   `json:"desc"`
	Category        *string   `json:"category"`
	Icon            *string   `json:"icon"`
	Tags            *[]string `json:"tags"`
	IsPrivate       *bool     `json:"isPrivate"`
	IsVoiceRoom     *bool     `json:"isVoiceRoom"`
	Rules           *string   `json:"rules"`
	ContentMode     *string   `json:"content_mode"`
	AllowMedia      *bool     `json:"allow_media"`
	AllowLinks      *bool     `json:"allow_links"`
	SlowModeSeconds *int      `json:"slow_mode_seconds"`
	IsReadOnly      *bool     `json:"is_read_only"`
}

type RoomParticipant struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Avatar   string `json:"avatar"`
	Status   string `json:"status"`
	MatchPct int    `json:"matchPct"`
	Role     string `json:"role,omitempty"`
	IsMuted  bool   `json:"is_muted"`
}

type RoomJoinRequest struct {
	ID        string    `json:"id"`
	RoomID    string    `json:"room_id"`
	UserID    string    `json:"user_id"`
	Status    string    `json:"status"` // 'PENDING', 'APPROVED', 'REJECTED'
	CreatedAt time.Time `json:"created_at"`
	UserName  string    `json:"user_name,omitempty"`
	Avatar    string    `json:"avatar,omitempty"`
	RoomName  string    `json:"room_name,omitempty"`
}

type RoomMessageReaction struct {
	Emoji   string `json:"emoji"`
	Count   int    `json:"count"`
	Reacted bool   `json:"reacted"`
}
