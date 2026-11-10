package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type ADInteractionsHandler struct {
	Repo *repository.ADInteractionsRepository
}

func NewADInteractionsHandler(repo *repository.ADInteractionsRepository) *ADInteractionsHandler {
	return &ADInteractionsHandler{Repo: repo}
}

// POST /api/afterdark/posts/{postId}/likes
func (h *ADInteractionsHandler) ToggleLike(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	postID := chi.URLParam(r, "postId")
	if postID == "" {
		http.Error(w, "Post ID is required", http.StatusBadRequest)
		return
	}

	liked, err := h.Repo.ToggleLike(r.Context(), userID, postID)
	if err != nil {
		http.Error(w, "Failed to toggle like", http.StatusInternalServerError)
		return
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
		http.Error(w, "Post ID is required", http.StatusBadRequest)
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit == 0 || limit > 100 {
		limit = 20
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	comments, err := h.Repo.GetComments(r.Context(), postID, limit, offset)
	if err != nil {
		http.Error(w, "Failed to fetch comments", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(comments)
}

// POST /api/afterdark/posts/{postId}/comments
func (h *ADInteractionsHandler) AddComment(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	postID := chi.URLParam(r, "postId")
	if postID == "" {
		http.Error(w, "Post ID is required", http.StatusBadRequest)
		return
	}

	var req struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Content == "" {
		http.Error(w, "Invalid request body or missing content", http.StatusBadRequest)
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
		http.Error(w, "Failed to add comment", http.StatusInternalServerError)
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
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		TargetType string `json:"target_type"`
		TargetID   string `json:"target_id"`
		Reason     string `json:"reason"`
		Details    string `json:"details"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
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
		http.Error(w, "Failed to submit report", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "success",
		"message": "Report submitted for review",
	})
}
