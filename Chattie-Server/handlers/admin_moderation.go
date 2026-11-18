package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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
	var req models.ResolveIncidentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBody", "Invalid request body"), http.StatusBadRequest)
		return
	}
	if req.IncidentID == "" {
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBody", "Incident is required"), http.StatusBadRequest)
		return
	}
	switch req.ActionType {
	case "DISMISS", "FORMAL WARNING", "SHADOWBAN", "DEVICE/IP BAN":
	default:
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBody", "Unsupported moderation action"), http.StatusBadRequest)
		return
	}
	if req.ActionType != "DISMISS" && req.TargetID == "" {
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBody", "Target is required for punitive actions"), http.StatusBadRequest)
		return
	}

	adminID, _ := r.Context().Value(middlewares.UserIDKey).(string)

	if err := h.Repo.ResolveIncident(r.Context(), adminID, req); err != nil {
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, repository.ErrModerationTargetMismatch) {
			http.Error(w, localized(r.Context(), "ErrModerationIncidentChanged", "Incident is no longer pending or its target does not match"), http.StatusConflict)
			return
		}
		http.Error(w, localizedMessage(r.Context(), "ErrFailedResolveIncident", "Failed to resolve incident: %s", map[string]interface{}{"Error": err.Error()}), http.StatusInternalServerError)
		return
	}

	if req.TargetID != "" && req.ActionType != "DISMISS" && h.Events != nil {
		if req.ActionType == "DEVICE/IP BAN" && h.Events.NotifService != nil {
			h.Events.NotifService.DisconnectUser(req.TargetID)
		}
		eventType := "MODERATION_ACTION"
		if req.ActionType == "DEVICE/IP BAN" {
			eventType = "USER_BANNED"
		} else if req.ActionType == "SHADOWBAN" {
			eventType = "USER_SUSPENDED"
		}
		detachedCtx := context.WithoutCancel(r.Context())
		go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
			RecipientID:   req.TargetID,
			WSEventType:   eventType,
			WSPayload:     map[string]interface{}{"reason": req.Note, "action": req.ActionType},
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

	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	if err := h.Repo.ToggleFirewallRule(r.Context(), adminID, req.RuleID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "Firewall rule not found", http.StatusNotFound)
			return
		}
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

func (h *AdminHandler) GetMyAccountReview(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	review, err := h.Repo.GetAccountReview(r.Context(), userID)
	if errors.Is(err, sql.ErrNoRows) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"review": nil})
		return
	}
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedFetchReview", "Failed to fetch account review"), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"review": review})
}

func (h *AdminHandler) CreateMyAccountReview(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	var req struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBody", "Invalid request body"), http.StatusBadRequest)
		return
	}
	review, err := h.Repo.CreateAccountReview(r.Context(), userID, req.Reason)
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrAccountNotRestricted):
			http.Error(w, localized(r.Context(), "ErrAccountNotRestricted", "Account is not restricted"), http.StatusConflict)
		case errors.Is(err, repository.ErrReviewAlreadyPending):
			http.Error(w, localized(r.Context(), "ErrReviewAlreadyPending", "An account review is already pending"), http.StatusConflict)
		case errors.Is(err, repository.ErrInvalidReviewReason):
			http.Error(w, localized(r.Context(), "ErrInvalidReviewReason", "Review reason must contain 20 to 2000 characters"), http.StatusBadRequest)
		default:
			http.Error(w, localized(r.Context(), "ErrFailedCreateReview", "Failed to submit account review"), http.StatusInternalServerError)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"review": review})
}

func (h *AdminHandler) GetAccountReviewQueue(w http.ResponseWriter, r *http.Request) {
	reviews, err := h.Repo.GetPendingAccountReviews(r.Context())
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedFetchReviewQueue", "Failed to fetch account review queue"), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(reviews)
}

func (h *AdminHandler) ResolveAccountReview(w http.ResponseWriter, r *http.Request) {
	var req models.ResolveAccountReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBody", "Invalid request body"), http.StatusBadRequest)
		return
	}
	if req.Decision != "reinstate" && req.Decision != "uphold" {
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBody", "Decision must be reinstate or uphold"), http.StatusBadRequest)
		return
	}
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	userID, err := h.Repo.ResolveAccountReview(r.Context(), adminID, chi.URLParam(r, "id"), req.Decision, req.Note)
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, localized(r.Context(), "ErrAccountReviewNotFound", "Account review not found or already resolved"), http.StatusNotFound)
		return
	}
	if errors.Is(err, repository.ErrAccountNotRestricted) {
		http.Error(w, localized(r.Context(), "ErrAccountNotRestricted", "Account is no longer restricted"), http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedResolveReview", "Failed to resolve account review"), http.StatusInternalServerError)
		return
	}
	if req.Decision == "reinstate" && h.Events != nil {
		ctx := context.WithoutCancel(r.Context())
		go h.Events.ProcessEvent(ctx, services.AppEvent{
			RecipientID: userID,
			WSEventType: "ACCOUNT_REINSTATED",
			WSPayload:   map[string]string{"message": "Your account appeal was approved."},
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "resolved", "decision": req.Decision})
}
