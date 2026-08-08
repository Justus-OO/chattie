package repository

import (
	"chattie-backend/models"
	"database/sql"
	"errors"
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
