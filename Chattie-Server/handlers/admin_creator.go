package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"
)

type AdminCreatorHandler struct {
	Repo *repository.Repository
}

func NewAdminCreatorHandler(repo *repository.Repository) *AdminCreatorHandler {
	return &AdminCreatorHandler{Repo: repo}
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
		sendAdminError(w, http.StatusInternalServerError, "Failed to load roster")
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
		sendAdminError(w, http.StatusBadRequest, "Invalid payload")
		return
	}

	if payload.Rate < 0 || payload.Rate > 100 {
		sendAdminError(w, http.StatusBadRequest, "Commission rate must be between 0 and 100")
		return
	}

	err := h.Repo.UpdateOperatorCommission(r.Context(), operatorID, payload.Rate)
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to update commission")
		return
	}

	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Commission rate updated successfully"})
}

// UpdateOperatorStatus handles PATCH /api/admin/operators/{id}/status (Overrides & Suspensions)
func (h *AdminCreatorHandler) UpdateOperatorStatus(w http.ResponseWriter, r *http.Request) {
	operatorID := chi.URLParam(r, "id")
	var payload models.StatusUpdateRequest

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	// Validate status
	if payload.Status != "ONLINE" && payload.Status != "OFFLINE" && payload.Status != "SUSPENDED" {
		sendAdminError(w, http.StatusBadRequest, "Invalid status state")
		return
	}

	if err := h.Repo.UpdateOperatorStatus(r.Context(), operatorID, payload.Status); err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to update status")
		return
	}

	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Status updated successfully"})
}

// ToggleAutoPilot handles PATCH /api/admin/operators/{id}/autopilot
func (h *AdminCreatorHandler) ToggleAutoPilot(w http.ResponseWriter, r *http.Request) {
	operatorID := chi.URLParam(r, "id")
	var payload models.AutoPilotRequest

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	if err := h.Repo.ToggleOperatorAutoPilot(r.Context(), operatorID, payload.Active); err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to toggle AI auto-pilot")
		return
	}

	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Auto-Pilot state updated"})
}

// BindPersona handles POST /api/admin/operators/{id}/personas/{personaId}
func (h *AdminCreatorHandler) BindPersona(w http.ResponseWriter, r *http.Request) {
	operatorID := chi.URLParam(r, "id")
	personaID := chi.URLParam(r, "personaId")

	err := h.Repo.BindPersonaToOperator(r.Context(), operatorID, personaID)
	if err != nil {
		// Catch our custom database rejection error
		if err.Error() == "persona already assigned or not found" {
			sendAdminError(w, http.StatusConflict, "This persona is already assigned to an operator")
			return
		}
		sendAdminError(w, http.StatusInternalServerError, "Failed to bind persona to operator")
		return
	}

	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Persona bound successfully"})
}

// UnbindPersona handles DELETE /api/admin/operators/{id}/personas/{personaId}
func (h *AdminCreatorHandler) UnbindPersona(w http.ResponseWriter, r *http.Request) {
	personaID := chi.URLParam(r, "personaId")

	if err := h.Repo.UnbindPersonaFromOperator(r.Context(), personaID); err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to unbind persona")
		return
	}
	sendAdminJSON(w, http.StatusOK, map[string]string{"message": "Persona unbound successfully"})
}

// GetPersonasMetrics handles GET /api/admin/personas-metrics
func (h *AdminCreatorHandler) GetPersonasMetrics(w http.ResponseWriter, r *http.Request) {
	metrics, err := h.Repo.GetManagedPersonasMetrics(r.Context())
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to load persona metrics")
		return
	}
	sendAdminJSON(w, http.StatusOK, metrics)
}

// CreateCreatorAccount provisions a model/creator account directly from the admin panel
func (h *AdminCreatorHandler) CreateCreatorAccount(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		sendAdminError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	var payload models.AdminCreateCreatorRequest
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	if payload.Email == "" || payload.Username == "" || payload.Password == "" {
		sendAdminError(w, http.StatusBadRequest, "Email, username, and password are required")
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(payload.Password), bcrypt.DefaultCost)
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to process credentials")
		return
	}

	ctx := r.Context()

	var userID string
	err = h.Repo.DB.QueryRowContext(ctx, `
		INSERT INTO users (email, username, password_hash, role, status)
		VALUES ($1, $2, $3, 'model', 'active')
		RETURNING id::text
	`, payload.Email, payload.Username, string(hashedPassword)).Scan(&userID)

	if err != nil {
		sendAdminError(w, http.StatusBadRequest, "Email or username already exists")
		return
	}

	_, err = h.Repo.DB.ExecContext(ctx, `
		INSERT INTO user_profiles (user_id, display_name, date_of_birth, gender, bio, avatar_url, intent, verified)
		VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
	`, userID, payload.DisplayName, payload.DateOfBirth, payload.Gender, payload.Bio, payload.AvatarURL, payload.Intent)

	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, "Failed to create user profile metadata")
		return
	}

	_, _ = h.Repo.DB.ExecContext(ctx, `
		INSERT INTO creator_stats (user_id, current_balance, total_earned, is_online)
		VALUES ($1, 0.00, 0.00, FALSE)
		ON CONFLICT (user_id) DO NOTHING
	`, userID)

	_, _ = h.Repo.DB.ExecContext(ctx, `
		INSERT INTO managed_profiles (manager_id, name, avatar_url, status)
		VALUES ($1, $2, $3, 'offline')
	`, userID, payload.DisplayName, payload.AvatarURL)

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

	// Validation
	if payload.Name == "" {
		sendAdminError(w, http.StatusBadRequest, "Persona name is required")
		return
	}

	// Create the full ghost user account via the repository
	newID, err := h.Repo.CreatePersona(r.Context(), payload.Name, payload.Archetype, payload.AvatarURL)
	if err != nil {
		log.Printf("CRITICAL: Failed to provision new persona: %v", err)
		sendAdminError(w, http.StatusInternalServerError, "Failed to provision persona account")
		return
	}

	// Return success with the new UUID
	sendAdminJSON(w, http.StatusCreated, map[string]string{
		"id":      newID,
		"message": "Persona provisioned successfully",
	})
}
