package handlers

import (
	"chattie-backend/middlewares"
	"chattie-backend/models"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type ADDiscoveryHandler struct {
	Repo          *repository.ADDiscoveryRepository
	UploadService *services.UploadService
}

func NewADDiscoveryHandler(repo *repository.ADDiscoveryRepository, uploadService *services.UploadService) *ADDiscoveryHandler {
	return &ADDiscoveryHandler{Repo: repo, UploadService: uploadService}
}

func (h *ADDiscoveryHandler) signProfileMedia(ctx context.Context, profile *models.PerformerProfile) error {
	return presignPerformerProfileMedia(ctx, h.UploadService, profile)
}

// GET /api/afterdark/creators
func (h *ADDiscoveryHandler) GetDirectory(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
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
	minPriceCents, err := parseDirectoryPrice(r.URL.Query().Get("min_price_cents"))
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidMinimumSubscriptionPrice", "Invalid minimum subscription price"), http.StatusBadRequest)
		return
	}
	maxPriceCents, err := parseDirectoryPrice(r.URL.Query().Get("max_price_cents"))
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidMaximumSubscriptionPrice", "Invalid maximum subscription price"), http.StatusBadRequest)
		return
	}
	profiles, total, err := h.Repo.GetDirectory(
		r.Context(),
		userID,
		query,
		r.URL.Query().Get("location"),
		verifiedOnly,
		onlineOnly,
		minPriceCents,
		maxPriceCents,
		r.URL.Query().Get("sort"),
		limit,
		offset,
	)
	if err != nil {
		if errors.Is(err, repository.ErrInvalidDirectoryPriceRange) {
			http.Error(w, localized(r.Context(), "ErrMinimumPriceCannotExceedMaximumPrice", "Minimum price cannot exceed maximum price"), http.StatusBadRequest)
			return
		}
		log.Printf("[AFTER DARK DISCOVERY] Directory query failed: %v", err)
		http.Error(w, localized(r.Context(), "ErrFailedToFetchDirectory", "Failed to fetch directory"), http.StatusInternalServerError)
		return
	}
	for i := range profiles {
		if err := h.signProfileMedia(r.Context(), &profiles[i]); err != nil {
			log.Printf("[AFTER DARK MEDIA] Could not sign directory images: %v", err)
			http.Error(w, localized(r.Context(), "ErrCouldNotLoadCreatorImages", "Could not load creator images"), http.StatusBadGateway)
			return
		}
	}

	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"creators": profiles,
		"total":    total,
		"limit":    limit,
	})
}

func parseDirectoryPrice(value string) (*int64, error) {
	if value == "" {
		return nil, nil
	}
	price, err := strconv.ParseInt(value, 10, 64)
	if err != nil || price < 0 {
		return nil, fmt.Errorf("invalid price")
	}
	return &price, nil
}

func parseFeedCreatorID(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	creatorID, err := uuid.Parse(value)
	if err != nil {
		return "", err
	}
	return creatorID.String(), nil
}

func parseFeedPagination(limitValue, pageValue, offsetValue string) (int, int, error) {
	const maxFeedLimit = 50
	const maxFeedOffset = 1000000

	limit := 20
	if limitValue != "" {
		parsedLimit, err := strconv.Atoi(limitValue)
		if err != nil || parsedLimit < 1 || parsedLimit > maxFeedLimit {
			return 0, 0, fmt.Errorf("invalid feed limit")
		}
		limit = parsedLimit
	}

	page := 0
	if pageValue != "" {
		parsedPage, err := strconv.Atoi(pageValue)
		if err != nil || parsedPage < 0 || parsedPage > maxFeedOffset/limit {
			return 0, 0, fmt.Errorf("invalid feed page")
		}
		page = parsedPage
	}
	offset := page * limit

	if offsetValue != "" {
		parsedOffset, err := strconv.Atoi(offsetValue)
		if err != nil || parsedOffset < 0 || parsedOffset > maxFeedOffset {
			return 0, 0, fmt.Errorf("invalid feed offset")
		}
		offset = parsedOffset
	}

	return limit, offset, nil
}

// GET /api/afterdark/feed
func (h *ADDiscoveryHandler) GetFeed(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	creatorID := r.URL.Query().Get("creator_id")
	if creatorID != "" {
		parsedCreatorID, err := parseFeedCreatorID(creatorID)
		if err != nil {
			http.Error(w, localized(r.Context(), "ErrInvalidCreatorID", "Invalid creator ID"), http.StatusBadRequest)
			return
		}
		creatorID = parsedCreatorID
	}
	searchQuery := r.URL.Query().Get("q")
	mediaType := r.URL.Query().Get("media_type")
	accessType := r.URL.Query().Get("access")
	if len(searchQuery) > 200 {
		http.Error(w, localized(r.Context(), "ErrSearchQueryIsTooLong", "Search query is too long"), http.StatusBadRequest)
		return
	}

	if accessType != "" && accessType != "all" && accessType != "free" &&
		accessType != "subscriber" && accessType != "ppv" {
		http.Error(w, localized(r.Context(), "ErrInvalidAccessFilter", "Invalid access filter"), http.StatusBadRequest)
		return
	}
	if mediaType != "" && mediaType != "all" && mediaType != "image" && mediaType != "video" {
		http.Error(w, localized(r.Context(), "ErrInvalidMediaTypeFilter", "Invalid media type filter"), http.StatusBadRequest)
		return
	}
	feedScope := r.URL.Query().Get("feed_scope")
	if feedScope == "" {
		feedScope = "discover"
	}
	if feedScope != "discover" && feedScope != "following" {
		http.Error(w, localized(r.Context(), "ErrInvalidFeedScope", "Invalid feed scope"), http.StatusBadRequest)
		return
	}

	limit, offset, err := parseFeedPagination(
		r.URL.Query().Get("limit"),
		r.URL.Query().Get("page"),
		r.URL.Query().Get("offset"),
	)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidFeedPagination", "Invalid feed pagination"), http.StatusBadRequest)
		return
	}

	posts, err := h.Repo.GetPublicFeed(
		r.Context(),
		userID,
		middlewares.CountryCodeFromContext(r.Context()),
		creatorID,
		searchQuery,
		mediaType,
		accessType,
		feedScope == "following",
		limit+1,
		offset,
	)
	if err != nil {
		log.Printf("[AFTER DARK DISCOVERY] Feed query failed for user %s (creator %q): %v", userID, creatorID, err)
		http.Error(w, localized(r.Context(), "ErrFailedToFetchFeed", "Failed to fetch feed"), http.StatusInternalServerError)
		return
	}
	hasMore := len(posts) > limit
	if hasMore {
		posts = posts[:limit]
	}
	for i := range posts {
		if err := h.signProfileMedia(r.Context(), &posts[i].Creator); err != nil {
			log.Printf("[AFTER DARK MEDIA] Could not sign feed creator images: %v", err)
			http.Error(w, localized(r.Context(), "ErrCouldNotLoadCreatorImages2", "Could not load creator images"), http.StatusBadGateway)
			return
		}
	}

	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"posts":    posts,
		"has_more": hasMore,
		"page":     offset / limit,
		"limit":    limit,
	})
}

// GET /api/afterdark/creators/{creatorId}
func (h *ADDiscoveryHandler) GetCreatorProfile(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	creatorID := chi.URLParam(r, "creatorId")

	profile, err := h.Repo.GetPublicCreatorProfile(r.Context(), userID, creatorID)
	if err != nil {
		log.Printf("[AFTER DARK DISCOVERY] Creator profile query failed for %q: %v", creatorID, err)
		http.Error(w, localized(r.Context(), "ErrFailedToFetchCreatorProfile", "Failed to fetch creator profile"), http.StatusInternalServerError)
		return
	}
	if profile == nil {
		http.Error(w, localized(r.Context(), "ErrCreatorNotFound2", "Creator not found"), http.StatusNotFound)
		return
	}
	if err := h.signProfileMedia(r.Context(), profile); err != nil {
		log.Printf("[AFTER DARK MEDIA] Could not sign creator profile images: %v", err)
		http.Error(w, localized(r.Context(), "ErrCouldNotLoadCreatorImages3", "Could not load creator images"), http.StatusBadGateway)
		return
	}

	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profile)
}

// GET /api/afterdark/stories
func (h *ADDiscoveryHandler) GetStories(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	stories, err := h.Repo.GetActiveStories(r.Context(), userID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToFetchStories", "Failed to fetch stories"), http.StatusInternalServerError)
		return
	}
	for i := range stories {
		if stories[i].AvatarURL, err = presignMediaURL(r.Context(), h.UploadService, stories[i].AvatarURL); err != nil {
			log.Printf("[AFTER DARK MEDIA] Could not sign story avatar: %v", err)
			http.Error(w, localized(r.Context(), "ErrCouldNotLoadCreatorImages4", "Could not load creator images"), http.StatusBadGateway)
			return
		}
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stories)
}

// POST /api/afterdark/creators/{creatorId}/follow
func (h *ADDiscoveryHandler) ToggleFollow(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middlewares.UserIDKey).(string)
	if userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	creatorID := chi.URLParam(r, "creatorId")

	isFollowing, err := h.Repo.ToggleFollow(r.Context(), userID, creatorID)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, localized(r.Context(), "ErrCreatorNotFound3", "Creator not found"), http.StatusNotFound)
			return
		}
		if err.Error() == "cannot follow yourself" {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		http.Error(w, localized(r.Context(), "ErrFailedToToggleFollow", "Failed to toggle follow"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"is_following": isFollowing})
}
func (h *ADDiscoveryHandler) CreateShareLink(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	var req struct {
		TargetType string `json:"target_type"`
		TargetID   string `json:"target_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidRequest4", "Invalid request"), http.StatusBadRequest)
		return
	}

	linkID := uuid.New().String()

	// Call the Repository instead of raw SQL
	if err := h.Repo.CreateShareLink(r.Context(), linkID, userID, req.TargetType, req.TargetID); err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToCreateShareLink", "Failed to create share link"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"share_url": "https://chattie.app/ad/share/" + linkID, // Update with your actual frontend domain
	})
}
