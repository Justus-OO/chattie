package models

import "time"

type SettingsPayload struct {
	// Profile Data
	Name             string   `json:"name"`
	Email            string   `json:"email"`
	PhoneNumber      string   `json:"phone_number"`
	Job              string   `json:"job"`
	Location         string   `json:"location"`
	Bio              string   `json:"bio"`
	Intent           string   `json:"intent"`
	Tags             []string `json:"tags"`
	Avatar           string   `json:"avatar"`
	Cover            string   `json:"cover"`
	AvatarStorageURL string   `json:"avatar_storage_url"`
	CoverStorageURL  string   `json:"cover_storage_url"`
	PreserveAvatar   bool     `json:"-"`
	PreserveCover    bool     `json:"-"`
	Photos           []string `json:"photos"`
	Verified         bool     `json:"verified"`
	TwoFactorEnabled bool     `json:"two_factor_enabled"`
	TwoFactorChannel string   `json:"two_factor_channel"`

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

	SubStatus string `json:"sub_status"`
	ExpiresAt string `json:"expires_at"`
	Plan      string `json:"plan"`
}

type MediaItem struct {
	ID        string    `json:"id"`
	URL       string    `json:"url"`
	IsPrimary bool      `json:"is_primary"`
	CreatedAt time.Time `json:"created_at"`
}
