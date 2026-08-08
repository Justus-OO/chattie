package models

// AdminPersonaVault represents the persona overview cards in the directory tab
type AdminPersonaVault struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Archetype    string `json:"archetype"`
	AssignedOp   string `json:"assignedOp"`
	StorageUsed  string `json:"storageUsed"`
	TotalAssets  int    `json:"totalAssets"`
	PrimaryImage string `json:"primaryImage"`
	LastUpdated  string `json:"lastUpdated"`
}

// AdminMediaItem represents an image/video asset inside a persona's vault
type AdminMediaItem struct {
	ID         string `json:"id"`
	URL        string `json:"url"`
	IsPrimary  bool   `json:"isPrimary"`
	UploadedAt string `json:"uploadedAt"`
	Size       string `json:"size"`
	Type       string `json:"type"`
}

// AdminMediaAuditLog represents items in the media audit trail table
type AdminMediaAuditLog struct {
	ID       string `json:"id"`
	Action   string `json:"action"`
	Target   string `json:"target"`
	Admin    string `json:"admin"`
	Filename string `json:"filename"`
	Time     string `json:"time"`
}

// AdminClusterTelemetry represents storage statistics at the top of the page
type AdminClusterTelemetry struct {
	TotalStorage string `json:"totalStorage"`
	TotalAssets  int    `json:"totalAssets"`
	SyncStatus   string `json:"syncStatus"`
}
