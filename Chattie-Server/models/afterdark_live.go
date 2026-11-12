package models

import "time"

type ADLiveSession struct {
	ID                     string     `json:"id"`
	CreatorID              string     `json:"creator_id"`
	HostID                 string     `json:"host_id,omitempty"`
	DisplayName            string     `json:"display_name,omitempty"`
	Username               string     `json:"username,omitempty"`
	AvatarURL              string     `json:"avatar_url,omitempty"`
	Status                 string     `json:"status"`
	PriceCents             int64      `json:"price_cents"`
	SubscriptionPriceCents int64      `json:"subscription_price_cents,omitempty"`
	StartedAt              time.Time  `json:"started_at"`
	EndedAt                *time.Time `json:"ended_at,omitempty"`
}

type ADLiveStageRequest struct {
	SessionID string    `json:"session_id"`
	ViewerID  string    `json:"viewer_id"`
	Status    string    `json:"status"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ADLiveTipNotification struct {
	Type        string `json:"type"`
	ID          string `json:"id"`
	SenderID    string `json:"sender_id"`
	SenderName  string `json:"sender_name"`
	AmountCents int64  `json:"amount_cents"`
	Message     string `json:"message,omitempty"`
}
