package models

import "time"

type ADComment struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	PostID    string    `json:"post_id"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ADReport struct {
	ID         string    `json:"id"`
	ReporterID string    `json:"reporter_id"`
	TargetType string    `json:"target_type"` // creator, post, message, live_session
	TargetID   string    `json:"target_id"`
	Reason     string    `json:"reason"`
	Details    string    `json:"details"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
}
