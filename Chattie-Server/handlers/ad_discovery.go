package handlers

import (
	"chattie-backend/middlewares"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type ADDiscoveryHandler struct {
	Repo *repository.ADDiscoveryRepository
}

func NewADDiscoveryHandler(repo *repository.ADDiscoveryRepository) *ADDiscoveryHandler {
	return &ADDiscoveryHandler{Repo: repo}
}

// GET /api/afterdark/creators
func (h *ADDiscoveryHandler) GetDirectory(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")

	// Basic pagination mapping (cursor/offset)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit == 0 || limit > 50 {
		limit = 20
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if page, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && page > 1 && offset == 0 {
		offset = (page - 1) * limit
	}

	verifiedOnly, _ := strconv.ParseBool(r.URL.Query().Get("verified_only"))
	onlineOnly, _ := strconv.ParseBool(r.URL.Query().Get("online_only"))
	profiles, total, err := h.Repo.GetDirectory(
		r.Context(),
		query,
		r.URL.Query().Get("location"),
		verifiedOnly,
		onlineOnly,
		r.URL.Query().Get("sort"),
		limit,
		offset,
	)
	if err != nil {
		http.Error(w, "Failed to fetch directory", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"creators": profiles,
		"total":    total,
		"limit":    limit,
	})
}

// GET /api/afterdark/feed
func (h *ADDiscoveryHandler) GetFeed(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	creatorID := r.URL.Query().Get("creator_id")
	searchQuery := r.URL.Query().Get("q")
	mediaType := r.URL.Query().Get("media_type")
	accessType := r.URL.Query().Get("access")

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit == 0 || limit > 50 {
		limit = 20
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if page, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && page > 0 && offset == 0 {
		offset = page * limit
	}

	posts, err := h.Repo.GetPublicFeed(r.Context(), userID, creatorID, searchQuery, mediaType, accessType, limit, offset)
	if err != nil {
		http.Error(w, "Failed to fetch feed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(posts)
}

// GET /api/afterdark/creators/{creatorId}
func (h *ADDiscoveryHandler) GetCreatorProfile(w http.ResponseWriter, r *http.Request) {
	creatorID := chi.URLParam(r, "creatorId")

	profile, err := h.Repo.GetPublicCreatorProfile(r.Context(), creatorID)
	if err != nil {
		http.Error(w, "Failed to fetch creator profile", http.StatusInternalServerError)
		return
	}
	if profile == nil {
		http.Error(w, "Creator not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profile)
}

// GET /api/afterdark/stories
func (h *ADDiscoveryHandler) GetStories(w http.ResponseWriter, r *http.Request) {
	stories, err := h.Repo.GetActiveStories(r.Context())
	if err != nil {
		http.Error(w, "Failed to fetch stories", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stories)
}

// POST /api/afterdark/creators/{creatorId}/follow
func (h *ADDiscoveryHandler) ToggleFollow(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middlewares.UserIDKey).(string)
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	creatorID := chi.URLParam(r, "creatorId")

	isFollowing, err := h.Repo.ToggleFollow(r.Context(), userID, creatorID)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Creator not found", http.StatusNotFound)
			return
		}
		if err.Error() == "cannot follow yourself" {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		http.Error(w, "Failed to toggle follow", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"is_following": isFollowing})
}
func (h *ADDiscoveryHandler) CreateShareLink(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		TargetType string `json:"target_type"`
		TargetID   string `json:"target_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	linkID := uuid.New().String()

	// Call the Repository instead of raw SQL
	if err := h.Repo.CreateShareLink(r.Context(), linkID, userID, req.TargetType, req.TargetID); err != nil {
		http.Error(w, "Failed to create share link", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"share_url": "https://chattie.app/ad/share/" + linkID, // Update with your actual frontend domain
	})
}
