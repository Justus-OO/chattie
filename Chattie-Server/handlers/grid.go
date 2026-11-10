package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
)

type GridHandler struct {
	Repo *repository.Repository
}

func NewGridHandler(repo *repository.Repository) *GridHandler {
	return &GridHandler{Repo: repo}
}

func (h *GridHandler) GetGridBrowse(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// 1. Extract logged-in user securely
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		log.Println("CRITICAL 401: user_id missing from request context in GetGridBrowse")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrUnauthorizedMissingUserContext", "Unauthorized: Missing user context")})
		return
	}

	query := r.URL.Query()

	// 2. Parse and sanitize pagination
	limit, _ := strconv.Atoi(query.Get("limit"))
	if limit <= 0 || limit > 50 {
		limit = 24 // Grid pages look best with multiples of 4, 6, or 8
	}

	offset, _ := strconv.Atoi(query.Get("offset"))
	if offset < 0 {
		offset = 0 // Prevent PostgreSQL syntax errors
	}

	// 3. Parse Age safely
	minAge, _ := strconv.Atoi(query.Get("min_age"))
	maxAge, _ := strconv.Atoi(query.Get("max_age"))

	// 4. Construct safe, trimmed filters
	filters := models.GridFilters{
		Intent:      strings.TrimSpace(query.Get("intent")),
		Status:      strings.TrimSpace(query.Get("status")),
		MinAge:      minAge,
		MaxAge:      maxAge,
		SearchQuery: strings.TrimSpace(query.Get("q")),
		SortBy:      strings.TrimSpace(query.Get("sort")), // "match", "distance", "newest"
		Limit:       limit,
		Offset:      offset,
	}

	// 5. REAL-WORLD SECURITY LOGIC: Premium Feature Gate
	// If the user tries to use advanced filters, verify they have the rights to do so.
	if (filters.Status != "" && !strings.EqualFold(filters.Status, "All")) ||
		(filters.Intent != "" && !strings.EqualFold(filters.Intent, "All")) {

		canUseFilters, err := h.Repo.CanUseAdvancedFilters(r.Context(), userID)
		if err != nil {
			log.Printf("[GRID] 500 Error checking subscription for user %s: %v", userID, err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedVerifySubscription", "Failed to verify subscription tier")})
			return
		}

		if !canUseFilters {
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{
				"error":   "UPGRADE_REQUIRED",
				"message": localized(r.Context(), "ErrAdvancedFilteringPremium", "Advanced filtering requires Chattie Premium."),
			})
			return
		}
	}

	// 6. Execute the advanced discovery query
	profiles, err := h.Repo.GetGridProfiles(r.Context(), userID, filters)
	if err != nil {
		log.Printf("[GRID] 500 Error fetching profiles for user %s: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedLoadGridProfiles", "Failed to load grid profiles")})
		return
	}

	// 7. Ensure a clean JSON array is returned, never null
	if profiles == nil {
		profiles = []models.DiscoverProfile{}
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(profiles)
}
