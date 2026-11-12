package repository

import (
	"chattie-backend/models"
	"context"

	"github.com/lib/pq"
)

// GetSwipeDeck fetches the Tinder-style swipe queue enforcing all privacy, block, and distance logic.
func (r *Repository) GetSwipeDeck(ctx context.Context, userID string, limit, offset int) ([]models.DiscoverProfile, error) {
	//goland:noinspection SqlDialectInspection
	query := `
       WITH current_user_data AS (
          SELECT 
             COALESCE(ussu.show_me, 'Everyone') AS show_me,
             COALESCE(current_profile.gender, '') AS gender,
             EXTRACT(YEAR FROM age(current_profile.date_of_birth))::INT AS age,
             COALESCE(pref.interested_in, 'All') AS viewer_intent,
             COALESCE(pref.min_age, 18) AS min_age, 
             COALESCE(pref.max_age, 100) AS max_age, 
             COALESCE(pref.max_distance_km, 50) AS max_distance_km,
             loc.latitude AS latitude,
             loc.longitude AS longitude,
             COALESCE(us.global_mode, FALSE) AS global_mode,
             COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = $1), ARRAY[]::VARCHAR[]) AS my_tags
          FROM users u
          LEFT JOIN user_preferences pref ON u.id = pref.user_id
          LEFT JOIN user_profiles current_profile ON u.id = current_profile.user_id
          LEFT JOIN user_settings ussu ON u.id = ussu.user_id
          LEFT JOIN user_locations loc ON u.id = loc.user_id
          LEFT JOIN user_settings us ON u.id = us.user_id
          WHERE u.id = $1
       ),
       potential_matches AS (
          -- Step 2: Filter by hard constraints, blocks, incognito, and calculate distance
          SELECT 
             u.id,
             p.display_name,
             COALESCE(p.bio, '') AS bio,
             EXTRACT(YEAR FROM age(p.date_of_birth))::INT AS age,
             COALESCE(l.city, 'Unknown') AS city,
             CASE 
                WHEN cu.latitude IS NULL OR cu.longitude IS NULL OR l.latitude IS NULL OR l.longitude IS NULL THEN 9999.0
                ELSE (6371 * acos(LEAST(1.0, GREATEST(-1.0,
                   cos(radians(cu.latitude)) * cos(radians(l.latitude)) * 
                   cos(radians(l.longitude) - radians(cu.longitude)) + 
                   sin(radians(cu.latitude)) * sin(radians(l.latitude))
                ))))
             END AS distance_km,
             
             COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[]) AS their_tags,
             
             -- UPGRADE: Correct URL column and respect primary image order
             COALESCE(
                ARRAY(SELECT url FROM user_media WHERE user_id = u.id AND NULLIF(BTRIM(url), '') IS NOT NULL ORDER BY is_primary DESC, sort_order ASC, created_at ASC LIMIT 6),
                ARRAY[]::TEXT[]
             ) AS images,
             
             cu.my_tags,
             cu.global_mode,
             cu.max_distance_km,
             COALESCE(target_preferences.min_age, 18) AS min_age,
             COALESCE(target_preferences.max_age, 100) AS max_age
          FROM users u
          JOIN user_profiles p ON u.id = p.user_id
          LEFT JOIN user_locations l ON u.id = l.user_id
          LEFT JOIN user_preferences target_preferences ON u.id = target_preferences.user_id
          LEFT JOIN user_settings target_settings ON u.id = target_settings.user_id
          CROSS JOIN current_user_data cu
          WHERE u.id != $1
            AND u.status IN ('active', 'online', 'ONLINE')
            AND u.role <> 'admin'
            AND NULLIF(BTRIM(p.display_name), '') IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM user_media um
                WHERE um.user_id = u.id AND NULLIF(BTRIM(um.url), '') IS NOT NULL
            )
            AND cu.age IS NOT NULL
            AND (
                lower(BTRIM(cu.show_me)) IN ('everyone', 'all', '')
                OR lower(BTRIM(p.gender)) = CASE lower(BTRIM(cu.show_me))
                    WHEN 'men' THEN 'male'
                    WHEN 'women' THEN 'female'
                    ELSE lower(BTRIM(cu.show_me))
                END
            )
            AND (
                lower(BTRIM(COALESCE(target_settings.show_me, 'Everyone'))) IN ('everyone', 'all', '')
                OR (lower(BTRIM(COALESCE(target_settings.show_me, 'Everyone'))) = 'men' AND lower(BTRIM(cu.gender)) IN ('male', 'man'))
                OR (lower(BTRIM(COALESCE(target_settings.show_me, 'Everyone'))) = 'women' AND lower(BTRIM(cu.gender)) IN ('female', 'woman'))
            )
            AND (
                lower(BTRIM(COALESCE(target_preferences.interested_in, 'All'))) IN ('all', '')
                OR lower(BTRIM(cu.viewer_intent)) IN ('all', '')
                OR lower(BTRIM(target_preferences.interested_in)) = lower(BTRIM(cu.viewer_intent))
            )
            AND (EXTRACT(YEAR FROM age(p.date_of_birth))::INT) BETWEEN cu.min_age AND cu.max_age
            AND cu.age BETWEEN COALESCE(target_preferences.min_age, 18)
                           AND COALESCE(target_preferences.max_age, 100)
            AND NOT EXISTS (
              SELECT 1 FROM interactions i WHERE i.actor_id = $1 AND i.target_id = u.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM blocks b 
              WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) 
                 OR (b.blocker_id = u.id AND b.blocked_id = $1)
            )
            AND (
              COALESCE(target_settings.privacy_incognito, FALSE) = FALSE 
              OR EXISTS (
                  SELECT 1 FROM interactions i 
                  WHERE i.actor_id = u.id AND i.target_id = $1 AND i.action_type IN ('LIKE', 'SUPER_LIKE')
              )
            )
       )
       -- Step 3: Calculate Match Percentage and apply Global Mode overrides
       SELECT 
          m.id,
          m.display_name,
          COALESCE(m.bio, ''),
          m.age,
          COALESCE(m.city, 'Unknown'),
          ROUND(m.distance_km::numeric, 1) AS distance,
          m.their_tags,
          m.images, 
          -- UPGRADE: Safe Match ALGORITHM using NULLIF to prevent div-by-zero crashes
          (50 + COALESCE(
             (
                SELECT COUNT(*) * 50.0 / NULLIF(array_length(m.my_tags, 1), 0)
                FROM unnest(m.their_tags) AS t 
                WHERE t = ANY(m.my_tags)
             ), 0
          ))::INT AS match_pct
       FROM potential_matches m
       -- GLOBAL MODE: Respect distance limit ONLY if Global Mode is OFF
       WHERE (m.global_mode = TRUE OR m.distance_km <= m.max_distance_km)
       ORDER BY match_pct DESC, distance ASC, m.id ASC
       LIMIT $2 OFFSET $3;
    `

	rows, err := r.DB.QueryContext(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var profiles []models.DiscoverProfile
	for rows.Next() {
		var p models.DiscoverProfile
		if err := rows.Scan(
			&p.ID,
			&p.DisplayName,
			&p.Bio,
			&p.Age,
			&p.City,
			&p.Distance,
			pq.Array(&p.Tags),
			pq.Array(&p.Images),
			&p.MatchPct,
		); err != nil {
			return nil, err
		}
		profiles = append(profiles, p)
	}

	// Prevents returning 'null' to React which causes .map() crashes
	if profiles == nil {
		profiles = []models.DiscoverProfile{}
	}

	return profiles, nil
}
