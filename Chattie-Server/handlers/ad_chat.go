package handlers

import (
	"context"
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
	Hub           *Hub
	Events        *services.EventHandler
}

func NewADChatHandler(repo *repository.ADChatRepository, mediaRepo *repository.ADMediaRepository, uploadService *services.UploadService, hub *Hub, events *services.EventHandler) *ADChatHandler {
	return &ADChatHandler{Repo: repo, MediaRepo: mediaRepo, UploadService: uploadService, Hub: hub, Events: events}
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
	blocked, err := h.Repo.IsBlocked(r.Context(), userID, targetUserID)
	if err != nil {
		http.Error(w, "Failed to verify block status", http.StatusInternalServerError)
		return
	}
	if blocked {
		http.Error(w, "Messaging is unavailable for this conversation", http.StatusForbidden)
		return
	}

	convID, err := h.Repo.GetOrCreateConversation(r.Context(), userID, targetUserID)
	if err != nil {
		http.Error(w, "Failed to initialize conversation", http.StatusInternalServerError)
		return
	}
	hasAccess := dmControl == "all" || isSubscriber
	if !hasAccess && dmControl == "subscribers" {
		hasAccess, err = h.Repo.HasChatEntitlement(r.Context(), userID, targetUserID)
		if err != nil {
			http.Error(w, "Failed to verify chat access", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"conversation_id":  convID,
		"creator_id":       targetUserID,
		"other_user_id":    targetUserID,
		"has_access":       hasAccess,
		"requires_payment": dmControl == "subscribers" && !hasAccess,
		"dm_control":       dmControl,
		"chat_price_cents": repository.ChatAccessPriceCents,
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
	otherUserID, err := h.Repo.GetOtherParticipant(r.Context(), conversationID, userID)
	if err != nil {
		http.Error(w, "Failed to resolve conversation participant", http.StatusInternalServerError)
		return
	}
	blocked, err := h.Repo.IsBlocked(r.Context(), userID, otherUserID)
	if err != nil {
		http.Error(w, "Failed to verify block status", http.StatusInternalServerError)
		return
	}
	if blocked {
		http.Error(w, "Messaging is unavailable for this conversation", http.StatusForbidden)
		return
	}
	canSend, err := h.Repo.CanSendMessage(r.Context(), conversationID, userID)
	if err != nil {
		http.Error(w, "Failed to verify messaging access", http.StatusInternalServerError)
		return
	}
	if !canSend {
		http.Error(w, "Unlock this creator's chat or subscribe to continue messaging", http.StatusPaymentRequired)
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
		log.Printf("[AFTERDARK CHAT] Failed to upload attachment for user %s: %v", userID, err)
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
	otherUserID, err := h.Repo.GetOtherParticipant(r.Context(), convID, userID)
	if err != nil {
		http.Error(w, "Failed to resolve conversation participant", http.StatusInternalServerError)
		return
	}
	blocked, err := h.Repo.IsBlocked(r.Context(), userID, otherUserID)
	if err != nil {
		http.Error(w, "Failed to verify block status", http.StatusInternalServerError)
		return
	}
	if blocked {
		http.Error(w, "Messaging is unavailable for this conversation", http.StatusForbidden)
		return
	}
	canSend, err := h.Repo.CanSendMessage(r.Context(), convID, userID)
	if err != nil {
		http.Error(w, "Failed to verify messaging access", http.StatusInternalServerError)
		return
	}
	if !canSend {
		http.Error(w, "Unlock this creator's chat or subscribe to continue messaging", http.StatusPaymentRequired)
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
			http.Error(w, "Message was not saved; check attachment ownership and conversation access", http.StatusBadRequest)
			return
		}
		http.Error(w, "Failed to save message", http.StatusInternalServerError)
		return
	}

	recipientID, err := h.Repo.GetOtherParticipant(r.Context(), convID, userID)
	if err != nil {
		log.Printf("[AFTERDARK CHAT] Message %s saved, but recipient lookup failed: %v", msg.ID, err)
	} else if h.Hub != nil {
		if err := h.Hub.SendToUser(r.Context(), recipientID, map[string]interface{}{
			"type":            "ad_message",
			"conversation_id": convID,
			"message":         msg,
		}); err != nil {
			log.Printf("[AFTERDARK CHAT] Message %s saved, but realtime delivery failed: %v", msg.ID, err)
		}
	}
	if recipientID != "" && h.Events != nil {
		detachedCtx := context.WithoutCancel(r.Context())
		go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
			RecipientID: recipientID,
			WSEventType: "AFTER_DARK_MESSAGE",
			WSPayload: map[string]interface{}{
				"title": "New After Dark message", "message": "You received a new message.",
				"conversation_id": convID,
			},
			EmailTemplate: "afterdark_notification",
			EmailData: map[string]interface{}{
				"Title": "New After Dark message", "Message": "You received a new message.",
			},
			AfterDarkEmailCategory: "messages",
		})
	}

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

func (h *ADChatHandler) SetConversationBlock(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
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
	otherUserID, err := h.Repo.GetOtherParticipant(r.Context(), conversationID, userID)
	if err != nil {
		http.Error(w, "Failed to resolve conversation participant", http.StatusInternalServerError)
		return
	}
	var req struct {
		Blocked *bool `json:"blocked"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Blocked == nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if err := h.Repo.SetBlock(r.Context(), userID, otherUserID, *req.Blocked); err != nil {
		http.Error(w, "Failed to update block", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"blocked": *req.Blocked})
}

func (h *ADChatHandler) UnlockChat(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
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
	otherUserID, err := h.Repo.GetOtherParticipant(r.Context(), conversationID, userID)
	if err != nil {
		http.Error(w, "Failed to resolve conversation participant", http.StatusInternalServerError)
		return
	}
	blocked, err := h.Repo.IsBlocked(r.Context(), userID, otherUserID)
	if err != nil {
		http.Error(w, "Failed to verify block status", http.StatusInternalServerError)
		return
	}
	if blocked {
		http.Error(w, "Messaging is unavailable for this conversation", http.StatusForbidden)
		return
	}
	if err := h.Repo.PurchaseChatAccess(r.Context(), conversationID, userID); err != nil {
		switch err.Error() {
		case "insufficient funds":
			http.Error(w, "Insufficient wallet balance", http.StatusPaymentRequired)
		case "creators cannot purchase their own chat", "creator is not accepting direct messages":
			http.Error(w, err.Error(), http.StatusForbidden)
		case "chat access is already included":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "has_access": true, "already_unlocked": true})
		default:
			if errors.Is(err, sql.ErrNoRows) {
				http.Error(w, "Conversation or creator not found", http.StatusNotFound)
				return
			}
			http.Error(w, "Chat access purchase failed", http.StatusInternalServerError)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "has_access": true})
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
