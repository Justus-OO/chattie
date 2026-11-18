package handlers

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strings"

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

	user, err := h.Repo.GetUserByID(r.Context(), clientID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			sendAdminError(w, http.StatusNotFound, "Client not found")
			return
		}
		log.Printf("Error checking client before ban update: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to verify client")
		return
	}
	if !strings.EqualFold(user.Role, "client") {
		sendAdminError(w, http.StatusNotFound, "Client not found")
		return
	}
	isBanned := strings.EqualFold(user.Status, "banned")

	if err := h.Repo.ToggleClientBan(r.Context(), clientID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			sendAdminError(w, http.StatusNotFound, "Client not found")
			return
		}
		log.Printf("Error updating client ban status: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to update ban status")
		return
	}

	// Notify client if they're being banned
	if !isBanned {
		if h.Events != nil && h.Events.NotifService != nil {
			h.Events.NotifService.DisconnectUser(clientID)
		}
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

	user, err := h.Repo.GetUserByID(r.Context(), clientID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			sendAdminError(w, http.StatusNotFound, "Client not found")
			return
		}
		log.Printf("Error checking client before tier revocation: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to verify client")
		return
	}
	if !strings.EqualFold(user.Role, "client") {
		sendAdminError(w, http.StatusNotFound, "Client not found")
		return
	}

	if err := h.Repo.RevokeClientTier(r.Context(), clientID); err != nil {
		log.Printf("Error revoking client tier: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to revoke tier")
		return
	}
	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Tier revoked successfully"})
}
