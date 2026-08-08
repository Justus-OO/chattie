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

	// 1. Update Profile
	_, err = tx.Exec(`
		UPDATE user_profiles 
		SET display_name = $1, bio = $2, intent = $3, avatar_url = $4
		WHERE user_id = $5`,
		data.Name, data.Bio, data.Intent, data.Avatar, userID)
	if err != nil {
		tx.Rollback()
		return err
	}

	// 2. Update Preferences
	_, err = tx.Exec(`
		UPDATE user_preferences 
		SET interested_in = $1, min_age = $2, max_age = $3, max_distance_km = $4
		WHERE user_id = $5`,
		data.ShowMe, data.AgeMin, data.AgeMax, data.Distance, userID)
	if err != nil {
		tx.Rollback()
		return err
	}

	// 3. Update Tags (Clear old, insert new)
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

	// 4. Upsert Settings Toggles
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

	return tx.Commit()
}

// DeleteAccount completely wipes a user and cascades down
func (r *SettingsRepository) DeleteAccount(userID string) error {
	_, err := r.DB.Exec("DELETE FROM users WHERE id = $1", userID)
	return err
}
func (r *SettingsRepository) GetSettings(userID string) (models.SettingsPayload, error) {
	var data models.SettingsPayload
	data.Notifs = make(map[string]bool)
	data.Privacy = make(map[string]bool)
	data.Connected = make(map[string]bool)

	// Temporary variables for unaddressable map properties
	var notifNewMatches, notifMessages, notifSuperLikes, notifPromotions bool
	var privIncognito, privReadReceipts bool
	var connSpotify, connInstagram bool

	// 1. LEFT JOIN from 'users' ensures we ALWAYS return 1 row, even if profile/settings are missing.
	// 2. COALESCE ensures we NEVER get a NULL pointer panic during Scan.
	// 3. Added user_locations join to fetch the city.
	query := `
       SELECT 
          COALESCE(up.display_name, ''), 
          COALESCE(up.bio, ''), 
          COALESCE(up.intent, 'Dating'),
          COALESCE(up.avatar_url, ''),
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
          COALESCE(us.conn_instagram, false)
       FROM users u
       LEFT JOIN user_profiles up ON u.id = up.user_id
       LEFT JOIN user_locations l ON u.id = l.user_id
       LEFT JOIN user_preferences upref ON u.id = upref.user_id
       LEFT JOIN user_settings us ON u.id = us.user_id
       WHERE u.id = $1
    `

	err := r.DB.QueryRow(query, userID).Scan(
		&data.Name, &data.Bio, &data.Intent, &data.Avatar,
		&data.Location, // <-- Now properly scanning the location from user_locations.city
		&data.AgeMin, &data.AgeMax, &data.Distance, &data.ShowMe,
		&data.IsGlobal,
		&notifNewMatches, &notifMessages, &notifSuperLikes, &notifPromotions,
		&privIncognito, &privReadReceipts,
		&connSpotify, &connInstagram,
	)
	if err != nil {
		log.Printf("CRITICAL: Error fetching settings for user %s: %v\n", userID, err)
		return data, err
	}

	// Supply empty strings for UI fields that don't have DB columns yet in your schema
	data.Job = ""
	data.Cover = ""

	// Assign temp variables back to maps
	data.Notifs["newMatches"] = notifNewMatches
	data.Notifs["messages"] = notifMessages
	data.Notifs["superLikes"] = notifSuperLikes
	data.Notifs["promotions"] = notifPromotions

	data.Privacy["incognito"] = privIncognito
	data.Privacy["readReceipts"] = privReadReceipts

	data.Connected["spotify"] = connSpotify
	data.Connected["instagram"] = connInstagram

	// Fetch Tags from the user_tags table
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

	// Ensure tags is never null for the frontend (React expects an array)
	if data.Tags == nil {
		data.Tags = []string{}
	}

	return data, nil
}

// GetUserMedia fetches a user's uploaded gallery/vault images
func (r *SettingsRepository) GetUserMedia(userID string) ([]models.MediaItem, error) {
	// Pulls from your user_media table, sorting the primary photo first
	query := `
		SELECT id::text, media_url, is_primary 
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

	// Always return an empty array instead of null for React's map()
	if media == nil {
		media = []models.MediaItem{}
	}

	return media, nil
}

func (r *SettingsRepository) SaveUserMedia(userID string, mediaURL string) error {
	query := `
		INSERT INTO user_media (user_id, url, created_at) 
		VALUES ($1, $2, NOW())
	`
	_, err := r.DB.Exec(query, userID, mediaURL)
	return err
}

// Deletes the media only if it belongs to the requesting user
func (r *SettingsRepository) DeleteUserMedia(userID string, mediaID string) error {
	query := `DELETE FROM user_media WHERE id = $1 AND user_id = $2`
	_, err := r.DB.Exec(query, mediaID, userID)
	return err
}

// Sets one photo to primary = true, and all others to false
func (r *SettingsRepository) SetPrimaryMedia(userID string, mediaID string) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Reset all user's media to NOT primary
	_, err = tx.Exec(`UPDATE user_media SET is_primary = FALSE WHERE user_id = $1`, userID)
	if err != nil {
		return err
	}

	// 2. Set the chosen media to primary
	_, err = tx.Exec(`UPDATE user_media SET is_primary = TRUE WHERE id = $1 AND user_id = $2`, mediaID, userID)
	if err != nil {
		return err
	}

	// 3. (Optional but recommended) Mirror this to user_profiles table so it's globally cached
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
