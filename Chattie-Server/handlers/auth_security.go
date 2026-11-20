package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

func (h *AuthHandler) sendLoginOrChallenge(w http.ResponseWriter, r *http.Request, user *models.User) {
	details, err := h.Repo.GetAuthDetailsByUserID(r.Context(), user.ID)
	if err != nil {
		log.Printf("[AUTH] Failed to load security settings for %s: %v", user.ID, err)
		http.Error(w, "Could not complete sign-in", http.StatusInternalServerError)
		return
	}
	user.Provider = details.Provider
	user.TokenVersion = details.TokenVersion
	if !details.TwoFactorEnabled {
		h.sendAuthResponse(w, r, user)
		return
	}
	challengeID, err := h.startAuthChallenge(r, details, "login_2fa", details.TwoFactorChannel)
	if err != nil {
		if errors.Is(err, repository.ErrAuthChallengeRateLimited) {
			http.Error(w, "Too many verification codes requested. Try again later.", http.StatusTooManyRequests)
			return
		}
		log.Printf("[AUTH] Failed to start sign-in verification for %s: %v", user.ID, err)
		http.Error(w, "Could not send sign-in verification code", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"requires_two_factor": true,
		"challenge_id":        challengeID,
		"channel":             details.TwoFactorChannel,
		"destination":         maskedDestination(details, details.TwoFactorChannel),
		"message":             "Enter the code sent to your registered security method.",
	})
}

func (h *AuthHandler) GetTwoFactorSettings(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	details, err := h.Repo.GetAuthDetailsByUserID(r.Context(), userID)
	if err != nil {
		log.Printf("[AUTH] Failed to load two-factor settings for %s: %v", userID, err)
		http.Error(w, "Could not load security settings", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"enabled":         details.TwoFactorEnabled,
		"channel":         details.TwoFactorChannel,
		"email_available": details.Email != "",
		"sms_available":   details.PhoneNumber != "",
		"sms_verified":    details.PhoneVerified,
	})
}

func (h *AuthHandler) RequestTwoFactorChange(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		Enabled bool   `json:"enabled"`
		Channel string `json:"channel"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	details, err := h.Repo.GetAuthDetailsByUserID(r.Context(), userID)
	if err != nil {
		http.Error(w, "Could not load account security details", http.StatusInternalServerError)
		return
	}
	if !req.Enabled {
		user, err := h.Repo.GetUserByID(r.Context(), userID)
		if err != nil {
			log.Printf("[AUTH] Could not verify role before disabling two-factor for %s: %v", userID, err)
			http.Error(w, "Could not verify account security settings", http.StatusInternalServerError)
			return
		}
		if user.Role == "admin" {
			http.Error(w, "Administrator accounts must keep two-factor authentication enabled", http.StatusForbidden)
			return
		}
	}
	channel := strings.ToLower(strings.TrimSpace(req.Channel))
	purpose := "enable_2fa"
	if !req.Enabled {
		if !details.TwoFactorEnabled {
			http.Error(w, "Two-factor authentication is already disabled", http.StatusConflict)
			return
		}
		purpose = "disable_2fa"
		channel = details.TwoFactorChannel
	}
	if channel != "email" && channel != "sms" {
		http.Error(w, "Choose email or SMS for verification", http.StatusBadRequest)
		return
	}
	if channel == "sms" && details.PhoneNumber == "" {
		http.Error(w, "Add a phone number to your Chattie profile before choosing SMS", http.StatusBadRequest)
		return
	}
	challengeID, err := h.startAuthChallenge(r, details, purpose, channel)
	if err != nil {
		if errors.Is(err, repository.ErrAuthChallengeRateLimited) {
			http.Error(w, "Too many verification codes requested. Try again later.", http.StatusTooManyRequests)
			return
		}
		log.Printf("[AUTH] Failed to send two-factor setup code for %s: %v", userID, err)
		http.Error(w, "Could not send verification code", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"challenge_id": challengeID,
		"enabled":      req.Enabled,
		"channel":      channel,
		"destination":  maskedDestination(details, channel),
		"message":      "Enter the code to confirm this security change.",
	})
}

func (h *AuthHandler) VerifyTwoFactorChange(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		ChallengeID string `json:"challenge_id"`
		Code        string `json:"code"`
		Enabled     bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	purpose := "disable_2fa"
	if req.Enabled {
		purpose = "enable_2fa"
	}
	challenge, err := h.Repo.GetAuthChallenge(r.Context(), req.ChallengeID, purpose)
	if err != nil || challenge.UserID != userID {
		http.Error(w, "Invalid or expired verification code", http.StatusUnauthorized)
		return
	}
	if _, err := h.verifyAuthCode(r, req.ChallengeID, purpose, req.Code, userID); err != nil {
		http.Error(w, "Invalid or expired verification code", http.StatusUnauthorized)
		return
	}
	if !req.Enabled {
		user, err := h.Repo.GetUserByID(r.Context(), userID)
		if err != nil {
			log.Printf("[AUTH] Could not verify role before disabling two-factor for %s: %v", userID, err)
			http.Error(w, "Could not verify account security settings", http.StatusInternalServerError)
			return
		}
		if user.Role == "admin" {
			http.Error(w, "Administrator accounts must keep two-factor authentication enabled", http.StatusForbidden)
			return
		}
	}
	if err := h.Repo.SetTwoFactor(r.Context(), userID, req.Enabled, challenge.Channel); err != nil {
		log.Printf("[AUTH] Failed to save two-factor setting for %s: %v", userID, err)
		http.Error(w, "Could not update two-factor settings", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"enabled": req.Enabled, "channel": challenge.Channel})
}

func (h *AuthHandler) VerifyLoginTwoFactor(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ChallengeID string `json:"challenge_id"`
		Code        string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	userID, err := h.verifyAuthCode(r, req.ChallengeID, "login_2fa", req.Code, "")
	if err != nil {
		http.Error(w, "Invalid or expired verification code", http.StatusUnauthorized)
		return
	}
	user, err := h.Repo.GetUserByID(r.Context(), userID)
	if err != nil {
		log.Printf("[AUTH] Failed to load user after two-factor verification: %v", err)
		http.Error(w, "Could not complete sign-in", http.StatusInternalServerError)
		return
	}
	h.sendAuthResponse(w, r, user)
}

func (h *AuthHandler) RequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email   string `json:"email"`
		Channel string `json:"channel"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.Channel = strings.ToLower(strings.TrimSpace(req.Channel))
	decoyID := uuid.NewString()

	details, err := h.Repo.GetAuthDetailsByEmail(r.Context(), req.Email)
	if err == nil && details.Provider == "local" && (req.Channel == "email" || (req.Channel == "sms" && details.PhoneVerified && details.PhoneNumber != "")) {
		if challengeID, startErr := h.startAuthChallenge(r, details, "password_reset", req.Channel); startErr == nil {
			decoyID = challengeID
		} else if !errors.Is(startErr, repository.ErrAuthChallengeRateLimited) {
			log.Printf("[AUTH] Password reset code delivery failed: %v", startErr)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"challenge_id": decoyID,
		"message":      "If an eligible account matches those details, a password reset code has been sent.",
	})
}

func (h *AuthHandler) CompletePasswordReset(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ChallengeID string `json:"challenge_id"`
		Code        string `json:"code"`
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.NewPassword) < 8 {
		http.Error(w, "Password must be at least 8 characters", http.StatusBadRequest)
		return
	}
	challenge, err := h.Repo.GetAuthChallenge(r.Context(), req.ChallengeID, "password_reset")
	if err != nil {
		http.Error(w, "Invalid or expired verification code", http.StatusUnauthorized)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(challenge.CodeHash), []byte(req.Code)) != nil {
		_ = h.Repo.RecordAuthChallengeFailure(r.Context(), req.ChallengeID)
		http.Error(w, "Invalid or expired verification code", http.StatusUnauthorized)
		return
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Could not update password", http.StatusInternalServerError)
		return
	}
	if err := h.Repo.CompletePasswordReset(r.Context(), req.ChallengeID, challenge.UserID, string(passwordHash)); err != nil {
		http.Error(w, "Invalid or expired verification code", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Password reset successful. You can now sign in."})
}

func (h *AuthHandler) startAuthChallenge(r *http.Request, details *repository.AuthDetails, purpose, channel string) (string, error) {
	code, err := generateSecureOTP(6)
	if err != nil {
		return "", err
	}
	codeHash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	challengeID := uuid.NewString()
	if err := h.Repo.CreateAuthChallenge(r.Context(), challengeID, details.UserID, purpose, channel, string(codeHash), time.Now().Add(10*time.Minute)); err != nil {
		return "", err
	}
	templateName := map[string]string{
		"login_2fa":      "login_2fa",
		"password_reset": "password_reset",
		"enable_2fa":     "two_factor_setup",
		"disable_2fa":    "two_factor_setup",
	}[purpose]
	data := map[string]any{"Code": code, "ExpiresMinutes": 10}
	var sendErr error
	if channel == "sms" {
		if details.PhoneNumber == "" || h.SMS == nil {
			return "", errors.New("SMS delivery is unavailable")
		}
		sendErr = h.SMS.QueueTemplatedSMS(r.Context(), details.PhoneNumber, templateName+"_sms", data)
	} else {
		if details.Email == "" || h.Email == nil {
			return "", errors.New("email delivery is unavailable")
		}
		sendErr = h.Email.SendSecurityCode(r.Context(), details.Email, templateName+"_email", code)
	}
	if sendErr != nil {
		_, _ = h.Repo.ConsumeAuthChallenge(r.Context(), challengeID, purpose)
		return "", sendErr
	}
	return challengeID, nil
}

func (h *AuthHandler) verifyAuthCode(r *http.Request, challengeID, purpose, code, expectedUserID string) (string, error) {
	challenge, err := h.Repo.GetAuthChallenge(r.Context(), challengeID, purpose)
	if err != nil {
		return "", err
	}
	if expectedUserID != "" && challenge.UserID != expectedUserID {
		return "", errors.New("verification code does not match the current account")
	}
	if bcrypt.CompareHashAndPassword([]byte(challenge.CodeHash), []byte(code)) != nil {
		_ = h.Repo.RecordAuthChallengeFailure(r.Context(), challengeID)
		return "", errors.New("invalid verification code")
	}
	userID, err := h.Repo.ConsumeAuthChallenge(r.Context(), challengeID, purpose)
	if err != nil {
		return "", err
	}
	return userID, nil
}

func maskedDestination(details *repository.AuthDetails, channel string) string {
	if channel == "sms" && details.PhoneNumber != "" {
		phone := details.PhoneNumber
		if len(phone) > 3 {
			return "•••• " + phone[len(phone)-3:]
		}
		return "registered phone"
	}
	parts := strings.Split(details.Email, "@")
	if len(parts) != 2 {
		return "registered email"
	}
	local := parts[0]
	if len(local) > 1 {
		local = local[:1] + "•••"
	} else {
		local = "•••"
	}
	return local + "@" + parts[1]
}
