package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type ADInteractionsHandler struct {
	Repo   *repository.ADInteractionsRepository
	Events *services.EventHandler
}

func NewADInteractionsHandler(repo *repository.ADInteractionsRepository, events *services.EventHandler) *ADInteractionsHandler {
	return &ADInteractionsHandler{Repo: repo, Events: events}
}

// POST /api/afterdark/posts/{postId}/likes
func (h *ADInteractionsHandler) ToggleLike(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	postID := chi.URLParam(r, "postId")
	if postID == "" {
		http.Error(w, localized(r.Context(), "ErrPostIDIsRequired", "Post ID is required"), http.StatusBadRequest)
		return
	}

	liked, err := h.Repo.ToggleLike(r.Context(), userID, postID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToToggleLike", "Failed to toggle like"), http.StatusInternalServerError)
		return
	}
	if liked && h.Events != nil {
		var creatorID string
		err := h.Repo.DB.QueryRowContext(r.Context(), `
			SELECT creator_id::text FROM ad_posts WHERE id = $1 AND status = 'published'`,
			postID).Scan(&creatorID)
		if err != nil {
			log.Printf("[AFTER DARK NOTIFICATION] Could not resolve post creator for %s: %v", postID, err)
		} else if creatorID != userID {
			detachedCtx := context.WithoutCancel(r.Context())
			go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
				RecipientID: creatorID,
				WSEventType: "AFTER_DARK_LIKE",
				WSPayload: map[string]interface{}{
					"title": localized(r.Context(), "MsgNewAfterDarkLike", "New After Dark like"), "message": localized(r.Context(), "MsgAMemberLikedYourPost", "A member liked your post."), "post_id": postID,
					"action_url": "/afterdark/feed", "action_label": "View post", "category": "social",
				},
				EmailTemplate: "afterdark_notification",
				EmailData: map[string]interface{}{
					"Title": "New After Dark like", "Message": "A member liked your post.",
				},
				AfterDarkEmailCategory: "likes",
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "success",
		"liked":  liked,
	})
}

// GET /api/afterdark/posts/{postId}/comments
func (h *ADInteractionsHandler) GetComments(w http.ResponseWriter, r *http.Request) {
	postID := chi.URLParam(r, "postId")
	if postID == "" {
		http.Error(w, localized(r.Context(), "ErrPostIDIsRequired2", "Post ID is required"), http.StatusBadRequest)
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if offset < 0 {
		offset = 0
	}

	comments, err := h.Repo.GetComments(r.Context(), postID, limit, offset)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToFetchComments", "Failed to fetch comments"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(comments)
}

// POST /api/afterdark/posts/{postId}/comments
func (h *ADInteractionsHandler) AddComment(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	postID := chi.URLParam(r, "postId")
	if postID == "" {
		http.Error(w, localized(r.Context(), "ErrPostIDIsRequired3", "Post ID is required"), http.StatusBadRequest)
		return
	}

	var req struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Content == "" {
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBodyOrMissingContent", "Invalid request body or missing content"), http.StatusBadRequest)
		return
	}

	comment := &models.ADComment{
		ID:        uuid.New().String(),
		UserID:    userID,
		PostID:    postID,
		Content:   req.Content,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := h.Repo.AddComment(r.Context(), comment); err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToAddComment", "Failed to add comment"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(comment)
}

// POST /api/afterdark/moderation/reports
func (h *ADInteractionsHandler) SubmitReport(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	var req struct {
		TargetType string `json:"target_type"`
		TargetID   string `json:"target_id"`
		Reason     string `json:"reason"`
		Details    string `json:"details"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBody", "Invalid request body"), http.StatusBadRequest)
		return
	}

	report := &models.ADReport{
		ID:         uuid.New().String(),
		ReporterID: userID,
		TargetType: req.TargetType,
		TargetID:   req.TargetID,
		Reason:     req.Reason,
		Details:    req.Details,
		Status:     "pending",
		CreatedAt:  time.Now(),
	}

	if err := h.Repo.SubmitReport(r.Context(), report); err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedSubmitReport", "Failed to submit report"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "success",
		"message": localized(r.Context(), "MsgReportSubmittedForReview", "Report submitted for review"),
	})
}
