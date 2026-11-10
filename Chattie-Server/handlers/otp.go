package handlers

import (
	"crypto/rand"
	"encoding/json"
	"log"
	"math/big"
	"net/http"
	"strings"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/repository"
	"chattie-backend/services"
)

type OTPHandler struct {
	Repo  *repository.Repository
	SMS   *services.SMSClient
	Email *EmailHandler
}

// NewOTPHandler injects both the SMS client and your internal EmailHandler
func NewOTPHandler(repo *repository.Repository, sms *services.SMSClient, email *EmailHandler) *OTPHandler {
	return &OTPHandler{
		Repo:  repo,
		SMS:   sms,
		Email: email,
	}
}

type OTPRequestPayload struct {
	Channel string `json:"channel"` // "sms" or "email"
	Target  string `json:"target"`  // phone number or email address
}

// RequestOTP generates a secure 6-digit code and routes it via SMS or Email
func (h *OTPHandler) RequestOTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var payload OTPRequestPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request payload"})
		return
	}

	payload.Channel = strings.ToLower(strings.TrimSpace(payload.Channel))
	payload.Target = strings.TrimSpace(payload.Target)

	if payload.Target == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Target destination (phone or email) is required"})
		return
	}

	if payload.Channel != "sms" && payload.Channel != "email" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Channel must be 'sms' or 'email'"})
		return
	}

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	// 1. Generate Cryptographically Secure 6-Digit OTP
	otpCode, err := generateSecureOTP(6)
	if err != nil {
		log.Printf("[OTP ERROR] Failed to generate code for user %s: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	// 2. Save OTP to DB (valid for 10 minutes)
	expiresAt := time.Now().Add(10 * time.Minute)
	if err := h.Repo.SaveOTP(r.Context(), userID, otpCode, expiresAt); err != nil {
		log.Printf("[OTP ERROR] Failed to save OTP for user %s: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to process OTP request"})
		return
	}

	// 3. Route to the requested channel
	if payload.Channel == "sms" {
		templateData := map[string]any{"Code": otpCode}
		if err := h.SMS.QueueTemplatedSMS(r.Context(), payload.Target, "otp_verification_sms", templateData); err != nil {
			log.Printf("[SMS QUEUE ERROR] Failed to queue OTP for %s: %v", payload.Target, err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to queue SMS delivery"})
			return
		}
	} else if payload.Channel == "email" {
		if err := h.Email.SendOTPEmail(r.Context(), payload.Target, otpCode); err != nil {
			log.Printf("[EMAIL QUEUE ERROR] Failed to queue OTP for %s: %v", payload.Target, err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to queue Email delivery"})
			return
		}
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Verification code sent successfully",
	})
}

// generateSecureOTP uses crypto/rand to prevent predictable token generation
func generateSecureOTP(length int) (string, error) {
	const chars = "0123456789"
	result := make([]byte, length)
	for i := range result {
		num, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			return "", err
		}
		result[i] = chars[num.Int64()]
	}
	return string(result), nil
}
