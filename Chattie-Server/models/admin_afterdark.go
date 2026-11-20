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
	CommentsCount      int       `json:"comments_count"`
	Comments           []AdminAfterDarkComment `json:"comments"`
	AISafetyScore      *int      `json:"ai_safety_score"`
	AISafetyReason     string    `json:"ai_safety_reason"`
	AISafetyScoredAt   *time.Time `json:"ai_safety_scored_at"`
	CreatedAt          time.Time `json:"created_at"`
}

type AdminAfterDarkComment struct {
	ID        string    `json:"id"`
	Author    string    `json:"author"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}
