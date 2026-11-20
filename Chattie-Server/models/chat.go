package models

import "time"

type Message struct {
	ID                string                `json:"id"`
	SenderID          string                `json:"sender_id"`
	SenderName        string                `json:"sender_name,omitempty"` // Hydrated from DB for frontend display
	AvatarURL         string                `json:"avatar_url,omitempty"`  // Hydrated from DB for frontend display
	RecipientID       string                `json:"recipient_id,omitempty"`
	RoomID            string                `json:"room_id,omitempty"`
	Content           string                `json:"content"`
	Text              string                `json:"text,omitempty"`  // Fallback alias sent by React
	Media             string                `json:"media,omitempty"` // The new media attachment URL
	Status            string                `json:"status"`
	CreatedAt         time.Time             `json:"created_at"`
	IsPinned          bool                  `json:"is_pinned,omitempty"`
	PinnedBy          string                `json:"pinned_by,omitempty"`
	PinnedAt          *time.Time            `json:"pinned_at,omitempty"`
	MessageKind       string                `json:"message_kind,omitempty"`
	IsAIGenerated    bool                  `json:"is_ai_generated,omitempty"`
	CallMode          string                `json:"call_mode,omitempty"`
	Reactions         []RoomMessageReaction `json:"reactions,omitempty"`
	ClientMessageID   string                `json:"client_message_id,omitempty"`
	EarnedByCreatorID string                `json:"-"`

	Type     string `json:"type,omitempty"`      // 'chat', 'notification', 'incoming_call', 'call_answered', 'reaction'
	Mode     string `json:"mode,omitempty"`      // 'video' or 'audio'
	FromName string `json:"from_name,omitempty"` // Name of the caller
	Emoji    string `json:"emoji,omitempty"`     // Emoji reaction string
	Reason   string `json:"reason,omitempty"`

	// --- MODERATION FIELDS (NEW) ---
	IsFlagged bool   `json:"is_flagged,omitempty"` // True if caught by regex filters
	Role      string `json:"role,omitempty"`       // 'model' or 'user' (travels with message for frontend UI)
}

type InboxItem struct {
	RoomID          string    `json:"room_id"`
	PartnerID       string    `json:"partner_id"`
	PartnerName     string    `json:"partner_name"`
	AvatarURL       string    `json:"avatar_url"`
	Bio             string    `json:"bio"`
	LifetimeSpend   float64   `json:"lifetime_spend"`
	LastMessage     string    `json:"last_message"`
	LastMessageTime time.Time `json:"last_message_time"`
	UnreadCount     int       `json:"unread_count"`
	Status          string    `json:"status"`
	IsMuted         bool      `json:"is_muted"`
}

// --- NEW MODERATION & TRACKING STRUCTS ---

// ActionLog is pushed to the async logger channel
type ActionLog struct {
	UserID     string `json:"user_id"`
	ActionType string `json:"action_type"` // e.g., 'PROFILE_UPDATE', 'REPORT_USER', 'NSFW_FLAG'
	TargetID   string `json:"target_id,omitempty"`
	IP         string `json:"ip_address,omitempty"`
	Metadata   string `json:"metadata,omitempty"` // JSON string of extra context (e.g., {"word_used": "telegram"})
}

// UserInsight provides context to Operators/Models about the user they are chatting with
type UserInsight struct {
	JoinDate      string   `json:"join_date"`
	TotalSpent    float64  `json:"total_spent"`
	Preferences   []string `json:"preferences"`
	RiskScore     int      `json:"risk_score"`
	PreviousFlags int      `json:"previous_flags"`
	IsSuspicious  bool     `json:"is_suspicious"` // True if RiskScore > 50
}
