package repository

import (
	"chattie-backend/models"
	"context"

	"github.com/lib/pq"
)

func (r *Repository) GetSwipeDeck(ctx context.Context, userID string, limit, offset int) ([]models.DiscoverProfile, error) {
	query := `
		WITH current_user_data AS (
			-- Step 1: Gather the current user's state safely!
			SELECT 
				COALESCE(pref.interested_in, 'all') AS interested_in, 
				COALESCE(pref.min_age, 18) AS min_age, 
				COALESCE(pref.max_age, 100) AS max_age, 
				COALESCE(pref.max_distance_km, 9999) AS max_distance_km,
				COALESCE(loc.latitude, 0.0) AS latitude, 
				COALESCE(loc.longitude, 0.0) AS longitude,
				COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = $1), ARRAY[]::VARCHAR[]) AS my_tags
			FROM users u
			-- UPGRADE: Changed to LEFT JOIN so the deck works even if user skipped onboarding
			LEFT JOIN user_preferences pref ON u.id = pref.user_id
			LEFT JOIN user_locations loc ON u.id = loc.user_id
			WHERE u.id = $1
		),
		potential_matches AS (
			-- Step 2: Filter by hard constraints and calculate distance
			SELECT 
				u.id,
				p.display_name,
				COALESCE(p.bio, '') AS bio,
				EXTRACT(YEAR FROM age(p.date_of_birth))::INT AS age,
				COALESCE(l.city, 'Unknown') AS city,
				
				-- UPGRADE: Safe Distance Calculation prevents NaN Database crashes
				CASE 
					WHEN cu.latitude = 0 OR l.latitude IS NULL THEN 9999.0
					ELSE (6371 * acos(
						cos(radians(cu.latitude)) * cos(radians(l.latitude)) * 
						cos(radians(l.longitude) - radians(cu.longitude)) + 
						sin(radians(cu.latitude)) * sin(radians(l.latitude))
					)) 
				END AS distance_km,
				
				COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[]) AS their_tags,
				
				-- UPGRADE: Fixed 'media_url' to 'url' to actually fetch user images
				COALESCE(
					ARRAY(SELECT url FROM user_media WHERE user_id = u.id ORDER BY created_at ASC), 
					ARRAY[]::TEXT[]
				) AS images,
				
				cu.my_tags
			FROM users u
			JOIN user_profiles p ON u.id = p.user_id
			LEFT JOIN user_locations l ON u.id = l.user_id
			CROSS JOIN current_user_data cu
			WHERE u.id != $1
			  AND u.status IN ('active', 'online')
			  -- UPGRADE: Properly support 'all' sexual orientation!
			  AND (cu.interested_in = 'all' OR p.gender = cu.interested_in) 
			  -- Age is within range
			  AND (EXTRACT(YEAR FROM age(p.date_of_birth))::INT) BETWEEN cu.min_age AND cu.max_age
			  -- Exclude users already interacted with
			  AND NOT EXISTS (
				 SELECT 1 FROM interactions i WHERE i.actor_id = $1 AND i.target_id = u.id
			  )
		)
		-- Step 3: Calculate Match Percentage and output
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
		WHERE m.distance_km <= (SELECT max_distance_km FROM current_user_data)
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
