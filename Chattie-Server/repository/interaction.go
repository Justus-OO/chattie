package repository

import (
	"chattie-backend/models"
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
)

// =====================================================================
// CUSTOM ERRORS
// =====================================================================

var (
	ErrPermissionDenied = errors.New("permission denied: upgrade to premium required")
	ErrUserNotFound     = errors.New("user profile not found or unavailable")
)

// =====================================================================
// 1. PROCESS SWIPE / INTERACTION (Auto-Match for Models/Personas)
// =====================================================================

func (r *Repository) ProcessAction(ctx context.Context, userID string, req models.InteractionRequest) (*models.InteractionResponse, error) {
	switch req.ActionType {
	case "LIKE", "PASS", "SUPER_LIKE", "FLIRT":
	default:
		return nil, errors.New("invalid interaction action")
	}
	if req.TargetID == "" || req.TargetID == userID {
		return &models.InteractionResponse{Allowed: false, Code: models.InteractionCodeUnavailable, Message: "User unavailable"}, nil
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Lock both participants in a stable order to serialize quotas and reciprocal likes.
	lockedUsers, err := lockUsersInOrder(ctx, tx, userID, req.TargetID)
	if err != nil {
		return nil, err
	}
	if len(lockedUsers) != 2 {
		return &models.InteractionResponse{Allowed: false, Code: models.InteractionCodeUnavailable, Message: "User unavailable"}, nil
	}

	var targetRole string
	var targetIsActive bool
	err = tx.QueryRowContext(ctx, `
SELECT role, LOWER(status) IN ('active', 'online')
FROM users
WHERE id = $1
`, req.TargetID).Scan(&targetRole, &targetIsActive)
	if err == sql.ErrNoRows || (err == nil && (targetRole == "admin" || !targetIsActive)) {
		return &models.InteractionResponse{Allowed: false, Code: models.InteractionCodeUnavailable, Message: "User unavailable"}, nil
	}
	if err != nil {
		return nil, err
	}

	var eligible bool
	if err := tx.QueryRowContext(ctx, actionEligibilityQuery, userID, req.TargetID).Scan(&eligible); err != nil {
		return nil, err
	}
	if !eligible {
		return &models.InteractionResponse{Allowed: false, Code: models.InteractionCodeUnavailable, Message: "User unavailable"}, nil
	}

	var alreadyInteracted bool
	if err := tx.QueryRowContext(ctx, `
SELECT EXISTS (
    SELECT 1 FROM interactions WHERE actor_id = $1 AND target_id = $2
)
`, userID, req.TargetID).Scan(&alreadyInteracted); err != nil {
		return nil, err
	}
	if alreadyInteracted {
		return &models.InteractionResponse{Allowed: false, Code: models.InteractionCodeAlreadyExists, Message: "Already interacted with this user"}, nil
	}

	var maxSwipes, maxSuperLikes, swipesUsed, superLikesUsed int
	limitQuery := `
SELECT
    COALESCE(active_tier.max_daily_swipes, free_tier.max_daily_swipes),
    COALESCE(active_tier.max_daily_super_likes, free_tier.max_daily_super_likes),
    COALESCE(usage.swipes_used, 0),
    COALESCE(usage.super_likes_used, 0)
FROM subscription_tiers free_tier
LEFT JOIN user_subscriptions s
    ON s.user_id = $1
    AND s.status = 'active'
    AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
LEFT JOIN subscription_tiers active_tier ON active_tier.id = s.tier_id
LEFT JOIN user_daily_usage usage
    ON usage.user_id = $1 AND usage.usage_date = CURRENT_DATE
WHERE LOWER(free_tier.name) = 'free'
`
	err = tx.QueryRowContext(ctx, limitQuery, userID).Scan(&maxSwipes, &maxSuperLikes, &swipesUsed, &superLikesUsed)
	if err != nil {
		return nil, err
	}

	if req.ActionType == "LIKE" || req.ActionType == "PASS" || req.ActionType == "FLIRT" {
		if maxSwipes >= 0 && swipesUsed >= maxSwipes {
			return &models.InteractionResponse{Allowed: false, Code: models.InteractionCodeUpgradeRequired, Message: "Daily limit reached"}, nil
		}
	} else if req.ActionType == "SUPER_LIKE" {
		if maxSuperLikes >= 0 && superLikesUsed >= maxSuperLikes {
			return &models.InteractionResponse{Allowed: false, Code: models.InteractionCodeUpgradeRequired, Message: "Daily super like limit reached"}, nil
		}
	}

	// 1. Record the user's interaction towards the target
	insertQuery := `
INSERT INTO interactions (actor_id, target_id, action_type, is_match)
VALUES ($1, $2, $3, FALSE)
ON CONFLICT (actor_id, target_id) DO NOTHING
RETURNING id
`
	var interactionID string
	err = tx.QueryRowContext(ctx, insertQuery, userID, req.TargetID, req.ActionType).Scan(&interactionID)
	if err == sql.ErrNoRows {
		return &models.InteractionResponse{Allowed: false, Code: models.InteractionCodeAlreadyExists, Message: "Already interacted with this user"}, nil
	}
	if err != nil {
		return nil, err
	}

	// 2. Track daily usage
	usageQuery := `
       INSERT INTO user_daily_usage (user_id, usage_date, swipes_used, super_likes_used)
       VALUES ($1, CURRENT_DATE, 
          CASE WHEN $2 IN ('LIKE', 'PASS', 'FLIRT') THEN 1 ELSE 0 END, 
          CASE WHEN $2 = 'SUPER_LIKE' THEN 1 ELSE 0 END)
       ON CONFLICT (user_id, usage_date) DO UPDATE 
       SET swipes_used = user_daily_usage.swipes_used + EXCLUDED.swipes_used,
          super_likes_used = user_daily_usage.super_likes_used + EXCLUDED.super_likes_used
    `
	if _, err = tx.ExecContext(ctx, usageQuery, userID, req.ActionType); err != nil {
		return nil, err
	}

	isMatch := false

	if req.ActionType == "LIKE" || req.ActionType == "SUPER_LIKE" || req.ActionType == "FLIRT" {
		// If target is a model/persona, AUTO-LIKE back immediately!
		if targetRole == "persona" {
			_, err = tx.ExecContext(ctx, `
             INSERT INTO interactions (actor_id, target_id, action_type, is_match)
             VALUES ($1, $2, 'LIKE', TRUE)
             ON CONFLICT (actor_id, target_id) DO UPDATE 
             SET action_type = 'LIKE', is_match = TRUE
          `, req.TargetID, userID)
			if err != nil {
				return nil, err
			}
		}

		// Check mutual status
		err = tx.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM interactions
				WHERE actor_id = $1 AND target_id = $2 AND action_type IN ('LIKE', 'SUPER_LIKE', 'FLIRT')
			)
		`, req.TargetID, userID).Scan(&isMatch)
		if err != nil {
			return nil, err
		}
		if isMatch {
			updateMatchQuery := `
             UPDATE interactions SET is_match = TRUE 
             WHERE (actor_id = $1 AND target_id = $2) OR (actor_id = $2 AND target_id = $1)
          `
			if _, err = tx.ExecContext(ctx, updateMatchQuery, userID, req.TargetID); err != nil {
				return nil, err
			}
		}
	}

	if err = tx.Commit(); err != nil {
		return nil, err
	}

	return &models.InteractionResponse{Allowed: true, IsMatch: isMatch}, nil
}

func (r *Repository) GetFullProfile(ctx context.Context, currentUserID, targetUserID string) (*models.DiscoverProfile, error) {
	query := `
       WITH current_user_data AS (
          SELECT 
             loc.latitude AS latitude,
             loc.longitude AS longitude,
             COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = $1), ARRAY[]::VARCHAR[]) AS my_tags
          FROM users u
          LEFT JOIN user_locations loc ON u.id = loc.user_id
          WHERE u.id = $1
       )
       SELECT 
          u.id, p.display_name, COALESCE(p.bio, ''), EXTRACT(YEAR FROM age(p.date_of_birth))::INT AS age,
          COALESCE(l.city, 'Unknown'),
          COALESCE(l.country_code, ''),
          
          -- SAFE DISTANCE
          CASE 
             WHEN cu.latitude IS NULL OR cu.longitude IS NULL OR l.latitude IS NULL OR l.longitude IS NULL THEN 9999.0
             ELSE (6371 * acos(LEAST(1.0, GREATEST(-1.0,
                 cos(radians(cu.latitude)) * cos(radians(l.latitude)) * cos(radians(l.longitude) - radians(cu.longitude)) + sin(radians(cu.latitude)) * sin(radians(l.latitude))
             ))))
          END AS distance_km,
          
          COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[]) AS their_tags,
          
          -- SAFE MEDIA ORDERING
          COALESCE(ARRAY(SELECT url FROM user_media WHERE user_id = u.id AND NULLIF(BTRIM(url), '') IS NOT NULL ORDER BY is_primary DESC, sort_order ASC, created_at ASC), ARRAY[]::TEXT[]) AS images,
          
          ` + tagCompatibilityScoreSQL("cu.my_tags", "COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[])") + ` AS match_pct
       
       FROM users u
       JOIN user_profiles p ON u.id = p.user_id
       LEFT JOIN user_locations l ON u.id = l.user_id
       LEFT JOIN user_settings target_settings ON target_settings.user_id = u.id
       CROSS JOIN current_user_data cu
       WHERE u.id = $2 
         AND u.status IN ('active', 'online', 'ONLINE')
         AND u.role <> 'admin'
         AND NULLIF(BTRIM(p.display_name), '') IS NOT NULL
         AND EXISTS (
             SELECT 1 FROM user_media um
             WHERE um.user_id = u.id AND NULLIF(BTRIM(um.url), '') IS NOT NULL
         )
         -- EXCLUDE IF MUTUALLY BLOCKED
         AND NOT EXISTS (
             SELECT 1 FROM blocks b 
             WHERE (b.blocker_id = $1 AND b.blocked_id = $2) OR (b.blocker_id = $2 AND b.blocked_id = $1)
         )
         AND (
             $1 = $2
             OR COALESCE(target_settings.privacy_incognito, FALSE) = FALSE
             OR EXISTS (
                 SELECT 1 FROM interactions i
                 WHERE i.actor_id = $2 AND i.target_id = $1 AND i.action_type IN ('LIKE', 'SUPER_LIKE')
             )
         )
    `
	var p models.DiscoverProfile
	arrayMap := pgtype.NewMap()
	err := r.DB.QueryRowContext(ctx, query, currentUserID, targetUserID).Scan(
		&p.ID, &p.DisplayName, &p.Bio, &p.Age, &p.City, &p.CountryCode, &p.Distance,
		arrayMap.SQLScanner(&p.Tags), arrayMap.SQLScanner(&p.Images), &p.MatchPct,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	if currentUserID != targetUserID {
		_, err := r.DB.ExecContext(ctx, `
			INSERT INTO profile_views (viewer_id, viewed_id, viewed_at)
			VALUES ($1, $2, CURRENT_TIMESTAMP)
			ON CONFLICT (viewer_id, viewed_id) DO UPDATE SET viewed_at = EXCLUDED.viewed_at
		`, currentUserID, targetUserID)
		if err != nil {
			return nil, err
		}
	}
	return &p, nil
}

func (r *Repository) GetMatches(ctx context.Context, userID string) ([]models.MatchResponse, error) {
	query := `
       WITH viewer_data AS (
          SELECT COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = $1), ARRAY[]::VARCHAR[]) AS tags
       )
       SELECT
          u.id::text,
          COALESCE(p.display_name, u.username) AS display_name,
          COALESCE(
             (SELECT url FROM user_media WHERE user_id = u.id ORDER BY is_primary DESC, sort_order ASC, created_at ASC LIMIT 1), 
             ''
          ) AS avatar_url,
          CASE
             WHEN LOWER(u.status) = 'online' THEN 'online'
             ELSE 'offline'
          END AS status,
          ` + tagCompatibilityScoreSQL("viewer_data.tags", "COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[])") + ` AS match_pct
       FROM interactions i
       JOIN users u ON i.target_id = u.id
       LEFT JOIN user_profiles p ON u.id = p.user_id
       CROSS JOIN viewer_data
       WHERE i.actor_id = $1 AND i.is_match = TRUE
         AND u.role <> 'admin'
         AND LOWER(u.status) <> 'banned'
       
       -- EXCLUDE IF BLOCKED AFTER MATCHING
       AND NOT EXISTS (
           SELECT 1 FROM blocks b 
           WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1)
       )
       ORDER BY u.created_at DESC NULLS LAST
    `

	rows, err := r.DB.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	matches := make([]models.MatchResponse, 0)
	for rows.Next() {
		var m models.MatchResponse
		if err := rows.Scan(&m.ID, &m.DisplayName, &m.AvatarURL, &m.Status, &m.MatchPct); err != nil {
			return nil, err
		}
		matches = append(matches, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return matches, nil
}

func (r *Repository) GetSecretAdmirers(ctx context.Context, userID string) ([]models.DiscoverProfile, bool, error) {
	var isPremium bool
	tierQuery := `
       SELECT EXISTS (
          SELECT 1
          FROM user_subscriptions s
          JOIN subscription_tiers t ON s.tier_id = t.id
          WHERE s.user_id = $1
            AND s.status = 'active'
            AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
            AND t.can_see_likes = TRUE
       )
    `
	err := r.DB.QueryRowContext(ctx, tierQuery, userID).Scan(&isPremium)
	if err != nil {
		return nil, false, err
	}

	query := `
       WITH current_user_data AS (
          SELECT
             loc.latitude AS latitude,
             loc.longitude AS longitude,
             COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = $1), ARRAY[]::VARCHAR[]) AS my_tags
          FROM users u
          LEFT JOIN user_locations loc ON loc.user_id = u.id
          WHERE u.id = $1
       )
       SELECT
          u.id, p.display_name, COALESCE(p.bio, ''), EXTRACT(YEAR FROM age(p.date_of_birth))::INT,
          COALESCE(l.city, 'Unknown'),
          CASE
             WHEN cu.latitude IS NULL OR cu.longitude IS NULL OR l.latitude IS NULL OR l.longitude IS NULL THEN 9999.0
             ELSE (6371 * acos(LEAST(1.0, GREATEST(-1.0,
                 cos(radians(cu.latitude)) * cos(radians(l.latitude)) * cos(radians(l.longitude) - radians(cu.longitude)) + sin(radians(cu.latitude)) * sin(radians(l.latitude))
             ))))
          END AS distance_km,
          ` + tagCompatibilityScoreSQL("cu.my_tags", "COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[])") + ` AS match_pct,
          COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[]) AS tags,
          COALESCE(ARRAY(SELECT url FROM user_media WHERE user_id = u.id AND NULLIF(BTRIM(url), '') IS NOT NULL ORDER BY is_primary DESC, sort_order ASC, created_at ASC), ARRAY[]::TEXT[]),
          (i.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days') AS is_new
       FROM interactions i
       JOIN users u ON i.actor_id = u.id
       JOIN user_profiles p ON u.id = p.user_id
       LEFT JOIN user_locations l ON u.id = l.user_id
       CROSS JOIN current_user_data cu
       WHERE i.target_id = $1
         AND i.action_type IN ('LIKE', 'SUPER_LIKE')
         AND i.is_match = FALSE
         AND LOWER(u.status) <> 'banned'
         AND u.role = 'client'
         AND NOT EXISTS (
             SELECT 1 FROM interactions response
             WHERE response.actor_id = $1 AND response.target_id = u.id
         )
         AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1)
         )
       ORDER BY i.created_at DESC
    `
	rows, err := r.DB.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, isPremium, err
	}
	defer rows.Close()

	var profiles []models.DiscoverProfile
	arrayMap := pgtype.NewMap()
	for rows.Next() {
		var p models.DiscoverProfile
		if err := rows.Scan(&p.ID, &p.DisplayName, &p.Bio, &p.Age, &p.City, &p.Distance, &p.MatchPct, arrayMap.SQLScanner(&p.Tags), arrayMap.SQLScanner(&p.Images), &p.IsNew); err != nil {
			return nil, isPremium, err
		}
		profiles = append(profiles, p)
	}
	if err := rows.Err(); err != nil {
		return nil, isPremium, err
	}

	if profiles == nil {
		profiles = []models.DiscoverProfile{}
	}
	return profiles, isPremium, nil
}

func (r *Repository) UndoLastAction(ctx context.Context, userID string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var canUndo bool
	err = tx.QueryRowContext(ctx, `
       SELECT t.can_undo FROM user_subscriptions s 
       JOIN subscription_tiers t ON s.tier_id = t.id 
       WHERE s.user_id = $1 AND s.status = 'active'
         AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
    `, userID).Scan(&canUndo)

	if err != nil {
		if err == sql.ErrNoRows {
			return ErrPermissionDenied
		}
		return err
	}
	if !canUndo {
		return ErrPermissionDenied
	}

	var lastInteractionID, targetID string
	var wasMatch bool

	err = tx.QueryRowContext(ctx, "SELECT id, target_id, is_match FROM interactions WHERE actor_id = $1 ORDER BY created_at DESC LIMIT 1", userID).Scan(&lastInteractionID, &targetID, &wasMatch)
	if err != nil {
		return err
	}

	if _, err = tx.ExecContext(ctx, "DELETE FROM interactions WHERE id = $1", lastInteractionID); err != nil {
		return err
	}

	if wasMatch {
		if _, err = tx.ExecContext(ctx, "UPDATE interactions SET is_match = FALSE WHERE actor_id = $1 AND target_id = $2", targetID, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *Repository) UnmatchUser(ctx context.Context, actorID, targetID string) error {
	query := `
       UPDATE interactions 
       SET is_match = FALSE 
       WHERE (actor_id = $1 AND target_id = $2) OR (actor_id = $2 AND target_id = $1)
    `
	_, err := r.DB.ExecContext(ctx, query, actorID, targetID)
	return err
}

func (r *Repository) BlockUser(ctx context.Context, blockerID, blockedID string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	lockedUsers, err := lockUsersInOrder(ctx, tx, blockerID, blockedID)
	if err != nil {
		return err
	}
	if len(lockedUsers) != 2 {
		return ErrUserNotFound
	}

	// 1. Overtake interaction to PASS
	_, err = tx.ExecContext(ctx, `
       INSERT INTO interactions (actor_id, target_id, action_type, is_match)
       VALUES ($1, $2, 'PASS', FALSE)
       ON CONFLICT (actor_id, target_id) DO UPDATE SET action_type = 'PASS', is_match = FALSE
    `, blockerID, blockedID)
	if err != nil {
		return err
	}

	// 2. Break their match towards us
	_, err = tx.ExecContext(ctx, "UPDATE interactions SET is_match = FALSE WHERE actor_id = $1 AND target_id = $2", blockedID, blockerID)
	if err != nil {
		return err
	}

	// 3. Insert into Blocks Matrix
	_, err = tx.ExecContext(ctx, "INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING", blockerID, blockedID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (r *Repository) ReportUser(ctx context.Context, reporterID, reportedID, reason string) (bool, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	lockedUsers, err := lockUsersInOrder(ctx, tx, reporterID, reportedID)
	if err != nil {
		return false, err
	}
	if _, ok := lockedUsers[reporterID]; !ok {
		return false, sql.ErrNoRows
	}

	// PRESERVATION: Fetch username so we don't lose them if they delete their account
	var reportedUsername string
	err = tx.QueryRowContext(ctx, "SELECT username FROM users WHERE id = $1", reportedID).Scan(&reportedUsername)
	if err != nil && err != sql.ErrNoRows {
		return false, err
	}

	// Insert Report
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO reports (reporter_id, reported_id, reported_username, reason) 
		VALUES ($1, $2, $3, $4)
	`, reporterID, reportedID, reportedUsername, reason); err != nil {
		return false, err
	}

	// Force PASS
	if _, err = tx.ExecContext(ctx, `
       INSERT INTO interactions (actor_id, target_id, action_type, is_match)
       VALUES ($1, $2, 'PASS', FALSE)
       ON CONFLICT (actor_id, target_id) DO UPDATE SET action_type = 'PASS', is_match = FALSE
    `, reporterID, reportedID); err != nil {
		return false, err
	}

	// Break Match
	if _, err = tx.ExecContext(ctx, "UPDATE interactions SET is_match = FALSE WHERE actor_id = $1 AND target_id = $2", reportedID, reporterID); err != nil {
		return false, err
	}

	var reportCount int
	err = tx.QueryRowContext(ctx, `
		WITH eligible AS (
			SELECT target.id, COUNT(DISTINCT report.reporter_id) AS report_count
			FROM users target
			JOIN reports report
			  ON report.reported_id = target.id
			 AND report.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
			 AND COALESCE(report.status, 'pending') <> 'dismissed'
			JOIN users reporter
			  ON reporter.id = report.reporter_id
			 AND reporter.role = 'client'
			WHERE target.id = $1
			  AND target.role = 'client'
			  AND target.status <> 'banned'
			  AND report.created_at > COALESCE((
				  SELECT MAX(review.reviewed_at)
				  FROM account_review_requests review
				  WHERE review.user_id = target.id
				    AND review.status = 'reinstated'
			  ), '-infinity'::timestamptz)
			GROUP BY target.id
			HAVING COUNT(DISTINCT report.reporter_id) >= 10
		)
		UPDATE users target
		SET status = 'banned',
		    token_version = token_version + 1,
		    updated_at = CURRENT_TIMESTAMP
		FROM eligible
		WHERE target.id = eligible.id
		  AND target.status <> 'banned'
		RETURNING eligible.report_count
	`, reportedID).Scan(&reportCount)
	restricted := err == nil
	if err != nil && err != sql.ErrNoRows {
		return false, err
	}
	if restricted {
		reason := fmt.Sprintf("Restricted after %d distinct client reports in 30 days", reportCount)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO admin_audit_logs (admin_id, admin_username, action, target_id, reason)
			VALUES (NULL, 'SYSTEM', 'AUTO_REPORT_RESTRICTION', $1, $2)
		`, reportedID, reason); err != nil {
			return false, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO notifications (user_id, event_type, title, message, icon, payload)
			VALUES ($1, 'ACCOUNT_RESTRICTED', 'Account restricted',
			        'Your account was restricted after receiving multiple user reports. You can request a review.',
			        'shield-alert', jsonb_build_object('reason', 'report_threshold', 'reportCount', $2))
		`, reportedID, reportCount); err != nil {
			return false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return restricted, nil
}
