package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services" // <-- Imported your new services package
)

type ExtrasHandler struct {
	Repo   *repository.Repository
	Events *services.EventHandler // <-- Injected the notification engine
}

// Updated constructor to accept the EventHandler
func NewExtrasHandler(repo *repository.Repository, events *services.EventHandler) *ExtrasHandler {
	return &ExtrasHandler{
		Repo:   repo,
		Events: events,
	}
}

// =====================================================================
// 1. SECRET ADMIRERS HANDLER (No notifications needed here)
// =====================================================================
func (h *ExtrasHandler) GetSecretAdmirers(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	profiles, isPremium, err := h.Repo.GetSecretAdmirers(r.Context(), userID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedLoadAdmirers", "Failed to load admirers"), http.StatusInternalServerError)
		return
	}

	if profiles == nil {
		profiles = []models.DiscoverProfile{}
	}

	if !isPremium {
		redactSecretAdmirers(profiles)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"is_premium": isPremium,
		"admirers":   profiles,
	})
}

// Keep only the number of admirers visible to users without the entitlement.
func redactSecretAdmirers(profiles []models.DiscoverProfile) {
	for i := range profiles {
		profiles[i] = models.DiscoverProfile{
			DisplayName: "Hidden Identity",
			City:        "Nearby",
			Distance:    9999,
			Tags:        []string{},
			Images:      []string{},
		}
	}
}

// =====================================================================
// 2. UNDO SWIPE HANDLER (No notifications needed here)
// =====================================================================
func (h *ExtrasHandler) UndoAction(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	err := h.Repo.UndoLastAction(r.Context(), userID)
	if err != nil {
		if errors.Is(err, repository.ErrPermissionDenied) {
			http.Error(w, localized(r.Context(), "ErrPremiumUndoRequired", "Upgrade to Premium to Undo actions"), http.StatusForbidden)
			return
		}
		if err == sql.ErrNoRows {
			http.Error(w, localized(r.Context(), "ErrNothingToUndo", "Nothing to undo"), http.StatusBadRequest)
			return
		}
		http.Error(w, localized(r.Context(), "ErrFailedUndoAction", "Failed to undo action"), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgActionUndone", "Action undone successfully")})
}

// =====================================================================
// 3. REPORT USER HANDLER (Added email confirmation)
// =====================================================================
func (h *ExtrasHandler) ReportUser(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	var payload struct {
		ReportedID string `json:"reported_id"`
		Reason     string `json:"reason"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidPayloadShort", "Invalid payload"), http.StatusBadRequest)
		return
	}

	if payload.ReportedID == "" || payload.Reason == "" {
		http.Error(w, localized(r.Context(), "ErrMissingFields", "Missing fields"), http.StatusBadRequest)
		return
	}

	restricted, err := h.Repo.ReportUser(r.Context(), userID, payload.ReportedID, strings.ToUpper(payload.Reason))
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedSubmitReport", "Failed to submit report"), http.StatusInternalServerError)
		return
	}
	if restricted && h.Events != nil && h.Events.NotifService != nil {
		h.Events.NotifService.DisconnectUser(payload.ReportedID)
	}
	if restricted && h.Events != nil {
		detachedCtx := context.WithoutCancel(r.Context())
		go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
			RecipientID:   payload.ReportedID,
			EmailTemplate: "account_banned",
		})
	}

	// --- NOTIFICATION TRIGGER ---
	// Send a trust & safety confirmation email to the user who filed the report

	// FIX: Detach the context for the background goroutine
	detachedCtx := context.WithoutCancel(r.Context())

	go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
		RecipientID:   userID,
		EmailTemplate: "report_received",
		// We leave EmailNotifColumn blank here because security/report emails usually shouldn't be opted-out of.
	})

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgUserReportedBlocked", "User reported and blocked")})
}

// =====================================================================
// 4. VIP UPGRADE HANDLER (Added WS + Email confirmation)
// =====================================================================
func (h *ExtrasHandler) HandleUpgrade(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	var req models.UpgradeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidPayloadShort", "Invalid payload"), http.StatusBadRequest)
		return
	}

	months := req.PlanID
	if months <= 0 {
		months = 1
	}

	if err := h.Repo.UpgradeToPremium(r.Context(), userID, months); err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedProcessUpgrade", "Failed to process upgrade"), http.StatusInternalServerError)
		return
	}

	// --- NOTIFICATION TRIGGER ---
	// 1. Send WS event so the frontend instantly unlocks the VIP features without a page refresh
	// 2. Send a receipt/welcome email

	// FIX: Detach the context for the background goroutine
	detachedCtx := context.WithoutCancel(r.Context())

	go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
		RecipientID:   userID,
		WSEventType:   "VIP_UPGRADE_SUCCESS",
		WSPayload:     map[string]interface{}{"months": months, "message": "Welcome to Premium!"},
		EmailTemplate: "premium_welcome",
	})

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgVipActivated", "VIP status activated successfully")})
}

// HandleAgreeGuidelines =====================================================================
// 5. AGREE TO GUIDELINES HANDLER (No notifications needed here)
// =====================================================================
func (h *ExtrasHandler) HandleAgreeGuidelines(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	if err := h.Repo.AgreeToGuidelines(r.Context(), userID); err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedUpdateSettings", "Failed to update settings"), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgGuidelinesAcknowledged", "Guidelines acknowledged")})
}
