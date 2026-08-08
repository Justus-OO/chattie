package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"chattie-backend/models"
	"chattie-backend/repository"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// In a real production environment, load this from config/environment variables!
var jwtSecret = []byte("super_secret_chattie_key_do_not_leak")

// AuthHandler holds the repository to interact with the database securely
type AuthHandler struct {
	Repo *repository.Repository
}

// NewAuthHandler creates a new handler with the injected repository
func NewAuthHandler(repo *repository.Repository) *AuthHandler {
	return &AuthHandler{Repo: repo}
}

// Register creates a new user securely
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var user models.User

	// PREVENT MEMORY LEAKS: Always close the request body
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&user); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request payload"})
		return
	}

	// REAL-WORLD FIX: Sanitize and validate inputs
	user.Email = strings.TrimSpace(strings.ToLower(user.Email))
	if user.Email == "" || len(user.Password) < 6 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Valid email and password (min 6 characters) are required"})
		return
	}

	// Hash password (Cost 10 is standard for security vs performance)
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), 10)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	user.Password = string(hashedPassword)

	// Enforce default role if none provided
	if user.Role == "" {
		user.Role = "client"
	}

	if err := h.Repo.CreateUser(&user); err != nil {
		// PRINT THE ACTUAL ERROR TO YOUR GO TERMINAL
		println("DATABASE ERROR:", err.Error())

		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()}) // Send real error to frontend
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"message": "User registered successfully"})
}

// Login verifies credentials and issues a secure JWT
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var creds struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	// PREVENT MEMORY LEAKS
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request payload"})
		return
	}

	// REAL-WORLD FIX: Normalize input to match database records
	creds.Email = strings.TrimSpace(strings.ToLower(creds.Email))

	// Fetch User from PostgreSQL
	user, err := h.Repo.GetUserByEmail(creds.Email)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid credentials"})
		return
	}

	// Verify Password Hash
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(creds.Password)); err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid credentials"})
		return
	}

	// Generate JWT containing user ID and Role
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": user.ID,
		"role":    user.Role,
		"exp":     time.Now().Add(time.Hour * 72).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Could not generate token"})
		return
	}

	// Return Token and User Data
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token": tokenString,
		"user": map[string]string{
			"id":       user.ID,
			"username": user.Username,
			"role":     user.Role,
		},
	})
}
