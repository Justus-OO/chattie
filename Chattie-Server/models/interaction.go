// models/interaction.go
package models

const (
	InteractionCodeUpgradeRequired = "UPGRADE_REQUIRED"
	InteractionCodeAlreadyExists   = "ALREADY_INTERACTED"
	InteractionCodeUnavailable     = "USER_UNAVAILABLE"
)

type InteractionRequest struct {
	TargetID   string `json:"target_id"`
	ActionType string `json:"action_type"` // "LIKE", "PASS", "SUPER_LIKE", "FLIRT"
}

// Sent back to React to trigger the "It's a Match!" modal
type InteractionResponse struct {
	Allowed bool   `json:"allowed"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"` // e.g., "Out of swipes for today"
	IsMatch bool   `json:"is_match"`
}

type MatchResponse struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`
	Status      string `json:"status"`    // 'online' or 'offline'
	MatchPct    int    `json:"match_pct"` // e.g., 98
}
