package handlers

import (
	"encoding/json"
	"net/http"

	"chattie-backend/models"
	"chattie-backend/repository"
)

type OnboardingHandler struct {
	Repo *repository.Repository
}

func NewOnboardingHandler(repo *repository.Repository) *OnboardingHandler {
	return &OnboardingHandler{Repo: repo}
}

// SetupProfile handles Step 2
func (h *OnboardingHandler) SetupProfile(w http.ResponseWriter, r *http.Request) {
	var profile models.UserProfile
	defer r.Body.Close()

	if err := json.NewDecoder(r.Body).Decode(&profile); err != nil {
		http.Error(w, "Invalid request payload", http.StatusBadRequest)
		return
	}

	// SECURITY UPGRADE: Extract the guaranteed user_id from the context.
	// This overwrites anything the client might have put in the JSON body.
	userID, ok := r.Context().Value("user_id").(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	profile.UserID = userID

	if err := h.Repo.CreateUserProfile(&profile); err != nil {
		http.Error(w, "Failed to save profile", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"message": "Profile saved successfully"})
}

// SetupLocation handles Step 3
func (h *OnboardingHandler) SetupLocation(w http.ResponseWriter, r *http.Request) {
	var loc models.UserLocation
	defer r.Body.Close()

	if err := json.NewDecoder(r.Body).Decode(&loc); err != nil {
		http.Error(w, "Invalid request payload", http.StatusBadRequest)
		return
	}

	// SECURITY UPGRADE
	userID, ok := r.Context().Value("user_id").(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	loc.UserID = userID

	if err := h.Repo.CreateUserLocation(&loc); err != nil {
		http.Error(w, "Failed to save location", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"message": "Location saved successfully"})
}

// SetupPreferences handles Step 4
func (h *OnboardingHandler) SetupPreferences(w http.ResponseWriter, r *http.Request) {
	var pref models.UserPreference
	defer r.Body.Close()

	if err := json.NewDecoder(r.Body).Decode(&pref); err != nil {
		http.Error(w, "Invalid request payload", http.StatusBadRequest)
		return
	}

	// SECURITY UPGRADE
	userID, ok := r.Context().Value("user_id").(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	pref.UserID = userID

	if err := h.Repo.CreateUserPreference(&pref); err != nil {
		http.Error(w, "Failed to save preferences", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"message": "Preferences saved successfully"})
}

// ActivateAccount handles the Final Step
func (h *OnboardingHandler) ActivateAccount(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	// SECURITY UPGRADE: We no longer need to decode a JSON payload for this route.
	// We get the ID securely and directly from the JWT.
	userID, ok := r.Context().Value("user_id").(string)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.Repo.ActivateUser(userID); err != nil {
		http.Error(w, "Failed to activate account", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Account fully activated and ready for matching"})
}
