package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"chattie-backend/models"

	"github.com/lib/pq"
)

// =====================================================================
// DISCOVERY & FEED LOGIC
// =====================================================================

// CanUseAdvancedFilters checks if the user's active subscription allows advanced Grid filtering
func (r *Repository) CanUseAdvancedFilters(ctx context.Context, userID string) (bool, error) {
	var canUse bool

	query := `
		SELECT t.can_use_advanced_filters 
		FROM user_subscriptions s 
		JOIN subscription_tiers t ON s.tier_id = t.id 
		WHERE s.user_id = $1 AND s.status = 'active'
		  AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
	`

	err := r.DB.QueryRowContext(ctx, query, userID).Scan(&canUse)
	if err != nil {
		// If no row is found, it means they have no active sub (or are on free tier but the row is missing)
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}

	return canUse, nil
}

// GetGridProfiles fetches the discovery feed with advanced logic for Incognito, Blocks, Global Mode, and Match %
func (r *Repository) GetGridProfiles(ctx context.Context, userID string, filters models.GridFilters) ([]models.DiscoverProfile, error) {
	// 1. Base Query using Common Table Expressions (CTEs)
	baseQuery := `
		WITH current_user_data AS (
			SELECT 
				COALESCE(ussu.show_me, 'Everyone') AS show_me,
				COALESCE(current_profile.gender, '') AS gender,
				EXTRACT(YEAR FROM age(current_profile.date_of_birth))::INT AS viewer_age,
				LOWER(u.status) AS viewer_status,
				u.role AS viewer_role,
				COALESCE(pref.interested_in, 'All') AS viewer_intent,
				COALESCE(pref.max_distance_km, 50) AS max_distance_km,
				COALESCE(pref.min_age, 18) AS pref_min_age,
				COALESCE(pref.max_age, 99) AS pref_max_age,
				loc.latitude AS latitude,
				loc.longitude AS longitude,
				loc.country_code AS country_code,
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
			-- Find users matching the baseline criteria
			SELECT 
				u.id,
				p.display_name,
				COALESCE(p.bio, '') AS bio,
				COALESCE(target_preferences.interested_in, 'All') AS intent,
				LOWER(u.status) AS current_status,
				EXTRACT(YEAR FROM age(p.date_of_birth))::INT AS age,
				COALESCE(l.city, 'Unknown') AS city,
				
				-- Safe Haversine Distance Calculation (prevents NaN crashes)
				CASE 
					WHEN cu.latitude IS NULL OR cu.longitude IS NULL OR l.latitude IS NULL OR l.longitude IS NULL THEN 9999.0
					ELSE (6371 * acos(LEAST(1.0, GREATEST(-1.0,
						cos(radians(cu.latitude)) * cos(radians(l.latitude)) * 
						cos(radians(l.longitude) - radians(cu.longitude)) + 
						sin(radians(cu.latitude)) * sin(radians(l.latitude))
					))))
				END AS distance_km,
				
				COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[]) AS their_tags,
				
				-- Pull ordered images directly from the media vault
				COALESCE(
					ARRAY(SELECT url FROM user_media WHERE user_id = u.id AND NULLIF(BTRIM(url), '') IS NOT NULL ORDER BY is_primary DESC, sort_order ASC, created_at ASC LIMIT 6),
					ARRAY[]::TEXT[]
				) AS images,
				
				cu.my_tags,
				u.created_at,
				cu.max_distance_km,
				cu.global_mode,
				COALESCE(target_settings.global_mode, FALSE) AS target_global_mode,
				COALESCE(target_preferences.max_distance_km, 50) AS target_max_distance_km,
				COALESCE(target_preferences.min_age, 18) AS target_min_age,
				COALESCE(target_preferences.max_age, 99) AS target_max_age
			FROM users u
			JOIN user_profiles p ON u.id = p.user_id
			LEFT JOIN user_locations l ON u.id = l.user_id
			LEFT JOIN user_preferences target_preferences ON u.id = target_preferences.user_id
			LEFT JOIN user_settings target_settings ON u.id = target_settings.user_id
			CROSS JOIN current_user_data cu
			
			WHERE u.id != $1 
			  
			  -- 1. ACCOUNT STATUS: Target user must be active
			  AND u.status IN ('active', 'online', 'ONLINE')
			  AND u.role IN ('client', 'persona')
			  AND cu.viewer_status IN ('active', 'online')
			  AND cu.viewer_role <> 'admin'
			  AND EXISTS (
				  SELECT 1 FROM user_media viewer_media
				  WHERE viewer_media.user_id = $1 AND NULLIF(BTRIM(viewer_media.url), '') IS NOT NULL
			  )
			  AND (
				  cu.country_code IS NULL
				  OR l.country_code IS NULL
				  OR (l.country_code IS NOT NULL AND cu.country_code = l.country_code)
				  OR (cu.global_mode = TRUE AND COALESCE(target_settings.global_mode, FALSE) = TRUE)
			  )
			  AND NULLIF(BTRIM(p.display_name), '') IS NOT NULL
			  AND EXISTS (
				  SELECT 1 FROM user_media um
				  WHERE um.user_id = u.id AND NULLIF(BTRIM(um.url), '') IS NOT NULL
			  )
			  AND cu.viewer_age IS NOT NULL
			  AND cu.viewer_age >= 18
			  AND EXTRACT(YEAR FROM age(p.date_of_birth))::INT >= 18
			  AND (
				  lower(BTRIM(cu.show_me)) IN ('everyone', 'all', '')
				  OR (lower(BTRIM(cu.show_me)) = 'men' AND lower(BTRIM(p.gender)) IN ('male', 'man'))
				  OR (lower(BTRIM(cu.show_me)) = 'women' AND lower(BTRIM(p.gender)) IN ('female', 'woman'))
				  OR (lower(BTRIM(cu.show_me)) = 'other' AND lower(BTRIM(p.gender)) IN ('other', 'nonbinary', 'non-binary'))
			  )
			  AND (
				  lower(BTRIM(COALESCE(target_settings.show_me, 'Everyone'))) IN ('everyone', 'all', '')
				  OR (lower(BTRIM(COALESCE(target_settings.show_me, 'Everyone'))) = 'men' AND lower(BTRIM(cu.gender)) IN ('male', 'man'))
				  OR (lower(BTRIM(COALESCE(target_settings.show_me, 'Everyone'))) = 'women' AND lower(BTRIM(cu.gender)) IN ('female', 'woman'))
				  OR (lower(BTRIM(COALESCE(target_settings.show_me, 'Everyone'))) = 'other' AND lower(BTRIM(cu.gender)) IN ('other', 'nonbinary', 'non-binary'))
			  )
			  AND (
				  lower(BTRIM(COALESCE(target_preferences.interested_in, 'All'))) IN ('all', '')
				  OR lower(BTRIM(cu.viewer_intent)) IN ('all', '')
				  OR lower(BTRIM(target_preferences.interested_in)) = lower(BTRIM(cu.viewer_intent))
			  )
			  AND (EXTRACT(YEAR FROM age(p.date_of_birth))::INT BETWEEN cu.pref_min_age AND cu.pref_max_age)
			  AND cu.viewer_age BETWEEN COALESCE(target_preferences.min_age, 18)
									AND COALESCE(target_preferences.max_age, 99)
			  AND NOT EXISTS (
				  SELECT 1 FROM interactions my_swipes 
				  WHERE my_swipes.actor_id = $1 AND my_swipes.target_id = u.id
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
		-- Execute final filtering and calculate dynamic Match %
		SELECT 
			id, display_name, bio, age, city, ROUND(distance_km::numeric, 1) AS distance, their_tags, images,
			
			` + tagCompatibilityScoreSQL("my_tags", "their_tags") + ` AS match_pct
			
		FROM potential_matches
		WHERE 1=1
	`

	// 2. Dynamic UI Filters Processing
	var whereClauses []string
	args := []interface{}{userID} // $1 is always the current user's ID
	argID := 2

	// Cross-country discovery bypasses distance limits only with mutual Global Mode opt-in.
	whereClauses = append(whereClauses, "((global_mode = TRUE AND target_global_mode = TRUE) OR (distance_km <= max_distance_km AND distance_km <= target_max_distance_km))")

	// Dynamic Age Overrides (If user adjusts sliders in the UI)
	if filters.MinAge > 0 {
		whereClauses = append(whereClauses, fmt.Sprintf("age >= $%d", argID))
		args = append(args, filters.MinAge)
		argID++
	}
	if filters.MaxAge > 0 {
		whereClauses = append(whereClauses, fmt.Sprintf("age <= $%d", argID))
		args = append(args, filters.MaxAge)
		argID++
	}

	// Dynamic Intent Filtering
	if filters.Intent != "" && !strings.EqualFold(filters.Intent, "All") {
		whereClauses = append(whereClauses, fmt.Sprintf("lower(intent) = lower($%d)", argID))
		args = append(args, filters.Intent)
		argID++
	}

	// Dynamic Online Status Enforcement
	if strings.EqualFold(filters.Status, "Online") {
		whereClauses = append(whereClauses, "current_status = 'online'")
	}

	// Direct Search (ILIKE for Name or Bio)
	if filters.SearchQuery != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("(display_name ILIKE $%d OR bio ILIKE $%d)", argID, argID))
		args = append(args, "%"+filters.SearchQuery+"%")
		argID++
	}

	// Attach dynamic filters to the query
	if len(whereClauses) > 0 {
		baseQuery += " AND " + strings.Join(whereClauses, " AND ")
	}

	// 3. Sorting Logic
	switch filters.SortBy {
	case "distance":
		baseQuery += " ORDER BY distance_km ASC, id ASC"
	case "newest":
		baseQuery += " ORDER BY created_at DESC, id ASC"
	default: // "match" (Highest match %, then closest distance)
		baseQuery += " ORDER BY match_pct DESC, distance_km ASC, id ASC"
	}

	// 4. Pagination
	baseQuery += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argID, argID+1)
	args = append(args, filters.Limit, filters.Offset)

	// 5. Execute & Scan
	rows, err := r.DB.QueryContext(ctx, baseQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var profiles []models.DiscoverProfile
	for rows.Next() {
		var p models.DiscoverProfile
		if err := rows.Scan(
			&p.ID, &p.DisplayName, &p.Bio, &p.Age, &p.City,
			&p.Distance, pq.Array(&p.Tags), pq.Array(&p.Images), &p.MatchPct,
		); err != nil {
			return nil, err
		}
		profiles = append(profiles, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if profiles == nil {
		profiles = []models.DiscoverProfile{}
	}

	return profiles, nil
}
