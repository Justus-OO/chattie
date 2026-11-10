package models

import "time"

type ADLedgerEntry struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	AmountCents     int64     `json:"amount_cents"`
	TransactionType string    `json:"transaction_type"`
	ReferenceID     string    `json:"reference_id,omitempty"`
	Description     string    `json:"description"`
	CreatedAt       time.Time `json:"created_at"`
}

type ADWallet struct {
	UserID                string    `json:"user_id"`
	AvailableBalanceCents int64     `json:"available_balance_cents"`
	PendingBalanceCents   int64     `json:"pending_balance_cents"`
	UpdatedAt             time.Time `json:"updated_at"`
}

type ADSubscription struct {
	ID                 string    `json:"id"`
	SubscriberID       string    `json:"subscriber_id"`
	CreatorID          string    `json:"creator_id"`
	Status             string    `json:"status"`
	CurrentPeriodStart time.Time `json:"current_period_start"`
	CurrentPeriodEnd   time.Time `json:"current_period_end"`
}
