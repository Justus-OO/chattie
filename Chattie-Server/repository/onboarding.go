package repository

import (
	"chattie-backend/models"
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

var ErrInvalidOnboardingProfile = errors.New("invalid onboarding profile")

func validateOnboardingProfile(profile *models.UserProfile) error {
	if utf8.RuneCountInString(strings.TrimSpace(profile.DisplayName)) < 2 ||
		utf8.RuneCountInString(strings.TrimSpace(profile.Bio)) < 10 ||
		profile.HeightCm < 100 || profile.HeightCm > 250 {
		return ErrInvalidOnboardingProfile
	}

	dateOfBirth, err := time.Parse("2006-01-02", strings.TrimSpace(profile.DateOfBirth))
	if err != nil || dateOfBirth.After(time.Now().UTC().AddDate(-18, 0, 0)) {
		return ErrInvalidOnboardingProfile
	}
	return nil
}

func NormalizeOnboardingTags(tags []string) ([]string, error) {
	normalized := make([]string, 0, len(tags))
	seen := make(map[string]struct{}, len(tags))
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if utf8.RuneCountInString(tag) > 40 {
			return nil, fmt.Errorf("%w: interest is too long", ErrInvalidDiscoveryPreferences)
		}
		key := strings.ToLower(tag)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, tag)
	}
	if len(normalized) < 3 || len(normalized) > 7 {
		return nil, fmt.Errorf("%w: select between 3 and 7 interests", ErrInvalidDiscoveryPreferences)
	}
	return normalized, nil
}

// CreateUserProfile handles Step 2 of registration
func (r *Repository) CreateUserProfile(profile *models.UserProfile) error {
	if err := validateOnboardingProfile(profile); err != nil {
		return err
	}
	gender, err := normalizeProfileGender(profile.Gender)
	if err != nil {
		return err
	}
	query := `
       INSERT INTO user_profiles (user_id, display_name, phone_number, date_of_birth, gender, bio, height_cm) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           phone_number = EXCLUDED.phone_number,
           date_of_birth = EXCLUDED.date_of_birth,
           gender = EXCLUDED.gender,
           bio = EXCLUDED.bio,
           height_cm = EXCLUDED.height_cm`

	_, err = r.DB.Exec(query,
		profile.UserID,
		profile.DisplayName,
		profile.PhoneNumber,
		profile.DateOfBirth,
		gender,
		profile.Bio,
		profile.HeightCm,
	)
	return err
}

// CreateUserLocation handles Step 3 of registration
func (r *Repository) CreateUserLocation(loc *models.UserLocation) error {
	query := `
       INSERT INTO user_locations (user_id, latitude, longitude, city, country, country_code)
       VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''))
       ON CONFLICT (user_id) DO UPDATE SET
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           city = EXCLUDED.city,
           country = EXCLUDED.country,
           country_code = COALESCE(EXCLUDED.country_code, user_locations.country_code),
           last_updated = CURRENT_TIMESTAMP`

	_, err := r.DB.Exec(query,
		loc.UserID,
		loc.Latitude,
		loc.Longitude,
		loc.City,
		loc.Country,
		loc.CountryCode,
	)
	return err
}

// CreateUserPreference handles Step 4 of registration
func (r *Repository) CreateUserPreference(pref *models.UserPreference) error {
	showMe, err := normalizeShowMePreference(pref.ShowMe)
	if err != nil {
		return err
	}
	interestedIn, err := normalizeMatchingIntent(pref.InterestedIn)
	if err != nil {
		return err
	}
	tags, err := NormalizeOnboardingTags(pref.Tags)
	if err != nil {
		return err
	}
	if pref.MinAge < 18 || pref.MaxAge > 99 || pref.MinAge > pref.MaxAge || pref.MaxDistanceKm < 1 || pref.MaxDistanceKm > 500 {
		return ErrInvalidDiscoveryPreferences
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
       INSERT INTO user_preferences (user_id, interested_in, min_age, max_age, max_distance_km)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
           interested_in = EXCLUDED.interested_in,
           min_age = EXCLUDED.min_age,
           max_age = EXCLUDED.max_age,
           max_distance_km = EXCLUDED.max_distance_km`,
		pref.UserID, interestedIn, pref.MinAge, pref.MaxAge, pref.MaxDistanceKm,
	)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`
       INSERT INTO user_settings (user_id, show_me)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET show_me = EXCLUDED.show_me`,
		pref.UserID, showMe,
	)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(`DELETE FROM user_tags WHERE user_id = $1`, pref.UserID); err != nil {
		return err
	}
	for _, tag := range tags {
		if _, err = tx.Exec(`INSERT INTO user_tags (user_id, tag) VALUES ($1, $2)`, pref.UserID, tag); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ActivateUser is the Final Step: Flips the status from 'onboarding' to 'active'
func (r *Repository) ActivateUser(ctx context.Context, userID string) error {
	query := `UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = $1`
	_, err := r.DB.ExecContext(ctx, query, userID)
	return err
}

// ActivateUserSecure flips the status and logs legal consent & device footprint
func (r *Repository) ActivateUserSecure(ctx context.Context, userID string, consent models.ConsentLog) ([]string, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var hasProfile, hasPhoto, hasLocation, hasPreferences bool
	var interestCount int
	err = tx.QueryRowContext(ctx, `
		SELECT
			EXISTS (
				SELECT 1 FROM user_profiles p
				WHERE p.user_id = $1
				  AND CHAR_LENGTH(BTRIM(p.display_name)) >= 2
				  AND p.date_of_birth <= CURRENT_DATE - INTERVAL '18 years'
				  AND p.gender IN ('male', 'female', 'other')
				  AND CHAR_LENGTH(BTRIM(COALESCE(p.bio, ''))) >= 10
				  AND p.height_cm BETWEEN 100 AND 250
			),
			EXISTS (
				SELECT 1 FROM user_media m
				WHERE m.user_id = $1 AND NULLIF(BTRIM(m.url), '') IS NOT NULL
			),
			EXISTS (
				SELECT 1 FROM user_locations l
				WHERE l.user_id = $1
				  AND NULLIF(BTRIM(l.city), '') IS NOT NULL
				  AND l.latitude BETWEEN -90 AND 90
				  AND l.longitude BETWEEN -180 AND 180
			),
			EXISTS (
				SELECT 1
				FROM user_preferences p
				JOIN user_settings s ON s.user_id = p.user_id
				WHERE p.user_id = $1
				  AND p.interested_in IN ('all', 'casual', 'dating', 'friends', 'network')
				  AND p.min_age >= 18 AND p.max_age <= 99 AND p.min_age <= p.max_age
				  AND p.max_distance_km BETWEEN 1 AND 500
				  AND s.show_me IN ('Everyone', 'Men', 'Women', 'Other')
			),
			(
				SELECT COUNT(DISTINCT LOWER(BTRIM(tag)))
				FROM user_tags
				WHERE user_id = $1 AND NULLIF(BTRIM(tag), '') IS NOT NULL
			)
	`, userID).Scan(&hasProfile, &hasPhoto, &hasLocation, &hasPreferences, &interestCount)
	if err != nil {
		return nil, err
	}

	var missing []string
	if !hasProfile {
		missing = append(missing, "profile details (name, adult date of birth, gender, bio, and height)")
	}
	if !hasPhoto {
		missing = append(missing, "at least one profile photo")
	}
	if !hasLocation {
		missing = append(missing, "city and valid location coordinates")
	}
	if !hasPreferences {
		missing = append(missing, "valid discovery preferences")
	}
	if interestCount < 3 || interestCount > 7 {
		missing = append(missing, "3 to 7 interests")
	}
	if len(missing) > 0 {
		return missing, nil
	}

	// Activate only after every discovery-required profile field is present.
	queryActivate := `UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = $1`
	if _, err := tx.ExecContext(ctx, queryActivate, userID); err != nil {
		return nil, err
	}

	queryConsent := `
        INSERT INTO user_consent_logs (user_id, terms_accepted_at, ip_address, user_agent) 
        VALUES ($1, CURRENT_TIMESTAMP, $2, $3)`
	if _, err := tx.ExecContext(ctx, queryConsent, consent.UserID, consent.IPAddress, consent.UserAgent); err != nil {
		return nil, err
	}

	if err := provisionAfterDarkViewer(ctx, tx, userID); err != nil {
		return nil, err
	}

	return nil, tx.Commit()
}

func (r *Repository) GetUserByID(ctx context.Context, userID string) (*models.User, error) {
	var user models.User
	query := `SELECT id, email, username, role, status, provider, token_version FROM users WHERE id = $1`

	err := r.DB.QueryRowContext(ctx, query, userID).Scan(&user.ID, &user.Email, &user.Username, &user.Role, &user.Status, &user.Provider, &user.TokenVersion)
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
