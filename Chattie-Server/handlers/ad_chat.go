package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime/multipart"
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

type ADChatHandler struct {
	Repo          *repository.ADChatRepository
	MediaRepo     *repository.ADMediaRepository
	UploadService *services.UploadService
}

func NewADChatHandler(repo *repository.ADChatRepository, mediaRepo *repository.ADMediaRepository, uploadService *services.UploadService) *ADChatHandler {
	return &ADChatHandler{Repo: repo, MediaRepo: mediaRepo, UploadService: uploadService}
}

// POST /api/afterdark/conversations
// Used by frontend when clicking "Message Creator" to ensure a thread exists
func (h *ADChatHandler) InitConversation(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		TargetUserID string `json:"target_user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TargetUserID == "" {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.TargetUserID == userID {
		http.Error(w, "Cannot start a conversation with yourself", http.StatusBadRequest)
		return
	}

	targetUserID, dmControl, isSubscriber, err := h.Repo.ResolveMessageTarget(r.Context(), userID, req.TargetUserID)
	if err != nil {
		http.Error(w, "Failed to resolve conversation target", http.StatusInternalServerError)
		return
	}
	if dmControl == "none" {
		http.Error(w, "This creator is not accepting direct messages", http.StatusForbidden)
		return
	}
	if dmControl == "subscribers" && !isSubscriber {
		http.Error(w, "A subscription is required to message this creator", http.StatusForbidden)
		return
	}

	convID, err := h.Repo.GetOrCreateConversation(r.Context(), userID, targetUserID)
	if err != nil {
		http.Error(w, "Failed to initialize conversation", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"conversation_id": convID,
	})
}

// GET /api/afterdark/conversations
func (h *ADChatHandler) GetConversations(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	conversations, err := h.Repo.GetConversations(r.Context(), userID)
	if err != nil {
		http.Error(w, "Failed to fetch conversations", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(conversations)
}

// POST /api/afterdark/conversations/{conversationId}/attachments
func (h *ADChatHandler) UploadAttachment(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if h.UploadService == nil {
		http.Error(w, "Attachment storage is unavailable", http.StatusServiceUnavailable)
		return
	}
	conversationID := chi.URLParam(r, "conversationId")
	isParticipant, err := h.Repo.IsParticipant(r.Context(), conversationID, userID)
	if err != nil {
		http.Error(w, "Failed to verify conversation access", http.StatusInternalServerError)
		return
	}
	if !isParticipant {
		http.Error(w, "Conversation not found", http.StatusNotFound)
		return
	}
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "File upload too large or invalid", http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "File is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	mimeType, err := sniffUploadType(file)
	if err != nil {
		http.Error(w, "Failed to read uploaded file", http.StatusBadRequest)
		return
	}
	if !strings.HasPrefix(mimeType, "image/") &&
		!strings.HasPrefix(mimeType, "video/") &&
		!strings.HasPrefix(mimeType, "audio/") &&
		mimeType != "application/pdf" {
		http.Error(w, "Unsupported attachment type", http.StatusUnsupportedMediaType)
		return
	}
	uploadURL, size, err := h.UploadService.SaveFile(file, header, "afterdark/messages")
	if err != nil {
		http.Error(w, "Failed to upload attachment", http.StatusInternalServerError)
		return
	}
	asset := &models.ADAsset{
		ID: uuid.New().String(), OwnerID: userID, StorageKey: uploadURL,
		MimeType: mimeType, SizeBytes: size, Status: "ready",
		ModerationStatus: "pending", CreatedAt: time.Now(),
	}
	if err := h.MediaRepo.CreateAsset(r.Context(), asset); err != nil {
		if deleteErr := h.UploadService.DeleteFile(uploadURL); deleteErr != nil {
			log.Printf("[AFTERDARK CHAT] Failed to clean up uploaded attachment: %v", deleteErr)
		}
		http.Error(w, "Failed to save attachment record", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"media_asset_id": asset.ID,
		"url":            asset.StorageKey,
		"mime_type":      asset.MimeType,
		"size_bytes":     asset.SizeBytes,
	})
}

// POST /api/afterdark/conversations/{conversationId}/messages
func (h *ADChatHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	convID := chi.URLParam(r, "conversationId")
	isParticipant, err := h.Repo.IsParticipant(r.Context(), convID, userID)
	if err != nil {
		http.Error(w, "Failed to verify conversation access", http.StatusInternalServerError)
		return
	}
	if !isParticipant {
		http.Error(w, "Conversation not found", http.StatusNotFound)
		return
	}

	var req struct {
		Content      string `json:"content"`
		MediaAssetID string `json:"media_asset_id"` // Optional if they uploaded an attachment first
		IsExplicit   bool   `json:"is_explicit"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Content) == "" && req.MediaAssetID == "" {
		http.Error(w, "Message content or an attachment is required", http.StatusBadRequest)
		return
	}

	msg := &models.ADMessage{
		ID:             uuid.New().String(),
		ConversationID: convID,
		SenderID:       userID,
		Content:        req.Content,
		MediaAssetID:   req.MediaAssetID,
		IsExplicit:     req.IsExplicit,
		CreatedAt:      time.Now(),
	}

	if err := h.Repo.SaveMessage(r.Context(), msg); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "Invalid conversation attachment", http.StatusBadRequest)
			return
		}
		http.Error(w, "Failed to save message", http.StatusInternalServerError)
		return
	}

	// TODO: Dispatch msg to your existing WebSocket Hub for real-time delivery to the recipient

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(msg)
}

// GET /api/afterdark/conversations/{conversationId}/messages
func (h *ADChatHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	convID := chi.URLParam(r, "conversationId")
	isParticipant, err := h.Repo.IsParticipant(r.Context(), convID, userID)
	if err != nil {
		http.Error(w, "Failed to verify conversation access", http.StatusInternalServerError)
		return
	}
	if !isParticipant {
		http.Error(w, "Conversation not found", http.StatusNotFound)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if offset < 0 {
		http.Error(w, "Invalid offset", http.StatusBadRequest)
		return
	}

	messages, err := h.Repo.GetMessages(r.Context(), convID, limit, offset)
	if err != nil {
		http.Error(w, "Failed to fetch messages", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(messages)
}

// POST /api/afterdark/conversations/{conversationId}/read
func (h *ADChatHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	convID := chi.URLParam(r, "conversationId")
	isParticipant, err := h.Repo.IsParticipant(r.Context(), convID, userID)
	if err != nil {
		http.Error(w, "Failed to verify conversation access", http.StatusInternalServerError)
		return
	}
	if !isParticipant {
		http.Error(w, "Conversation not found", http.StatusNotFound)
		return
	}

	if err := h.Repo.UpdateReadCursor(r.Context(), convID, userID); err != nil {
		http.Error(w, "Failed to update read cursor", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "read"})
}

func sniffUploadType(file multipart.File) (string, error) {
	buffer := make([]byte, 512)
	n, err := file.Read(buffer)
	if err != nil && err != io.EOF {
		return "", err
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	return http.DetectContentType(buffer[:n]), nil
}
