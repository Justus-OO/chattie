package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/go-chi/chi/v5"
)

type AdminHandler struct {
	Repo   *repository.AdminRepository
	Events *services.EventHandler // For admin notifications
}

func NewAdminHandler(repo *repository.AdminRepository, events *services.EventHandler) *AdminHandler {
	return &AdminHandler{
		Repo:   repo,
		Events: events,
	}
}

// GET /api/admin/moderation/queue
func (h *AdminHandler) GetQueue(w http.ResponseWriter, r *http.Request) {
	items, err := h.Repo.GetPendingQueue(r.Context())
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedFetchQueue", "Failed to fetch queue"), http.StatusInternalServerError)
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
	// Read the raw body once
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedReadBody", "Failed to read body"), http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	// 1. Decode into your strict model for the repository
	var req models.ResolveIncidentRequest
	if err := json.Unmarshal(bodyBytes, &req); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBody", "Invalid request body"), http.StatusBadRequest)
		return
	}

	// 2. Decode into a dynamic map to safely extract notification fields (Bypasses struct compilation errors)
	var dynamicPayload map[string]interface{}
	json.Unmarshal(bodyBytes, &dynamicPayload)

	adminID, _ := r.Context().Value(middlewares.UserIDKey).(string)

	if err := h.Repo.ResolveIncident(r.Context(), adminID, req); err != nil {
		http.Error(w, localizedMessage(r.Context(), "ErrFailedResolveIncident", "Failed to resolve incident: %s", map[string]interface{}{"Error": err.Error()}), http.StatusInternalServerError)
		return
	}

	// Safely extract fields for the notification
	targetID, _ := dynamicPayload["target_id"].(string) // or "target_user_id"
	action, _ := dynamicPayload["action"].(string)      // or "resolution"
	reason, _ := dynamicPayload["reason"].(string)

	// Notify affected user if action was taken
	if targetID != "" && action != "" {
		eventType := "MODERATION_ACTION"
		if action == "BANNED" {
			eventType = "USER_BANNED"
		} else if action == "SUSPENDED" {
			eventType = "USER_SUSPENDED"
		}
		detachedCtx := context.WithoutCancel(r.Context())
		go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
			RecipientID:   targetID,
			WSEventType:   eventType,
			WSPayload:     map[string]interface{}{"reason": reason},
			EmailTemplate: "moderation_action",
		})
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// GET /api/admin/moderation/audit
func (h *AdminHandler) GetAuditLogs(w http.ResponseWriter, r *http.Request) {
	logs, err := h.Repo.GetAuditLogs(r.Context())
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedLoadAuditLogs", "Failed to fetch audit logs"), http.StatusInternalServerError)
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
		http.Error(w, localized(r.Context(), "ErrFailedFetchFirewallRules", "Failed to fetch firewall rules"), http.StatusInternalServerError)
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
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBody", "Invalid request body"), http.StatusBadRequest)
		return
	}

	if err := h.Repo.ToggleFirewallRule(r.Context(), req.RuleID); err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToggleRule", "Failed to toggle rule"), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// GET /api/admin/clients/{id}/telemetry
func (h *AdminHandler) GetClientTelemetry(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")

	logs, err := h.Repo.GetUserTelemetry(r.Context(), targetID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedFetchTelemetry", "Failed to fetch telemetry"), http.StatusInternalServerError)
		return
	}

	if logs == nil {
		logs = []models.ActionLog{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(logs)
}
