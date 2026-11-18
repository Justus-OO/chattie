package models

import "time"

type AdminModerationTerm struct {
	ID        string    `json:"id"`
	Word      string    `json:"word"`
	Category  string    `json:"category"`
	CreatedAt time.Time `json:"createdAt"`
}
