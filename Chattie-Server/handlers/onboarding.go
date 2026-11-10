package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services" // REQUIRED for UploadService
)

type OnboardingHandler struct {
	Repo    *repository.Repository
	Email   *EmailHandler           // Injected Smart Email Handler
	Storage *services.UploadService // INJECTED: Required for photo upload
}

// NewOnboardingHandler now accepts the UploadService
func NewOnboardingHandler(repo *repository.Repository, emailHandler *EmailHandler, storage *services.UploadService) *OnboardingHandler {
	return &OnboardingHandler{
		Repo:    repo,
		Email:   emailHandler,
		Storage: storage,
	}
}

// SetupProfile handles Step 2
func (h *OnboardingHandler) SetupProfile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var profile models.UserProfile
	defer r.Body.Close()

	if err := json.NewDecoder(r.Body).Decode(&profile); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request payload"})
		return
	}

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	profile.UserID = userID

	if err := h.Repo.CreateUserProfile(&profile); err != nil {
		log.Printf("[ONBOARDING ERROR] Failed to save profile for user %s: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"message": "Profile saved successfully"})
}

// SetupLocation handles Step 3
func (h *OnboardingHandler) SetupLocation(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var loc models.UserLocation
	defer r.Body.Close()

	if err := json.NewDecoder(r.Body).Decode(&loc); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	loc.UserID = userID

	if err := h.Repo.CreateUserLocation(&loc); err != nil {
		log.Printf("[ONBOARDING ERROR] Failed to save location for user %s: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"message": "Location saved successfully"})
}

// SetupPreferences handles Step 4
func (h *OnboardingHandler) SetupPreferences(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var pref models.UserPreference
	defer r.Body.Close()

	if err := json.NewDecoder(r.Body).Decode(&pref); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	pref.UserID = userID

	if err := h.Repo.CreateUserPreference(&pref); err != nil {
		log.Printf("[ONBOARDING ERROR] Failed to save preferences for user %s: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"message": "Preferences saved successfully"})
}

// VerifyOTP handles Step 1.5: Proving identity before saving profile data
func (h *OnboardingHandler) VerifyOTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var payload struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	userID, _ := r.Context().Value(middlewares.UserIDKey).(string)

	// Verify against cache/DB
	isValid, err := h.Repo.ValidateOTP(r.Context(), userID, payload.Code)
	if err != nil || !isValid {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid or expired verification code"})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Identity verified"})
}

// SetupInitialMedia handles Step 5: Forcing at least one photo upload
func (h *OnboardingHandler) SetupInitialMedia(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	// 1. Parse Multipart Form (e.g., 10MB limit)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "File too large or invalid form data"})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Image file is required"})
		return
	}
	defer file.Close()

	// 2. Stream directly to Backblaze B2 using the injected UploadService
	fileURL, _, err := h.Storage.SaveFile(file, header, "vault")
	if err != nil {
		log.Printf("[ONBOARDING ERROR] Engine failed to save initial file for %s: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to upload image to storage"})
		return
	}

	// 3. Save the resulting public URL to the DB as the primary photo (true)
	if err := h.Repo.SaveUserMedia(userID, fileURL, true); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to link image to profile"})
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Initial photo uploaded successfully",
		"url":     fileURL,
	})
}

// ActivateAccount handles the Final Step with Hardened Security
func (h *OnboardingHandler) ActivateAccount(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	// SECURITY CHECK 1: Ensure user uploaded at least one photo
	mediaCount, _ := h.Repo.GetUserMediaCount(r.Context(), userID)
	if mediaCount == 0 {
		w.WriteHeader(http.StatusPreconditionFailed)
		json.NewEncoder(w).Encode(map[string]string{"error": "At least one profile photo is required to activate account"})
		return
	}

	// SECURITY CHECK 2: Capture Device & Consent Context
	consentData := models.ConsentLog{
		UserID:    userID,
		IPAddress: r.RemoteAddr,
		UserAgent: r.UserAgent(),
	}

	if err := h.Repo.ActivateUserSecure(r.Context(), userID, consentData); err != nil {
		log.Printf("[ONBOARDING ERROR] Failed to activate account for user %s: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	go func(uid string) {
		user, err := h.Repo.GetUserByID(r.Context(), uid)
		if err == nil && user.Email != "" {
			h.Email.SendWelcomeEmail(r.Context(), user.Email, user.Username)
		}
	}(userID)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Account fully activated securely"})
}
