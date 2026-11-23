package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"chattie-backend/middlewares"
	"chattie-backend/models" // ADDED: needed for the empty array fallback
	"chattie-backend/repository"
	"chattie-backend/services"
)

type DiscoverHandler struct {
	Repo          *repository.Repository
	UploadService *services.UploadService
}

func NewDiscoverHandler(repo *repository.Repository, uploadService *services.UploadService) *DiscoverHandler {
	return &DiscoverHandler{Repo: repo, UploadService: uploadService}
}

func (h *DiscoverHandler) GetSwipeDeck(w http.ResponseWriter, r *http.Request) {
	// Extract user ID from JWT
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	// Pagination parameters
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 50 {
		limit = 20 // Default deck batch size
	}

	offset, err := strconv.Atoi(r.URL.Query().Get("offset"))
	if r.URL.Query().Get("offset") != "" && (err != nil || offset < 0 || offset > 10000) {
		http.Error(w, localized(r.Context(), "ErrOffsetMustBeBetween0And10000", "Offset must be between 0 and 10000"), http.StatusBadRequest)
		return
	}
	if err != nil {
		offset = 0
	}

	// Fetch curated profiles
	profiles, err := h.Repo.GetSwipeDeck(r.Context(), userID, limit, offset)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedGenerateDiscoverDeck", "Failed to generate discover deck"), http.StatusInternalServerError)
		return
	}

	// ADDED: Prevent React from crashing if the deck is empty.
	// This ensures we send `[]` instead of `null` in the JSON response.
	if profiles == nil {
		profiles = []models.DiscoverProfile{}
	}
	for i := range profiles {
		for j := range profiles[i].Images {
			profiles[i].Images[j], err = presignMediaURL(r.Context(), h.UploadService, profiles[i].Images[j])
			if err != nil {
				log.Printf("[DISCOVERY MEDIA] Could not sign profile image for user %s: %v", profiles[i].ID, err)
				http.Error(w, localized(r.Context(), "ErrCouldNotLoadProfileImages", "Could not load profile images"), http.StatusBadGateway)
				return
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profiles)
}

func (h *DiscoverHandler) GetSwipeDeckDiagnostics(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	diagnostics, err := h.Repo.GetSwipeDeckDiagnostics(r.Context(), userID)
	if err != nil {
		log.Printf("[DISCOVERY] Failed to load swipe-deck diagnostics for user %s: %v", userID, err)
		http.Error(w, localized(r.Context(), "ErrFailedGenerateDiscoverDeck", "Failed to load discovery diagnostics"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, no-store")
	if err := json.NewEncoder(w).Encode(diagnostics); err != nil {
		log.Printf("[DISCOVERY] Failed to encode swipe-deck diagnostics for user %s: %v", userID, err)
	}
}
