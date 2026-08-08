package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

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
	// Extract logged-in user
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	query := r.URL.Query()

	// Parse pagination safely
	limit, _ := strconv.Atoi(query.Get("limit"))
	if limit <= 0 || limit > 50 {
		limit = 24 // Grid pages look better with multiples of 4 or 6
	}

	offset, _ := strconv.Atoi(query.Get("offset"))
	if offset < 0 {
		offset = 0 // ADDED: Prevent PostgreSQL syntax errors on negative offset
	}

	// Parse Age safely
	minAge, _ := strconv.Atoi(query.Get("min_age"))
	maxAge, _ := strconv.Atoi(query.Get("max_age"))

	// Construct Filters mapping directly to the frontend state
	filters := models.GridFilters{
		Intent:      query.Get("intent"),
		Status:      query.Get("status"),
		MinAge:      minAge,
		MaxAge:      maxAge,
		SearchQuery: query.Get("q"),
		SortBy:      query.Get("sort"), // "match", "distance", "newest"
		Limit:       limit,
		Offset:      offset,
	}

	// Note: In a production environment, this is where you verify if the user's
	// subscription tier actually allows them to use advanced filters like Status or Intent.
	// if filters.Status != "All" && !userSubscription.CanUseAdvancedFilters {
	//     http.Error(w, "Upgrade to Premium to filter by Online Status", http.StatusForbidden)
	//     return
	// }

	profiles, err := h.Repo.GetGridProfiles(r.Context(), userID, filters)
	if err != nil {
		http.Error(w, "Failed to load grid profiles", http.StatusInternalServerError)
		return
	}

	// Ensure we return an empty array instead of null if no records are found
	if profiles == nil {
		profiles = []models.DiscoverProfile{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profiles)
}
