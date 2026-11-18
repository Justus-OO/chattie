package models

type ModerationItem struct {
	ID            string     `json:"id"`
	User          string     `json:"user"`
	UserID        string     `json:"userId"`
	Reporter      string     `json:"reporter"`
	TargetProfile string     `json:"targetProfile"`
	Type          string     `json:"type"`
	Severity      string     `json:"severity"`
	Time          string     `json:"time"`
	Status        string     `json:"status"`
	Content       string     `json:"content"`
	AISummary     string     `json:"aiSummary,omitempty"`
	RiskScore     int        `json:"riskScore"`
	IP            string     `json:"ip"`
	Location      string     `json:"location"`
	History       string     `json:"history"`
	ReportCount   int        `json:"reportCount"`
	Evidence      []Evidence `json:"evidence"`
}

type Evidence struct {
	Sender string `json:"sender"`
	Text   string `json:"text"`
	Time   string `json:"time"`
}

type AuditLog struct {
	ID     string `json:"id"`
	Admin  string `json:"admin"`
	Action string `json:"action"`
	Target string `json:"target"`
	Reason string `json:"reason"`
	Time   string `json:"time"`
	Date   string `json:"date"`
}

type FirewallRule struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
	Desc   string `json:"desc"`
}

type ResolveIncidentRequest struct {
	IncidentID string `json:"incidentId"`
	TargetID   string `json:"targetId"`
	ActionType string `json:"actionType"` // 'FORMAL WARNING', 'SHADOWBAN', 'DEVICE/IP BAN', 'DISMISS'
	Note       string `json:"note"`
}

type AccountReviewRequest struct {
	ID           string `json:"id"`
	UserID       string `json:"userId"`
	Username     string `json:"username"`
	Email        string `json:"email"`
	Reason       string `json:"reason"`
	Status       string `json:"status"`
	SubmittedAt  string `json:"submittedAt"`
	ReviewerNote string `json:"reviewerNote"`
}

type ResolveAccountReviewRequest struct {
	Decision string `json:"decision"`
	Note     string `json:"note"`
}
