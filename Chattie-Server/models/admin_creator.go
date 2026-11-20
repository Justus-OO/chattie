package models

// OperatorSecurity represents security telemetry for an operator
type OperatorSecurity struct {
	LastIP     string `json:"lastIp"`
	MfaEnabled bool   `json:"mfaEnabled"`
	Locked     bool   `json:"locked"`
}

// OperatorPerformance represents output metrics for an operator
type OperatorPerformance struct {
	AvgReplyTime         string  `json:"avgReplyTime"`
	AvgReplyTimeSeconds  int64   `json:"avgReplyTimeSeconds"`
	MsgsSent             int     `json:"msgsSent"`
	ActiveSessions       int     `json:"activeSessions"`
	Rating               float64 `json:"rating"`
	RatingSampleSize     int     `json:"ratingSampleSize"`
	AnsweredMessages     int     `json:"answeredMessages"`
	SubstantiatedReports int     `json:"substantiatedReports"`
}

// OperatorDetail represents the human staff member operating chat queues
type OperatorDetail struct {
	ID              string              `json:"id"`
	Username        string              `json:"username"`
	DisplayName     string              `json:"displayName"` // Maps to realName in FE
	Email           string              `json:"email"`
	Role            string              `json:"role"`
	Status          string              `json:"status"` // 'ONLINE', 'OFFLINE', 'SUSPENDED'
	CurrentBalance  float64             `json:"current_balance"`
	TotalEarned     float64             `json:"total_earned"`
	CommissionRate  float64             `json:"commissionRate"` // Matched to FE prop
	AutoPilotActive bool                `json:"autoPilotActive"`
	Security        OperatorSecurity    `json:"security"`
	Performance     OperatorPerformance `json:"performance"`
	Personas        []PersonaMetric     `json:"personas"`
}

// PersonaMetric represents individual virtual model profiles managed by creators
type PersonaMetric struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	AvatarURL       string  `json:"avatar_url"`
	Archetype       string  `json:"archetype"`
	Status          string  `json:"status"`
	ManagerID       string  `json:"manager_id"`
	Revenue         float64 `json:"earnings"` // Matched to FE
	ActiveChats     int     `json:"activeChats"`
	PendingReplies  int     `json:"pendingReplies"`
	Unread          int     `json:"unread"`
	MediaVault      int     `json:"mediaVault"`
	AutoPilotActive bool    `json:"autoPilotActive"`
	LastActivity    string  `json:"lastActivity"`
}

// CreatePersonaRequest contains the discovery-ready data for a new managed persona.
type CreatePersonaRequest struct {
	Name        string   `json:"name"`
	Archetype   string   `json:"archetype"`
	AvatarURL   string   `json:"avatarUrl"`
	Bio         string   `json:"bio"`
	Gender      string   `json:"gender"`
	DateOfBirth string   `json:"dateOfBirth"`
	Height      int      `json:"height"`
	City        string   `json:"city"`
	Country     string   `json:"country"`
	CountryCode string   `json:"countryCode"`
	Latitude    *float64 `json:"latitude"`
	Longitude   *float64 `json:"longitude"`
	Interests   []string `json:"interests"`
}

// AdminCreateCreatorRequest represents the payload sent from the admin panel to provision a creator
type AdminCreateCreatorRequest struct {
	Email       string  `json:"email"`
	Username    string  `json:"username"`
	Password    string  `json:"password"`
	DisplayName string  `json:"display_name"`
	Gender      string  `json:"gender"`
	DateOfBirth string  `json:"date_of_birth"` // YYYY-MM-DD
	Bio         string  `json:"bio"`
	AvatarURL   string  `json:"avatar_url"`
	Intent      string  `json:"intent"`
	Commission  float64 `json:"commission_rate"`
}

// StatusUpdateRequest payload for overriding statuses
type StatusUpdateRequest struct {
	Status string `json:"status"` // ONLINE, OFFLINE, SUSPENDED
}

// AutoPilotRequest payload for toggling AI
type AutoPilotRequest struct {
	Active bool `json:"active"`
}
