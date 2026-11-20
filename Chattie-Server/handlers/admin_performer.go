package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"chattie-backend/middlewares"
	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type AdminPerformerHandler struct {
	Repo *repository.ADPerformerRepository
}

func NewAdminPerformerHandler(repo *repository.ADPerformerRepository) *AdminPerformerHandler {
	return &AdminPerformerHandler{Repo: repo}
}

func (h *AdminPerformerHandler) ListPendingApplications(w http.ResponseWriter, r *http.Request) {
	applications, err := h.Repo.ListPendingApplications(r.Context())
	if err != nil {
		log.Printf("[ADMIN CREATOR APPLICATIONS] Failed to list pending applications: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Could not load creator applications")
		return
	}
	sendAdminJSON(w, http.StatusOK, applications)
}

func (h *AdminPerformerHandler) ReviewApplication(w http.ResponseWriter, r *http.Request) {
	applicationID := chi.URLParam(r, "application_id")
	if _, err := uuid.Parse(applicationID); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid creator application")
		return
	}
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		sendAdminError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	var request struct {
		Decision string `json:"decision"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid creator application decision")
		return
	}
	if request.Decision != "approve" && request.Decision != "reject" {
		sendAdminError(w, http.StatusBadRequest, "Decision must be approve or reject")
		return
	}
	if err := h.Repo.ReviewApplication(r.Context(), adminID, applicationID, request.Decision); err != nil {
		switch {
		case errors.Is(err, repository.ErrCreatorApplicationAlreadyApproved):
			sendAdminError(w, http.StatusConflict, "This user already has an approved creator application")
		case errors.Is(err, repository.ErrCreatorApplicationPending):
			sendAdminError(w, http.StatusConflict, "This user already has a pending creator application")
		case errors.Is(err, repository.ErrCreatorApplicationNotEligible):
			sendAdminError(w, http.StatusConflict, "Application does not meet the age, identity, and consent requirements for approval")
		case errors.Is(err, sql.ErrNoRows):
			sendAdminError(w, http.StatusConflict, "Application is no longer pending")
		default:
			log.Printf("[ADMIN CREATOR APPLICATIONS] Failed to review application %s: %v", applicationID, err)
			sendAdminError(w, http.StatusInternalServerError, "Could not review creator application")
		}
		return
	}
	status := "rejected"
	if request.Decision == "approve" {
		status = "approved"
	}
	sendAdminJSON(w, http.StatusOK, map[string]string{"status": status})
}
