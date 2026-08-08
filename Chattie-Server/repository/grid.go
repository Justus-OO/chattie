package repository

import (
	"chattie-backend/models"
	"context"
	"fmt"
	"strings"

	"github.com/lib/pq"
)

func (r *Repository) GetGridProfiles(ctx context.Context, userID string, filters models.GridFilters) ([]models.DiscoverProfile, error) {
	// 1. Base CTEs to get current user data safely and join potential matches
	baseQuery := `
		WITH current_user_data AS (
			SELECT 
				COALESCE(pref.interested_in, 'all') AS interested_in, 
				COALESCE(loc.latitude, 0.0) AS latitude, 
				COALESCE(loc.longitude, 0.0) AS longitude,
				COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = $1), ARRAY[]::VARCHAR[]) AS my_tags
			FROM users u
			-- UPGRADE: Changed to LEFT JOIN so the Grid works even if user skipped onboarding
			LEFT JOIN user_preferences pref ON u.id = pref.user_id
			LEFT JOIN user_locations loc ON u.id = loc.user_id
			WHERE u.id = $1
		),
		potential_matches AS (
			SELECT 
				u.id,
				p.display_name,
				COALESCE(p.bio, '') AS bio,
				EXTRACT(YEAR FROM age(p.date_of_birth))::INT AS age,
				COALESCE(l.city, 'Unknown') AS city,
				
				-- UPGRADE: Safe Distance Calculation prevents NaN Database crashes!
				CASE 
					WHEN cu.latitude = 0 OR l.latitude IS NULL THEN 9999.0
					ELSE (6371 * acos(
						cos(radians(cu.latitude)) * cos(radians(l.latitude)) * 
						cos(radians(l.longitude) - radians(cu.longitude)) + 
						sin(radians(cu.latitude)) * sin(radians(l.latitude))
					)) 
				END AS distance_km,
				
				COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[]) AS their_tags,
				
				-- UPGRADE: Changed 'media_url' to 'url' to match your actual Media Vault table
				COALESCE(
					ARRAY(SELECT url FROM user_media WHERE user_id = u.id ORDER BY created_at ASC), 
					ARRAY[]::TEXT[]
				) AS images,
				
				cu.my_tags,
				u.created_at
			FROM users u
			JOIN user_profiles p ON u.id = p.user_id
			LEFT JOIN user_locations l ON u.id = l.user_id
			CROSS JOIN current_user_data cu
			WHERE u.id != $1 
			  -- Allow 'active' or 'online' users to show up
			  AND u.status IN ('active', 'online')
			  -- UPGRADE: Actually enforce Gender Preferences!
			  AND (cu.interested_in = 'all' OR p.gender = cu.interested_in)
		`

	// 2. Dynamic Filtering
	var whereClauses []string
	args := []interface{}{userID} // $1 is always userID
	argID := 2

	// Age Filter
	if filters.MinAge > 0 {
		whereClauses = append(whereClauses, fmt.Sprintf("(EXTRACT(YEAR FROM age(p.date_of_birth))::INT) >= $%d", argID))
		args = append(args, filters.MinAge)
		argID++
	}
	if filters.MaxAge > 0 {
		whereClauses = append(whereClauses, fmt.Sprintf("(EXTRACT(YEAR FROM age(p.date_of_birth))::INT) <= $%d", argID))
		args = append(args, filters.MaxAge)
		argID++
	}

	// Intent Filter
	if filters.Intent != "" && filters.Intent != "All" {
		whereClauses = append(whereClauses, fmt.Sprintf("p.intent = $%d", argID))
		args = append(args, filters.Intent)
		argID++
	}

	// UPGRADE: Online Status Filter hooked up
	if filters.Status == "Online" {
		// Only show people currently connected to the WebSockets
		whereClauses = append(whereClauses, "u.status = 'online'")
	}

	// Search Query (ILIKE for case-insensitive matching on Name or Bio)
	if filters.SearchQuery != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("(p.display_name ILIKE $%d OR p.bio ILIKE $%d)", argID, argID))
		args = append(args, "%"+filters.SearchQuery+"%")
		argID++
	}

	// Combine dynamic WHERE clauses
	if len(whereClauses) > 0 {
		baseQuery += " AND " + strings.Join(whereClauses, " AND ")
	}

	baseQuery += `)` // Close the potential_matches CTE

	// 3. Final Select & Safely Math'd Match % Algorithm
	baseQuery += `
		SELECT 
			id, display_name, bio, age, city, ROUND(distance_km::numeric, 1), their_tags, images,
			-- UPGRADE: NULLIF prevents division-by-zero crashes if a user has no tags
			(50 + COALESCE(
				(
					SELECT COUNT(*) * 50.0 / NULLIF(array_length(my_tags, 1), 0)
					FROM unnest(their_tags) AS t 
					WHERE t = ANY(my_tags)
				), 0
			))::INT AS match_pct
		FROM potential_matches
	`

	// 4. Sorting logic
	switch filters.SortBy {
	case "distance":
		baseQuery += " ORDER BY distance_km ASC"
	case "newest":
		baseQuery += " ORDER BY created_at DESC"
	default: // "match"
		baseQuery += " ORDER BY match_pct DESC, distance_km ASC"
	}

	// 5. Pagination
	baseQuery += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argID, argID+1)
	args = append(args, filters.Limit, filters.Offset)

	// Execute the Query
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

	// Return empty array instead of nil to prevent React crashes
	if profiles == nil {
		profiles = []models.DiscoverProfile{}
	}

	return profiles, nil
}
