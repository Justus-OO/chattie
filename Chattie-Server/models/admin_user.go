package models

// Billing details for a client
type UserBilling struct {
	PaymentMethod string `json:"paymentMethod"`
	Recurring     bool   `json:"recurring"`
	NextBilling   string `json:"nextBilling"`
}

// Behavior and moderation tracking
type UserBehavior struct {
	RiskScore    int `json:"riskScore"`
	Flags        int `json:"flags"`
	MessagesSent int `json:"messagesSent"`
}

// Security and device telemetry
type UserSecurity struct {
	LastIp   string `json:"lastIp"`
	Location string `json:"location"`
	Device   string `json:"device"`
}

// The main user object expected by the React table
type AdminUserDetail struct {
	ID         string       `json:"id"`
	Username   string       `json:"username"`
	Email      string       `json:"email"`
	Status     string       `json:"status"` // ACTIVE, FLAGGED, BANNED
	Tier       string       `json:"tier"`   // VIP, PREMIUM, STANDARD
	TotalSpend float64      `json:"totalSpend"`
	JoinDate   string       `json:"joinDate"`
	LastActive string       `json:"lastActive"`
	Billing    UserBilling  `json:"billing"`
	Behavior   UserBehavior `json:"behavior"`
	Security   UserSecurity `json:"security"`
}

// Global telemetry for the top dashboard bar
type AdminClientTelemetry struct {
	TotalUsers   int `json:"totalUsers"`
	VipCount     int `json:"vipCount"`
	PremiumCount int `json:"premiumCount"`
	DailyActive  int `json:"dailyActive"`
}
