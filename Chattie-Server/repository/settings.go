package repository

import (
	"chattie-backend/models"
	"database/sql"
	"log"
)

type SettingsRepository struct {
	DB *sql.DB
}

func NewSettingsRepository(db *sql.DB) *SettingsRepository {
	return &SettingsRepository{DB: db}
}

// UpdateSettings updates profile, preferences, settings, and tags in a single transaction
func (r *SettingsRepository) UpdateSettings(userID string, data models.SettingsPayload) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return err
	}

	// 1. Update Profile (Now includes phone_number)
	_, err = tx.Exec(`
       UPDATE user_profiles 
       SET display_name = $1, bio = $2, intent = $3, avatar_url = $4, job_title = $5, cover_url = $6, phone_number = $7
       WHERE user_id = $8`,
		data.Name, data.Bio, data.Intent, data.Avatar, data.Job, data.Cover, data.PhoneNumber, userID)
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

	// 3. Update Preferences (Map frontend 0 values to safe defaults)
	if data.AgeMin == 0 {
		data.AgeMin = 18
	}
	if data.AgeMax == 0 {
		data.AgeMax = 50
	}
	if data.Distance == 0 {
		data.Distance = 25
	}

	_, err = tx.Exec(`
       UPDATE user_preferences 
       SET interested_in = $1, min_age = $2, max_age = $3, max_distance_km = $4
       WHERE user_id = $5`,
		data.ShowMe, data.AgeMin, data.AgeMax, data.Distance, userID)
	if err != nil {
		tx.Rollback()
		return err
	}

	// 4. Update Tags
	_, err = tx.Exec("DELETE FROM user_tags WHERE user_id = $1", userID)
	if err != nil {
		tx.Rollback()
		return err
	}

	for _, tag := range data.Tags {
		_, err = tx.Exec("INSERT INTO user_tags (user_id, tag) VALUES ($1, $2)", userID, tag)
		if err != nil {
			tx.Rollback()
			return err
		}
	}

	// 5. Upsert Settings Toggles (Only update if the frontend sent the maps)
	if data.Notifs != nil && data.Privacy != nil && data.Connected != nil {
		_, err = tx.Exec(`
           INSERT INTO user_settings (
              user_id, global_mode, show_me, 
              notif_new_matches, notif_messages, notif_super_likes, notif_promotions,
              privacy_incognito, privacy_read_receipts, conn_spotify, conn_instagram
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (user_id) DO UPDATE SET
              global_mode = EXCLUDED.global_mode,
              show_me = EXCLUDED.show_me,
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
			userID, data.IsGlobal, data.ShowMe,
			data.Notifs["newMatches"], data.Notifs["messages"], data.Notifs["superLikes"], data.Notifs["promotions"],
			data.Privacy["incognito"], data.Privacy["readReceipts"],
			data.Connected["spotify"], data.Connected["instagram"],
		)
		if err != nil {
			tx.Rollback()
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
         COALESCE(upref.interested_in, 'Everyone'),
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
         COALESCE(TO_CHAR(ub.expires_at,'YYYY:MM:DD HH24:MI:SS'), ''),
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
		&data.Name, &data.Email, &data.PhoneNumber, &data.Bio, &data.Intent, &data.Avatar,
		&data.Job, &data.Cover, &data.Location,
		&data.AgeMin, &data.AgeMax, &data.Distance, &data.ShowMe,
		&data.IsGlobal,
		&notifNewMatches, &notifMessages, &notifSuperLikes, &notifPromotions,
		&privIncognito, &privReadReceipts,
		&connSpotify, &connInstagram, &data.SubStatus, &data.ExpiresAt, &data.Plan,
	)
	if err != nil {
		log.Printf("CRITICAL: Error fetching settings for user %s: %v\n", userID, err)
		return data, err
	}

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
	if err == nil {
		defer tagRows.Close()
		for tagRows.Next() {
			var tag string
			if err := tagRows.Scan(&tag); err == nil {
				data.Tags = append(data.Tags, tag)
			}
		}
	}
	if data.Tags == nil {
		data.Tags = []string{}
	}

	// -------------------------------------------------------------------------
	// POPULATE 6-SLOT PHOTO ARRAY FOR REACT FRONTEND
	// -------------------------------------------------------------------------
	photoRows, err := r.DB.Query("SELECT url FROM user_media WHERE user_id = $1 ORDER BY is_primary DESC, sort_order ASC, created_at DESC LIMIT 6", userID)
	var photos []string
	if err == nil {
		defer photoRows.Close()
		for photoRows.Next() {
			var url string
			if err := photoRows.Scan(&url); err == nil {
				photos = append(photos, url)
			}
		}
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
		if err := rows.Scan(&m.ID, &m.URL, &m.IsPrimary); err == nil {
			media = append(media, m)
		}
	}

	if media == nil {
		media = []models.MediaItem{}
	}
	return media, nil
}

func (r *SettingsRepository) SaveUserMedia(userID string, mediaURL string) error {
	query := `INSERT INTO user_media (user_id, url, created_at) VALUES ($1, $2, NOW())`
	_, err := r.DB.Exec(query, userID, mediaURL)
	return err
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
func (r *SettingsRepository) IncrementTokenVersion(userID string) error {
	_, err := r.DB.Exec("UPDATE users SET token_version = token_version + 1 WHERE id = $1", userID)
	return err
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

func (r *SettingsRepository) VerifyProfile(userID string) error {
	query := `UPDATE user_profiles SET verified = true WHERE user_id = $1`
	_, err := r.DB.Exec(query, userID)
	return err
}

// VerifyProfileV2 marks a profile as verified AND logs the exact name extracted from their ID Card.
// This allows Trust & Safety admins to audit KYC data later if a user is flagged.
func (r *SettingsRepository) VerifyProfileV2(userID string, extractedGovtName string, rawDocData string) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Mark the profile as fully verified
	_, err = tx.Exec(`UPDATE user_profiles SET verified = true WHERE user_id = $1`, userID)
	if err != nil {
		return err
	}

	// 2. Log the KYC data for future Trust & Safety audits.
	metadata := map[string]string{
		"extracted_name":    extractedGovtName,
		"raw_document_dump": rawDocData,
		"verification_type": "AWS_REKOGNITION_GOVT_ID",
	}

	// Assuming action_logs metadata is JSONB, pass it directly
	_, err = tx.Exec(`
		INSERT INTO user_action_logs (user_id, action_type, metadata, created_at) 
		VALUES ($1, 'KYC_VERIFICATION_PASSED', $2, NOW())
	`, userID, metadata)

	if err != nil {
		log.Printf("[KYC AUDIT WARNING] Failed to log KYC metadata for user %s: %v", userID, err)
	}

	return tx.Commit()
}

// GetVerificationConfig returns the dynamic rules for KYC frontend directly from the database
func (r *SettingsRepository) GetVerificationConfig() (models.VerificationConfig, error) {
	config := models.VerificationConfig{
		Countries:      []string{},
		DocumentTypes:  make(map[string][]string),
		DocumentLabels: make(map[string]string),
		Poses:          []string{},
	}

	// 1. Fetch Active Countries (Ordered by sort_order)
	countryRows, err := r.DB.Query("SELECT name FROM kyc_countries WHERE is_active = TRUE ORDER BY sort_order ASC, name ASC")
	if err != nil {
		return config, err
	}
	defer countryRows.Close()

	for countryRows.Next() {
		var name string
		if err := countryRows.Scan(&name); err == nil {
			config.Countries = append(config.Countries, name)
		}
	}

	// 2. Fetch Document Labels
	docRows, err := r.DB.Query("SELECT code, label FROM kyc_documents")
	if err != nil {
		return config, err
	}
	defer docRows.Close()

	for docRows.Next() {
		var code, label string
		if err := docRows.Scan(&code, &label); err == nil {
			config.DocumentLabels[code] = label
		}
	}

	// 3. Fetch Country to Document Mappings
	mapQuery := `
        SELECT c.name, d.code
        FROM kyc_country_documents kcd
        JOIN kyc_countries c ON kcd.country_id = c.id
        JOIN kyc_documents d ON kcd.document_id = d.id
        WHERE c.is_active = TRUE
        ORDER BY d.id ASC
    `
	mapRows, err := r.DB.Query(mapQuery)
	if err != nil {
		return config, err
	}
	defer mapRows.Close()

	for mapRows.Next() {
		var country, docCode string
		if err := mapRows.Scan(&country, &docCode); err == nil {
			config.DocumentTypes[country] = append(config.DocumentTypes[country], docCode)
		}
	}

	// 4. Fetch Active Poses
	poseRows, err := r.DB.Query("SELECT instruction FROM kyc_poses WHERE is_active = TRUE ORDER BY id ASC")
	if err != nil {
		return config, err
	}
	defer poseRows.Close()

	for poseRows.Next() {
		var instruction string
		if err := poseRows.Scan(&instruction); err == nil {
			config.Poses = append(config.Poses, instruction)
		}
	}

	return config, nil
}

// SubmitForManualReview logs a failed automated KYC attempt into the admin queue
func (r *SettingsRepository) SubmitForManualReview(userID, idCardURL, selfieURL, reason string) error {
	metadata := map[string]string{
		"id_card_url": idCardURL,
		"selfie_url":  selfieURL,
		"reason":      reason,
		"status":      "PENDING_ADMIN_REVIEW",
	}

	// Log this action so it appears in the Admin Moderation/KYC Queue
	_, err := r.DB.Exec(`
        INSERT INTO user_action_logs (user_id, action_type, metadata, created_at) 
        VALUES ($1, 'KYC_MANUAL_REVIEW_REQUESTED', $2, NOW())
    `, userID, metadata)

	return err
}
