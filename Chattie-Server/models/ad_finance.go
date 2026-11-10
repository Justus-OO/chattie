package models

import "time"

type ADDepositIntent struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	AmountCents int64     `json:"amount_cents"`
	Provider    string    `json:"provider"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type ADWithdrawal struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	AmountCents    int64     `json:"amount_cents"`
	PayoutMethodID string    `json:"payout_method_id"`
	Status         string    `json:"status"`
	FailureReason  string    `json:"failure_reason,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}
