package models

type BillingPlan struct {
	ID        int     `json:"id"` // We map this to duration_months for frontend logic
	Duration  string  `json:"duration"`
	Price     float64 `json:"price"`
	Monthly   float64 `json:"monthly"`
	Save      int     `json:"save"`
	IsPopular bool    `json:"isPopular"`
}
