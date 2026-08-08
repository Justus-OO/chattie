package repository

import (
	"chattie-backend/models"
	"context"
	"database/sql"
	"errors"

	"github.com/lib/pq"
)

// =====================================================================
// CUSTOM ERRORS
// =====================================================================

var (
	ErrPermissionDenied = errors.New("permission denied: upgrade to premium required")
	ErrUserNotFound     = errors.New("user profile not found")
)

// =====================================================================
// 1. PROCESS SWIPE / INTERACTION (Auto-Match for Models/Personas)
// =====================================================================

func (r *Repository) ProcessAction(ctx context.Context, userID string, req models.InteractionRequest) (*models.InteractionResponse, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var maxSwipes, maxSuperLikes, swipesUsed, superLikesUsed int

	limitQuery := `
		SELECT 
			t.max_daily_swipes, t.max_daily_super_likes,
			COALESCE(u.swipes_used, 0), COALESCE(u.super_likes_used, 0)
		FROM user_subscriptions s
		JOIN subscription_tiers t ON s.tier_id = t.id
		LEFT JOIN user_daily_usage u ON s.user_id = u.user_id AND u.usage_date = CURRENT_DATE
		WHERE s.user_id = $1
	`
	err = tx.QueryRowContext(ctx, limitQuery, userID).Scan(&maxSwipes, &maxSuperLikes, &swipesUsed, &superLikesUsed)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}

	if req.ActionType == "LIKE" || req.ActionType == "PASS" || req.ActionType == "FLIRT" {
		if maxSwipes != -1 && swipesUsed >= maxSwipes {
			return &models.InteractionResponse{Allowed: false, Message: "Daily limit reached"}, nil
		}
	} else if req.ActionType == "SUPER_LIKE" {
		if maxSuperLikes != -1 && superLikesUsed >= maxSuperLikes {
			return &models.InteractionResponse{Allowed: false, Message: "Daily super like limit reached"}, nil
		}
	}

	// 1. Record the user's interaction towards the target
	insertQuery := `
		INSERT INTO interactions (actor_id, target_id, action_type, is_match)
		VALUES ($1, $2, $3, FALSE)
		ON CONFLICT (actor_id, target_id) DO UPDATE 
		SET action_type = EXCLUDED.action_type
		RETURNING id
	`
	var interactionID string
	err = tx.QueryRowContext(ctx, insertQuery, userID, req.TargetID, req.ActionType).Scan(&interactionID)
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
		// Check if the target is a model/persona
		var targetRole string
		err = tx.QueryRowContext(ctx, `SELECT role FROM users WHERE id = $1`, req.TargetID).Scan(&targetRole)

		// If target is a model/persona, AUTO-LIKE back immediately!
		if err == nil && targetRole == "model" {
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

		// Check mutual status (now guaranteed to match if target is a model)
		var mutualID string
		matchQuery := `
			SELECT id FROM interactions 
			WHERE actor_id = $1 AND target_id = $2 AND action_type IN ('LIKE', 'SUPER_LIKE', 'FLIRT')
		`
		err = tx.QueryRowContext(ctx, matchQuery, req.TargetID, userID).Scan(&mutualID)

		if err == nil && mutualID != "" {
			isMatch = true
			updateMatchQuery := `
				UPDATE interactions SET is_match = TRUE 
				WHERE (actor_id = $1 AND target_id = $2) OR (actor_id = $2 AND target_id = $1)
			`
			if _, err = tx.ExecContext(ctx, updateMatchQuery, userID, req.TargetID); err != nil {
				return nil, err
			}
		} else if err != sql.ErrNoRows {
			return nil, err
		}
	}

	if err = tx.Commit(); err != nil {
		return nil, err
	}

	return &models.InteractionResponse{Allowed: true, IsMatch: isMatch}, nil
}

func (r *Repository) GetFullProfile(ctx context.Context, currentUserID, targetUserID string) (*models.DiscoverProfile, error) {
	if currentUserID != targetUserID {
		viewQuery := `
			INSERT INTO profile_views (viewer_id, viewed_id, viewed_at) 
			VALUES ($1, $2, NOW()) 
			ON CONFLICT (viewer_id, viewed_id) DO UPDATE SET viewed_at = NOW()
		`
		r.DB.ExecContext(ctx, viewQuery, currentUserID, targetUserID)
	}

	query := `
		WITH current_user_data AS (
			SELECT 
				COALESCE(loc.latitude, 0.0) AS latitude, 
				COALESCE(loc.longitude, 0.0) AS longitude,
				COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = $1), ARRAY[]::VARCHAR[]) AS my_tags
			FROM users u
			LEFT JOIN user_locations loc ON u.id = loc.user_id
			WHERE u.id = $1
		)
		SELECT 
			u.id, p.display_name, COALESCE(p.bio, ''), EXTRACT(YEAR FROM age(p.date_of_birth))::INT AS age,
			COALESCE(l.city, 'Unknown'),
			CASE 
				WHEN cu.latitude = 0 OR l.latitude IS NULL THEN 9999.0
				ELSE (6371 * acos(cos(radians(cu.latitude)) * cos(radians(l.latitude)) * cos(radians(l.longitude) - radians(cu.longitude)) + sin(radians(cu.latitude)) * sin(radians(l.latitude)))) 
			END AS distance_km,
			COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[]) AS their_tags,
			COALESCE(ARRAY(SELECT url FROM user_media WHERE user_id = u.id ORDER BY created_at ASC), ARRAY[]::TEXT[]) AS images,
			(50 + COALESCE((SELECT COUNT(*) * 50.0 / NULLIF(array_length(cu.my_tags, 1), 0) FROM unnest(COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[])) AS t WHERE t = ANY(cu.my_tags)), 0))::INT AS match_pct
		FROM users u
		JOIN user_profiles p ON u.id = p.user_id
		LEFT JOIN user_locations l ON u.id = l.user_id
		CROSS JOIN current_user_data cu
		WHERE u.id = $2 AND u.status IN ('active', 'online')
	`
	var p models.DiscoverProfile
	err := r.DB.QueryRowContext(ctx, query, currentUserID, targetUserID).Scan(
		&p.ID, &p.DisplayName, &p.Bio, &p.Age, &p.City, &p.Distance,
		pq.Array(&p.Tags), pq.Array(&p.Images), &p.MatchPct,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return &p, nil
}

func (r *Repository) GetMatches(ctx context.Context, userID string) ([]models.MatchResponse, error) {
	query := `
		SELECT 
			u.id::text,
			COALESCE(p.display_name, u.username) AS display_name,
			COALESCE(
			   (SELECT url FROM user_media WHERE user_id = u.id ORDER BY created_at ASC LIMIT 1), 
			   ''
			) AS avatar_url,
			CASE 
				WHEN u.status = 'online' THEN 'online' 
				ELSE 'offline' 
			END AS status
		FROM interactions i
		JOIN users u ON i.target_id = u.id
		LEFT JOIN user_profiles p ON u.id = p.user_id
		WHERE i.actor_id = $1 AND i.is_match = TRUE
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
		if err := rows.Scan(&m.ID, &m.DisplayName, &m.AvatarURL, &m.Status); err != nil {
			return nil, err
		}
		m.MatchPct = 95
		matches = append(matches, m)
	}

	return matches, nil
}

func (r *Repository) GetSecretAdmirers(ctx context.Context, userID string) ([]models.DiscoverProfile, bool, error) {
	var isPremium bool
	tierQuery := `
		SELECT t.can_see_likes FROM user_subscriptions s 
		JOIN subscription_tiers t ON s.tier_id = t.id 
		WHERE s.user_id = $1 AND s.status = 'active'
	`
	err := r.DB.QueryRowContext(ctx, tierQuery, userID).Scan(&isPremium)
	if err != nil && err != sql.ErrNoRows {
		return nil, false, err
	}

	query := `
		SELECT 
			u.id, p.display_name, COALESCE(p.bio, ''), EXTRACT(YEAR FROM age(p.date_of_birth))::INT,
			COALESCE(l.city, 'Unknown'),
			COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[]),
			COALESCE(ARRAY(SELECT url FROM user_media WHERE user_id = u.id ORDER BY created_at ASC), ARRAY[]::TEXT[]),
			i.created_at
		FROM interactions i
		JOIN users u ON i.actor_id = u.id
		JOIN user_profiles p ON u.id = p.user_id
		LEFT JOIN user_locations l ON u.id = l.user_id
		WHERE i.target_id = $1 AND i.action_type IN ('LIKE', 'SUPER_LIKE') AND i.is_match = FALSE
		ORDER BY i.created_at DESC
	`
	rows, err := r.DB.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, isPremium, err
	}
	defer rows.Close()

	var profiles []models.DiscoverProfile
	for rows.Next() {
		var p models.DiscoverProfile
		var createdAt string
		if err := rows.Scan(&p.ID, &p.DisplayName, &p.Bio, &p.Age, &p.City, pq.Array(&p.Tags), pq.Array(&p.Images), &createdAt); err != nil {
			return nil, isPremium, err
		}
		profiles = append(profiles, p)
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
	`, userID).Scan(&canUndo)

	if err != nil || !canUndo {
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

	_, err = tx.ExecContext(ctx, `
		INSERT INTO interactions (actor_id, target_id, action_type, is_match)
		VALUES ($1, $2, 'PASS', FALSE)
		ON CONFLICT (actor_id, target_id) DO UPDATE SET action_type = 'PASS', is_match = FALSE
	`, blockerID, blockedID)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, "UPDATE interactions SET is_match = FALSE WHERE actor_id = $1 AND target_id = $2", blockedID, blockerID)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, "INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING", blockerID, blockedID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (r *Repository) ReportUser(ctx context.Context, reporterID, reportedID, reason string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.ExecContext(ctx, "INSERT INTO reports (reporter_id, reported_id, reason) VALUES ($1, $2, $3)", reporterID, reportedID, reason); err != nil {
		return err
	}

	if _, err = tx.ExecContext(ctx, `
		INSERT INTO interactions (actor_id, target_id, action_type, is_match)
		VALUES ($1, $2, 'PASS', FALSE)
		ON CONFLICT (actor_id, target_id) DO UPDATE SET action_type = 'PASS', is_match = FALSE
	`, reporterID, reportedID); err != nil {
		return err
	}

	if _, err = tx.ExecContext(ctx, "UPDATE interactions SET is_match = FALSE WHERE actor_id = $1 AND target_id = $2", reportedID, reporterID); err != nil {
		return err
	}

	return tx.Commit()
}
