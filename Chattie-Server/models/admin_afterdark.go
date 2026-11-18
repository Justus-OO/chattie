package models

import "time"

type AdminAfterDarkPost struct {
	ID                 string    `json:"id"`
	CreatorID          string    `json:"creator_id"`
	CreatorName        string    `json:"creator_name"`
	Caption            string    `json:"caption"`
	Status             string    `json:"status"`
	AccessType         string    `json:"access_type"`
	PriceCents         int64     `json:"price_cents"`
	IsExplicit         bool      `json:"is_explicit"`
	AssetStatus        string    `json:"asset_status"`
	ModerationStatus   string    `json:"moderation_status"`
	MediaType          string    `json:"media_type"`
	PendingReportCount int       `json:"pending_report_count"`
	CreatedAt          time.Time `json:"created_at"`
}
