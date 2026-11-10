package models

import "time"

// ADAsset tracks the actual file residing in a private bucket
type ADAsset struct {
	ID               string    `json:"id"`
	OwnerID          string    `json:"owner_id"`
	StorageKey       string    `json:"storage_key"`
	MimeType         string    `json:"mime_type"`
	SizeBytes        int64     `json:"size_bytes"`
	Status           string    `json:"status"`
	ModerationStatus string    `json:"moderation_status"`
	CreatedAt        time.Time `json:"created_at"`
}

// ADPost tracks the viewer-facing content and its paywall strategy
type ADPost struct {
	ID              string           `json:"id"`
	CreatorID       string           `json:"creator_id"`
	AssetID         string           `json:"asset_id"`
	MediaURL        string           `json:"media_url,omitempty"`
	MediaType       string           `json:"media_type,omitempty"`
	Creator         PerformerProfile `json:"creator"`
	Caption         string           `json:"caption"`
	AccessType      string           `json:"access_type"` // free, subscriber, ppv
	PricingStrategy string           `json:"pricing_strategy"`
	PriceCents      int64            `json:"price_cents"`
	IsUnlocked      bool             `json:"is_unlocked"`
	IsExplicit      bool             `json:"is_explicit"`
	Status          string           `json:"status"`
	PublishAt       *time.Time       `json:"publish_at,omitempty"`
	CreatedAt       time.Time        `json:"created_at"`
	UpdatedAt       time.Time        `json:"updated_at"`
}
