package models

import "time"

type SettingsPayload struct {
	// Profile Data
	Name     string   `json:"name"`
	Job      string   `json:"job"`
	Location string   `json:"location"`
	Bio      string   `json:"bio"`
	Intent   string   `json:"intent"`
	Tags     []string `json:"tags"`
	Avatar   string   `json:"avatar"`
	Cover    string   `json:"cover"`

	// Discovery Preferences
	Distance int    `json:"distance"`
	AgeMin   int    `json:"ageMin"`
	AgeMax   int    `json:"ageMax"`
	IsGlobal bool   `json:"isGlobal"`
	ShowMe   string `json:"showMe"`

	// Toggles
	Notifs    map[string]bool `json:"notifs"`
	Privacy   map[string]bool `json:"privacy"`
	Connected map[string]bool `json:"connected"`
}
type MediaItem struct {
	ID        string    `json:"id"`
	URL       string    `json:"url"`
	IsPrimary bool      `json:"is_primary"`
	CreatedAt time.Time `json:"created_at"`
}
