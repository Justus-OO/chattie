package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"io" // FIX: Added missing io package
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"
)

type SettingsHandler struct {
	Repo         *repository.SettingsRepository
	Storage      *services.UploadService
	Email        *EmailHandler
	Verification *services.VerificationService
	Events       *services.EventHandler
}

// Updated Constructor to accept all dependencies safely
func NewSettingsHandler(
	repo *repository.SettingsRepository,
	storage *services.UploadService,
	emailHandler *EmailHandler,
	events *services.EventHandler,
	verification *services.VerificationService,
) *SettingsHandler {
	return &SettingsHandler{
		Repo:         repo,
		Storage:      storage,
		Email:        emailHandler,
		Verification: verification,
		Events:       events,
	}
}

// ============================================================================
// CORE PROFILE & SETTINGS
// ============================================================================

func (h *SettingsHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

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

	json.NewEncoder(w).Encode(settings)
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

	if err := h.Repo.UpdateSettings(userID, payload); err != nil {
		log.Printf("500 Error in UpdateSettings for user %s: %v\n", userID, err)
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
	err := r.ParseMultipartForm(10 << 20)
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

	// 2. Delegate to your distinct UploadService (Zero local disk I/O if using Backblaze)
	fileURL, _, err := h.Storage.SaveFile(file, header, "vault")
	if err != nil {
		log.Printf("[UPLOAD ERROR] Engine failed to save file: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedSaveFile", "Failed to save file")})
		return
	}

	// 3. Save the resulting public URL to your DB
	if err := h.Repo.SaveUserMedia(userID, fileURL); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedLogFile", "Failed to log file to database")})
		return
	}

	ActionLogQueue <- models.ActionLog{
		UserID:     userID,
		ActionType: "MEDIA_UPLOAD",
		IP:         r.RemoteAddr,
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":    "File uploaded successfully",
		"url":        fileURL,
		"is_primary": false,
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
		h.Email.SendDataDossier(r.Context(), user.Email, pdfBytes, filename)
		log.Printf("[DATA EXPORT] Successfully processed Job %s and emailed %s", jID, filename)

		detachedCtx := context.WithoutCancel(r.Context())
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

	err := h.Repo.IncrementTokenVersion(userID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedTerminateSessions", "Failed to terminate sessions")})
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
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgOtherDevicesLoggedOut", "All other devices have been logged out.")})
}

// ============================================================================
// 1. BASIC VERIFICATION (Selfie vs Primary Profile Picture)
// ============================================================================

func (h *SettingsHandler) VerifyProfile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	if err := r.ParseMultipartForm(5 << 20); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "File too large or invalid"})
		return
	}

	file, _, err := r.FormFile("selfie")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Live selfie image is required"})
		return
	}
	defer file.Close()

	liveSelfieBytes, err := io.ReadAll(file)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	primaryMediaURL, err := h.Repo.GetPrimaryMediaURL(userID)
	if err != nil || primaryMediaURL == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "You must have a primary profile picture to verify your account"})
		return
	}

	referenceBytes, err := h.Storage.GetFileBytes(r.Context(), primaryMediaURL)
	if err != nil {
		log.Printf("[VERIFICATION ERROR] Failed to fetch B2 image for user %s: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to fetch reference profile picture"})
		return
	}

	result, err := h.Verification.CompareFaces(r.Context(), referenceBytes, liveSelfieBytes)
	if err != nil {
		log.Printf("[VERIFICATION ERROR] User %s: %v", userID, err)
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": "Biometric analysis failed. Ensure faces are clearly visible."})
		return
	}

	if !result.IsMatch {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": "Facial verification failed. Images do not match."})
		return
	}

	if err := h.Repo.VerifyProfile(userID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update verification status"})
		return
	}

	ActionLogQueue <- models.ActionLog{
		UserID:     userID,
		ActionType: "PROFILE_VERIFIED_BASIC",
		IP:         r.RemoteAddr,
	}

	detachedCtx := context.WithoutCancel(r.Context())
	go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
		RecipientID: userID,
		WSEventType: "PROFILE_VERIFIED",
		WSPayload: map[string]string{
			"title":   "Verified!",
			"message": "Your biometrics were analyzed successfully. Your profile is now verified.",
			"type":    "success",
		},
	})

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Biometrics analyzed. Profile verified."})
}

// ============================================================================
// 2. FULL KYC VERIFICATION (Live Selfie vs Government ID + OCR)
// ============================================================================
// GetVerificationConfig serves the dynamic KYC rules to the frontend
func (h *SettingsHandler) GetVerificationConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	config, err := h.Repo.GetVerificationConfig()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to load verification rules"})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(config)
}

func (h *SettingsHandler) VerifyIdentityKYC(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	if err := r.ParseMultipartForm(10 << 20); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Files too large or invalid request format"})
		return
	}

	// 1. Grab Files & Headers (Headers are needed to upload to Storage later)
	idCardFile, idCardHeader, err := r.FormFile("id_card")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Government ID image is required for KYC"})
		return
	}
	defer idCardFile.Close()
	idCardBytes, _ := io.ReadAll(idCardFile)

	selfieFile, selfieHeader, err := r.FormFile("selfie")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Live selfie image is required"})
		return
	}
	defer selfieFile.Close()
	liveSelfieBytes, _ := io.ReadAll(selfieFile)

	user, err := h.Repo.GetUserByID(userID)
	if err != nil || user.Username == "" {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	// 2. Call AWS Rekognition
	kycRes, awsErr := h.Verification.VerifyGovernmentID(r.Context(), userID, idCardBytes, liveSelfieBytes)

	// 3. Determine if Automated Verification Failed
	var failureReason string
	if awsErr != nil {
		failureReason = awsErr.Error() // Catches blurriness, sunglasses, bad lighting, duplicates
	} else if !kycRes.IsFaceMatch {
		failureReason = "Facial mismatch between live selfie and Government ID"
	} else {
		nameParts := strings.Fields(user.Username)
		firstName := user.Username
		lastName := ""
		if len(nameParts) > 1 {
			firstName = nameParts[0]
			lastName = nameParts[len(nameParts)-1]
		}

		if !kycRes.CheckDocumentForName(firstName, lastName) {
			failureReason = fmt.Sprintf("OCR Name mismatch: Could not find '%s' on the ID document", user.Username)
		}
	}

	// ========================================================================
	// 4. THE FALLBACK: Route to Manual Admin Review instead of rejecting
	// ========================================================================
	if failureReason != "" {
		log.Printf("[KYC ROUTED TO MANUAL] User %s automated fail: %s", userID, failureReason)

		// Reset file pointers to the beginning so we can upload them to B2 Storage
		idCardFile.Seek(0, io.SeekStart)
		selfieFile.Seek(0, io.SeekStart)

		// Upload to your secure vault (ignoring upload errors here to ensure the user gets a response)
		idCardURL, _, _ := h.Storage.SaveFile(idCardFile, idCardHeader, "kyc_reviews")
		selfieURL, _, _ := h.Storage.SaveFile(selfieFile, selfieHeader, "kyc_reviews")

		// Log to database for Admin Queue
		h.Repo.SubmitForManualReview(userID, idCardURL, selfieURL, failureReason)

		w.WriteHeader(http.StatusOK) // Return 200 OK so frontend doesn't throw a red error
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "pending_review",
			"message": "Automated check couldn't verify images. Submitted for manual review.",
		})
		return
	}

	// ========================================================================
	// 5. SUCCESS: Lock in Verified Status
	// ========================================================================
	if err := h.Repo.VerifyProfileV2(userID, user.Username, kycRes.RawDocumentData); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	ActionLogQueue <- models.ActionLog{
		UserID:     userID,
		ActionType: "KYC_PASSED_FULL",
		IP:         r.RemoteAddr,
	}

	detachedCtx := context.WithoutCancel(r.Context())
	go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
		RecipientID: userID,
		WSEventType: "PROFILE_VERIFIED",
		WSPayload: map[string]string{
			"title":   "Identity Verified!",
			"message": "Your Government ID and biometrics were authenticated.",
			"type":    "success",
		},
	})

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "verified",
		"message": "Identity confirmed. Profile verified.",
	})
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
