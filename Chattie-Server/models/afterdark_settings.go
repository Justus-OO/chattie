package models

import (
	"encoding/json"
	"time"
)

type ADCreatorSettings struct {
	UserID              string          `json:"user_id"`
	WatermarkEnabled    *bool           `json:"watermark_enabled"`
	WatermarkText       *string         `json:"watermark_text"`
	GeoBlockEnabled     *bool           `json:"geo_block_enabled"`
	BlockedRegions      []string        `json:"blocked_regions"`
	ShowExplicitContent *bool           `json:"show_explicit_content"`
	Discoverable        *bool           `json:"discoverable"`
	NotificationEmail   json.RawMessage `json:"notification_email"`
	NotificationPush    json.RawMessage `json:"notification_push"`
	DefaultPPVCents     *int64          `json:"-"`
	DefaultPPV          *float64        `json:"default_ppv"`
	AutoWithdraw        *bool           `json:"auto_withdraw"`
	WithdrawThreshold   *float64        `json:"withdraw_threshold"`
	Paused              *bool           `json:"paused"`
	UpdatedAt           time.Time       `json:"updated_at"`
}

type ADExportRequest struct {
	JobID     string    `json:"job_id"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}
