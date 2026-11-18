package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type AdminAfterDarkHandler struct {
	Repo          *repository.AdminRepository
	UploadService *services.UploadService
}

func NewAdminAfterDarkHandler(repo *repository.AdminRepository, uploadService *services.UploadService) *AdminAfterDarkHandler {
	return &AdminAfterDarkHandler{Repo: repo, UploadService: uploadService}
}

func (h *AdminAfterDarkHandler) ListPosts(w http.ResponseWriter, r *http.Request) {
	status := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
	if status == "" {
		status = "all"
	}
	switch status {
	case "all", "draft", "processing", "published", "scheduled", "rejected", "deleted":
	default:
		sendAdminError(w, http.StatusBadRequest, "Unsupported After Dark post status")
		return
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			sendAdminError(w, http.StatusBadRequest, "Limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	offset := 0
	if raw := r.URL.Query().Get("offset"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			sendAdminError(w, http.StatusBadRequest, "Offset must be zero or greater")
			return
		}
		offset = parsed
	}
	posts, err := h.Repo.ListAfterDarkPosts(r.Context(), status, limit, offset)
	if err != nil {
		log.Printf("Failed to load After Dark admin posts: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to load After Dark posts")
		return
	}
	sendAdminJSON(w, http.StatusOK, posts)
}

func (h *AdminAfterDarkHandler) GetPostMediaURL(w http.ResponseWriter, r *http.Request) {
	if h.UploadService == nil {
		sendAdminError(w, http.StatusServiceUnavailable, "After Dark media storage is unavailable")
		return
	}
	postID := chi.URLParam(r, "postId")
	if _, err := uuid.Parse(postID); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid post ID")
		return
	}
	asset, err := h.Repo.GetAfterDarkPostAsset(r.Context(), postID)
	if errors.Is(err, sql.ErrNoRows) {
		sendAdminError(w, http.StatusNotFound, "Post media not found")
		return
	}
	if err != nil {
		log.Printf("Failed to load After Dark post media for admin: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Could not load post media")
		return
	}
	const urlLifetime = 3 * time.Minute
	mediaURL, err := h.UploadService.ReadURL(r.Context(), asset.StorageKey, urlLifetime)
	if err != nil {
		log.Printf("Failed to sign After Dark post media for admin: %v", err)
		sendAdminError(w, http.StatusBadGateway, "Could not provide post media")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	sendAdminJSON(w, http.StatusOK, map[string]interface{}{
		"url": mediaURL, "mime_type": asset.MimeType,
		"expires_at": time.Now().Add(urlLifetime).UTC(),
	})
}

func (h *AdminAfterDarkHandler) ModeratePost(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		sendAdminError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	postID := chi.URLParam(r, "postId")
	if _, err := uuid.Parse(postID); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid post ID")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	var request struct {
		Action string `json:"action"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid moderation request")
		return
	}
	if request.Action != "approve" && request.Action != "reject" {
		sendAdminError(w, http.StatusBadRequest, "Action must be approve or reject")
		return
	}
	if strings.TrimSpace(request.Reason) == "" || len(request.Reason) > 1000 {
		sendAdminError(w, http.StatusBadRequest, "A moderation reason of 1 to 1000 characters is required")
		return
	}
	err := h.Repo.ModerateAfterDarkPost(r.Context(), adminID, postID, request.Action, request.Reason)
	if errors.Is(err, repository.ErrAdminAfterDarkPostUnavailable) {
		sendAdminError(w, http.StatusNotFound, "Post is unavailable for moderation")
		return
	}
	if errors.Is(err, repository.ErrAdminAfterDarkAssetNotReady) {
		sendAdminError(w, http.StatusConflict, "Post media is not ready for approval")
		return
	}
	if err != nil {
		log.Printf("Failed to moderate After Dark post %s: %v", postID, err)
		sendAdminError(w, http.StatusInternalServerError, "Could not apply moderation action")
		return
	}
	sendAdminJSON(w, http.StatusOK, map[string]string{"status": "updated", "action": request.Action})
}
