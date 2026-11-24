package repository

import (
	"chattie-backend/models"
	"context"

	"github.com/jackc/pgx/v5/pgtype"
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
             LOWER(u.status) AS status,
             u.role,
             COALESCE(pref.interested_in, 'All') AS viewer_intent,
             COALESCE(pref.min_age, 18) AS min_age, 
             COALESCE(pref.max_age, 99) AS max_age,
             COALESCE(pref.max_distance_km, 50) AS max_distance_km,
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
          -- Step 2: Filter by hard constraints, blocks, incognito, and calculate distance
          SELECT 
             u.id,
             p.display_name,
             COALESCE(p.bio, '') AS bio,
             EXTRACT(YEAR FROM age(p.date_of_birth))::INT AS age,
             COALESCE(l.city, 'Unknown') AS city,
             COALESCE(l.country_code, '') AS country_code,
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
             COALESCE(target_settings.global_mode, FALSE) AS target_global_mode,
             COALESCE(target_preferences.max_distance_km, 50) AS target_max_distance_km,
             COALESCE(target_preferences.min_age, 18) AS min_age,
             COALESCE(target_preferences.max_age, 99) AS max_age
          FROM users u
          JOIN user_profiles p ON u.id = p.user_id
          LEFT JOIN user_locations l ON u.id = l.user_id
          LEFT JOIN user_preferences target_preferences ON u.id = target_preferences.user_id
          LEFT JOIN user_settings target_settings ON u.id = target_settings.user_id
          CROSS JOIN current_user_data cu
          WHERE u.id != $1
            AND u.status IN ('active', 'online', 'ONLINE')
            AND u.role IN ('client', 'persona')
            AND cu.status IN ('active', 'online')
            AND cu.role <> 'admin'
            AND EXISTS (
                SELECT 1 FROM user_media viewer_media
                WHERE viewer_media.user_id = $1 AND NULLIF(BTRIM(viewer_media.url), '') IS NOT NULL
            )
            AND (
                cu.country_code IS NULL
                OR l.country_code IS NULL
                OR (l.country_code IS NOT NULL AND cu.country_code = l.country_code)
                OR ` + globalModeOverrideSQL("cu.global_mode", "COALESCE(target_settings.global_mode, FALSE)") + `
            )
            AND NULLIF(BTRIM(p.display_name), '') IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM user_media um
                WHERE um.user_id = u.id AND NULLIF(BTRIM(um.url), '') IS NOT NULL
            )
            AND cu.age IS NOT NULL
            AND cu.age >= 18
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
            AND (EXTRACT(YEAR FROM age(p.date_of_birth))::INT) BETWEEN cu.min_age AND cu.max_age
            AND cu.age BETWEEN COALESCE(target_preferences.min_age, 18)
                           AND COALESCE(target_preferences.max_age, 99)
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
          m.country_code,
          ROUND(m.distance_km::numeric, 1) AS distance,
          m.their_tags,
          m.images, 
          ` + tagCompatibilityScoreSQL("m.my_tags", "m.their_tags") + ` AS match_pct
       FROM potential_matches m
       -- Either user's Global Mode opt-in allows cross-region discovery.
       WHERE (` + globalModeOverrideSQL("m.global_mode", "m.target_global_mode") + `
          OR (m.distance_km <= m.max_distance_km AND m.distance_km <= m.target_max_distance_km)
       )
       ORDER BY match_pct DESC, distance ASC, m.id ASC
       LIMIT $2 OFFSET $3;
    `

	rows, err := r.DB.QueryContext(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var profiles []models.DiscoverProfile
	arrayMap := pgtype.NewMap()
	for rows.Next() {
		var p models.DiscoverProfile
		if err := rows.Scan(
			&p.ID,
			&p.DisplayName,
			&p.Bio,
			&p.Age,
			&p.City,
			&p.CountryCode,
			&p.Distance,
			arrayMap.SQLScanner(&p.Tags),
			arrayMap.SQLScanner(&p.Images),
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

func (r *Repository) GetSwipeDeckDiagnostics(ctx context.Context, userID string) (models.DiscoverDiagnostics, error) {
	var diagnostics models.DiscoverDiagnostics
	query := `
		WITH viewer AS (
			SELECT
				u.id,
				(lower(u.status) IN ('active', 'online') AND u.role <> 'admin') AS account_eligible,
				EXTRACT(YEAR FROM age(p.date_of_birth))::INT AS age,
				p.gender,
				COALESCE(pref.interested_in, 'All') AS interested_in,
				COALESCE(pref.min_age, 18) AS min_age,
				COALESCE(pref.max_age, 99) AS max_age,
				COALESCE(pref.max_distance_km, 50) AS max_distance_km,
				COALESCE(settings.show_me, 'Everyone') AS show_me,
				COALESCE(settings.global_mode, FALSE) AS global_mode,
				loc.latitude,
				loc.longitude,
				loc.country_code,
				EXISTS (
					SELECT 1 FROM user_media media
					WHERE media.user_id = u.id AND NULLIF(BTRIM(media.url), '') IS NOT NULL
				) AS has_photo
			FROM users u
			LEFT JOIN user_profiles p ON p.user_id = u.id
			LEFT JOIN user_preferences pref ON pref.user_id = u.id
			LEFT JOIN user_settings settings ON settings.user_id = u.id
			LEFT JOIN user_locations loc ON loc.user_id = u.id
			WHERE u.id = $1
		),
		candidate_pool AS (
			SELECT
				EXTRACT(YEAR FROM age(profile.date_of_birth))::INT AS target_age,
				profile.gender AS target_gender,
				COALESCE(candidate_preferences.min_age, 18) AS target_min_age,
				COALESCE(candidate_preferences.max_age, 99) AS target_max_age,
				COALESCE(candidate_preferences.interested_in, 'All') AS target_interested_in,
				COALESCE(candidate_preferences.max_distance_km, 50) AS target_max_distance_km,
				COALESCE(candidate_settings.show_me, 'Everyone') AS target_show_me,
				COALESCE(candidate_settings.global_mode, FALSE) AS target_global_mode,
				location.country_code AS target_country_code,
				CASE
					WHEN viewer.latitude IS NULL OR viewer.longitude IS NULL OR location.latitude IS NULL OR location.longitude IS NULL THEN 9999.0
					ELSE 6371 * acos(LEAST(1.0, GREATEST(-1.0,
						cos(radians(viewer.latitude)) * cos(radians(location.latitude)) *
						cos(radians(location.longitude) - radians(viewer.longitude)) +
						sin(radians(viewer.latitude)) * sin(radians(location.latitude))
					)))
				END AS distance_km,
				viewer.age AS viewer_age,
				viewer.gender AS viewer_gender,
				viewer.interested_in AS viewer_interested_in,
				viewer.min_age AS viewer_min_age,
				viewer.max_age AS viewer_max_age,
				viewer.max_distance_km AS viewer_max_distance_km,
				viewer.show_me AS viewer_show_me,
				viewer.global_mode AS viewer_global_mode,
				viewer.country_code AS viewer_country_code
			FROM users candidate
			JOIN user_profiles profile ON profile.user_id = candidate.id
			LEFT JOIN user_locations location ON location.user_id = candidate.id
			LEFT JOIN user_preferences candidate_preferences ON candidate_preferences.user_id = candidate.id
			LEFT JOIN user_settings candidate_settings ON candidate_settings.user_id = candidate.id
			CROSS JOIN viewer
			WHERE candidate.id <> $1
				AND candidate.status IN ('active', 'online', 'ONLINE')
				AND candidate.role IN ('client', 'persona')
				AND NULLIF(BTRIM(profile.display_name), '') IS NOT NULL
				AND EXTRACT(YEAR FROM age(profile.date_of_birth))::INT >= 18
				AND EXISTS (
					SELECT 1 FROM user_media media
					WHERE media.user_id = candidate.id AND NULLIF(BTRIM(media.url), '') IS NOT NULL
				)
				AND viewer.account_eligible
				AND viewer.age >= 18
				AND viewer.has_photo
				AND NOT EXISTS (
					SELECT 1 FROM interactions interaction
					WHERE interaction.actor_id = $1 AND interaction.target_id = candidate.id
				)
				AND NOT EXISTS (
					SELECT 1 FROM blocks block
					WHERE (block.blocker_id = $1 AND block.blocked_id = candidate.id)
						OR (block.blocker_id = candidate.id AND block.blocked_id = $1)
				)
				AND (
					COALESCE(candidate_settings.privacy_incognito, FALSE) = FALSE
					OR EXISTS (
						SELECT 1 FROM interactions interaction
						WHERE interaction.actor_id = candidate.id
							AND interaction.target_id = $1
							AND interaction.action_type IN ('LIKE', 'SUPER_LIKE')
					)
				)
		),
		age_matches AS (
			SELECT * FROM candidate_pool
			WHERE target_age BETWEEN viewer_min_age AND viewer_max_age
				AND viewer_age BETWEEN target_min_age AND target_max_age
		),
		gender_matches AS (
			SELECT * FROM age_matches candidate
			WHERE (
				lower(BTRIM(candidate.viewer_show_me)) IN ('everyone', 'all', '')
				OR (lower(BTRIM(candidate.viewer_show_me)) = 'men' AND lower(BTRIM(candidate.target_gender)) IN ('male', 'man'))
				OR (lower(BTRIM(candidate.viewer_show_me)) = 'women' AND lower(BTRIM(candidate.target_gender)) IN ('female', 'woman'))
				OR (lower(BTRIM(candidate.viewer_show_me)) = 'other' AND lower(BTRIM(candidate.target_gender)) IN ('other', 'nonbinary', 'non-binary'))
			)
			AND (
				lower(BTRIM(candidate.target_show_me)) IN ('everyone', 'all', '')
				OR (lower(BTRIM(candidate.target_show_me)) = 'men' AND lower(BTRIM(candidate.viewer_gender)) IN ('male', 'man'))
				OR (lower(BTRIM(candidate.target_show_me)) = 'women' AND lower(BTRIM(candidate.viewer_gender)) IN ('female', 'woman'))
				OR (lower(BTRIM(candidate.target_show_me)) = 'other' AND lower(BTRIM(candidate.viewer_gender)) IN ('other', 'nonbinary', 'non-binary'))
			)
		),
		intent_matches AS (
			SELECT * FROM gender_matches candidate
			WHERE lower(BTRIM(candidate.target_interested_in)) IN ('all', '')
				OR lower(BTRIM(candidate.viewer_interested_in)) IN ('all', '')
				OR lower(BTRIM(candidate.target_interested_in)) = lower(BTRIM(candidate.viewer_interested_in))
		),
		location_matches AS (
			SELECT * FROM intent_matches candidate
			WHERE (
				candidate.viewer_country_code IS NULL
				OR candidate.target_country_code IS NULL
				OR candidate.target_country_code = candidate.viewer_country_code
				OR ` + globalModeOverrideSQL("candidate.viewer_global_mode", "candidate.target_global_mode") + `
			)
			AND (
				` + globalModeOverrideSQL("candidate.viewer_global_mode", "candidate.target_global_mode") + `
				OR (candidate.distance_km <= candidate.viewer_max_distance_km
					AND candidate.distance_km <= candidate.target_max_distance_km)
			)
		)
		SELECT
			COALESCE(viewer.account_eligible AND COALESCE(viewer.age >= 18, FALSE) AND viewer.has_photo, FALSE),
			viewer.has_photo,
			COALESCE(viewer.age >= 18, FALSE),
			(SELECT COUNT(*) FROM candidate_pool),
			(SELECT COUNT(*) FROM age_matches),
			(SELECT COUNT(*) FROM gender_matches),
			(SELECT COUNT(*) FROM intent_matches),
			(SELECT COUNT(*) FROM location_matches)
		FROM viewer
	`
	err := r.DB.QueryRowContext(ctx, query, userID).Scan(
		&diagnostics.ViewerReady,
		&diagnostics.ViewerHasPhoto,
		&diagnostics.ViewerAgeEligible,
		&diagnostics.CandidatePool,
		&diagnostics.AfterAge,
		&diagnostics.AfterGender,
		&diagnostics.AfterIntent,
		&diagnostics.AfterLocation,
	)
	return diagnostics, err
}
