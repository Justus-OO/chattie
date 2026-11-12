package models

type UpgradeRequest struct {
	PlanID       int     `json:"plan_id"` // e.g., 1, 6, 12 (months)
	Price        float64 `json:"price"`
	PaymentToken string  `json:"payment_token,omitempty"` // For future Stripe integration
	PhoneNumber  string  `json:"phone_number,omitempty"`
}

// ReportRequest handles the Guidelines report modal
type ReportRequest struct {
	ReportedID       string `json:"reported_id,omitempty"`       // If reporting from a profile
	ReportedUsername string `json:"reported_username,omitempty"` // If typed manually in the modal
	Reason           string `json:"reason"`
	Description      string `json:"description"`
}
