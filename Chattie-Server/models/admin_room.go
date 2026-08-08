package models

// AdminRoomDetail represents a chat/voice space for the admin directory
type AdminRoomDetail struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Type         string   `json:"type"` // 'TEXT' or 'VOICE'
	IsPrivate    bool     `json:"isPrivate"`
	Host         string   `json:"host"`
	Participants int      `json:"participants"`
	Limit        int      `json:"limit"`
	Uptime       string   `json:"uptime"`
	Status       string   `json:"status"` // 'ACTIVE', 'WARNING', 'SUSPENDED'
	Tags         []string `json:"tags"`
	WarningLevel int      `json:"warningLevel"`
}

// AdminRoomParticipant represents a user inside a specific room
type AdminRoomParticipant struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Role    string `json:"role"`
	Joined  string `json:"joined"`
	IsMuted bool   `json:"isMuted"`
}

// AdminRoomKnock represents a pending private room request
type AdminRoomKnock struct {
	ID         string `json:"id"`
	User       string `json:"user"`
	TargetRoom string `json:"targetRoom"`
	Time       string `json:"time"`
	RiskScore  int    `json:"riskScore"`
	Tier       string `json:"tier"`
}
