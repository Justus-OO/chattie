package models

import "time"

// CreatorStats represents the top-level dashboard metrics
type CreatorStats struct {
	Balance     float64 `json:"balance"`
	TotalEarned float64 `json:"total_earned"`
	IsOnline    bool    `json:"is_online"`
	PendingReqs int     `json:"pending_reqs"`
	Earnings24H float64 `json:"earnings_24h"`
}

// ChatQueueItem represents a single pending/active request in the queue
type ChatQueueItem struct {
	ID            string    `json:"id"`
	ClientID      string    `json:"client_id"`
	ClientName    string    `json:"user"`
	ClientAvatar  string    `json:"avatar"`
	TipAmount     float64   `json:"tip"`
	Status        string    `json:"status"`
	TimeAdded     time.Time `json:"timeAdded"`
	LifetimeSpend float64   `json:"lifetimeSpend"`
	IsFlagged     bool      `json:"flagged"`
}

// Transaction represents an item in the financial ledger
type Transaction struct {
	ID     string  `json:"id"`
	Date   string  `json:"date"` // Format: YYYY-MM-DD
	Time   string  `json:"time"` // Format: HH:MM
	Type   string  `json:"type"`
	User   string  `json:"user"`
	Amount float64 `json:"amount"`
	Status string  `json:"status"`
}

// PayoutRequest handles the incoming request to withdraw funds
type PayoutRequest struct {
	Amount float64 `json:"amount"`
}

// QueueActionRequest handles accepting/rejecting a chat
type QueueActionRequest struct {
	Action string `json:"action"` // 'accept' or 'reject'
}
type ManagedProfile struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Avatar  string `json:"avatar_url"`
	Status  string `json:"status"`
	Pending int    `json:"pending"`
}

type UpdateStatusRequest struct {
	Status string `json:"status"` // 'online' or 'offline'
}
