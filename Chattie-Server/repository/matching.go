package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

var ErrInvalidDiscoveryPreferences = errors.New("invalid discovery preferences")

func lockUsersInOrder(ctx context.Context, tx *sql.Tx, firstID, secondID string) (map[string]struct{}, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id FROM users WHERE id IN ($1, $2) ORDER BY id FOR UPDATE
	`, firstID, secondID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	locked := make(map[string]struct{}, 2)
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		locked[userID] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return locked, nil
}

func normalizeShowMePreference(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "everyone", "all":
		return "Everyone", nil
	case "men", "man", "male":
		return "Men", nil
	case "women", "woman", "female":
		return "Women", nil
	case "other", "nonbinary", "non-binary":
		return "Other", nil
	default:
		return "", fmt.Errorf("%w: unsupported show_me value", ErrInvalidDiscoveryPreferences)
	}
}

func normalizeMatchingIntent(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "all":
		return "All", nil
	case "casual", "dating", "friends", "network":
		return strings.ToLower(strings.TrimSpace(value)), nil
	default:
		return "", fmt.Errorf("%w: unsupported interested_in value", ErrInvalidDiscoveryPreferences)
	}
}

func normalizeProfileGender(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "male", "man":
		return "male", nil
	case "female", "woman":
		return "female", nil
	case "other", "everyone", "nonbinary", "non-binary":
		return "other", nil
	default:
		return "", fmt.Errorf("%w: unsupported gender value", ErrInvalidDiscoveryPreferences)
	}
}

func tagCompatibilityScoreSQL(leftTags, rightTags string) string {
	return fmt.Sprintf(`COALESCE((
		100.0 * (
			SELECT COUNT(DISTINCT LOWER(BTRIM(left_tag)))
			FROM UNNEST(COALESCE(%[1]s, ARRAY[]::VARCHAR[])) AS left_values(left_tag)
			WHERE NULLIF(BTRIM(left_tag), '') IS NOT NULL
			  AND EXISTS (
				  SELECT 1
				  FROM UNNEST(COALESCE(%[2]s, ARRAY[]::VARCHAR[])) AS right_values(right_tag)
				  WHERE LOWER(BTRIM(right_tag)) = LOWER(BTRIM(left_tag))
			  )
		) / NULLIF((
			SELECT COUNT(DISTINCT LOWER(BTRIM(tag)))
			FROM UNNEST(COALESCE(%[1]s, ARRAY[]::VARCHAR[]) || COALESCE(%[2]s, ARRAY[]::VARCHAR[])) AS all_values(tag)
			WHERE NULLIF(BTRIM(tag), '') IS NOT NULL
		), 0)
	)::INT, 0)`, leftTags, rightTags)
}

const actionEligibilityQuery = `
SELECT EXISTS (
	SELECT 1
	FROM users viewer
	JOIN user_profiles viewer_profile ON viewer_profile.user_id = viewer.id
	LEFT JOIN user_preferences viewer_preferences ON viewer_preferences.user_id = viewer.id
	LEFT JOIN user_settings viewer_settings ON viewer_settings.user_id = viewer.id
	LEFT JOIN user_locations viewer_location ON viewer_location.user_id = viewer.id
	JOIN users target ON target.id = $2
	JOIN user_profiles target_profile ON target_profile.user_id = target.id
	LEFT JOIN user_preferences target_preferences ON target_preferences.user_id = target.id
	LEFT JOIN user_settings target_settings ON target_settings.user_id = target.id
	LEFT JOIN user_locations target_location ON target_location.user_id = target.id
	WHERE viewer.id = $1
	  AND viewer.id <> target.id
	  AND LOWER(viewer.status) IN ('active', 'online')
	  AND LOWER(target.status) IN ('active', 'online')
	  AND viewer.role <> 'admin'
	  AND target.role <> 'admin'
	  AND viewer_profile.date_of_birth IS NOT NULL
	  AND target_profile.date_of_birth IS NOT NULL
	  AND EXTRACT(YEAR FROM age(viewer_profile.date_of_birth))::INT >= 18
	  AND EXTRACT(YEAR FROM age(target_profile.date_of_birth))::INT >= 18
	  AND NULLIF(BTRIM(viewer_profile.display_name), '') IS NOT NULL
	  AND NULLIF(BTRIM(target_profile.display_name), '') IS NOT NULL
	  AND EXISTS (
		  SELECT 1 FROM user_media media
		  WHERE media.user_id = viewer.id AND NULLIF(BTRIM(media.url), '') IS NOT NULL
	  )
	  AND EXISTS (
		  SELECT 1 FROM user_media media
		  WHERE media.user_id = target.id AND NULLIF(BTRIM(media.url), '') IS NOT NULL
	  )
	  AND NOT EXISTS (
		  SELECT 1 FROM blocks block
		  WHERE (block.blocker_id = viewer.id AND block.blocked_id = target.id)
		     OR (block.blocker_id = target.id AND block.blocked_id = viewer.id)
	  )
	  AND (
		  LOWER(BTRIM(COALESCE(viewer_settings.show_me, 'Everyone'))) IN ('everyone', 'all', '')
		  OR (LOWER(BTRIM(viewer_settings.show_me)) = 'men' AND LOWER(BTRIM(target_profile.gender)) IN ('male', 'man'))
		  OR (LOWER(BTRIM(viewer_settings.show_me)) = 'women' AND LOWER(BTRIM(target_profile.gender)) IN ('female', 'woman'))
		  OR (LOWER(BTRIM(viewer_settings.show_me)) = 'other' AND LOWER(BTRIM(target_profile.gender)) IN ('other', 'nonbinary', 'non-binary'))
	  )
	  AND (
		  LOWER(BTRIM(COALESCE(target_settings.show_me, 'Everyone'))) IN ('everyone', 'all', '')
		  OR (LOWER(BTRIM(target_settings.show_me)) = 'men' AND LOWER(BTRIM(viewer_profile.gender)) IN ('male', 'man'))
		  OR (LOWER(BTRIM(target_settings.show_me)) = 'women' AND LOWER(BTRIM(viewer_profile.gender)) IN ('female', 'woman'))
		  OR (LOWER(BTRIM(target_settings.show_me)) = 'other' AND LOWER(BTRIM(viewer_profile.gender)) IN ('other', 'nonbinary', 'non-binary'))
	  )
	  AND (
		  LOWER(BTRIM(COALESCE(viewer_preferences.interested_in, 'All'))) IN ('all', '')
		  OR LOWER(BTRIM(COALESCE(target_preferences.interested_in, 'All'))) IN ('all', '')
		  OR LOWER(BTRIM(viewer_preferences.interested_in)) = LOWER(BTRIM(target_preferences.interested_in))
	  )
	  AND EXTRACT(YEAR FROM age(target_profile.date_of_birth))::INT
	      BETWEEN COALESCE(viewer_preferences.min_age, 18) AND COALESCE(viewer_preferences.max_age, 99)
	  AND EXTRACT(YEAR FROM age(viewer_profile.date_of_birth))::INT
	      BETWEEN COALESCE(target_preferences.min_age, 18) AND COALESCE(target_preferences.max_age, 99)
	  AND (
		  COALESCE(target_settings.privacy_incognito, FALSE) = FALSE
		  OR EXISTS (
			  SELECT 1 FROM interactions prior_like
			  WHERE prior_like.actor_id = target.id AND prior_like.target_id = viewer.id
			    AND prior_like.action_type IN ('LIKE', 'SUPER_LIKE')
		  )
	  )
	  AND (
		  viewer_location.country_code IS NULL
		  OR target_location.country_code IS NULL
		  OR viewer_location.country_code = target_location.country_code
		  OR (COALESCE(viewer_settings.global_mode, FALSE) AND COALESCE(target_settings.global_mode, FALSE))
	  )
	  AND (
		  COALESCE(viewer_settings.global_mode, FALSE) AND COALESCE(target_settings.global_mode, FALSE)
		  OR (
			  CASE
				  WHEN viewer_location.latitude IS NULL OR viewer_location.longitude IS NULL
				    OR target_location.latitude IS NULL OR target_location.longitude IS NULL THEN 9999.0
				  ELSE 6371 * acos(LEAST(1.0, GREATEST(-1.0,
					  cos(radians(viewer_location.latitude)) * cos(radians(target_location.latitude))
					  * cos(radians(target_location.longitude) - radians(viewer_location.longitude))
					  + sin(radians(viewer_location.latitude)) * sin(radians(target_location.latitude))
				  )))
			  END <= COALESCE(viewer_preferences.max_distance_km, 50)
			  AND
			  CASE
				  WHEN viewer_location.latitude IS NULL OR viewer_location.longitude IS NULL
				    OR target_location.latitude IS NULL OR target_location.longitude IS NULL THEN 9999.0
				  ELSE 6371 * acos(LEAST(1.0, GREATEST(-1.0,
					  cos(radians(viewer_location.latitude)) * cos(radians(target_location.latitude))
					  * cos(radians(target_location.longitude) - radians(viewer_location.longitude))
					  + sin(radians(viewer_location.latitude)) * sin(radians(target_location.latitude))
				  )))
			  END <= COALESCE(target_preferences.max_distance_km, 50)
		  )
	  )
)
`
