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
          -- Step 1: Gather the current user's state safely!
          SELECT 
             COALESCE(ussu.show_me, '') AS interested_in, 
             COALESCE(pref.min_age, 18) AS min_age, 
             COALESCE(pref.max_age, 100) AS max_age, 
             COALESCE(pref.max_distance_km, 50) AS max_distance_km,
             COALESCE(loc.latitude, 0.0) AS latitude, 
             COALESCE(loc.longitude, 0.0) AS longitude,
             COALESCE(us.global_mode, FALSE) AS global_mode,
             COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = $1), ARRAY[]::VARCHAR[]) AS my_tags
          FROM users u
          -- UPGRADE: LEFT JOIN so the deck works even if user skipped onboarding
          LEFT JOIN user_preferences pref ON u.id = pref.user_id
        LEFT JOIN public.user_settings ussu  ON u.id = ussu.user_id
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
                WHEN cu.latitude = 0 OR l.latitude IS NULL THEN 9999.0
                ELSE (6371 * acos(
                   cos(radians(cu.latitude)) * cos(radians(l.latitude)) * 
                   cos(radians(l.longitude) - radians(cu.longitude)) + 
                   sin(radians(cu.latitude)) * sin(radians(l.latitude))
                )) 
             END AS distance_km,
             
             COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[]) AS their_tags,
             
             -- UPGRADE: Correct URL column and respect primary image order
             COALESCE(
                ARRAY(SELECT url FROM user_media WHERE user_id = u.id ORDER BY is_primary DESC, sort_order ASC, created_at ASC), 
                ARRAY[]::TEXT[]
             ) AS images,
             
             cu.my_tags,
             cu.global_mode,
             cu.max_distance_km
          FROM users u
          JOIN user_profiles p ON u.id = p.user_id
          LEFT JOIN user_locations l ON u.id = l.user_id
          LEFT JOIN user_settings target_settings ON u.id = target_settings.user_id
          CROSS JOIN current_user_data cu
          WHERE u.id != $1
            AND u.status IN ('active', 'online', 'onboarding')
            
            -- UPGRADE: Properly support 'Everyone' sexual orientation!
            AND (cu.interested_in IN ('Everyone', 'All', 'all') OR p.gender = cu.interested_in) 
            
            -- Age is within range
            AND (EXTRACT(YEAR FROM age(p.date_of_birth))::INT) BETWEEN cu.min_age AND cu.max_age
            
            -- EXCLUDE: Users I have already swiped on
            AND NOT EXISTS (
              SELECT 1 FROM interactions i WHERE i.actor_id = $1 AND i.target_id = u.id
            )
            
            -- EXCLUDE: Mutual block enforcement
            AND NOT EXISTS (
              SELECT 1 FROM blocks b 
              WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) 
                 OR (b.blocker_id = u.id AND b.blocked_id = $1)
            )
            
            -- INCOGNITO MODE: Hide them if they are incognito, UNLESS they already liked me
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
       ORDER BY match_pct DESC, distance ASC
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
