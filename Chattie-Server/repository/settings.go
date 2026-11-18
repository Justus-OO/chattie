package repository

import (
	"chattie-backend/models"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
)

var (
	ErrPlaidIdentityVerificationRateLimited = errors.New("Plaid Identity Verification session creation is rate limited")
	ErrPlaidIdentityVerificationNotFound    = errors.New("Plaid Identity Verification session not found")
	ErrPlaidIdentityVerificationConflict    = errors.New("Plaid Identity Verification session is already attached")
)

type SettingsRepository struct {
	DB *sql.DB
}

func NewSettingsRepository(db *sql.DB) *SettingsRepository {
	return &SettingsRepository{DB: db}
}

func (r *SettingsRepository) CanUseIncognito(ctx context.Context, userID string) (bool, error) {
	var allowed bool
	err := r.DB.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM user_subscriptions
			WHERE user_id = $1 AND tier_id = 2 AND status = 'active'
			  AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
		)
	`, userID).Scan(&allowed)
	return allowed, err
}

// UpdateSettings updates profile, preferences, settings, and tags in a single transaction
func (r *SettingsRepository) UpdateSettings(userID string, data models.SettingsPayload) error {
	showMe, err := normalizeShowMePreference(data.ShowMe)
	if err != nil {
		return err
	}
	if data.AgeMin == 0 {
		data.AgeMin = 18
	}
	if data.AgeMax == 0 {
		data.AgeMax = 50
	}
	if data.Distance == 0 {
		data.Distance = 25
	}
	if data.AgeMin < 18 || data.AgeMax > 99 || data.AgeMin > data.AgeMax || data.Distance < 1 || data.Distance > 500 {
		return ErrInvalidDiscoveryPreferences
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	avatarURL := data.Avatar
	if data.AvatarStorageURL != "" {
		avatarURL = data.AvatarStorageURL
	}
	coverURL := data.Cover
	if data.CoverStorageURL != "" {
		coverURL = data.CoverStorageURL
	}

	// 1. Update Profile (Now includes phone_number)
	_, err = tx.Exec(`
       UPDATE user_profiles 
       SET display_name = $1, bio = $2, intent = $3,
           avatar_url = CASE WHEN $9 THEN avatar_url ELSE $4 END,
           job_title = $5,
           cover_url = CASE WHEN $10 THEN cover_url ELSE $6 END,
           phone_number = $7
       WHERE user_id = $8`,
		data.Name, data.Bio, data.Intent, avatarURL, data.Job, coverURL,
		data.PhoneNumber, userID, data.PreserveAvatar, data.PreserveCover)
	if err != nil {
		tx.Rollback()
		return err
	}

	// 1.5 Update Account Email
	if data.Email != "" {
		_, err = tx.Exec(`
           UPDATE users 
           SET email = $1 
           WHERE id = $2`,
			data.Email, userID)
		if err != nil {
			tx.Rollback()
			return err
		}
	}

	// 2. Update Location
	if data.Location != "" {
		_, err = tx.Exec(`
           UPDATE user_locations 
           SET city = $1 
           WHERE user_id = $2`,
			data.Location, userID)
		if err != nil {
			tx.Rollback()
			return err
		}
	}

	_, err = tx.Exec(`
       INSERT INTO user_preferences (user_id, interested_in, min_age, max_age, max_distance_km)
       VALUES ($1, 'All', $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
           min_age = EXCLUDED.min_age,
           max_age = EXCLUDED.max_age,
           max_distance_km = EXCLUDED.max_distance_km`,
		userID, data.AgeMin, data.AgeMax, data.Distance)
	if err != nil {
		return err
	}

	_, err = tx.Exec(`
       INSERT INTO user_settings (user_id, global_mode, show_me)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
           global_mode = EXCLUDED.global_mode,
           show_me = EXCLUDED.show_me,
           updated_at = CURRENT_TIMESTAMP`,
		userID, data.IsGlobal, showMe)
	if err != nil {
		return err
	}

	// 4. Update Tags
	_, err = tx.Exec("DELETE FROM user_tags WHERE user_id = $1", userID)
	if err != nil {
		return err
	}

	for _, tag := range data.Tags {
		_, err = tx.Exec("INSERT INTO user_tags (user_id, tag) VALUES ($1, $2)", userID, tag)
		if err != nil {
			return err
		}
	}

	// 5. Upsert Settings Toggles (Only update if the frontend sent the maps)
	if data.Notifs != nil && data.Privacy != nil && data.Connected != nil {
		_, err = tx.Exec(`
           INSERT INTO user_settings (
              user_id,
              notif_new_matches, notif_messages, notif_super_likes, notif_promotions,
              privacy_incognito, privacy_read_receipts, conn_spotify, conn_instagram
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (user_id) DO UPDATE SET
              notif_new_matches = EXCLUDED.notif_new_matches,
              notif_messages = EXCLUDED.notif_messages,
              notif_super_likes = EXCLUDED.notif_super_likes,
              notif_promotions = EXCLUDED.notif_promotions,
              privacy_incognito = EXCLUDED.privacy_incognito,
              privacy_read_receipts = EXCLUDED.privacy_read_receipts,
              conn_spotify = EXCLUDED.conn_spotify,
              conn_instagram = EXCLUDED.conn_instagram,
              updated_at = CURRENT_TIMESTAMP
        `,
			userID,
			data.Notifs["newMatches"], data.Notifs["messages"], data.Notifs["superLikes"], data.Notifs["promotions"],
			data.Privacy["incognito"], data.Privacy["readReceipts"],
			data.Connected["spotify"], data.Connected["instagram"],
		)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (r *SettingsRepository) GetSettings(userID string) (models.SettingsPayload, error) {
	var data models.SettingsPayload
	data.Notifs = make(map[string]bool)
	data.Privacy = make(map[string]bool)
	data.Connected = make(map[string]bool)

	var notifNewMatches, notifMessages, notifSuperLikes, notifPromotions bool
	var twoFactorEnabled bool
	var privIncognito, privReadReceipts bool
	var connSpotify, connInstagram bool

	query := `
      SELECT 
         COALESCE(up.display_name, ''), 
         COALESCE(u.email, ''),
         COALESCE(up.phone_number, ''),
         COALESCE(up.bio, ''), 
         COALESCE(up.intent, 'Dating'),
         COALESCE(up.avatar_url, ''),
         COALESCE(up.job_title, ''),
         COALESCE(up.cover_url, ''),
         COALESCE(l.city, ''),
         COALESCE(upref.min_age, 18), 
         COALESCE(upref.max_age, 50), 
         COALESCE(upref.max_distance_km, 25), 
         COALESCE(us.show_me, 'Everyone'),
         COALESCE(up.verified, false),
         COALESCE(us.two_factor_enabled, false),
         COALESCE(us.two_factor_channel, 'email'),
         COALESCE(us.global_mode, false), 
         COALESCE(us.notif_new_matches, true), 
         COALESCE(us.notif_messages, true), 
         COALESCE(us.notif_super_likes, true), 
         COALESCE(us.notif_promotions, false),
         COALESCE(us.privacy_incognito, false), 
         COALESCE(us.privacy_read_receipts, true),
         COALESCE(us.conn_spotify, false), 
         COALESCE(us.conn_instagram, false),
         COALESCE(ub.status,''),
         COALESCE(TO_CHAR(ub.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''),
         CASE
            WHEN ub.tier_id = 1 THEN 'BASIC'
            WHEN ub.tier_id = 2 THEN 'PREMIUM'
            ELSE 'NONE' END AS PLAN
      
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      LEFT JOIN user_locations l ON u.id = l.user_id
      LEFT JOIN user_preferences upref ON u.id = upref.user_id
      LEFT JOIN user_settings us ON u.id = us.user_id
      LEFT JOIN user_subscriptions ub ON u.id = ub.user_id
      WHERE u.id = $1
   `
	err := r.DB.QueryRow(query, userID).Scan(
		&data.Name, &data.Email, &data.PhoneNumber, &data.Bio, &data.Intent, &data.AvatarStorageURL,
		&data.Job, &data.CoverStorageURL, &data.Location,
		&data.AgeMin, &data.AgeMax, &data.Distance, &data.ShowMe,
		&data.Verified, &twoFactorEnabled, &data.TwoFactorChannel, &data.IsGlobal,
		&notifNewMatches, &notifMessages, &notifSuperLikes, &notifPromotions,
		&privIncognito, &privReadReceipts,
		&connSpotify, &connInstagram, &data.SubStatus, &data.ExpiresAt, &data.Plan,
	)
	if err != nil {
		log.Printf("CRITICAL: Error fetching settings for user %s: %v\n", userID, err)
		return data, err
	}
	data.Avatar = data.AvatarStorageURL
	data.Cover = data.CoverStorageURL

	data.TwoFactorEnabled = twoFactorEnabled
	data.Notifs["newMatches"] = notifNewMatches
	data.Notifs["messages"] = notifMessages
	data.Notifs["superLikes"] = notifSuperLikes
	data.Notifs["promotions"] = notifPromotions
	data.Privacy["incognito"] = privIncognito
	data.Privacy["readReceipts"] = privReadReceipts
	data.Connected["spotify"] = connSpotify
	data.Connected["instagram"] = connInstagram

	// Fetch Tags
	tagRows, err := r.DB.Query("SELECT tag FROM user_tags WHERE user_id = $1", userID)
	if err != nil {
		return data, fmt.Errorf("fetch profile tags: %w", err)
	}
	defer tagRows.Close()
	for tagRows.Next() {
		var tag string
		if err := tagRows.Scan(&tag); err != nil {
			return data, fmt.Errorf("scan profile tag: %w", err)
		}
		data.Tags = append(data.Tags, tag)
	}
	if err := tagRows.Err(); err != nil {
		return data, fmt.Errorf("iterate profile tags: %w", err)
	}
	if data.Tags == nil {
		data.Tags = []string{}
	}

	// -------------------------------------------------------------------------
	// POPULATE 6-SLOT PHOTO ARRAY FOR REACT FRONTEND
	// -------------------------------------------------------------------------
	photoRows, err := r.DB.Query("SELECT url FROM user_media WHERE user_id = $1 ORDER BY is_primary DESC, sort_order ASC, created_at DESC LIMIT 6", userID)
	if err != nil {
		return data, fmt.Errorf("fetch profile photos: %w", err)
	}
	var photos []string
	defer photoRows.Close()
	for photoRows.Next() {
		var url string
		if err := photoRows.Scan(&url); err != nil {
			return data, fmt.Errorf("scan profile photo: %w", err)
		}
		photos = append(photos, url)
	}
	if err := photoRows.Err(); err != nil {
		return data, fmt.Errorf("iterate profile photos: %w", err)
	}

	// Pad the array to exactly 6 slots to prevent React UI crashes
	paddedPhotos := make([]string, 6)
	for i := 0; i < 6; i++ {
		if i < len(photos) {
			paddedPhotos[i] = photos[i]
		} else {
			paddedPhotos[i] = "" // React component treats empty string as null empty slot
		}
	}
	data.Photos = paddedPhotos

	return data, nil
}

// DeleteAccount completely wipes a user and cascades down
func (r *SettingsRepository) DeleteAccount(userID string) error {
	_, err := r.DB.Exec("DELETE FROM users WHERE id = $1", userID)
	return err
}

// GetUserMedia fetches a user's uploaded gallery/vault images
func (r *SettingsRepository) GetUserMedia(userID string) ([]models.MediaItem, error) {
	query := `
       SELECT id::text, url, is_primary 
       FROM user_media 
       WHERE user_id = $1 
       ORDER BY is_primary DESC, sort_order ASC, created_at DESC
    `
	rows, err := r.DB.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var media []models.MediaItem
	for rows.Next() {
		var m models.MediaItem
		if err := rows.Scan(&m.ID, &m.URL, &m.IsPrimary); err != nil {
			return nil, fmt.Errorf("scan user media item: %w", err)
		}
		media = append(media, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user media: %w", err)
	}

	if media == nil {
		media = []models.MediaItem{}
	}
	return media, nil
}

func (r *SettingsRepository) SaveUserMedia(userID string, mediaURL string) (models.MediaItem, error) {
	var media models.MediaItem
	err := r.DB.QueryRow(`
		INSERT INTO user_media (user_id, url, created_at)
		VALUES ($1, $2, NOW())
		RETURNING id::text, url, is_primary, created_at
	`, userID, mediaURL).Scan(&media.ID, &media.URL, &media.IsPrimary, &media.CreatedAt)
	return media, err
}

func (r *SettingsRepository) DeleteUserMedia(userID string, mediaID string) error {
	query := `DELETE FROM user_media WHERE id = $1 AND user_id = $2`
	_, err := r.DB.Exec(query, mediaID, userID)
	return err
}

func (r *SettingsRepository) SetPrimaryMedia(userID string, mediaID string) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`UPDATE user_media SET is_primary = FALSE WHERE user_id = $1`, userID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(`UPDATE user_media SET is_primary = TRUE WHERE id = $1 AND user_id = $2`, mediaID, userID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(`
       UPDATE user_profiles 
       SET avatar_url = (SELECT url FROM user_media WHERE id = $1)
       WHERE user_id = $2
    `, mediaID, userID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// IncrementTokenVersion instantly logs out old JWTs
func (r *SettingsRepository) IncrementTokenVersion(userID string) (int64, error) {
	var version int64
	err := r.DB.QueryRow(`
		UPDATE users SET token_version = token_version + 1
		WHERE id = $1
		RETURNING token_version
	`, userID).Scan(&version)
	return version, err
}

// ============================================================================
// DATA EXPORT REQUIREMENTS
// ============================================================================

// GetUserByID fetches the core user record (needed for email dispatch)
func (r *SettingsRepository) GetUserByID(userID string) (*models.User, error) {
	var user models.User
	query := `SELECT id, email, username FROM users WHERE id = $1`
	err := r.DB.QueryRow(query, userID).Scan(&user.ID, &user.Email, &user.Username)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// Fetch all messages for the data export zip
func (r *SettingsRepository) GetAllUserMessages(userID string) ([]map[string]interface{}, error) {
	query := `
        SELECT id, sender_id, recipient_id, content, created_at 
        FROM messages 
        WHERE sender_id = $1 OR recipient_id = $1
        ORDER BY created_at DESC
    `
	rows, err := r.DB.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var msgs []map[string]interface{}
	for rows.Next() {
		var id, sender, recipient, content, time string
		if err := rows.Scan(&id, &sender, &recipient, &content, &time); err == nil {
			msgs = append(msgs, map[string]interface{}{
				"id": id, "sender_id": sender, "recipient_id": recipient, "content": content, "timestamp": time,
			})
		}
	}
	if msgs == nil {
		msgs = make([]map[string]interface{}, 0)
	}
	return msgs, nil
}

// Fetch all matches for data export zip
func (r *SettingsRepository) GetUserMatches(userID string) ([]string, error) {
	query := `
        SELECT target_id FROM interactions 
        WHERE actor_id = $1 AND is_match = TRUE
    `
	rows, err := r.DB.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var matches []string
	for rows.Next() {
		var matchID string
		if err := rows.Scan(&matchID); err == nil {
			matches = append(matches, matchID)
		}
	}
	if matches == nil {
		matches = make([]string, 0)
	}
	return matches, nil
}

// ============================================================================
// NEW ADDITIONS: Blocks & Verification
// ============================================================================

// GetBlockedUsers returns a list of users blocked by the current user
func (r *SettingsRepository) GetBlockedUsers(userID string) ([]map[string]interface{}, error) {
	query := `
       SELECT b.blocked_id, up.display_name, up.avatar_url, TO_CHAR(b.created_at, 'Mon DD, YYYY') as date
       FROM blocks b
       JOIN user_profiles up ON b.blocked_id = up.user_id
       WHERE b.blocker_id = $1
       ORDER BY b.created_at DESC
    `
	rows, err := r.DB.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var blockedUsers []map[string]interface{}
	for rows.Next() {
		var id, name, avatar, date string
		if err := rows.Scan(&id, &name, &avatar, &date); err == nil {
			blockedUsers = append(blockedUsers, map[string]interface{}{
				"id":     id,
				"name":   name,
				"avatar": avatar,
				"date":   date,
			})
		}
	}

	if blockedUsers == nil {
		blockedUsers = []map[string]interface{}{} // Return empty array instead of null
	}
	return blockedUsers, nil
}

// UnblockUser removes a block record
func (r *SettingsRepository) UnblockUser(blockerID, blockedID string) error {
	_, err := r.DB.Exec("DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2", blockerID, blockedID)
	return err
}

// GetPrimaryMediaURL retrieves the public URL of a user's primary profile picture.
func (r *SettingsRepository) GetPrimaryMediaURL(userID string) (string, error) {
	var url string
	query := `SELECT media_url FROM user_media WHERE user_id = $1 AND is_primary = true LIMIT 1`

	err := r.DB.QueryRow(query, userID).Scan(&url)
	if err != nil {
		return "", err
	}

	return url, nil
}

func (r *SettingsRepository) ReservePlaidIdentityVerificationAttempt(ctx context.Context, userID, attemptID string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var lockedUserID string
	if err := tx.QueryRowContext(ctx, `SELECT id::text FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&lockedUserID); err != nil {
		return err
	}

	var attemptInProgress bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM plaid_identity_verification_attempts
			WHERE user_id = $1 AND status = 'creating'
			  AND created_at > NOW() - INTERVAL '30 seconds'
		)
	`, userID).Scan(&attemptInProgress); err != nil {
		return err
	}
	if attemptInProgress {
		return ErrPlaidIdentityVerificationRateLimited
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO plaid_identity_verification_attempts (attempt_id, user_id, status, consented_at)
		VALUES ($1, $2, 'creating', NOW())
	`, attemptID, userID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (r *SettingsRepository) MarkPlaidIdentityVerificationAttemptReady(ctx context.Context, userID, attemptID string) error {
	result, err := r.DB.ExecContext(ctx, `
		UPDATE plaid_identity_verification_attempts
		SET status = 'active', updated_at = NOW()
		WHERE attempt_id = $1 AND user_id = $2 AND status = 'creating'
	`, attemptID, userID)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected != 1 {
		return ErrPlaidIdentityVerificationNotFound
	}
	return nil
}

func (r *SettingsRepository) FailPlaidIdentityVerificationAttempt(ctx context.Context, userID, attemptID string) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE plaid_identity_verification_attempts
		SET status = 'canceled', updated_at = NOW()
		WHERE attempt_id = $1 AND user_id = $2 AND status = 'creating'
	`, attemptID, userID)
	return err
}

func (r *SettingsRepository) GetPlaidIdentityVerificationAttempt(
	ctx context.Context,
	userID, attemptID string,
) (string, string, error) {
	var identityVerificationID sql.NullString
	var status string
	err := r.DB.QueryRowContext(ctx, `
		SELECT identity_verification_id, status
		FROM plaid_identity_verification_attempts
		WHERE attempt_id = $1 AND user_id = $2
	`, attemptID, userID).Scan(&identityVerificationID, &status)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", ErrPlaidIdentityVerificationNotFound
		}
		return "", "", err
	}
	return identityVerificationID.String, status, nil
}

func (r *SettingsRepository) SetPlaidIdentityVerificationID(
	ctx context.Context,
	userID, attemptID, identityVerificationID string,
) error {
	result, err := r.DB.ExecContext(ctx, `
		UPDATE plaid_identity_verification_attempts
		SET identity_verification_id = COALESCE(identity_verification_id, $3),
		    updated_at = NOW()
		WHERE attempt_id = $1 AND user_id = $2
		  AND (
		    identity_verification_id = $3
		    OR (identity_verification_id IS NULL AND status IN ('active', 'pending_review'))
		  )
	`, attemptID, userID, identityVerificationID)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected != 1 {
		return ErrPlaidIdentityVerificationConflict
	}
	return nil
}

func (r *SettingsRepository) ClearPlaidIdentityVerificationID(
	ctx context.Context,
	userID, attemptID, identityVerificationID string,
) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE plaid_identity_verification_attempts
		SET identity_verification_id = NULL, updated_at = NOW()
		WHERE attempt_id = $1 AND user_id = $2 AND identity_verification_id = $3
		  AND status IN ('active', 'pending_review')
	`, attemptID, userID, identityVerificationID)
	return err
}

func (r *SettingsRepository) ApplyPlaidIdentityVerificationStatus(
	ctx context.Context,
	userID, attemptID, identityVerificationID, status string,
) (bool, error) {
	switch status {
	case "active", "success", "failed", "expired", "canceled", "pending_review":
	default:
		return false, fmt.Errorf("invalid Plaid Identity Verification status")
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	var currentStatus string
	var currentID sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT status, identity_verification_id
		FROM plaid_identity_verification_attempts
		WHERE attempt_id = $1 AND user_id = $2
		FOR UPDATE
	`, attemptID, userID).Scan(&currentStatus, &currentID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, ErrPlaidIdentityVerificationNotFound
		}
		return false, err
	}
	if currentID.Valid && currentID.String != identityVerificationID {
		return false, ErrPlaidIdentityVerificationConflict
	}
	if currentStatus == "success" || currentStatus == "failed" ||
		currentStatus == "expired" || currentStatus == "canceled" {
		return false, tx.Commit()
	}
	if currentStatus == status && currentID.Valid {
		return false, tx.Commit()
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE plaid_identity_verification_attempts
		SET identity_verification_id = $3, status = $4, updated_at = NOW()
		WHERE attempt_id = $1 AND user_id = $2
	`, attemptID, userID, identityVerificationID, status); err != nil {
		return false, err
	}

	actionType := ""
	switch status {
	case "success":
		result, err := tx.ExecContext(ctx, `UPDATE user_profiles SET verified = true WHERE user_id = $1`, userID)
		if err != nil {
			return false, err
		}
		rowsAffected, err := result.RowsAffected()
		if err != nil {
			return false, err
		}
		if rowsAffected != 1 {
			return false, errors.New("user profile not found while applying Plaid verification")
		}
		actionType = "KYC_VERIFICATION_PASSED"
	case "failed":
		actionType = "KYC_VERIFICATION_REJECTED"
	case "pending_review":
		actionType = "KYC_MANUAL_REVIEW_REQUESTED"
	}

	if actionType != "" {
		metadata, err := json.Marshal(map[string]string{
			"provider":                    "PLAID_IDENTITY_VERIFICATION",
			"identity_verification_id":    identityVerificationID,
			"status":                      status,
			"plaid_identity_verification": "true",
		})
		if err != nil {
			return false, fmt.Errorf("encode Plaid verification audit metadata: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO user_action_logs (user_id, action_type, metadata, created_at)
			VALUES ($1, $2, $3::jsonb, NOW())
		`, userID, actionType, string(metadata)); err != nil {
			return false, err
		}
	}

	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}
