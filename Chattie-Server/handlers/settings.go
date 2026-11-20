package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"
)

type SettingsHandler struct {
	Repo    *repository.SettingsRepository
	Storage *services.UploadService
	Email   *EmailHandler
	Plaid   *services.PlaidIdentityVerificationService
	Events  *services.EventHandler
}

func NewSettingsHandler(
	repo *repository.SettingsRepository,
	storage *services.UploadService,
	emailHandler *EmailHandler,
	events *services.EventHandler,
	plaid *services.PlaidIdentityVerificationService,
) *SettingsHandler {
	return &SettingsHandler{
		Repo:    repo,
		Storage: storage,
		Email:   emailHandler,
		Plaid:   plaid,
		Events:  events,
	}
}

// ============================================================================
// CORE PROFILE & SETTINGS
// ============================================================================

func (h *SettingsHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, no-store")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		log.Println("CRITICAL 401: user_id missing from request context in GetSettings!")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrUnauthorizedMissingContext", "Unauthorized: Missing context")})
		return
	}

	settings, err := h.Repo.GetSettings(userID)
	if err != nil {
		log.Printf("500 Error in GetSettings for user %s: %v\n", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedFetchSettings", "Failed to fetch settings")})
		return
	}
	if settings.Avatar, err = presignMediaURL(r.Context(), h.Storage, settings.Avatar); err != nil {
		log.Printf("[SETTINGS] Could not sign profile avatar for user %s: %v", userID, err)
		http.Error(w, `{"error":"Could not load profile images"}`, http.StatusBadGateway)
		return
	}
	if settings.Cover, err = presignMediaURL(r.Context(), h.Storage, settings.Cover); err != nil {
		log.Printf("[SETTINGS] Could not sign profile cover for user %s: %v", userID, err)
		http.Error(w, `{"error":"Could not load profile images"}`, http.StatusBadGateway)
		return
	}
	for i := range settings.Photos {
		if settings.Photos[i], err = presignMediaURL(r.Context(), h.Storage, settings.Photos[i]); err != nil {
			log.Printf("[SETTINGS] Could not sign profile photo for user %s: %v", userID, err)
			http.Error(w, `{"error":"Could not load profile images"}`, http.StatusBadGateway)
			return
		}
	}

	json.NewEncoder(w).Encode(settings)
}

func isPresignedMediaURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	query := parsed.Query()
	return query.Has("X-Amz-Signature") || query.Has("X-Amz-Credential")
}

func (h *SettingsHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		log.Println("CRITICAL 401: user_id missing from request context in UpdateSettings!")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrUnauthorizedMissingContext", "Unauthorized: Missing context")})
		return
	}

	var payload models.SettingsPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrInvalidPayload", "Invalid payload")})
		return
	}
	payload.PreserveAvatar = payload.AvatarStorageURL == "" && isPresignedMediaURL(payload.Avatar)
	payload.PreserveCover = payload.CoverStorageURL == "" && isPresignedMediaURL(payload.Cover)
	if payload.Privacy["incognito"] {
		allowed, err := h.Repo.CanUseIncognito(r.Context(), userID)
		if err != nil {
			log.Printf("[SETTINGS] Failed to verify Incognito entitlement for %s: %v", userID, err)
			http.Error(w, `{"error":"Could not verify Premium access"}`, http.StatusInternalServerError)
			return
		}
		if !allowed {
			http.Error(w, `{"error":"An active Premium membership is required for Incognito Mode"}`, http.StatusPaymentRequired)
			return
		}
	}

	if err := h.Repo.UpdateSettings(userID, payload); err != nil {
		log.Printf("500 Error in UpdateSettings for user %s: %v\n", userID, err)
		if errors.Is(err, repository.ErrInvalidDiscoveryPreferences) {
			http.Error(w, `{"error":"Invalid matching preferences"}`, http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedUpdateSettings", "Failed to update settings")})
		return
	}

	ActionLogQueue <- models.ActionLog{
		UserID:     userID,
		ActionType: "PROFILE_UPDATE",
		IP:         r.RemoteAddr,
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Settings saved successfully"})
}

func (h *SettingsHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	if err := h.Repo.DeleteAccount(userID); err != nil {
		log.Printf("500 Error deleting account for user %s: %v\n", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedDeleteAccount", "Failed to delete account")})
		return
	}

	ActionLogQueue <- models.ActionLog{
		UserID:     userID,
		ActionType: "ACCOUNT_DELETED",
		IP:         r.RemoteAddr,
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgAccountTerminated", "Account terminated")})
}

// ============================================================================
// MEDIA VAULT
// ============================================================================

func (h *SettingsHandler) GetMediaVault(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, no-store")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrUnauthorized", "Unauthorized")})
		return
	}

	media, err := h.Repo.GetUserMedia(userID)
	if err != nil {
		log.Printf("500 Error fetching media vault for user %s: %v\n", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedFetchMediaVault", "Failed to fetch media vault")})
		return
	}
	for i := range media {
		media[i].URL, err = presignMediaURL(r.Context(), h.Storage, media[i].URL)
		if err != nil {
			log.Printf("[SETTINGS] Could not sign media vault image for user %s: %v", userID, err)
			http.Error(w, `{"error":"Could not load media vault images"}`, http.StatusBadGateway)
			return
		}
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(media)
}

func (h *SettingsHandler) UploadMedia(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrUnauthorized", "Unauthorized")})
		return
	}

	// 1. Limit Memory footprint
	const maxImageSize = 10 << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxImageSize+(1<<20))
	err := r.ParseMultipartForm(maxImageSize)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFileTooLargeInvalidForm", "File too large or invalid form")})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFileRetrieval", "Error retrieving file")})
		return
	}
	defer file.Close()
	if header.Size <= 0 || header.Size > maxImageSize {
		http.Error(w, `{"error":"Image must be smaller than 10 MB"}`, http.StatusRequestEntityTooLarge)
		return
	}
	sniff := make([]byte, 512)
	n, readErr := file.Read(sniff)
	if readErr != nil && readErr != io.EOF {
		http.Error(w, `{"error":"Could not read uploaded image"}`, http.StatusBadRequest)
		return
	}
	if !strings.HasPrefix(http.DetectContentType(sniff[:n]), "image/") {
		http.Error(w, `{"error":"Only image files are supported"}`, http.StatusUnsupportedMediaType)
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		http.Error(w, `{"error":"Could not process uploaded image"}`, http.StatusBadRequest)
		return
	}

	// 2. Delegate to your distinct UploadService (Zero local disk I/O if using Backblaze)
	fileURL, _, err := h.Storage.SaveFile(file, header, "vault")
	if err != nil {
		log.Printf("[UPLOAD ERROR] Engine failed to save file: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedSaveFile", "Failed to save file")})
		return
	}

	// 3. Save the resulting public URL to your DB
	media, err := h.Repo.SaveUserMedia(userID, fileURL)
	if err != nil {
		if deleteErr := h.Storage.DeleteFile(fileURL); deleteErr != nil {
			log.Printf("[UPLOAD CLEANUP] Could not remove unreferenced media after database failure: %v", deleteErr)
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedLogFile", "Failed to log file to database")})
		return
	}
	media.URL, err = presignMediaURL(r.Context(), h.Storage, media.URL)
	if err != nil {
		log.Printf("[SETTINGS] Uploaded media but could not sign response URL for user %s: %v", userID, err)
		http.Error(w, `{"error":"Image uploaded but could not be displayed"}`, http.StatusBadGateway)
		return
	}

	ActionLogQueue <- models.ActionLog{
		UserID:     userID,
		ActionType: "MEDIA_UPLOAD",
		IP:         r.RemoteAddr,
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":     "File uploaded successfully",
		"id":          media.ID,
		"url":         media.URL,
		"storage_url": fileURL,
		"is_primary":  media.IsPrimary,
	})
}

func (h *SettingsHandler) DeleteMedia(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	mediaID := chi.URLParam(r, "media_id")
	if mediaID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrMediaIdRequired", "Media ID is required")})
		return
	}

	if err := h.Repo.DeleteUserMedia(userID, mediaID); err != nil {
		log.Printf("500 Error deleting media %s for user %s: %v\n", mediaID, userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedDeleteMedia", "Failed to delete media")})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgMediaDeleted", "Media deleted successfully")})
}

func (h *SettingsHandler) SetPrimaryMedia(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	mediaID := chi.URLParam(r, "media_id")
	if mediaID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrMediaIdRequired", "Media ID is required")})
		return
	}

	if err := h.Repo.SetPrimaryMedia(userID, mediaID); err != nil {
		log.Printf("500 Error setting primary media %s for user %s: %v\n", mediaID, userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedSetPrimaryPicture", "Failed to set primary profile picture")})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgProfilePictureUpdated", "Profile picture updated!")})
}

// ============================================================================
// MODAL ACTIONS (DATA, VERIFICATION, SESSIONS, BLOCKS)
// ============================================================================

func (h *SettingsHandler) RequestDataDownload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	jobID := fmt.Sprintf("export_%d", time.Now().Unix())
	log.Printf("[DATA EXPORT] Started export job %s for user %s", jobID, userID)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Your gorgeous data dossier is compiling. You will receive an email shortly.",
		"job_id":  jobID,
	})

	go func(uid, jID string) {
		log.Printf("[DATA EXPORT] Processing background worker for Job %s (User: %s)", jID, uid)
		detachedCtx := context.WithoutCancel(r.Context())

		user, err := h.Repo.GetUserByID(uid)
		if err != nil || user.Email == "" {
			return
		}

		settings, _ := h.Repo.GetSettings(uid)
		messages, _ := h.Repo.GetAllUserMessages(uid)
		matches, _ := h.Repo.GetUserMatches(uid)

		data := map[string]interface{}{
			"ExportDate": time.Now().Format("January 02, 2006 at 15:04:05 MST"),
			"UserID":     uid,
			"Settings":   settings,
			"Messages":   messages,
			"Matches":    matches,
			"MsgCount":   len(messages),
			"MatchCount": len(matches),
		}

		tmpl, err := template.ParseFiles("templates/data_export.html")
		if err != nil {
			log.Printf("[DATA EXPORT ERROR] Failed to parse HTML template: %v", err)
			return
		}

		var htmlBuffer bytes.Buffer
		if err := tmpl.Execute(&htmlBuffer, data); err != nil {
			log.Printf("[DATA EXPORT ERROR] Failed to execute HTML template: %v", err)
			return
		}

		pdfBytes, err := services.GeneratePDF(htmlBuffer.String())
		if err != nil {
			log.Printf("[DATA EXPORT ERROR] Chrome PDF Engine failed: %v", err)
			return
		}

		filename := fmt.Sprintf("chattie_data_dossier_%s.pdf", uid[:8])
		if err := h.Email.SendDataDossier(detachedCtx, user.Email, pdfBytes, filename, user.Username); err != nil {
			log.Printf("[DATA EXPORT ERROR] Failed to queue dossier email for %s: %v", uid, err)
			return
		}
		log.Printf("[DATA EXPORT] Successfully processed Job %s and emailed %s", jID, filename)

		h.Events.ProcessEvent(detachedCtx, services.AppEvent{
			RecipientID: uid,
			WSEventType: "SYSTEM_ALERT",
			WSPayload: map[string]string{
				"title":   "Export Complete",
				"message": "Your Data Dossier has been successfully generated and sent to your email.",
				"type":    "success",
			},
		})
	}(userID, jobID)
}

func (h *SettingsHandler) TerminateOtherSessions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	currentID, _ := r.Context().Value(middlewares.SessionIDKey).(string)
	ipAddress := services.ExtractClientIP(r)
	if net.ParseIP(ipAddress) == nil {
		ipAddress = ""
	}
	version, sessionID, err := h.Repo.TerminateOtherAuthSessions(
		r.Context(), userID, currentID, r.UserAgent(), ipAddress,
	)
	if err != nil {
		log.Printf("[SETTINGS] Failed to terminate other sessions for %s: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedTerminateSessions", "Failed to terminate sessions")})
		return
	}
	role, _ := r.Context().Value(middlewares.RoleKey).(string)
	if role == "" {
		role = "client"
	}
	token, err := middlewares.GenerateAuthTokenWithSession(userID, role, version, sessionID)
	if err != nil {
		log.Printf("[SETTINGS] Failed to refresh current session for %s: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to refresh current session"})
		return
	}

	detachedCtx := context.WithoutCancel(r.Context())
	go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
		RecipientID: userID,
		WSEventType: "SYSTEM_ALERT",
		WSPayload: map[string]string{
			"title":   "Security Update",
			"message": "All other devices have been securely logged out.",
			"type":    "info",
		},
	})

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": localized(r.Context(), "MsgOtherDevicesLoggedOut", "All other devices have been logged out."),
		"token":   token,
	})
}

func (h *SettingsHandler) GetActiveSessions(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	currentID, _ := r.Context().Value(middlewares.SessionIDKey).(string)
	sessions, err := h.Repo.ListAuthSessions(r.Context(), userID, currentID)
	if err != nil {
		log.Printf("[SETTINGS] Failed to list sessions for %s: %v", userID, err)
		http.Error(w, "Could not load active sessions", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(sessions)
}

func (h *SettingsHandler) RevokeActiveSession(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	sessionID := chi.URLParam(r, "sessionId")
	if sessionID == "" {
		http.Error(w, "Session ID is required", http.StatusBadRequest)
		return
	}
	currentID, _ := r.Context().Value(middlewares.SessionIDKey).(string)
	if sessionID == currentID {
		http.Error(w, "Use sign out to end the current session", http.StatusBadRequest)
		return
	}
	revoked, err := h.Repo.RevokeAuthSession(r.Context(), userID, sessionID)
	if err != nil {
		log.Printf("[SETTINGS] Failed to revoke session for %s: %v", userID, err)
		http.Error(w, "Could not revoke session", http.StatusInternalServerError)
		return
	}
	if !revoked {
		http.Error(w, "Session was not found or is already revoked", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *SettingsHandler) GetBlockedUsers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	users, err := h.Repo.GetBlockedUsers(userID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedFetchBlockedUsers", "Failed to fetch blocked users")})
		return
	}
	json.NewEncoder(w).Encode(users)
}

func (h *SettingsHandler) UnblockUser(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	blockedID := chi.URLParam(r, "id")
	if err := h.Repo.UnblockUser(userID, blockedID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedUnblockUser", "Failed to unblock user")})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgUserUnblocked", "User unblocked")})
}
