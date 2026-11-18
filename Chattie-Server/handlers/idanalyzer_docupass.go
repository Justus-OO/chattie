package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/go-chi/chi/v5"
)

func writeIDAnalyzerJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func (h *SettingsHandler) CreateIDAnalyzerDocuPassSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		writeIDAnalyzerJSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	if h.IDAnalyzer == nil || !h.IDAnalyzer.Available() || h.IDAnalyzerWebhookSecret == "" {
		writeIDAnalyzerJSONError(w, http.StatusServiceUnavailable, "ID Analyzer DocuPass is not configured")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<10)
	var request struct {
		VerificationConsent bool `json:"verification_consent"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || !request.VerificationConsent {
		writeIDAnalyzerJSONError(w, http.StatusBadRequest, "Identity verification consent is required")
		return
	}

	randomValue := make([]byte, 32)
	if _, err := rand.Read(randomValue); err != nil {
		log.Printf("[KYC] Could not create DocuPass correlation value: %v", err)
		writeIDAnalyzerJSONError(w, http.StatusInternalServerError, "Could not start identity verification")
		return
	}
	customData := base64.RawURLEncoding.EncodeToString(randomValue)
	if err := h.Repo.ReserveIDAnalyzerDocuPassSession(r.Context(), userID, customData); err != nil {
		if errors.Is(err, repository.ErrIDAnalyzerDocuPassRateLimited) {
			writeIDAnalyzerJSONError(w, http.StatusTooManyRequests, "Please wait before starting another verification session")
			return
		}
		log.Printf("[KYC] Could not reserve DocuPass session for user %s: %v", userID, err)
		writeIDAnalyzerJSONError(w, http.StatusInternalServerError, "Could not start identity verification")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 35*time.Second)
	session, err := h.IDAnalyzer.CreateDocuPassSession(ctx, customData)
	cancel()
	if err != nil {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		if cleanupErr := h.Repo.FailIDAnalyzerDocuPassSession(cleanupCtx, customData); cleanupErr != nil {
			log.Printf("[KYC] Could not mark failed DocuPass session for user %s: %v", userID, cleanupErr)
		}
		cleanupCancel()

		var upstreamErr *services.IDAnalyzerUpstreamError
		if errors.As(err, &upstreamErr) {
			log.Printf("[KYC] ID Analyzer DocuPass request failed with HTTP %d", upstreamErr.StatusCode)
			status := http.StatusBadGateway
			if upstreamErr.StatusCode == http.StatusTooManyRequests || upstreamErr.StatusCode >= http.StatusInternalServerError {
				status = http.StatusServiceUnavailable
			}
			writeIDAnalyzerJSONError(w, status, "ID Analyzer is temporarily unavailable")
			return
		}
		log.Printf("[KYC] Could not create ID Analyzer DocuPass session: %v", err)
		writeIDAnalyzerJSONError(w, http.StatusBadGateway, "Could not start ID Analyzer verification")
		return
	}

	if err := h.Repo.SetIDAnalyzerDocuPassSession(r.Context(), customData, session.Reference, session.URL); err != nil {
		log.Printf("[KYC] Could not persist DocuPass session for user %s: %v", userID, err)
		writeIDAnalyzerJSONError(w, http.StatusInternalServerError, "Could not start identity verification")
		return
	}

	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"reference": session.Reference,
		"url":       session.URL,
	})
}

func (h *SettingsHandler) GetIDAnalyzerDocuPassStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		writeIDAnalyzerJSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	status, transactionID, err := h.Repo.GetIDAnalyzerDocuPassStatus(r.Context(), userID, chi.URLParam(r, "reference"))
	if errors.Is(err, repository.ErrIDAnalyzerDocuPassNotFound) {
		writeIDAnalyzerJSONError(w, http.StatusNotFound, "Verification session not found")
		return
	}
	if err != nil {
		log.Printf("[KYC] Could not load DocuPass status for user %s: %v", userID, err)
		writeIDAnalyzerJSONError(w, http.StatusInternalServerError, "Could not load verification status")
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":         status,
		"transaction_id": transactionID,
	})
}

func (h *SettingsHandler) HandleIDAnalyzerDocuPassWebhook(w http.ResponseWriter, r *http.Request) {
	if h.IDAnalyzerWebhookSecret == "" {
		http.Error(w, "Webhook is not configured", http.StatusServiceUnavailable)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Invalid webhook body", http.StatusRequestEntityTooLarge)
		return
	}
	if !services.VerifyIDAnalyzerWebhookSignature(
		h.IDAnalyzerWebhookSecret,
		r.Header.Get("X-IDA-Timestamp"),
		r.Header.Get("X-IDA-Signature"),
		body,
		time.Now(),
	) {
		http.Error(w, "Invalid webhook signature", http.StatusUnauthorized)
		return
	}

	var payload struct {
		Event         string `json:"event"`
		TransactionID string `json:"transactionId"`
		ProfileID     string `json:"profileId"`
		CustomData    string `json:"customData"`
		Decision      string `json:"decision"`
		Warning       []struct {
			Code string `json:"code"`
		} `json:"warning"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "Invalid webhook payload", http.StatusBadRequest)
		return
	}
	if payload.Event != "docupass_conclusive" {
		w.WriteHeader(http.StatusOK)
		return
	}
	if h.IDAnalyzer == nil || payload.ProfileID != h.IDAnalyzer.ProfileID() {
		w.WriteHeader(http.StatusOK)
		return
	}

	decision := strings.ToLower(strings.TrimSpace(payload.Decision))
	if decision != "accept" && decision != "review" && decision != "reject" {
		http.Error(w, "Invalid DocuPass decision", http.StatusBadRequest)
		return
	}
	if payload.TransactionID == "" || payload.CustomData == "" {
		http.Error(w, "Incomplete DocuPass event", http.StatusBadRequest)
		return
	}

	warningCodes := make([]string, 0, len(payload.Warning))
	rejectForAge := false
	requireReview := false
	for _, warning := range payload.Warning {
		code := strings.TrimSpace(warning.Code)
		if code == "" {
			continue
		}
		warningCodes = append(warningCodes, code)
		switch code {
		case "UNDER_18", "AGE_VERIFICATION_FAILED":
			rejectForAge = true
		case "FACE_MISMATCH", "FACE_LIVENESS_ERR", "RECAPTURED_FACE", "FACE_IDENTICAL", "MISSING_BIRTH_DATE":
			requireReview = true
		}
	}
	if rejectForAge {
		decision = "reject"
	} else if decision == "accept" && requireReview {
		decision = "review"
	}

	userID, changed, err := h.Repo.ApplyIDAnalyzerDocuPassDecision(
		r.Context(),
		payload.CustomData,
		payload.TransactionID,
		decision,
		warningCodes,
	)
	if errors.Is(err, repository.ErrIDAnalyzerDocuPassNotFound) {
		w.WriteHeader(http.StatusOK)
		return
	}
	if err != nil {
		log.Printf("[KYC] Could not apply DocuPass result: %v", err)
		http.Error(w, "Could not apply verification result", http.StatusInternalServerError)
		return
	}
	if changed && decision == "accept" && h.Events != nil {
		go h.Events.ProcessEvent(context.Background(), services.AppEvent{
			RecipientID: userID,
			WSEventType: "PROFILE_VERIFIED",
			WSPayload: map[string]string{
				"title":   "Identity Verified!",
				"message": "Your identity verification was approved.",
				"type":    "success",
			},
		})
	}

	w.WriteHeader(http.StatusOK)
}
