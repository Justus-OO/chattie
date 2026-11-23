package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/go-chi/chi/v5"
)

type CreatorHandler struct {
	Repo   *repository.Repository
	Events *services.EventHandler // For creator notifications
}

func NewCreatorHandler(repo *repository.Repository, events *services.EventHandler) *CreatorHandler {
	return &CreatorHandler{
		Repo:   repo,
		Events: events,
	}
}

// helper to send standard JSON responses
func sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// helper to send error responses
func sendError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// GetStats returns the live metrics for the dashboard
func (h *CreatorHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, localized(r.Context(), "ErrUnauthorized", "Unauthorized"))
		return
	}

	stats, err := h.Repo.GetCreatorStats(r.Context(), userID)
	if err != nil {
		log.Printf("Error fetching creator stats for user %s: %v", userID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedLoadDashboardData", "Failed to load dashboard data"))
		return
	}

	sendJSON(w, http.StatusOK, stats)
}

// ProcessQueueAction handles accepting or rejecting client chat requests
func (h *CreatorHandler) ProcessQueueAction(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, localized(r.Context(), "ErrUnauthorized", "Unauthorized"))
		return
	}

	profileID := r.URL.Query().Get("profile_id")
	if profileID == "" {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrMissingProfileIdParameter", "Missing profile_id query parameter"))
		return
	}
	reqID := chi.URLParam(r, "request_id")
	if reqID == "" {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrMissingRequestIdParameter", "Missing request_id URL parameter"))
		return
	}

	var payload models.QueueActionRequest
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidRequestPayload", "Invalid request payload"))
		return
	}

	if payload.Action != "accept" && payload.Action != "reject" {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidActionType", "Invalid action type: must be 'accept' or 'reject'"))
		return
	}

	err := h.Repo.ProcessQueueAction(r.Context(), reqID, profileID, payload.Action)
	if err != nil {
		log.Printf("Error processing queue action for req %s: %v", reqID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedProcessRequest", "Failed to process request"))
		return
	}

	// Log the action for audit trail
	actionType := "REQUEST_ACCEPTED"
	if payload.Action == "reject" {
		actionType = "REQUEST_REJECTED"
	}
	ActionLogQueue <- models.ActionLog{
		UserID:     userID,
		ActionType: actionType,
		TargetID:   profileID,
		IP:         r.RemoteAddr,
	}

	sendJSON(w, http.StatusOK, map[string]string{"message": localized(r.Context(), "MsgQueueUpdated", "Queue updated successfully")})
}

// GetLedger returns the transaction history
func (h *CreatorHandler) GetLedger(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, localized(r.Context(), "ErrUnauthorized", "Unauthorized"))
		return
	}

	txs, err := h.Repo.GetTransactions(r.Context(), userID)
	if err != nil {
		log.Printf("Error fetching ledger for user %s: %v", userID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedLoadTransactions", "Failed to load transactions"))
		return
	}

	sendJSON(w, http.StatusOK, txs)
}

// RequestPayout processes wire withdrawal requests
func (h *CreatorHandler) RequestPayout(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, localized(r.Context(), "ErrUnauthorized", "Unauthorized"))
		return
	}

	var payload models.PayoutRequest
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidRequestPayload", "Invalid request payload"))
		return
	}

	err := h.Repo.RequestPayout(r.Context(), userID, payload.Amount)
	if err != nil {
		log.Printf("Payout error for user %s: %v", userID, err)
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrPayoutFailed", err.Error())) // Pass through exact reason (e.g., "insufficient funds")
		return
	}

	sendJSON(w, http.StatusOK, map[string]string{"message": localized(r.Context(), "MsgPayoutRequested", "Payout requested successfully")})
}

// GetProfiles handles GET /api/creator/profiles
func (h *CreatorHandler) GetProfiles(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"))
		return
	}

	profiles, err := h.Repo.GetAssignedProfiles(r.Context(), userID)
	if err != nil {
		log.Printf("Error fetching managed profiles for user %s: %v", userID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedLoadProfiles", "Failed to load profiles"))
		return
	}

	sendJSON(w, http.StatusOK, profiles)
}

func (h *CreatorHandler) GetProfileConversations(w http.ResponseWriter, r *http.Request) {
	_, profileID, chatUserID, ok := h.profileChatIdentity(w, r)
	if !ok {
		return
	}

	conversations, err := repository.NewChatRepository(h.Repo.DB).GetInbox(chatUserID)
	if err != nil {
		log.Printf("Error fetching conversations for managed profile %s: %v", profileID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedToLoadProfileConversations", "Failed to load profile conversations"))
		return
	}
	sendJSON(w, http.StatusOK, conversations)
}

func (h *CreatorHandler) GetProfileConversationMessages(w http.ResponseWriter, r *http.Request) {
	_, profileID, chatUserID, ok := h.profileChatIdentity(w, r)
	if !ok {
		return
	}
	partnerID := chi.URLParam(r, "partner_id")
	if partnerID == "" || partnerID == chatUserID {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrAConversationPartnerIsRequired3", "A conversation partner is required"))
		return
	}

	chatRepo := repository.NewChatRepository(h.Repo.DB)
	messages, err := chatRepo.GetDirectMessages(chatUserID, partnerID, 100)
	if err != nil {
		log.Printf("Error fetching profile conversation %s/%s: %v", profileID, partnerID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedToLoadConversation", "Failed to load conversation"))
		return
	}
	if err := chatRepo.MarkMessagesAsRead(chatUserID, partnerID); err != nil {
		log.Printf("Error marking profile conversation %s/%s as read: %v", profileID, partnerID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedToUpdateReadStatus", "Failed to update read status"))
		return
	}
	sendJSON(w, http.StatusOK, messages)
}

func (h *CreatorHandler) BlockProfileConversationUser(w http.ResponseWriter, r *http.Request) {
	creatorID, profileID, chatUserID, ok := h.profileChatIdentity(w, r)
	if !ok {
		return
	}
	partnerID := chi.URLParam(r, "partner_id")
	if partnerID == "" || partnerID == chatUserID {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrAConversationPartnerIsRequired4", "A conversation partner is required"))
		return
	}
	if err := h.Repo.BlockUser(r.Context(), chatUserID, partnerID); err != nil {
		log.Printf("Creator %s failed to block user %s for profile %s: %v", creatorID, partnerID, profileID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedBlockUser", "Failed to block user"))
		return
	}
	sendJSON(w, http.StatusOK, map[string]string{"message": localized(r.Context(), "MsgUserBlocked", "User blocked")})
}

func (h *CreatorHandler) ReportProfileConversationUser(w http.ResponseWriter, r *http.Request) {
	creatorID, profileID, chatUserID, ok := h.profileChatIdentity(w, r)
	if !ok {
		return
	}
	partnerID := chi.URLParam(r, "partner_id")
	var payload struct {
		Reason string `json:"reason"`
	}
	if partnerID == "" || partnerID == chatUserID {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrAConversationPartnerIsRequired5", "A conversation partner is required"))
		return
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.Reason == "" {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrAReportReasonIsRequired", "A report reason is required"))
		return
	}
	restricted, err := h.Repo.ReportUser(r.Context(), chatUserID, partnerID, payload.Reason)
	if err != nil {
		log.Printf("Creator %s failed to report user %s for profile %s: %v", creatorID, partnerID, profileID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedSubmitReport", "Failed to submit report"))
		return
	}
	if restricted && h.Events != nil && h.Events.NotifService != nil {
		h.Events.NotifService.DisconnectUser(partnerID)
	}
	if restricted && h.Events != nil {
		detachedCtx := context.WithoutCancel(r.Context())
		go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
			RecipientID:   partnerID,
			EmailTemplate: "account_banned",
		})
	}
	sendJSON(w, http.StatusOK, map[string]string{"message": localized(r.Context(), "MsgReportSubmitted", "Report submitted")})
}

func (h *CreatorHandler) profileChatIdentity(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
	creatorID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || creatorID == "" {
		sendError(w, http.StatusUnauthorized, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"))
		return "", "", "", false
	}
	profileID := chi.URLParam(r, "profile_id")
	if profileID == "" {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrMissingProfileIdUrl", "Missing profile_id URL parameter"))
		return "", "", "", false
	}
	chatUserID, err := h.Repo.ResolveManagedProfileChatIdentity(r.Context(), profileID, creatorID)
	if err != nil {
		if err == sql.ErrNoRows {
			sendError(w, http.StatusNotFound, localized(r.Context(), "ErrAssignedProfileNotFound5", "Assigned profile not found"))
			return "", "", "", false
		}
		log.Printf("Error resolving chat identity for profile %s and creator %s: %v", profileID, creatorID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedToValidateAssignedProfile", "Failed to validate assigned profile"))
		return "", "", "", false
	}
	return creatorID, profileID, chatUserID, true
}

// UpdateStatus handles PATCH /api/creator/profiles/{profile_id}/status
func (h *CreatorHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"))
		return
	}

	profileID := chi.URLParam(r, "profile_id")
	if profileID == "" {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrMissingProfileIdUrl", "Missing profile_id URL parameter"))
		return
	}

	var payload models.UpdateStatusRequest
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidRequestPayload", "Invalid request payload"))
		return
	}

	if payload.Status != "online" && payload.Status != "offline" && payload.Status != "busy" {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidStatusValue", "Invalid status value"))
		return
	}

	err := h.Repo.UpdateProfileStatus(r.Context(), profileID, userID, payload.Status)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			sendError(w, http.StatusNotFound, localized(r.Context(), "ErrAssignedProfileNotFound6", "Assigned profile not found"))
			return
		}
		log.Printf("Error updating status for profile %s: %v", profileID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedUpdateProfileStatus", "Failed to update profile status"))
		return
	}

	sendJSON(w, http.StatusOK, map[string]string{"message": localized(r.Context(), "MsgStatusUpdated", "Status updated successfully")})
}

// GetQueue handles GET /api/creator/queue?profile_id=XYZ
func (h *CreatorHandler) GetQueue(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"))
		return
	}

	profileID := r.URL.Query().Get("profile_id")
	if profileID == "" {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrMissingProfileIdParameter", "Missing profile_id query parameter"))
		return
	}

	queue, err := h.Repo.GetChatQueueForProfile(r.Context(), profileID)
	if err != nil {
		log.Printf("Error fetching queue for profile %s: %v", profileID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedLoadCreatorQueue", "Failed to load queue"))
		return
	}

	sendJSON(w, http.StatusOK, queue)
}

// GetProfileMedia handles GET /api/creator/profiles/{profile_id}/media
func (h *CreatorHandler) GetProfileMedia(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"))
		return
	}

	profileID := chi.URLParam(r, "profile_id")
	if profileID == "" {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrMissingProfileIdUrl", "Missing profile_id URL parameter"))
		return
	}

	media, err := h.Repo.GetProfileMedia(r.Context(), profileID, userID)
	if err != nil {
		log.Printf("Error fetching media for profile %s: %v", profileID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedLoadProfileMedia", "Failed to load profile media"))
		return
	}

	sendJSON(w, http.StatusOK, media)
}

// ToggleOnlineStatus handles POST /api/creator/status
func (h *CreatorHandler) ToggleOnlineStatus(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		sendError(w, http.StatusUnauthorized, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"))
		return
	}

	var payload struct {
		IsOnline bool `json:"is_online"`
	}
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidPayloadShort", "Invalid payload"))
		return
	}

	err := h.Repo.UpdateCreatorOnlineStatus(r.Context(), userID, payload.IsOnline)
	if err != nil {
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedUpdateStatus", "Failed to update status"))
		return
	}

	sendJSON(w, http.StatusOK, map[string]bool{"is_online": payload.IsOnline})
}
