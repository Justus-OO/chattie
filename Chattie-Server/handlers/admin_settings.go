package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"chattie-backend/middlewares"
	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

var regionalCountryCodePattern = regexp.MustCompile(`^[A-Z]{2}$`)

func (h *AdminHandler) GetAfterDarkAutoModeration(w http.ResponseWriter, r *http.Request) {
	enabled, err := h.Repo.GetAfterDarkAutoApprove(r.Context())
	if err != nil {
		log.Printf("Failed to load After Dark auto-moderation setting: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to load After Dark moderation setting")
		return
	}
	sendAdminJSON(w, http.StatusOK, map[string]bool{"auto_approve_new_posts": enabled})
}

func (h *AdminHandler) UpdateAfterDarkAutoModeration(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		sendAdminError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4<<10)
	var payload struct {
		Enabled *bool `json:"auto_approve_new_posts"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.Enabled == nil {
		sendAdminError(w, http.StatusBadRequest, "Provide auto_approve_new_posts as a boolean")
		return
	}
	if err := h.Repo.SetAfterDarkAutoApprove(r.Context(), adminID, *payload.Enabled); err != nil {
		log.Printf("Failed to update After Dark auto-moderation setting: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to update After Dark moderation setting")
		return
	}
	sendAdminJSON(w, http.StatusOK, map[string]bool{"auto_approve_new_posts": *payload.Enabled})
}

func (h *AdminHandler) GetRegionalCountries(w http.ResponseWriter, r *http.Request) {
	countries, err := h.Repo.GetRegionalCountries(r.Context())
	if err != nil {
		log.Printf("Failed to load regional countries: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to load regional settings")
		return
	}
	sendAdminJSON(w, http.StatusOK, countries)
}

func (h *AdminHandler) BlockRegionalCountry(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		sendAdminError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	var payload struct {
		CountryCode string `json:"country_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid country code payload")
		return
	}
	payload.CountryCode = strings.ToUpper(strings.TrimSpace(payload.CountryCode))
	if !regionalCountryCodePattern.MatchString(payload.CountryCode) || payload.CountryCode == "XX" || payload.CountryCode == "T1" {
		sendAdminError(w, http.StatusBadRequest, "Enter a valid two-letter country code")
		return
	}
	changed, err := h.Repo.BlockRegionalCountry(r.Context(), adminID, payload.CountryCode)
	if err != nil {
		log.Printf("Failed to block country %s: %v", payload.CountryCode, err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to block country")
		return
	}
	if h.Events != nil && h.Events.NotifService != nil {
		disconnected := h.Events.NotifService.DisconnectCountry(payload.CountryCode)
		if disconnected > 0 {
			log.Printf("Disconnected %d active WebSocket connections after blocking country %s", disconnected, payload.CountryCode)
		}
	}
	status := http.StatusOK
	if changed {
		status = http.StatusCreated
	}
	sendAdminJSON(w, status, map[string]interface{}{"country_code": payload.CountryCode, "blocked": true})
}

func (h *AdminHandler) UnblockRegionalCountry(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		sendAdminError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	countryCode := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "code")))
	if !regionalCountryCodePattern.MatchString(countryCode) || countryCode == "XX" || countryCode == "T1" {
		sendAdminError(w, http.StatusBadRequest, "Enter a valid two-letter country code")
		return
	}
	if _, err := h.Repo.UnblockRegionalCountry(r.Context(), adminID, countryCode); err != nil {
		log.Printf("Failed to unblock country %s: %v", countryCode, err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to unblock country")
		return
	}
	sendAdminJSON(w, http.StatusOK, map[string]interface{}{"country_code": countryCode, "blocked": false})
}

func (h *AdminHandler) GetModerationTerms(w http.ResponseWriter, r *http.Request) {
	terms, err := h.Repo.GetModerationTerms(r.Context())
	if err != nil {
		log.Printf("Failed to load moderation terms: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to load moderation terms")
		return
	}
	sendAdminJSON(w, http.StatusOK, terms)
}

func (h *AdminHandler) CreateModerationTerm(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		sendAdminError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	var payload struct {
		Word     string `json:"word"`
		Category string `json:"category"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid moderation term payload")
		return
	}
	payload.Word = strings.TrimSpace(payload.Word)
	payload.Category = strings.ToLower(strings.TrimSpace(payload.Category))
	if payload.Word == "" || utf8.RuneCountInString(payload.Word) > 255 ||
		strings.ContainsAny(payload.Word, "\r\n") {
		sendAdminError(w, http.StatusBadRequest, "Term must contain 1 to 255 characters on one line")
		return
	}
	if payload.Category != "social" && payload.Category != "profanity" {
		sendAdminError(w, http.StatusBadRequest, "Category must be social or profanity")
		return
	}
	if err := h.Repo.CreateModerationTerm(r.Context(), adminID, payload.Word, payload.Category); err != nil {
		if errors.Is(err, repository.ErrModerationTermExists) {
			sendAdminError(w, http.StatusConflict, "That moderation term already exists")
			return
		}
		log.Printf("Failed to create moderation term: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to add moderation term")
		return
	}
	if err := ReloadFilters(h.Repo.DB); err != nil {
		log.Printf("Moderation term was saved but filters could not be reloaded: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Term was saved, but moderation filters could not be reloaded")
		return
	}
	sendAdminJSON(w, http.StatusCreated, map[string]string{"message": "Moderation term added"})
}

func (h *AdminHandler) DeleteModerationTerm(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		sendAdminError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	termID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(termID); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid moderation term ID")
		return
	}
	if err := h.Repo.DeleteModerationTerm(r.Context(), adminID, termID); err != nil {
		if errors.Is(err, repository.ErrModerationTermMissing) {
			sendAdminError(w, http.StatusNotFound, "Moderation term not found")
			return
		}
		log.Printf("Failed to delete moderation term %s: %v", termID, err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to remove moderation term")
		return
	}
	if err := ReloadFilters(h.Repo.DB); err != nil {
		log.Printf("Moderation term was removed but filters could not be reloaded: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Term was removed, but moderation filters could not be reloaded")
		return
	}
	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Moderation term removed"})
}
