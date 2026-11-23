package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"

	"github.com/google/uuid"
)

type ADPerformerHandler struct {
	Repo *repository.ADPerformerRepository
}

func NewADPerformerHandler(repo *repository.ADPerformerRepository) *ADPerformerHandler {
	return &ADPerformerHandler{Repo: repo}
}

func (h *ADPerformerHandler) GetMyApplication(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	application, err := h.Repo.GetApplicationByUserID(r.Context(), userID)
	if err != nil {
		log.Printf("[AFTER DARK ONBOARDING] Failed to fetch creator application for user %s: %v", userID, err)
		http.Error(w, localized(r.Context(), "ErrFailedToFetchCreatorApplication", "Failed to fetch creator application"), http.StatusInternalServerError)
		return
	}

	isCreator, err := h.Repo.IsActiveCreator(r.Context(), userID)
	if err != nil {
		log.Printf("[AFTER DARK ONBOARDING] Failed to fetch creator status for user %s: %v", userID, err)
		http.Error(w, localized(r.Context(), "ErrFailedToFetchCreatorStatus", "Failed to fetch creator status"), http.StatusInternalServerError)
		return
	}
	canManageCreatorProfile, err := h.Repo.CanManageCreatorProfile(r.Context(), userID)
	if err != nil {
		log.Printf("[AFTER DARK ONBOARDING] Failed to fetch creator profile access for user %s: %v", userID, err)
		http.Error(w, localized(r.Context(), "ErrFailedToFetchCreatorProfileAccess", "Failed to fetch creator profile access"), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"application":  application,
		"is_creator":   isCreator,
		"creator_mode": canManageCreatorProfile,
	})
}

func (h *ADPerformerHandler) SubmitApplication(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}
	existingApplication, err := h.Repo.GetApplicationByUserID(r.Context(), userID)
	if err != nil {
		log.Printf("[AFTER DARK ONBOARDING] Failed to check existing application for user %s: %v", userID, err)
		http.Error(w, localized(r.Context(), "ErrFailedToCheckCreatorApplication", "Failed to check creator application"), http.StatusInternalServerError)
		return
	}
	if existingApplication != nil && (existingApplication.Status == "pending" || existingApplication.Status == "approved") {
		http.Error(w, localized(r.Context(), "MsgACreatorApplicationIsAlreadyPendingOrApproved", "A creator application is already pending or approved"), http.StatusConflict)
		return
	}

	var req struct {
		CreatorAlias  string `json:"alias"`
		PolicyVersion string `json:"policy_version"`
		Consents      struct {
			Age              bool `json:"age"`
			ContentOwnership bool `json:"content_ownership"`
			RevenueSplit     bool `json:"revenue_split"`
			ZeroTolerance    bool `json:"zero_tolerance"`
		} `json:"consents"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBody", "Invalid request body"), http.StatusBadRequest)
		return
	}
	req.CreatorAlias = strings.TrimSpace(req.CreatorAlias)
	req.PolicyVersion = strings.TrimSpace(req.PolicyVersion)
	if req.CreatorAlias == "" || utf8.RuneCountInString(req.CreatorAlias) > 100 {
		http.Error(w, localized(r.Context(), "ErrCreatorNameIsRequiredAndMustBe100CharactersOrFewer", "Creator name is required and must be 100 characters or fewer"), http.StatusBadRequest)
		return
	}
	if req.PolicyVersion == "" || utf8.RuneCountInString(req.PolicyVersion) > 50 {
		http.Error(w, localized(r.Context(), "ErrAValidCreatorPolicyVersionIsRequired", "A valid creator policy version is required"), http.StatusBadRequest)
		return
	}
	if !req.Consents.Age || !req.Consents.ContentOwnership || !req.Consents.RevenueSplit || !req.Consents.ZeroTolerance {
		http.Error(w, localized(r.Context(), "ErrAllCreatorEligibilityAndPolicyAgreementsMustBeAccepted", "All creator eligibility and policy agreements must be accepted"), http.StatusBadRequest)
		return
	}

	submittedAt := time.Now()
	app := &models.PerformerApplication{
		ID:            uuid.New().String(),
		UserID:        userID,
		CreatorAlias:  req.CreatorAlias,
		Status:        "pending",
		PolicyVersion: req.PolicyVersion,
		SubmittedAt:   submittedAt,
	}

	consents := make([]models.PerformerConsent, 0, 4)
	for _, consentType := range []string{"age_attestation", "content_ownership", "revenue_split", "zero_tolerance"} {
		consents = append(consents, models.PerformerConsent{
			ID:            uuid.New().String(),
			UserID:        userID,
			ConsentType:   consentType,
			PolicyVersion: req.PolicyVersion,
			AcceptedAt:    submittedAt,
		})
	}

	if err := h.Repo.SubmitApplication(r.Context(), app, consents); err != nil {
		if errors.Is(err, repository.ErrCreatorApplicationIncomplete) {
			http.Error(w, localized(r.Context(), "MsgCompleteIdentityVerificationAndConfirmYouAre18OrOlderBe", "Complete identity verification and confirm you are 18 or older before submitting"), http.StatusConflict)
			return
		}
		if errors.Is(err, repository.ErrCreatorApplicationPending) || errors.Is(err, repository.ErrCreatorApplicationAlreadyApproved) {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		http.Error(w, localized(r.Context(), "ErrFailedToSubmitApplication", "Failed to submit application"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": localized(r.Context(), "MsgCreatorApplicationSubmittedSuccessfully", "Creator application submitted successfully"),
		"status":  app.Status,
		"id":      app.ID,
	})
}
