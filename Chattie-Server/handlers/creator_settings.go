package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func (h *CreatorHandler) GetModelSettings(w http.ResponseWriter, r *http.Request) {
	modelID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || modelID == "" {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	settings, err := h.Repo.GetModelSettings(r.Context(), modelID)
	if err != nil {
		log.Printf("Failed to load model settings for %s: %v", modelID, err)
		sendError(w, http.StatusInternalServerError, "Failed to load model settings")
		return
	}
	sendJSON(w, http.StatusOK, settings)
}

func (h *CreatorHandler) UpdateModelSettings(w http.ResponseWriter, r *http.Request) {
	modelID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || modelID == "" {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	var payload models.UpdateModelSettingsRequest
	if err := decodeModelSettingsJSON(w, r, &payload, 1024); err != nil || payload.AIDraftsEnabled == nil {
		sendError(w, http.StatusBadRequest, "Invalid model settings")
		return
	}
	if err := h.Repo.UpdateModelAIDrafts(r.Context(), modelID, *payload.AIDraftsEnabled); err != nil {
		if errors.Is(err, repository.ErrInvalidModelRole) {
			sendError(w, http.StatusForbidden, "Model account required")
			return
		}
		log.Printf("Failed to update model settings for %s: %v", modelID, err)
		sendError(w, http.StatusInternalServerError, "Failed to save model settings")
		return
	}

	settings, err := h.Repo.GetModelSettings(r.Context(), modelID)
	if err != nil {
		log.Printf("Model settings saved but could not be reloaded for %s: %v", modelID, err)
		sendError(w, http.StatusInternalServerError, "Settings saved but could not be reloaded")
		return
	}
	sendJSON(w, http.StatusOK, settings)
}

func (h *CreatorHandler) UpdateManagedProfileDetails(w http.ResponseWriter, r *http.Request) {
	modelID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || modelID == "" {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	profileID := chi.URLParam(r, "profile_id")
	if _, err := uuid.Parse(profileID); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid profile ID")
		return
	}

	var payload models.UpdateManagedProfileRequest
	if err := decodeModelSettingsJSON(w, r, &payload, 16<<10); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid profile details")
		return
	}
	payload.Name = strings.TrimSpace(payload.Name)
	payload.AvatarURL = strings.TrimSpace(payload.AvatarURL)
	payload.Bio = strings.TrimSpace(payload.Bio)
	if err := validateManagedProfileDetails(payload); err != nil {
		sendError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.Repo.UpdateManagedProfileDetails(r.Context(), modelID, profileID, payload); err != nil {
		if errors.Is(err, repository.ErrManagedProfileNotFound) {
			sendError(w, http.StatusNotFound, "Assigned profile not found")
			return
		}
		log.Printf("Failed to update managed profile %s for model %s: %v", profileID, modelID, err)
		sendError(w, http.StatusInternalServerError, "Failed to update profile details")
		return
	}
	sendJSON(w, http.StatusOK, map[string]string{
		"id":         profileID,
		"name":       payload.Name,
		"avatar_url": payload.AvatarURL,
		"bio":        payload.Bio,
	})
}

func decodeModelSettingsJSON(w http.ResponseWriter, r *http.Request, destination interface{}, maxBytes int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing interface{}
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return fmt.Errorf("request must contain exactly one JSON value")
	}
	return nil
}

func validateManagedProfileDetails(payload models.UpdateManagedProfileRequest) error {
	if length := utf8.RuneCountInString(payload.Name); length < 2 || length > 50 {
		return fmt.Errorf("profile name must be between 2 and 50 characters")
	}
	if utf8.RuneCountInString(payload.Bio) > 500 {
		return fmt.Errorf("profile bio must be 500 characters or fewer")
	}
	if len(payload.AvatarURL) > 500 {
		return fmt.Errorf("avatar URL must be 500 characters or fewer")
	}
	avatarURL, err := url.ParseRequestURI(payload.AvatarURL)
	if err != nil || avatarURL.Scheme != "https" || avatarURL.Hostname() == "" || avatarURL.User != nil {
		return fmt.Errorf("avatar URL must be a valid HTTPS URL")
	}
	return nil
}
