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
	"chattie-backend/services"
)

type GridHandler struct {
	Repo          *repository.Repository
	UploadService *services.UploadService
}

func NewGridHandler(repo *repository.Repository, uploadService *services.UploadService) *GridHandler {
	return &GridHandler{Repo: repo, UploadService: uploadService}
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

	// 2. Parse and bound pagination and age filters.
	parseQueryInt := func(key string, fallback int) (int, error) {
		raw := strings.TrimSpace(query.Get(key))
		if raw == "" {
			return fallback, nil
		}
		value, err := strconv.Atoi(raw)
		if err != nil {
			return 0, err
		}
		return value, nil
	}
	limit, err := parseQueryInt("limit", 24)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidLimit", "Invalid limit"), http.StatusBadRequest)
		return
	}
	if limit <= 0 {
		limit = 24
	}
	if limit > 50 {
		limit = 50
	}

	offset, err := parseQueryInt("offset", 0)
	if err != nil || offset < 0 || offset > 10000 {
		http.Error(w, localized(r.Context(), "ErrOffsetMustBeBetween0And100002", "Offset must be between 0 and 10000"), http.StatusBadRequest)
		return
	}

	minAge, err := parseQueryInt("min_age", 0)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidMinimumAge", "Invalid minimum age"), http.StatusBadRequest)
		return
	}
	maxAge, err := parseQueryInt("max_age", 0)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidMaximumAge", "Invalid maximum age"), http.StatusBadRequest)
		return
	}
	if (minAge != 0 && (minAge < 18 || minAge > 99)) ||
		(maxAge != 0 && (maxAge < 18 || maxAge > 99)) ||
		(minAge != 0 && maxAge != 0 && minAge > maxAge) {
		http.Error(w, localized(r.Context(), "ErrAgeRangeMustBeBetween18And99WithMinimumNoGreaterThanMax", "Age range must be between 18 and 99 with minimum no greater than maximum"), http.StatusBadRequest)
		return
	}

	status := strings.TrimSpace(query.Get("status"))
	if status != "" && !strings.EqualFold(status, "all") && !strings.EqualFold(status, "online") {
		http.Error(w, localized(r.Context(), "ErrStatusMustBeAllOrOnline", "Status must be All or Online"), http.StatusBadRequest)
		return
	}
	intent := strings.TrimSpace(query.Get("intent"))
	if intent != "" && !strings.EqualFold(intent, "all") &&
		!strings.EqualFold(intent, "casual") &&
		!strings.EqualFold(intent, "dating") &&
		!strings.EqualFold(intent, "friends") {
		http.Error(w, localized(r.Context(), "ErrIntentMustBeAllCasualDatingOrFriends", "Intent must be All, Casual, Dating, or Friends"), http.StatusBadRequest)
		return
	}
	searchQuery := strings.TrimSpace(query.Get("q"))
	if len(searchQuery) > 100 {
		http.Error(w, localized(r.Context(), "ErrSearchQueryCannotExceed100Characters", "Search query cannot exceed 100 characters"), http.StatusBadRequest)
		return
	}

	// 3. Construct safe, trimmed filters
	filters := models.GridFilters{
		Intent:      intent,
		Status:      strings.TrimSpace(query.Get("status")),
		MinAge:      minAge,
		MaxAge:      maxAge,
		SearchQuery: searchQuery,
		SortBy:      strings.TrimSpace(query.Get("sort")), // "match", "distance", "newest"
		Limit:       limit,
		Offset:      offset,
	}

	// 4. Premium feature gate for advanced filters.
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
	for i := range profiles {
		for j := range profiles[i].Images {
			profiles[i].Images[j], err = presignMediaURL(r.Context(), h.UploadService, profiles[i].Images[j])
			if err != nil {
				log.Printf("[GRID MEDIA] Could not sign profile image for user %s: %v", profiles[i].ID, err)
				http.Error(w, localized(r.Context(), "ErrCouldNotLoadProfileImages", "Could not load profile images"), http.StatusBadGateway)
				return
			}
		}
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(profiles)
}
