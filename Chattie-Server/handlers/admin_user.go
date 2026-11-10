package handlers

import (
	"context"
	"log"
	"net/http"

	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/go-chi/chi/v5"
)

type AdminClientHandler struct {
	Repo   *repository.Repository
	Events *services.EventHandler // For client notifications
}

func NewAdminClientHandler(repo *repository.Repository, events *services.EventHandler) *AdminClientHandler {
	return &AdminClientHandler{
		Repo:   repo,
		Events: events,
	}
}

// GetClientDirectory GET /api/admin/clients
func (h *AdminClientHandler) GetClientDirectory(w http.ResponseWriter, r *http.Request) {
	clients, err := h.Repo.GetAdminClientDirectory(r.Context())
	if err != nil {
		log.Printf("Error fetching client directory: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to fetch users")
		return
	}
	sendAdminJSON(w, http.StatusOK, clients)
}

// GetClientTelemetry GET /api/admin/clients/telemetry
func (h *AdminClientHandler) GetClientTelemetry(w http.ResponseWriter, r *http.Request) {
	telemetry, err := h.Repo.GetAdminClientTelemetry(r.Context())
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to fetch telemetry")
		return
	}
	sendAdminJSON(w, http.StatusOK, telemetry)
}

// ToggleBan PATCH /api/admin/clients/{id}/ban
func (h *AdminClientHandler) ToggleBan(w http.ResponseWriter, r *http.Request) {
	clientID := chi.URLParam(r, "id")

	// FIX: Pass r.Context() to GetUserByID
	user, err := h.Repo.GetUserByID(r.Context(), clientID)
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, "User not found")
		return
	}
	isBanned := user.Status == "BANNED"

	if err := h.Repo.ToggleClientBan(r.Context(), clientID); err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to update ban status")
		return
	}

	// Notify client if they're being banned
	if !isBanned {
		// FIX: Detach the context so the goroutine survives after the HTTP response is sent
		detachedCtx := context.WithoutCancel(r.Context())

		go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
			RecipientID:   clientID,
			WSEventType:   "USER_BANNED",
			WSPayload:     map[string]interface{}{"reason": "Account violation"},
			EmailTemplate: "account_banned",
		})
	}

	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Ban status updated"})
}

// RevokeTier PATCH /api/admin/clients/{id}/revoke-tier
func (h *AdminClientHandler) RevokeTier(w http.ResponseWriter, r *http.Request) {
	clientID := chi.URLParam(r, "id")

	if err := h.Repo.RevokeClientTier(r.Context(), clientID); err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to revoke tier")
		return
	}
	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Tier revoked successfully"})
}
