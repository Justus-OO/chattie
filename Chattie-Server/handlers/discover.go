package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"chattie-backend/middlewares"
	"chattie-backend/models" // ADDED: needed for the empty array fallback
	"chattie-backend/repository"
)

type DiscoverHandler struct {
	Repo *repository.Repository
}

func NewDiscoverHandler(repo *repository.Repository) *DiscoverHandler {
	return &DiscoverHandler{Repo: repo}
}

func (h *DiscoverHandler) GetSwipeDeck(w http.ResponseWriter, r *http.Request) {
	// Extract user ID from JWT
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Pagination parameters
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 50 {
		limit = 20 // Default deck batch size
	}

	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	// Fetch curated profiles
	profiles, err := h.Repo.GetSwipeDeck(r.Context(), userID, limit, offset)
	if err != nil {
		http.Error(w, "Failed to generate discover deck", http.StatusInternalServerError)
		return
	}

	// ADDED: Prevent React from crashing if the deck is empty.
	// This ensures we send `[]` instead of `null` in the JSON response.
	if profiles == nil {
		profiles = []models.DiscoverProfile{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profiles)
}
