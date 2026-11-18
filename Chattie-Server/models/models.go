package models

import "time"

// Core Auth
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"` // Required to prevent compilation errors in AuthHandler
	Email        string    `json:"email"`
	Password     string    `json:"password,omitempty"` // omitempty prevents it from being sent to frontend
	Role         string    `json:"role"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	Provider     string    `json:"provider"`
	TokenVersion int64     `json:"-"`
}

type UserProfile struct {
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	PhoneNumber string `json:"phone_number"`
	DateOfBirth string `json:"date_of_birth"` // Format: YYYY-MM-DD
	Gender      string `json:"gender"`
	Bio         string `json:"bio"`
	HeightCm    int    `json:"height_cm"`
	Verified    bool   `json:"verified"`
}

type UserLocation struct {
	UserID      string  `json:"user_id"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	City        string  `json:"city"`
	Country     string  `json:"country"`
	CountryCode string  `json:"country_code,omitempty"`
}

// Step 4: Preferences
type UserPreference struct {
	UserID        string   `json:"user_id"`
	InterestedIn  string   `json:"interested_in"`
	ShowMe        string   `json:"show_me"`
	MinAge        int      `json:"min_age"`
	MaxAge        int      `json:"max_age"`
	MaxDistanceKm int      `json:"max_distance_km"`
	Tags          []string `json:"tags"`
}

// Step 5: Media
type UserMedia struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	MediaURL  string `json:"media_url"`
	IsPrimary bool   `json:"is_primary"`
	SortOrder int    `json:"sort_order"`
}

// DiscoverProfile is the composite struct sent to the React Swipe and Grid components
type DiscoverProfile struct {
	ID          string   `json:"id"`
	DisplayName string   `json:"display_name"`
	Bio         string   `json:"bio"`
	Age         int      `json:"age"`  // Calculated from UserProfile.DateOfBirth
	City        string   `json:"city"` // From UserLocation
	CountryCode string   `json:"country_code,omitempty"`
	Distance    float64  `json:"distance_km"` // Calculated via PostGIS/Haversine
	MatchPct    int      `json:"match_pct"`   // Calculated via the Tag overlap query
	Tags        []string `json:"tags"`        // Aggregated from user_tags
	Images      []string `json:"images"`      // Aggregated from UserMedia
	Intent      string   `json:"intent"`      // e.g., "Casual", "Dating"
	IsNew       bool     `json:"is_new,omitempty"`
}
type ConsentLog struct {
	UserID    string `json:"user_id"`
	IPAddress string `json:"ip_address"`
	UserAgent string `json:"user_agent"`
}
