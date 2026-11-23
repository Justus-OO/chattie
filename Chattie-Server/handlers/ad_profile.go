package handlers

import (
	"encoding/json"
	"net/http"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"
)

type ADProfileHandler struct {
	Repo          *repository.ADProfileRepository
	UploadService *services.UploadService
}

func NewADProfileHandler(repo *repository.ADProfileRepository, uploadService *services.UploadService) *ADProfileHandler {
	return &ADProfileHandler{Repo: repo, UploadService: uploadService}
}

// GET /api/afterdark/me/creator-profile
func (h *ADProfileHandler) GetMyPerformerProfile(w http.ResponseWriter, r *http.Request) {
	// 1. Authenticate user from session (Invariant #1)
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	// 2. Fetch the profile
	profile, err := h.Repo.GetPerformerProfile(r.Context(), userID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFetchProfile", "Failed to fetch profile"), http.StatusInternalServerError)
		return
	}

	// 3. Handle empty state
	if profile == nil {
		http.Error(w, localized(r.Context(), "ErrProfileNotFound", "Performer profile not found"), http.StatusNotFound)
		return
	}
	if err := presignPerformerProfileMedia(r.Context(), h.UploadService, profile); err != nil {
		http.Error(w, localized(r.Context(), "ErrFetchProfile", "Failed to fetch profile images"), http.StatusBadGateway)
		return
	}

	// 4. Return JSON
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profile)
}

// PATCH /api/afterdark/me/creator-profile
func (h *ADProfileHandler) UpdateMyPerformerProfile(w http.ResponseWriter, r *http.Request) {
	// 1. Authenticate user
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	// 2. Decode the request body specifically for what the frontend sends
	var req struct {
		DisplayName            string  `json:"display_name"`
		Username               string  `json:"username"`
		Bio                    string  `json:"bio"`
		Website                string  `json:"website"`
		Location               string  `json:"location"`
		DMControl              string  `json:"dm_control"`
		SubscriptionPriceCents *int64  `json:"subscription_price_cents"`
		WelcomeMessage         *string `json:"welcome_message"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBody", "Invalid request body"), http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	// 3. Map it to the model
	profile := &models.PerformerProfile{
		UserID:      userID,
		DisplayName: req.DisplayName,
		Username:    req.Username,
		Bio:         req.Bio,
		Website:     req.Website,
		Location:    req.Location,
		DMControl:   req.DMControl,
	}
	if req.SubscriptionPriceCents != nil {
		if *req.SubscriptionPriceCents < 0 {
			http.Error(w, localized(r.Context(), "ErrSubscriptionPriceCannotBeNegative", "Subscription price cannot be negative"), http.StatusBadRequest)
			return
		}
		profile.SubscriptionPriceCents = *req.SubscriptionPriceCents
	}
	profile.SubscriptionPriceCentsProvided = req.SubscriptionPriceCents != nil
	if req.WelcomeMessage != nil {
		profile.WelcomeMessage = *req.WelcomeMessage
		profile.WelcomeMessageProvided = true
	}

	// 4. Save via Repository
	if err := h.Repo.UpsertPerformerProfile(r.Context(), profile); err != nil {
		http.Error(w, localized(r.Context(), "ErrUpdateProfile", "Failed to update profile"), http.StatusInternalServerError)
		return
	}

	// 5. Return success
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "success",
		"message": localized(r.Context(), "MsgProfileUpdated", "Profile updated successfully"),
	})
}

// GET /api/afterdark/me/subscribers
func (h *ADProfileHandler) GetSubscribers(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	subscribers, err := h.Repo.GetSubscribers(r.Context(), userID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToFetchSubscribers", "Failed to fetch subscribers"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(subscribers)
}
