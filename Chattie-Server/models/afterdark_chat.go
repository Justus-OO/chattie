package models

import "time"

type ADConversation struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ADConversationSummary struct {
	ID             string            `json:"id"`
	ConversationID string            `json:"conversation_id"`
	OtherUserID    string            `json:"other_user_id"`
	OtherUser      ADChatParticipant `json:"other_user"`
	LastMessage    string            `json:"last_message"`
	LastMessageAt  time.Time         `json:"last_message_at"`
	UnreadCount    int               `json:"unread_count"`
	HasAccess      bool              `json:"has_access"`
	DMControl      string            `json:"dm_control"`
	ChatPriceCents int64             `json:"chat_price_cents"`
	BlockedByMe    bool              `json:"blocked_by_me"`
	BlockedMe      bool              `json:"blocked_me"`
}

type ADChatParticipant struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Username    string `json:"username,omitempty"`
	AvatarURL   string `json:"avatar_url,omitempty"`
}

type ADMessage struct {
	ID               string              `json:"id"`
	ConversationID   string              `json:"conversation_id"`
	SenderID         string              `json:"sender_id"`
	Content          string              `json:"content"`
	MediaAssetID     string              `json:"media_asset_id,omitempty"`
	MediaURL         string              `json:"media_url,omitempty"`
	MediaType        string              `json:"media_type,omitempty"`
	IsExplicit       bool                `json:"is_explicit"`
	IsRead           bool                `json:"is_read"`
	MessageKind      string              `json:"message_kind"`
	CallMode         string              `json:"call_mode,omitempty"`
	ReplyToMessageID string              `json:"reply_to_message_id,omitempty"`
	IsPinned         bool                `json:"is_pinned"`
	PinnedBy         string              `json:"pinned_by,omitempty"`
	PinnedAt         *time.Time          `json:"pinned_at,omitempty"`
	Reactions        []ADMessageReaction `json:"reactions,omitempty"`
	CreatedAt        time.Time           `json:"created_at"`
}

type ADMessageReaction struct {
	Emoji   string `json:"emoji"`
	Count   int    `json:"count"`
	Reacted bool   `json:"reacted"`
}
