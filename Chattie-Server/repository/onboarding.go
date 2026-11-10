package repository

import (
	"chattie-backend/models"
	"context"
)

// CreateUserProfile handles Step 2 of registration
func (r *Repository) CreateUserProfile(profile *models.UserProfile) error {
	query := `
       INSERT INTO user_profiles (user_id, display_name, phone_number, date_of_birth, gender, bio, height_cm) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`

	_, err := r.DB.Exec(query,
		profile.UserID,
		profile.DisplayName,
		profile.PhoneNumber,
		profile.DateOfBirth,
		profile.Gender,
		profile.Bio,
		profile.HeightCm,
	)
	return err
}

// CreateUserLocation handles Step 3 of registration
func (r *Repository) CreateUserLocation(loc *models.UserLocation) error {
	query := `
       INSERT INTO user_locations (user_id, latitude, longitude, city, country) 
       VALUES ($1, $2, $3, $4, $5)`

	_, err := r.DB.Exec(query,
		loc.UserID,
		loc.Latitude,
		loc.Longitude,
		loc.City,
		loc.Country,
	)
	return err
}

// CreateUserPreference handles Step 4 of registration
func (r *Repository) CreateUserPreference(pref *models.UserPreference) error {
	query := `
       INSERT INTO user_preferences (user_id, interested_in, min_age, max_age, max_distance_km) 
       VALUES ($1, $2, $3, $4, $5)`

	_, err := r.DB.Exec(query,
		pref.UserID,
		pref.InterestedIn,
		pref.MinAge,
		pref.MaxAge,
		pref.MaxDistanceKm,
	)
	return err
}

// ActivateUser is the Final Step: Flips the status from 'onboarding' to 'active'
func (r *Repository) ActivateUser(ctx context.Context, userID string) error {
	query := `UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = $1`
	_, err := r.DB.ExecContext(ctx, query, userID)
	return err
}

// ActivateUserSecure flips the status and logs legal consent & device footprint
func (r *Repository) ActivateUserSecure(ctx context.Context, userID string, consent models.ConsentLog) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Activate the user
	queryActivate := `UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = $1`
	if _, err := tx.ExecContext(ctx, queryActivate, userID); err != nil {
		return err
	}

	// 2. Log Device & Consent (Crucial for banning bad actors later)
	queryConsent := `
        INSERT INTO user_consent_logs (user_id, terms_accepted_at, ip_address, user_agent) 
        VALUES ($1, CURRENT_TIMESTAMP, $2, $3)`
	if _, err := tx.ExecContext(ctx, queryConsent, consent.UserID, consent.IPAddress, consent.UserAgent); err != nil {
		return err
	}

	return tx.Commit()
}

func (r *Repository) GetUserByID(ctx context.Context, userID string) (*models.User, error) {
	var user models.User
	query := `SELECT id, email, username FROM users WHERE id = $1`

	err := r.DB.QueryRowContext(ctx, query, userID).Scan(&user.ID, &user.Email, &user.Username)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// GetUserMediaCount checks if the user meets the minimum media requirements
func (r *Repository) GetUserMediaCount(ctx context.Context, userID string) (int, error) {
	var count int
	query := `SELECT COUNT(*) FROM user_media WHERE user_id = $1`
	err := r.DB.QueryRowContext(ctx, query, userID).Scan(&count)
	return count, err
}

// ============================================================================
// BUG FIX: Synchronized SaveUserMedia
// ============================================================================
func (r *Repository) SaveUserMedia(userID string, mediaURL string, isPrimary bool) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Insert into user_media using correct 'url' column name
	queryMedia := `
       INSERT INTO user_media (user_id, url, is_primary, created_at) 
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`
	if _, err := tx.Exec(queryMedia, userID, mediaURL, isPrimary); err != nil {
		return err
	}

	// 2. If this is the primary photo (Onboarding), set it as the avatar in user_profiles!
	if isPrimary {
		queryProfile := `UPDATE user_profiles SET avatar_url = $1 WHERE user_id = $2`
		if _, err := tx.Exec(queryProfile, mediaURL, userID); err != nil {
			return err
		}
	}

	return tx.Commit()
}
