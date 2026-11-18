package models

import "time"

type AdminDashboardActivity struct {
	ID          string    `json:"id"`
	CreatedAt   time.Time `json:"createdAt"`
	Type        string    `json:"type"`
	Description string    `json:"description"`
}

type AdminDashboardTelemetry struct {
	GeneratedAt      time.Time                `json:"generatedAt"`
	DatabaseHealthy  bool                     `json:"databaseHealthy"`
	TotalUsers       int64                    `json:"totalUsers"`
	ActiveUsers24h   int64                    `json:"activeUsers24h"`
	TotalCreators    int64                    `json:"totalCreators"`
	OnlineCreators   int64                    `json:"onlineCreators"`
	OpenTextRooms    int64                    `json:"openTextRooms"`
	ActiveVoiceRooms int64                    `json:"activeVoiceRooms"`
	PendingReports   int64                    `json:"pendingReports"`
	PaidCheckouts24h int64                    `json:"paidCheckouts24h"`
	RecentActivity   []AdminDashboardActivity `json:"recentActivity"`
}
