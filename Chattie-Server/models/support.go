package models

import "time"

type SupportTicket struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	UserName       string    `json:"user_name,omitempty"`
	Subject        string    `json:"subject"`
	Status         string    `json:"status"`
	Priority       string    `json:"priority"`
	Category       string    `json:"category"`
	AISummary      string    `json:"ai_summary,omitempty"`
	HumanRequested bool      `json:"human_requested"`
	LastMessage    string    `json:"last_message,omitempty"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type SupportMessage struct {
	ID         string    `json:"id"`
	TicketID   string    `json:"ticket_id"`
	SenderID   string    `json:"sender_id,omitempty"`
	SenderType string    `json:"sender_type"`
	Content    string    `json:"content"`
	CreatedAt  time.Time `json:"created_at"`
}
