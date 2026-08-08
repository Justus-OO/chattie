package handlers

import (
	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"encoding/json"
	"net/http"
)

type AdminHandler struct {
	Repo *repository.AdminRepository
}

func NewAdminHandler(repo *repository.AdminRepository) *AdminHandler {
	return &AdminHandler{Repo: repo}
}

// GET /api/admin/moderation/queue
func (h *AdminHandler) GetQueue(w http.ResponseWriter, r *http.Request) {
	items, err := h.Repo.GetPendingQueue(r.Context())
	if err != nil {
		http.Error(w, "Failed to fetch queue", http.StatusInternalServerError)
		return
	}

	if items == nil {
		items = []models.ModerationItem{} // Ensure JSON array, not null
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

// POST /api/admin/moderation/action
func (h *AdminHandler) ResolveIncident(w http.ResponseWriter, r *http.Request) {
	var req models.ResolveIncidentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Assuming you have a middleware that extracts the Admin's UUID
	adminID, _ := r.Context().Value(middlewares.UserIDKey).(string)

	if err := h.Repo.ResolveIncident(r.Context(), adminID, req); err != nil {
		http.Error(w, "Failed to resolve incident: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// GET /api/admin/moderation/audit
func (h *AdminHandler) GetAuditLogs(w http.ResponseWriter, r *http.Request) {
	logs, err := h.Repo.GetAuditLogs(r.Context())
	if err != nil {
		http.Error(w, "Failed to fetch audit logs", http.StatusInternalServerError)
		return
	}

	if logs == nil {
		logs = []models.AuditLog{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(logs)
}

// GET /api/admin/moderation/rules
func (h *AdminHandler) GetFirewallRules(w http.ResponseWriter, r *http.Request) {
	rules, err := h.Repo.GetFirewallRules(r.Context())
	if err != nil {
		http.Error(w, "Failed to fetch firewall rules", http.StatusInternalServerError)
		return
	}

	if rules == nil {
		rules = []models.FirewallRule{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rules)
}

// POST /api/admin/moderation/rules/toggle
func (h *AdminHandler) ToggleFirewallRule(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RuleID string `json:"ruleId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.Repo.ToggleFirewallRule(r.Context(), req.RuleID); err != nil {
		http.Error(w, "Failed to toggle rule", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}
