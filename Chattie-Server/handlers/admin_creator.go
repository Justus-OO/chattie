package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/go-chi/chi/v5"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

type AdminCreatorHandler struct {
	Repo   *repository.Repository
	Events *services.EventHandler // For operator notifications
}

func NewAdminCreatorHandler(repo *repository.Repository, events *services.EventHandler) *AdminCreatorHandler {
	return &AdminCreatorHandler{
		Repo:   repo,
		Events: events,
	}
}

func sendAdminJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func sendAdminError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// GetAdminRoster handles GET /api/admin/operators
func (h *AdminCreatorHandler) GetAdminRoster(w http.ResponseWriter, r *http.Request) {
	operators, err := h.Repo.GetOperatorRoster(r.Context())
	if err != nil {
		log.Printf("Error fetching operator roster: %v", err)
		sendAdminError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedLoadRoster", "Failed to load roster"))
		return
	}
	sendAdminJSON(w, http.StatusOK, operators)
}

// UpdateCommission handles PATCH /api/admin/operators/{id}/commission
func (h *AdminCreatorHandler) UpdateCommission(w http.ResponseWriter, r *http.Request) {
	operatorID := chi.URLParam(r, "id")

	var payload struct {
		Rate float64 `json:"rate"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidPayload", "Invalid payload"))
		return
	}

	if payload.Rate < 0 || payload.Rate > 100 {
		sendAdminError(w, http.StatusBadRequest, localized(r.Context(), "ErrCommissionRateRange", "Commission rate must be between 0 and 100"))
		return
	}

	err := h.Repo.UpdateOperatorCommission(r.Context(), operatorID, payload.Rate)
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedUpdateCommission", "Failed to update commission"))
		return
	}

	sendAdminJSON(w, http.StatusOK, map[string]string{"message": localized(r.Context(), "MsgCommissionUpdated", "Commission rate updated successfully")})
}

// UpdateOperatorStatus handles PATCH /api/admin/operators/{id}/status (Overrides & Suspensions)
func (h *AdminCreatorHandler) UpdateOperatorStatus(w http.ResponseWriter, r *http.Request) {
	operatorID := chi.URLParam(r, "id")
	var payload models.StatusUpdateRequest

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidRequestPayload", "Invalid request payload"))
		return
	}

	// Validate status
	if payload.Status != "ONLINE" && payload.Status != "OFFLINE" && payload.Status != "SUSPENDED" {
		sendAdminError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidStatusState", "Invalid status state"))
		return
	}

	if err := h.Repo.UpdateOperatorStatus(r.Context(), operatorID, payload.Status); err != nil {
		sendAdminError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedUpdateStatus", "Failed to update status"))
		return
	}

	// Notify operator of status change if it's a significant action
	if payload.Status == "SUSPENDED" {
		// FIX: Use r.Context() to get the request's context before detaching
		detachedCtx := context.WithoutCancel(r.Context())

		go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
			RecipientID:   operatorID,
			WSEventType:   "OPERATOR_SUSPENDED",
			WSPayload:     map[string]interface{}{"status": payload.Status},
			EmailTemplate: "operator_suspended",
		})

	} else if payload.Status == "ONLINE" {
		// ActionLogQueue <- models.ActionLog{
		// 	UserID:     operatorID,
		// 	ActionType: "OPERATOR_ACTIVATED",
		// 	IP:         r.RemoteAddr,
		// }
	}

	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Status updated successfully"})
}

// ToggleAutoPilot handles PATCH /api/admin/operators/{id}/autopilot
func (h *AdminCreatorHandler) ToggleAutoPilot(w http.ResponseWriter, r *http.Request) {
	operatorID := chi.URLParam(r, "id")
	var payload models.AutoPilotRequest

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidRequestPayload", "Invalid request payload"))
		return
	}

	if err := h.Repo.ToggleOperatorAutoPilot(r.Context(), operatorID, payload.Active); err != nil {
		sendAdminError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedToggleAutoPilot", "Failed to toggle AI auto-pilot"))
		return
	}

	sendAdminJSON(w, http.StatusOK, map[string]string{"message": localized(r.Context(), "MsgAutoPilotUpdated", "Auto-Pilot state updated")})
}

// BindPersona handles POST /api/admin/operators/{id}/personas/{personaId}
func (h *AdminCreatorHandler) BindPersona(w http.ResponseWriter, r *http.Request) {
	operatorID := chi.URLParam(r, "id")
	personaID := chi.URLParam(r, "personaId")
	if operatorID == "" || personaID == "" {
		sendAdminError(w, http.StatusBadRequest, "Operator and profile IDs are required")
		return
	}

	err := h.Repo.BindPersonaToOperator(r.Context(), operatorID, personaID)
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrOperatorNotFound), errors.Is(err, repository.ErrPersonaNotFound):
			sendAdminError(w, http.StatusNotFound, "Operator or profile not found")
		case errors.Is(err, repository.ErrInvalidOperatorRole):
			sendAdminError(w, http.StatusBadRequest, "This account cannot manage profiles")
		case errors.Is(err, repository.ErrOperatorProfileLimit):
			sendAdminError(w, http.StatusConflict, "A creator cannot manage more than eight profiles at once")
		case errors.Is(err, repository.ErrPersonaAlreadyAssigned):
			sendAdminError(w, http.StatusConflict, "This profile has already been assigned. Refresh and try again.")
		default:
			log.Printf("Failed to assign profile %s to operator %s: %v", personaID, operatorID, err)
			sendAdminError(w, http.StatusInternalServerError, "Failed to assign profile")
		}
		return
	}

	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Persona bound successfully"})
}

// UnbindPersona handles DELETE /api/admin/operators/{id}/personas/{personaId}
func (h *AdminCreatorHandler) UnbindPersona(w http.ResponseWriter, r *http.Request) {
	operatorID := chi.URLParam(r, "id")
	personaID := chi.URLParam(r, "personaId")
	if operatorID == "" || personaID == "" {
		sendAdminError(w, http.StatusBadRequest, "Operator and profile IDs are required")
		return
	}

	if err := h.Repo.UnbindPersonaFromOperator(r.Context(), operatorID, personaID); err != nil {
		if errors.Is(err, repository.ErrAssignmentNotFound) {
			sendAdminError(w, http.StatusNotFound, "This profile is not assigned to that operator")
			return
		}
		log.Printf("Failed to unassign profile %s from operator %s: %v", personaID, operatorID, err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to unassign profile")
		return
	}
	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Persona unbound successfully"})
}

func (h *AdminCreatorHandler) NotifyOperatorPendingReplies(w http.ResponseWriter, r *http.Request) {
	operatorID := chi.URLParam(r, "id")
	if operatorID == "" {
		sendAdminError(w, http.StatusBadRequest, "Operator ID is required")
		return
	}

	pendingReplies, err := h.Repo.GetOperatorPendingReplyCount(r.Context(), operatorID)
	if errors.Is(err, repository.ErrOperatorNotFound) {
		sendAdminError(w, http.StatusNotFound, "Creator not found")
		return
	}
	if err != nil {
		log.Printf("Failed to count pending creator replies for %s: %v", operatorID, err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to check pending replies")
		return
	}
	if pendingReplies == 0 {
		sendAdminError(w, http.StatusConflict, "This creator has no conversations awaiting a reply")
		return
	}
	if h.Events == nil {
		sendAdminError(w, http.StatusServiceUnavailable, "Creator notifications are unavailable")
		return
	}

	h.Events.ProcessEvent(r.Context(), services.AppEvent{
		RecipientID: operatorID,
		WSEventType: "CREATOR_REPLY_REMINDER",
		WSPayload: map[string]interface{}{
			"title":           "Client conversations need replies",
			"message":         fmt.Sprintf("%d client conversation(s) across your assigned profiles are awaiting a reply.", pendingReplies),
			"pending_replies": pendingReplies,
		},
	})
	sendAdminJSON(w, http.StatusOK, map[string]interface{}{
		"message":        "Reply reminder sent",
		"pendingReplies": pendingReplies,
	})
}

// GetPersonasMetrics handles GET /api/admin/personas-metrics
func (h *AdminCreatorHandler) GetPersonasMetrics(w http.ResponseWriter, r *http.Request) {
	if err := h.Repo.EnsurePersonaManagedProfiles(r.Context()); err != nil {
		log.Printf("Error repairing managed profiles for persona accounts: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to prepare persona profiles")
		return
	}
	metrics, err := h.Repo.GetManagedPersonasMetrics(r.Context())
	if err != nil {
		log.Printf("Error fetching managed profile metrics: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to load persona metrics")
		return
	}
	sendAdminJSON(w, http.StatusOK, metrics)
}

// CreateCreatorAccount provisions a model/creator account directly from the admin panel
func (h *AdminCreatorHandler) CreateCreatorAccount(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		sendAdminError(w, http.StatusUnauthorized, localized(r.Context(), "ErrUnauthorized", "Unauthorized"))
		return
	}

	var payload models.AdminCreateCreatorRequest
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidRequestPayload", "Invalid request payload"))
		return
	}

	payload.Email = strings.TrimSpace(payload.Email)
	payload.Username = strings.TrimSpace(payload.Username)
	payload.DisplayName = strings.TrimSpace(payload.DisplayName)
	payload.Gender = strings.ToLower(strings.TrimSpace(payload.Gender))
	if payload.Email == "" || payload.Username == "" || payload.Password == "" ||
		payload.DisplayName == "" || payload.Gender == "" || payload.DateOfBirth == "" {
		sendAdminError(w, http.StatusBadRequest, "Display name, email, username, password, gender, and date of birth are required")
		return
	}
	if utf8.RuneCountInString(payload.DisplayName) > 50 {
		sendAdminError(w, http.StatusBadRequest, "Display name must be 50 characters or fewer")
		return
	}
	if payload.Gender != "male" && payload.Gender != "female" && payload.Gender != "other" {
		sendAdminError(w, http.StatusBadRequest, "Gender must be male, female, or other")
		return
	}
	birthDate, err := time.Parse("2006-01-02", payload.DateOfBirth)
	if err != nil {
		sendAdminError(w, http.StatusBadRequest, "Date of birth must use YYYY-MM-DD format")
		return
	}
	if birthDate.After(time.Now().AddDate(-18, 0, 0)) {
		sendAdminError(w, http.StatusBadRequest, "Creator must be at least 18 years old")
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(payload.Password), bcrypt.DefaultCost)
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to process credentials")
		return
	}

	ctx := r.Context()
	tx, err := h.Repo.DB.BeginTx(ctx, nil)
	if err != nil {
		log.Printf("Failed to start creator provisioning transaction: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to provision creator account")
		return
	}
	defer tx.Rollback()
	var userID string
	err = tx.QueryRowContext(ctx, `
       INSERT INTO users (email, username, password_hash, role, status)
       VALUES ($1, $2, $3, 'model', 'active')
       RETURNING id::text
    `, payload.Email, payload.Username, string(hashedPassword)).Scan(&userID)

	if err != nil {
		var postgresError *pq.Error
		if errors.As(err, &postgresError) && postgresError.Code == "23505" {
			sendAdminError(w, http.StatusConflict, "Email or username already exists")
			return
		}
		log.Printf("Failed to create creator login: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to create creator login")
		return
	}

	_, err = tx.ExecContext(ctx, `
       INSERT INTO user_profiles (user_id, display_name, date_of_birth, gender, bio, avatar_url, intent, verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
    `, userID, payload.DisplayName, birthDate, payload.Gender, payload.Bio, payload.AvatarURL, payload.Intent)

	if err != nil {
		log.Printf("Failed to create creator profile metadata: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to create creator profile metadata")
		return
	}

	_, err = tx.ExecContext(ctx, `
       INSERT INTO creator_stats (user_id, current_balance, total_earned, is_online)
       VALUES ($1, 0.00, 0.00, FALSE)
       ON CONFLICT (user_id) DO NOTHING
    `, userID)
	if err != nil {
		log.Printf("Failed to initialize creator stats: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to initialize creator stats")
		return
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO operator_profiles (user_id) VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING
	`, userID)
	if err != nil {
		log.Printf("Failed to initialize operator settings: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to initialize operator settings")
		return
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Failed to commit creator provisioning transaction: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to provision creator account")
		return
	}
	sendAdminJSON(w, http.StatusCreated, map[string]string{
		"message": "Creator account provisioned successfully",
		"user_id": userID,
	})
}

// CreatePersona handles POST /api/admin/personas
func (h *AdminCreatorHandler) CreatePersona(w http.ResponseWriter, r *http.Request) {
	var payload models.CreatePersonaRequest
	defer r.Body.Close()

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	if err := validatePersonaRequest(&payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, err.Error())
		return
	}

	newID, err := h.Repo.CreatePersona(r.Context(), payload)
	if err != nil {
		if errors.Is(err, repository.ErrInvalidDiscoveryPreferences) {
			sendAdminError(w, http.StatusBadRequest, "Select between 3 and 7 unique interests")
			return
		}
		log.Printf("CRITICAL: Failed to provision new persona: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to provision persona account. Check server logs for the failing setup step.")
		return
	}

	sendAdminJSON(w, http.StatusCreated, map[string]string{
		"id":      newID,
		"message": "Persona provisioned successfully",
	})
}

func validatePersonaRequest(payload *models.CreatePersonaRequest) error {
	payload.Name = strings.TrimSpace(payload.Name)
	payload.Archetype = strings.TrimSpace(payload.Archetype)
	payload.AvatarURL = strings.TrimSpace(payload.AvatarURL)
	payload.Bio = strings.TrimSpace(payload.Bio)
	payload.Gender = strings.ToLower(strings.TrimSpace(payload.Gender))
	payload.DateOfBirth = strings.TrimSpace(payload.DateOfBirth)
	payload.City = strings.TrimSpace(payload.City)
	payload.Country = strings.TrimSpace(payload.Country)
	payload.CountryCode = strings.ToUpper(strings.TrimSpace(payload.CountryCode))

	if utf8.RuneCountInString(payload.Name) < 2 {
		return fmt.Errorf("persona name must be at least 2 characters")
	}
	if utf8.RuneCountInString(payload.Name) > 50 {
		return fmt.Errorf("persona name must be 50 characters or fewer")
	}
	if payload.Archetype == "" {
		payload.Archetype = "General"
	}
	if utf8.RuneCountInString(payload.Archetype) > 50 {
		return fmt.Errorf("persona archetype must be 50 characters or fewer")
	}
	if payload.AvatarURL == "" {
		return fmt.Errorf("a primary avatar image is required for discovery")
	}
	if len(payload.AvatarURL) > 500 {
		return fmt.Errorf("persona avatar URL must be 500 characters or fewer")
	}
	switch payload.Gender {
	case "female", "male":
	case "non-binary", "nonbinary", "other":
		payload.Gender = "other"
	default:
		return fmt.Errorf("select a valid persona gender")
	}
	if utf8.RuneCountInString(payload.Bio) < 10 {
		return fmt.Errorf("persona bio must be at least 10 characters")
	}
	if payload.City == "" || utf8.RuneCountInString(payload.City) > 100 {
		return fmt.Errorf("enter a city of 1 to 100 characters")
	}
	if payload.Country == "" || utf8.RuneCountInString(payload.Country) > 100 {
		return fmt.Errorf("enter a country of 1 to 100 characters")
	}
	if len(payload.CountryCode) != 2 || payload.CountryCode[0] < 'A' || payload.CountryCode[0] > 'Z' ||
		payload.CountryCode[1] < 'A' || payload.CountryCode[1] > 'Z' {
		return fmt.Errorf("enter a valid two-letter country code")
	}
	if payload.Latitude == nil || payload.Longitude == nil ||
		math.IsNaN(*payload.Latitude) || math.IsInf(*payload.Latitude, 0) ||
		math.IsNaN(*payload.Longitude) || math.IsInf(*payload.Longitude, 0) ||
		*payload.Latitude < -90 || *payload.Latitude > 90 ||
		*payload.Longitude < -180 || *payload.Longitude > 180 {
		return fmt.Errorf("enter valid latitude and longitude coordinates")
	}
	if *payload.Latitude == 0 && *payload.Longitude == 0 {
		return fmt.Errorf("the default 0,0 location cannot be used; enter the persona's actual location")
	}
	interests, err := repository.NormalizeOnboardingTags(payload.Interests)
	if err != nil {
		return fmt.Errorf("select between 3 and 7 unique interests")
	}
	payload.Interests = interests

	dateOfBirth, err := time.Parse("2006-01-02", payload.DateOfBirth)
	if err != nil {
		return fmt.Errorf("enter a valid persona date of birth")
	}
	now := time.Now()
	if dateOfBirth.After(now) {
		return fmt.Errorf("persona date of birth cannot be in the future")
	}
	age := now.Year() - dateOfBirth.Year()
	if now.Before(dateOfBirth.AddDate(age, 0, 0)) {
		age--
	}
	if age < 18 {
		return fmt.Errorf("persona must be at least 18 years old")
	}
	if payload.Height < 100 || payload.Height > 250 {
		return fmt.Errorf("persona height must be between 100 and 250 cm")
	}
	return nil
}
