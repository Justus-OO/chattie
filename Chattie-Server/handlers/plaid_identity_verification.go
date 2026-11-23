package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func writePlaidJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func (h *SettingsHandler) CreatePlaidIdentityVerificationLinkToken(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		writePlaidJSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	if h.Plaid == nil || !h.Plaid.Available() {
		writePlaidJSONError(w, http.StatusServiceUnavailable, "Plaid Identity Verification is not configured")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<10)
	var request struct {
		VerificationConsent bool `json:"verification_consent"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || !request.VerificationConsent {
		writePlaidJSONError(w, http.StatusBadRequest, "Identity verification consent is required")
		return
	}

	attemptID := uuid.NewString()
	if err := h.Repo.ReservePlaidIdentityVerificationAttempt(r.Context(), userID, attemptID); err != nil {
		if errors.Is(err, repository.ErrPlaidIdentityVerificationRateLimited) {
			writePlaidJSONError(w, http.StatusTooManyRequests, "Please wait a moment before starting another verification session")
			return
		}
		log.Printf("[KYC] Could not reserve Plaid verification attempt for user %s: %v", userID, err)
		writePlaidJSONError(w, http.StatusInternalServerError, "Could not start identity verification")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	linkToken, err := h.Plaid.CreateLinkToken(ctx, userID)
	cancel()
	if err != nil {
		if cleanupErr := h.Repo.FailPlaidIdentityVerificationAttempt(context.Background(), userID, attemptID); cleanupErr != nil {
			log.Printf("[KYC] Could not close failed Plaid verification attempt for user %s: %v", userID, cleanupErr)
		}
		writePlaidServiceError(w, userID, "create Link token", err)
		return
	}
	if err := h.Repo.MarkPlaidIdentityVerificationAttemptReady(r.Context(), userID, attemptID); err != nil {
		log.Printf("[KYC] Could not mark Plaid verification attempt ready for user %s: %v", userID, err)
		writePlaidJSONError(w, http.StatusInternalServerError, "Could not start identity verification")
		return
	}

	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"attempt_id": attemptID,
		"link_token": linkToken,
	})
}

func (h *SettingsHandler) CompletePlaidIdentityVerification(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		writePlaidJSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<10)
	var request struct {
		AttemptID              string `json:"attempt_id"`
		IdentityVerificationID string `json:"identity_verification_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil ||
		strings.TrimSpace(request.AttemptID) == "" ||
		strings.TrimSpace(request.IdentityVerificationID) == "" ||
		len(request.IdentityVerificationID) > 128 {
		writePlaidJSONError(w, http.StatusBadRequest, "Plaid verification session is incomplete")
		return
	}
	if h.Plaid == nil || !h.Plaid.Available() {
		writePlaidJSONError(w, http.StatusServiceUnavailable, "Plaid Identity Verification is not configured")
		return
	}

	if _, _, err := h.Repo.GetPlaidIdentityVerificationAttempt(r.Context(), userID, request.AttemptID); err != nil {
		if errors.Is(err, repository.ErrPlaidIdentityVerificationNotFound) {
			writePlaidJSONError(w, http.StatusNotFound, "Verification attempt not found")
			return
		}
		log.Printf("[KYC] Could not find Plaid verification attempt for user %s: %v", userID, err)
		writePlaidJSONError(w, http.StatusInternalServerError, "Could not load verification attempt")
		return
	}
	if err := h.Repo.SetPlaidIdentityVerificationID(
		r.Context(),
		userID,
		request.AttemptID,
		request.IdentityVerificationID,
	); err != nil {
		if errors.Is(err, repository.ErrPlaidIdentityVerificationConflict) {
			writePlaidJSONError(w, http.StatusConflict, "A different Plaid verification session is already attached")
			return
		}
		log.Printf("[KYC] Could not attach Plaid verification session for user %s: %v", userID, err)
		writePlaidJSONError(w, http.StatusInternalServerError, "Could not attach verification session")
		return
	}

	status, err := h.refreshPlaidIdentityVerification(r.Context(), userID, request.AttemptID, request.IdentityVerificationID)
	if err != nil {
		if errors.Is(err, services.ErrPlaidIdentityVerificationUserMismatch) {
			if clearErr := h.Repo.ClearPlaidIdentityVerificationID(r.Context(), userID, request.AttemptID, request.IdentityVerificationID); clearErr != nil {
				log.Printf("[KYC] Could not clear mismatched Plaid session for user %s: %v", userID, clearErr)
			}
			writePlaidJSONError(w, http.StatusForbidden, "Plaid verification session does not match your account")
			return
		}
		writePlaidServiceError(w, userID, "retrieve verification result", err)
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]string{
		"attempt_id": request.AttemptID,
		"status":     status,
	})
}

func (h *SettingsHandler) GetPlaidIdentityVerificationStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		writePlaidJSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	attemptID := chi.URLParam(r, "attemptID")
	identityVerificationID, status, err := h.Repo.GetPlaidIdentityVerificationAttempt(r.Context(), userID, attemptID)
	if errors.Is(err, repository.ErrPlaidIdentityVerificationNotFound) {
		writePlaidJSONError(w, http.StatusNotFound, "Verification attempt not found")
		return
	}
	if err != nil {
		log.Printf("[KYC] Could not load Plaid verification status for user %s: %v", userID, err)
		writePlaidJSONError(w, http.StatusInternalServerError, "Could not load verification status")
		return
	}

	if identityVerificationID != "" && status != "success" && status != "failed" && status != "expired" && status != "canceled" {
		if h.Plaid == nil || !h.Plaid.Available() {
			writePlaidJSONError(w, http.StatusServiceUnavailable, "Plaid Identity Verification is not configured")
			return
		}
		status, err = h.refreshPlaidIdentityVerification(r.Context(), userID, attemptID, identityVerificationID)
		if err != nil {
			if errors.Is(err, services.ErrPlaidIdentityVerificationUserMismatch) {
				if clearErr := h.Repo.ClearPlaidIdentityVerificationID(r.Context(), userID, attemptID, identityVerificationID); clearErr != nil {
					log.Printf("[KYC] Could not clear mismatched Plaid session for user %s: %v", userID, clearErr)
				}
				writePlaidJSONError(w, http.StatusForbidden, "Plaid verification session does not match your account")
				return
			}
			writePlaidServiceError(w, userID, "refresh verification status", err)
			return
		}
	}

	_ = json.NewEncoder(w).Encode(map[string]string{
		"attempt_id": attemptID,
		"status":     status,
	})
}

func (h *SettingsHandler) refreshPlaidIdentityVerification(
	ctx context.Context,
	userID, attemptID, identityVerificationID string,
) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	verification, err := h.Plaid.GetIdentityVerification(ctx, identityVerificationID, userID)
	if err != nil {
		return "", err
	}
	changed, err := h.Repo.ApplyPlaidIdentityVerificationStatus(
		ctx,
		userID,
		attemptID,
		identityVerificationID,
		verification.Status,
	)
	if err != nil {
		return "", err
	}
	if changed && verification.Status == "success" && h.Events != nil {
		go h.Events.ProcessEvent(context.Background(), services.AppEvent{
			RecipientID: userID,
			WSEventType: "PROFILE_VERIFIED",
			WSPayload: map[string]string{
				"title": localized(context.Background(), "MsgIdentityVerified2", "Identity Verified!"),
				"message": localized(context.Background(), "MsgYourIdentityVerificationWasApproved", "Your identity verification was approved."),
				"type":    "success",
			},
		})
	}
	return verification.Status, nil
}

func writePlaidServiceError(w http.ResponseWriter, userID, operation string, err error) {
	var upstreamErr *services.PlaidAPIError
	if errors.As(err, &upstreamErr) {
		log.Printf("[KYC] Plaid could not %s for user %s (HTTP %d)", operation, userID, upstreamErr.StatusCode)
		status := http.StatusBadGateway
		if upstreamErr.StatusCode == http.StatusTooManyRequests || upstreamErr.StatusCode >= http.StatusInternalServerError {
			status = http.StatusServiceUnavailable
		}
		writePlaidJSONError(w, status, "Plaid is temporarily unavailable")
		return
	}
	log.Printf("[KYC] Could not %s with Plaid for user %s: %v", operation, userID, err)
	writePlaidJSONError(w, http.StatusBadGateway, "Could not complete Plaid identity verification")
}
