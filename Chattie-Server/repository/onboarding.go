package repository

import (
	"chattie-backend/models"
)

// CreateUserProfile handles Step 2 of registration
func (r *Repository) CreateUserProfile(profile *models.UserProfile) error {
	query := `
		INSERT INTO user_profiles (user_id, display_name, date_of_birth, gender, bio, height_cm) 
		VALUES ($1, $2, $3, $4, $5, $6)`

	_, err := r.DB.Exec(query,
		profile.UserID,
		profile.DisplayName,
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
func (r *Repository) ActivateUser(userID string) error {
	query := `UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = $1`
	_, err := r.DB.Exec(query, userID)
	return err
}
