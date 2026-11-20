package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v2"
	"github.com/google/uuid"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/api/idtoken"
)

type AuthHandler struct {
	Repo   *repository.Repository
	Events *services.EventHandler
	Email  *EmailHandler
	SMS    *services.SMSClient
}

// NewAuthHandler creates a new handler with the injected dependencies
func NewAuthHandler(repo *repository.Repository, events *services.EventHandler) *AuthHandler {
	return &AuthHandler{
		Repo:   repo,
		Events: events,
	}
}

// ============================================================================
// LOCAL AUTHENTICATION
// ============================================================================

// Register creates a new user securely
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var user models.User

	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&user); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrInvalidPayload", "Invalid request payload")})
		return
	}

	user.Email = strings.TrimSpace(strings.ToLower(user.Email))
	if user.Email == "" || len(user.Password) < 6 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrWeakPassword", "Valid email and password (min 6 characters) are required")})
		return
	}
	disposable, err := h.isDisposableEmail(r.Context(), user.Email)
	if err != nil {
		log.Printf("[AUTH] Could not check disposable-email rule: %v", err)
		http.Error(w, "Registration is temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	if disposable {
		http.Error(w, "Disposable email providers are not supported", http.StatusUnprocessableEntity)
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), 10)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrInternalServer", "Internal server error")})
		return
	}
	user.Password = string(hashedPassword)
	user.Provider = "local" // Tag as a local account

	if user.Role == "" {
		user.Role = "client"
	}

	if err := h.Repo.CreateUser(&user); err != nil {
		fmt.Println("DATABASE ERROR:", err.Error())
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	detachedCtx := context.WithoutCancel(r.Context())
	go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
		RecipientID:   user.ID,
		EmailTemplate: "welcome_email",
	})

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"message": localized(r.Context(), "MsgUserRegistered", "User registered successfully")})
}

// Login verifies credentials and issues a secure JWT
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var creds struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrInvalidPayload", "Invalid request payload")})
		return
	}

	creds.Email = strings.TrimSpace(strings.ToLower(creds.Email))

	user, err := h.Repo.GetUserByEmail(creds.Email)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrInvalidCredentials", "Invalid credentials")})
		return
	}

	// Prevent social logins from using an empty/dummy password to login locally
	if user.Provider != "local" && user.Provider != "" {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": localizedMessage(r.Context(), "TplLoginProviderRequired", "Please log in using your %s account", map[string]interface{}{"Provider": user.Provider})})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(creds.Password)); err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrInvalidCredentials", "Invalid credentials")})
		return
	}

	h.sendLoginOrChallenge(w, r, user)
}

// POST /api/settings/password
func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.NewPassword) < 8 {
		http.Error(w, "New password must be at least 8 characters", http.StatusBadRequest)
		return
	}
	passwordHash, err := h.Repo.GetPasswordHash(r.Context(), userID)
	if err != nil {
		http.Error(w, "Failed to verify current password", http.StatusInternalServerError)
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.CurrentPassword)); err != nil {
		http.Error(w, "Current password is incorrect", http.StatusUnauthorized)
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Failed to update password", http.StatusInternalServerError)
		return
	}
	version, err := h.Repo.UpdatePasswordAndRevokeOtherSessions(r.Context(), userID, string(newHash))
	if err != nil {
		http.Error(w, "Failed to update password", http.StatusInternalServerError)
		return
	}
	role, _ := r.Context().Value(middlewares.RoleKey).(string)
	if role == "" {
		role = "client"
	}
	token, err := h.issueSessionToken(r, userID, role, version)
	if err != nil {
		http.Error(w, "Password updated, but session refresh failed. Please sign in again.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "updated", "token": token})
}

// ============================================================================
// OAUTH / SOCIAL LOGIN
// ============================================================================

type OAuthRequest struct {
	IDToken string `json:"id_token"`
}

// GoogleSignIn verifies a Google ID token and authenticates the user
func (h *AuthHandler) GoogleSignIn(w http.ResponseWriter, r *http.Request) {
	var req OAuthRequest
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	clientID := os.Getenv("GOOGLE_CLIENT_ID")

	payload, err := idtoken.Validate(r.Context(), req.IDToken, clientID)
	if err != nil {
		http.Error(w, "Invalid Google token", http.StatusUnauthorized)
		return
	}

	email := fmt.Sprintf("%v", payload.Claims["email"])
	name := fmt.Sprintf("%v", payload.Claims["name"])

	h.processSocialLogin(w, r, email, name, "google")
}

var appleJWKS *keyfunc.JWKS

// Initialize this once when the server starts
func InitAppleKeys() error {
	jwks, err := keyfunc.Get("https://appleid.apple.com/auth/keys", keyfunc.Options{
		RefreshInterval: time.Hour * 24, // Refresh keys daily
	})
	if err != nil {
		return err
	}
	appleJWKS = jwks
	return nil
}

// AppleSignIn verifies an Apple ID token using Apple's public keys
func (h *AuthHandler) AppleSignIn(w http.ResponseWriter, r *http.Request) {
	var req OAuthRequest
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	// Lazy load the keys if they haven't been initialized yet
	if appleJWKS == nil {
		if err := InitAppleKeys(); err != nil {
			http.Error(w, "Failed to load Apple public keys", http.StatusInternalServerError)
			return
		}
	}

	// 1. Parse and verify the token signature using Apple's public keys
	token, err := jwt.Parse(req.IDToken, appleJWKS.Keyfunc)
	if err != nil || !token.Valid {
		http.Error(w, "Invalid Apple token signature", http.StatusUnauthorized)
		return
	}

	// 2. Extract the claims
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		http.Error(w, "Invalid token claims", http.StatusUnauthorized)
		return
	}

	// 3. Verify the Audience (Ensures the token was issued for YOUR app)
	appClientID := os.Getenv("APPLE_CLIENT_ID")
	aud, _ := claims["aud"].(string)
	if aud != appClientID {
		http.Error(w, "Apple token verification failed: Invalid Audience", http.StatusUnauthorized)
		return
	}

	// 4. Extract Email (Apple private relay emails will also show up here)
	email, _ := claims["email"].(string)
	if email == "" {
		http.Error(w, "Email not provided by Apple", http.StatusBadRequest)
		return
	}

	// Apple only sends the user's real name on the very first login.
	// For subsequent logins, we default to their email prefix.
	name := strings.Split(email, "@")[0]

	h.processSocialLogin(w, r, email, name, "apple")
}

// processSocialLogin handles the DB logic for both Google and Apple
func (h *AuthHandler) processSocialLogin(w http.ResponseWriter, r *http.Request, email, name, provider string) {
	w.Header().Set("Content-Type", "application/json")
	email = strings.ToLower(strings.TrimSpace(email))

	user, err := h.Repo.GetUserByEmail(email)

	if err != nil {
		// User doesn't exist, create a new one
		disposable, ruleErr := h.isDisposableEmail(r.Context(), email)
		if ruleErr != nil {
			log.Printf("[AUTH] Could not check disposable-email rule: %v", ruleErr)
			http.Error(w, "Registration is temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
		if disposable {
			http.Error(w, "Disposable email providers are not supported", http.StatusUnprocessableEntity)
			return
		}
		user = &models.User{
			Email:    email,
			Username: name,
			Role:     "client",
			Status:   "active",
			Password: "oauth_managed_account", // Cannot be logged into via standard login
			Provider: provider,
		}

		if err := h.Repo.CreateUser(user); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create account"})
			return
		}

		detachedCtx := context.WithoutCancel(r.Context())
		go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
			RecipientID:   user.ID,
			EmailTemplate: "welcome_email",
		})
	}

	if err := h.Repo.ProvisionAfterDarkViewer(r.Context(), user.ID); err != nil {
		log.Printf("[AUTH] Failed to provision After Dark viewer profile for %s: %v", user.ID, err)
	}

	h.sendLoginOrChallenge(w, r, user)
}

func (h *AuthHandler) isDisposableEmail(ctx context.Context, email string) (bool, error) {
	enabled, err := h.Repo.IsFirewallRuleActive(ctx, "RUL_2")
	if err != nil || !enabled {
		return false, err
	}
	return isKnownDisposableEmail(email), nil
}

func isKnownDisposableEmail(email string) bool {
	separator := strings.LastIndexByte(email, '@')
	if separator < 0 || separator == len(email)-1 {
		return false
	}
	domain := strings.ToLower(strings.TrimSpace(email[separator+1:]))
	for _, disposableDomain := range []string{
		"10minutemail.com", "guerrillamail.com", "mailinator.com", "tempmail.com",
		"temp-mail.org", "yopmail.com", "sharklasers.com", "dispostable.com",
	} {
		if domain == disposableDomain || strings.HasSuffix(domain, "."+disposableDomain) {
			return true
		}
	}
	return false
}

// ============================================================================
// HELPER METHODS
// ============================================================================

// sendAuthResponse centralizes the JWT generation and JSON response
func (h *AuthHandler) issueSessionToken(r *http.Request, userID, role string, tokenVersion int64) (string, error) {
	sessionID := uuid.NewString()
	expiresAt := time.Now().Add(72 * time.Hour)
	ipAddress := services.ExtractClientIP(r)
	if net.ParseIP(ipAddress) == nil {
		ipAddress = ""
	}
	if err := h.Repo.CreateAuthSession(
		r.Context(), sessionID, userID, tokenVersion, r.UserAgent(),
		ipAddress, expiresAt,
	); err != nil {
		return "", err
	}
	return middlewares.GenerateAuthTokenWithSession(userID, role, tokenVersion, sessionID)
}

func (h *AuthHandler) sendAuthResponse(w http.ResponseWriter, r *http.Request, user *models.User) {
	tokenString, err := h.issueSessionToken(r, user.ID, user.Role, user.TokenVersion)
	if err != nil {
		log.Printf("[AUTH] Failed to create login session for user %s: %v", user.ID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Could not generate token"})
		return
	}
	if err := h.Repo.RecordSuccessfulLogin(r.Context(), user.ID); err != nil {
		log.Printf("[AUTH] Failed to record successful login for user %s: %v", user.ID, err)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"token": tokenString,
		"user": map[string]string{
			"id":       user.ID,
			"username": user.Username,
			"role":     user.Role,
			"status":   user.Status,
			"provider": user.Provider,
		},
	})
}
