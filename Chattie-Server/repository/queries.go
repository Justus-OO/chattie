package repository

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"chattie-backend/models"
)

// Repository struct holds the database connection pool
type Repository struct {
	DB *sql.DB
}

// NewRepository creates a new instance of the database repository
func NewRepository(db *sql.DB) *Repository {
	return &Repository{DB: db}
}

// CreateUser safely inserts a new user and returns the generated UUID and timestamp
func (r *Repository) CreateUser(user *models.User) error {
	query := `
       INSERT INTO users (username, email, password_hash, role) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, created_at`

	// Execute the query and map the returned PostgreSQL ID and Timestamp back to the Go struct
	err := r.DB.QueryRow(query, user.Username, user.Email, user.Password, user.Role).
		Scan(&user.ID, &user.CreatedAt)

	return err
}

// GetUserByEmail fetches a user for login authentication
func (r *Repository) GetUserByEmail(email string) (*models.User, error) {
	query := `
       SELECT id, username, email, password_hash, role, created_at 
       FROM users 
       WHERE email = $1`

	user := &models.User{}
	err := r.DB.QueryRow(query, email).
		Scan(&user.ID, &user.Username, &user.Email, &user.Password, &user.Role, &user.CreatedAt)

	if err != nil {
		if err == sql.ErrNoRows {
			// Return a generic error to prevent user enumeration attacks
			return nil, errors.New("invalid credentials")
		}
		return nil, err
	}

	return user, nil
}

func (r *Repository) GetPasswordHash(ctx context.Context, userID string) (string, error) {
	var passwordHash string
	err := r.DB.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&passwordHash)
	return passwordHash, err
}

func (r *Repository) UpdatePasswordHash(ctx context.Context, userID string, passwordHash string) error {
	result, err := r.DB.ExecContext(ctx, `
		UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
		WHERE id = $2
	`, passwordHash, userID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// generateRandomAlias creates a string like "User-4A2B"
func generateRandomAlias() string {
	bytes := make([]byte, 2)
	if _, err := rand.Read(bytes); err != nil {
		return "User-0000" // Fallback
	}
	return fmt.Sprintf("User-%s", strings.ToUpper(hex.EncodeToString(bytes)))
}

// ProvisionAfterDarkViewer creates the default anonymous viewer profile
func (r *Repository) ProvisionAfterDarkViewer(ctx context.Context, userID string) error {
	alias := generateRandomAlias()

	// Create the viewer profile. Explicit consent and age verification are left NULL
	// until the user actually interacts with the explicit gate.
	query := `
       INSERT INTO ad_viewer_profiles (user_id, alias, created_at, updated_at) 
       VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO NOTHING
    `
	_, err := r.DB.ExecContext(ctx, query, userID, alias)
	return err
}
