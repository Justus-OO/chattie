package handlers

import (
	"crypto/rand"
	"encoding/json"
	"errors"
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
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrInvalidRequestPayload", "Invalid request payload")})
		return
	}

	payload.Channel = strings.ToLower(strings.TrimSpace(payload.Channel))
	payload.Target = strings.TrimSpace(payload.Target)

	if payload.Channel != "sms" && payload.Channel != "email" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrChannelMustBeSmsOrEmail", "Channel must be 'sms' or 'email'")})
		return
	}

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	if payload.Channel == "email" {
		user, err := h.Repo.GetUserByID(r.Context(), userID)
		if err != nil {
			log.Printf("[OTP ERROR] Failed to load email destination for user %s: %v", userID, err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrCouldNotLoadAccountEmail", "Could not load account email")})
			return
		}
		payload.Target = strings.TrimSpace(user.Email)
		if payload.Target == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrNoEmailAddressIsSetOnThisAccount", "No email address is set on this account")})
			return
		}
		if h.Email == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrEmailDeliveryIsUnavailable", "Email delivery is unavailable")})
			return
		}
	} else {
		if payload.Target == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrAPhoneNumberIsRequired", "A phone number is required")})
			return
		}
		if h.SMS == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrSMSDeliveryIsUnavailable", "SMS delivery is unavailable")})
			return
		}
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
		if errors.Is(err, repository.ErrOTPRequestRateLimited) {
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrPleaseWait60SecondsBeforeRequestingAnotherCode", "Please wait 60 seconds before requesting another code")})
			return
		}
		log.Printf("[OTP ERROR] Failed to save OTP for user %s: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedToProcessOTPRequest", "Failed to process OTP request")})
		return
	}

	// 3. Route to the requested channel
	if payload.Channel == "sms" {
		templateData := map[string]any{"Code": otpCode}
		if err := h.SMS.QueueTemplatedSMS(r.Context(), payload.Target, "otp_verification_sms", templateData); err != nil {
			log.Printf("[SMS QUEUE ERROR] Failed to queue OTP for %s: %v", payload.Target, err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedToQueueSMSDelivery", "Failed to queue SMS delivery")})
			return
		}
	} else if payload.Channel == "email" {
		if err := h.Email.SendOTPEmail(r.Context(), payload.Target, otpCode); err != nil {
			log.Printf("[EMAIL QUEUE ERROR] Failed to queue OTP for %s: %v", payload.Target, err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedToQueueEmailDelivery", "Failed to queue Email delivery")})
			return
		}
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": localized(r.Context(), "MsgVerificationCodeSentSuccessfully", "Verification code sent successfully"),
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
