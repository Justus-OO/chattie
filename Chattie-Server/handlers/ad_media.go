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
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type ADMediaHandler struct {
	Repo          *repository.ADMediaRepository
	UploadService *services.UploadService
}

func NewADMediaHandler(repo *repository.ADMediaRepository, uploadService *services.UploadService) *ADMediaHandler {
	return &ADMediaHandler{
		Repo:          repo,
		UploadService: uploadService,
	}
}

// POST /api/afterdark/me/posts
func (h *ADMediaHandler) CreatePost(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	requestID := uuid.NewString()
	if h.UploadService == nil {
		http.Error(w, "Media storage is unavailable", http.StatusServiceUnavailable)
		return
	}

	// Safely limit RAM usage to 32MB (larger files will be spooled to disk temp files)
	r.Body = http.MaxBytesReader(w, r.Body, 512<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "File upload too large or invalid", http.StatusBadRequest)
		return
	}

	priceCents := int64(0)
	if priceStr := r.FormValue("price_cents"); priceStr != "" {
		parsed, err := strconv.ParseInt(priceStr, 10, 64)
		if err != nil || parsed < 0 {
			http.Error(w, "Invalid price", http.StatusBadRequest)
			return
		}
		priceCents = parsed
	}

	accessType := r.FormValue("access_type")
	if accessType == "" {
		accessType = "free"
	}
	isExplicit := true
	if explicitValue := r.FormValue("is_explicit"); explicitValue != "" {
		parsed, err := strconv.ParseBool(explicitValue)
		if err != nil {
			http.Error(w, "Invalid explicit-content setting", http.StatusBadRequest)
			return
		}
		isExplicit = parsed
	}
	switch accessType {
	case "free", "subscriber", "ppv":
	default:
		http.Error(w, "Invalid access type", http.StatusBadRequest)
		return
	}
	if accessType == "ppv" && priceCents < 5000 {
		http.Error(w, "A valid price is required for PPV posts", http.StatusBadRequest)
		return
	}
	if accessType != "ppv" {
		priceCents = 0
	}

	activeCreator, err := h.Repo.IsActiveCreator(r.Context(), userID)
	if err != nil {
		log.Printf("[AFTERDARK MEDIA] Creator status lookup failed request=%s user=%s: %v", requestID, userID, err)
		writeADMediaError(w, http.StatusInternalServerError, "Could not verify creator access. Check server logs if the problem persists.", requestID)
		return
	}
	if !activeCreator {
		writeADMediaError(w, http.StatusForbidden, "Your creator profile must be approved and active before publishing posts.", requestID)
		return
	}

	file, header, err := r.FormFile("media") // Match this with your React FormData field name!
	if err != nil {
		http.Error(w, "Media file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()
	mimeType, err := sniffUploadType(file)
	if err != nil {
		http.Error(w, "Failed to read uploaded media", http.StatusBadRequest)
		return
	}
	if !strings.HasPrefix(mimeType, "image/") && !strings.HasPrefix(mimeType, "video/") {
		http.Error(w, "Only image and video posts are supported", http.StatusUnsupportedMediaType)
		return
	}

	// 1. Upload to Private Storage
	uploadURL, _, err := h.UploadService.SaveFile(file, header, "afterdark")
	if err != nil {
		log.Printf("[AFTERDARK MEDIA] Upload failed request=%s user=%s: %v", requestID, userID, err)
		writeADMediaError(w, http.StatusInternalServerError, "Media upload failed. Check server logs if the problem persists.", requestID)
		return
	}

	// 2. Save Asset to DB (Cleaned up formatting to remove hidden invisible spaces)
	asset := &models.ADAsset{
		ID:               uuid.New().String(),
		OwnerID:          userID,
		StorageKey:       uploadURL,
		MimeType:         mimeType,
		SizeBytes:        header.Size,
		Status:           "ready",
		ModerationStatus: "pending",
		CreatedAt:        time.Now(),
	}

	post := &models.ADPost{
		ID:         uuid.New().String(),
		CreatorID:  userID,
		AssetID:    asset.ID,
		Caption:    r.FormValue("caption"),
		AccessType: accessType,
		PriceCents: priceCents,
		IsExplicit: isExplicit,
		Status:     "published",
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	if err := h.Repo.CreatePostWithAsset(r.Context(), asset, post); err != nil {
		log.Printf("[AFTERDARK MEDIA] Database save failed request=%s user=%s asset=%s post=%s: %v", requestID, userID, asset.ID, post.ID, err)
		if deleteErr := h.UploadService.DeleteFile(uploadURL); deleteErr != nil {
			log.Printf("[AFTERDARK MEDIA] Upload cleanup failed request=%s asset=%s: %v", requestID, asset.ID, deleteErr)
		}
		writeADMediaError(w, http.StatusInternalServerError, "Could not save your post. Check server logs if the problem persists.", requestID)
		return
	}
	post.MediaURL = asset.StorageKey
	post.MediaType = asset.MimeType

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(post)
}

func writeADMediaError(w http.ResponseWriter, status int, message, requestID string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":      message,
		"request_id": requestID,
	})
}

// POST /api/afterdark/me/creator-profile/{kind}-upload
func (h *ADMediaHandler) UploadCreatorImage(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if h.UploadService == nil {
		http.Error(w, "Image storage is unavailable", http.StatusServiceUnavailable)
		return
	}
	kind := chi.URLParam(r, "kind")
	if kind != "avatar" && kind != "cover" {
		http.Error(w, "Unsupported image type", http.StatusBadRequest)
		return
	}
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		http.Error(w, "File upload too large or invalid", http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Image file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()
	mimeType, err := sniffUploadType(file)
	if err != nil {
		http.Error(w, "Failed to read uploaded image", http.StatusBadRequest)
		return
	}
	if !strings.HasPrefix(mimeType, "image/") {
		http.Error(w, "Only image files are supported", http.StatusUnsupportedMediaType)
		return
	}
	uploadURL, size, err := h.UploadService.SaveFile(file, header, "afterdark/profiles")
	if err != nil {
		http.Error(w, "Failed to upload creator image", http.StatusInternalServerError)
		return
	}
	asset := &models.ADAsset{
		ID: uuid.New().String(), OwnerID: userID, StorageKey: uploadURL,
		MimeType: mimeType, SizeBytes: size, Status: "ready",
		ModerationStatus: "pending", CreatedAt: time.Now(),
	}
	previewURL, err := presignMediaURL(r.Context(), h.UploadService, uploadURL)
	if err != nil {
		if deleteErr := h.UploadService.DeleteFile(uploadURL); deleteErr != nil {
			log.Printf("[AFTERDARK MEDIA] Failed to clean up creator image after signing failed: %v", deleteErr)
		}
		http.Error(w, "Could not prepare creator image for display", http.StatusBadGateway)
		return
	}
	if err := h.Repo.CreateCreatorImage(r.Context(), asset, kind); err != nil {
		if deleteErr := h.UploadService.DeleteFile(uploadURL); deleteErr != nil {
			log.Printf("[AFTERDARK MEDIA] Failed to clean up uploaded creator image: %v", deleteErr)
		}
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "Creator profile not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Failed to save creator image", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"asset_id": asset.ID,
		"url":      previewURL,
		"kind":     kind,
	})
}

// GET /api/afterdark/me/posts
func (h *ADMediaHandler) GetVaultPosts(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	statusFilter := r.URL.Query().Get("status")

	posts, err := h.Repo.GetVaultPosts(r.Context(), userID, statusFilter)
	if err != nil {
		http.Error(w, "Failed to fetch vault posts", http.StatusInternalServerError)
		return
	}
	for i := range posts {
		posts[i].MediaURL, err = presignMediaURL(r.Context(), h.UploadService, posts[i].MediaURL)
		if err != nil {
			log.Printf("[AFTERDARK MEDIA] Could not sign vault image for user %s: %v", userID, err)
			http.Error(w, "Could not load your media vault images", http.StatusBadGateway)
			return
		}
	}

	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(posts)
}

// GET /api/afterdark/posts/{postId}/media-url
func (h *ADMediaHandler) GetPostMediaURL(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if h.UploadService == nil {
		http.Error(w, "Media storage is unavailable", http.StatusServiceUnavailable)
		return
	}

	asset, err := h.Repo.GetAuthorizedPostAsset(
		r.Context(),
		userID,
		middlewares.CountryCodeFromContext(r.Context()),
		chi.URLParam(r, "postId"),
	)
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "Post media not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Could not authorize post media", http.StatusInternalServerError)
		return
	}

	const urlLifetime = 10 * time.Minute
	mediaURL, err := h.UploadService.ReadURL(r.Context(), asset.StorageKey, urlLifetime)
	if err != nil {
		http.Error(w, "Could not provide post media", http.StatusBadGateway)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"url":        mediaURL,
		"expires_at": time.Now().Add(urlLifetime).UTC(),
	})
}

// DELETE /api/afterdark/me/posts/{postId}
func (h *ADMediaHandler) DeletePost(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	postID := chi.URLParam(r, "postId")
	if err := h.Repo.DeletePost(r.Context(), postID, userID); err != nil {
		http.Error(w, "Failed to delete post or post not found", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

// PATCH /api/afterdark/me/posts/{postId}
func (h *ADMediaHandler) UpdatePost(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		Caption         string `json:"caption"`
		AccessType      string `json:"access_type"`
		PricingStrategy string `json:"pricing_strategy"`
		PriceCents      int64  `json:"price_cents"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	accessType := req.AccessType
	if accessType == "" {
		accessType = req.PricingStrategy
	}
	if accessType == "" {
		accessType = "free"
	}
	switch accessType {
	case "free", "subscriber", "ppv":
	default:
		http.Error(w, "Invalid pricing strategy", http.StatusBadRequest)
		return
	}
	if req.PriceCents < 0 || (accessType == "ppv" && req.PriceCents < 5000) {
		http.Error(w, "A valid price is required for PPV posts", http.StatusBadRequest)
		return
	}
	if accessType != "ppv" {
		req.PriceCents = 0
	}
	post, err := h.Repo.UpdatePost(r.Context(), chi.URLParam(r, "postId"), userID, req.Caption, accessType, req.PriceCents)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "Post not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Failed to update post", http.StatusInternalServerError)
		return
	}
	response := map[string]interface{}{
		"id": post.ID, "creator_id": post.CreatorID, "asset_id": post.AssetID,
		"media_url": post.MediaURL, "media_type": post.MediaType,
		"caption": post.Caption, "access_type": post.AccessType,
		"pricing_strategy": post.AccessType, "price_cents": post.PriceCents,
		"is_explicit": post.IsExplicit, "status": post.Status,
		"created_at": post.CreatedAt, "updated_at": post.UpdatedAt,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
