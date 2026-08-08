package handlers

import (
	"encoding/json"
	"net/http"

	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
)

type AdminRoomHandler struct {
	Repo *repository.Repository
}

func NewAdminRoomHandler(repo *repository.Repository) *AdminRoomHandler {
	return &AdminRoomHandler{Repo: repo}
}

func (h *AdminRoomHandler) GetRooms(w http.ResponseWriter, r *http.Request) {
	rooms, err := h.Repo.GetAdminRooms(r.Context())
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to load active spaces")
		return
	}
	sendAdminJSON(w, http.StatusOK, rooms)
}

func (h *AdminRoomHandler) TerminateRoom(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "id")
	if err := h.Repo.TerminateRoom(r.Context(), roomID); err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to terminate space")
		return
	}
	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Space terminated successfully"})
}

func (h *AdminRoomHandler) GetParticipants(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "id")
	participants, err := h.Repo.GetRoomParticipants(r.Context(), roomID)
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to load participants")
		return
	}
	sendAdminJSON(w, http.StatusOK, participants)
}

func (h *AdminRoomHandler) GetKnocks(w http.ResponseWriter, r *http.Request) {
	knocks, err := h.Repo.GetAdminKnocks(r.Context())
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to load access queue")
		return
	}
	sendAdminJSON(w, http.StatusOK, knocks)
}

func (h *AdminRoomHandler) ResolveKnock(w http.ResponseWriter, r *http.Request) {
	knockID := chi.URLParam(r, "knockId")
	var payload struct {
		Action string `json:"action"` // APPROVE, REJECT
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid payload")
		return
	}

	status := "APPROVED"
	if payload.Action == "REJECT" {
		status = "REJECTED"
	}

	if err := h.Repo.ResolveKnock(r.Context(), knockID, status); err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to resolve knock")
		return
	}
	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Access request updated"})
}

func (h *AdminRoomHandler) KickParticipant(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "id")
	userID := chi.URLParam(r, "userId")

	if err := h.Repo.KickUserFromRoom(r.Context(), roomID, userID); err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to kick user")
		return
	}
	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "User kicked successfully"})
}
