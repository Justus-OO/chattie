package repository

import (
	"chattie-backend/models"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

const MaxManagedProfilesPerOperator = 8

const creatorPendingRepliesCTE = `
	WITH latest_client_messages AS (
		SELECT m.recipient_id AS profile_id, m.sender_id AS client_id, MAX(m.created_at) AS last_message_at
		FROM messages m
		JOIN users client ON client.id = m.sender_id AND client.role = 'client'
		WHERE m.room_id IS NULL
		  AND m.recipient_id IS NOT NULL
		  AND COALESCE(m.message_kind, 'chat') = 'chat'
		GROUP BY m.recipient_id, m.sender_id
	),
	pending_creator_replies AS (
		SELECT incoming.profile_id, incoming.client_id, incoming.last_message_at
		FROM latest_client_messages incoming
		WHERE NOT EXISTS (
			SELECT 1
			FROM messages reply
			WHERE reply.sender_id = incoming.profile_id
			  AND reply.recipient_id = incoming.client_id
			  AND reply.room_id IS NULL
			  AND COALESCE(reply.message_kind, 'chat') = 'chat'
			  AND reply.created_at > incoming.last_message_at
		)
	)
`

// GetOperatorRoster fetches all creators, their live presence, and nested performance/personas
func (r *Repository) GetOperatorRoster(ctx context.Context) ([]models.OperatorDetail, error) {
	// 1. Fetch base operators
	query := `
		SELECT u.id::text, u.username, u.email, u.role, u.status,
			   COALESCE(cs.current_balance, 0.00), COALESCE(cs.total_earned, 0.00),
			   COALESCE(op.commission_rate, 50.00), COALESCE(op.auto_pilot, false),
			   COALESCE(sec.last_ip, 'Unknown'), COALESCE(sec.mfa_enabled, false),
			   COALESCE(perf.msgs_sent, 0), COALESCE(perf.active_sessions, 0), COALESCE(perf.rating, 0.0)
		FROM users u
		LEFT JOIN creator_stats cs ON u.id = cs.user_id
		LEFT JOIN operator_profiles op ON u.id = op.user_id
		LEFT JOIN operator_security sec ON u.id = sec.user_id
		LEFT JOIN operator_performance perf ON u.id = perf.user_id
		WHERE u.role IN ('model', 'operator')
		ORDER BY cs.total_earned DESC
	`
	rows, err := r.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	operators := make([]models.OperatorDetail, 0)
	operatorIndices := make(map[string]int)
	for rows.Next() {
		var op models.OperatorDetail

		// Map the rows to our enriched struct
		if err := rows.Scan(
			&op.ID, &op.Username, &op.Email, &op.Role, &op.Status,
			&op.CurrentBalance, &op.TotalEarned,
			&op.CommissionRate, &op.AutoPilotActive,
			&op.Security.LastIP, &op.Security.MfaEnabled,
			&op.Performance.MsgsSent, &op.Performance.ActiveSessions, &op.Performance.Rating,
		); err != nil {
			return nil, err
		}

		op.DisplayName = op.Username // Fallback display name
		op.Security.Locked = (op.Status == "SUSPENDED")
		op.Performance.AvgReplyTime = "14s" // Example derived metric
		op.Personas = make([]models.PersonaMetric, 0)
		operatorIndices[op.ID] = len(operators)
		operators = append(operators, op)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if len(operators) == 0 {
		return operators, nil
	}

	personaQuery := creatorPendingRepliesCTE + `
		SELECT mp.id::text, mp.name, COALESCE(mp.avatar_url, ''), mp.archetype,
		       mp.status, COALESCE(mp.manager_id::text, ''),
		       COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.model_id = mp.id), 0.00),
		       (SELECT COUNT(DISTINCT CASE WHEN m.sender_id = mp.id THEN m.recipient_id ELSE m.sender_id END)
		        FROM messages m
		        WHERE m.room_id IS NULL AND m.recipient_id IS NOT NULL
		          AND (m.sender_id = mp.id OR m.recipient_id = mp.id)
		          AND m.created_at >= NOW() - INTERVAL '30 minutes'),
		       (SELECT COUNT(*) FROM pending_creator_replies p WHERE p.profile_id = mp.id),
		       (SELECT COUNT(*) FROM chat_requests cr WHERE cr.managed_profile_id = mp.id AND cr.status = 'PENDING'),
		       (SELECT COUNT(*) FROM user_media um WHERE um.user_id = mp.id),
		       COALESCE((SELECT MAX(m.created_at)::text FROM messages m
		                 WHERE m.room_id IS NULL AND (m.sender_id = mp.id OR m.recipient_id = mp.id)), '')
		FROM managed_profiles mp
		WHERE mp.manager_id IS NOT NULL
	`
	personaRows, err := r.DB.QueryContext(ctx, personaQuery)
	if err != nil {
		return nil, err
	}
	defer personaRows.Close()

	for personaRows.Next() {
		var p models.PersonaMetric
		if err := personaRows.Scan(
			&p.ID, &p.Name, &p.AvatarURL, &p.Archetype, &p.Status, &p.ManagerID,
			&p.Revenue, &p.ActiveChats, &p.PendingReplies, &p.Unread, &p.MediaVault, &p.LastActivity,
		); err != nil {
			return nil, err
		}
		if operatorIndex, exists := operatorIndices[p.ManagerID]; exists {
			operators[operatorIndex].Personas = append(operators[operatorIndex].Personas, p)
		}
	}
	if err := personaRows.Err(); err != nil {
		return nil, err
	}
	if err := personaRows.Close(); err != nil {
		return nil, err
	}
	return operators, nil
}

// UpdateOperatorCommission updates the cut split percentage for an operator
func (r *Repository) UpdateOperatorCommission(ctx context.Context, operatorID string, rate float64) error {
	_, err := r.DB.ExecContext(ctx, `
		INSERT INTO operator_profiles (user_id, commission_rate, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (user_id) DO UPDATE 
		SET commission_rate = EXCLUDED.commission_rate, updated_at = NOW()
	`, operatorID, rate)
	return err
}

// UpdateOperatorStatus forces an operator online, offline, or suspended (locked)
func (r *Repository) UpdateOperatorStatus(ctx context.Context, operatorID string, status string) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2
	`, status, operatorID)
	return err
}

// ToggleOperatorAutoPilot switches the operator's persona control between human and AI
func (r *Repository) ToggleOperatorAutoPilot(ctx context.Context, operatorID string, active bool) error {
	_, err := r.DB.ExecContext(ctx, `
		INSERT INTO operator_profiles (user_id, auto_pilot, updated_at)
		VALUES ($2, $1, NOW())
		ON CONFLICT (user_id) DO UPDATE
		SET auto_pilot = EXCLUDED.auto_pilot, updated_at = NOW()
	`, active, operatorID)
	return err
}

var (
	ErrOperatorNotFound       = errors.New("operator not found")
	ErrInvalidOperatorRole    = errors.New("user cannot manage profiles")
	ErrOperatorProfileLimit   = errors.New("operator already manages the maximum number of profiles")
	ErrPersonaNotFound        = errors.New("managed profile not found")
	ErrPersonaAlreadyAssigned = errors.New("managed profile is already assigned")
	ErrAssignmentNotFound     = errors.New("profile is not assigned to this operator")
)

func (r *Repository) BindPersonaToOperator(ctx context.Context, operatorID string, personaID string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var lockedProfileID string
	err = tx.QueryRowContext(ctx, `
		SELECT id::text FROM managed_profiles WHERE id = $1 FOR UPDATE
	`, personaID).Scan(&lockedProfileID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrPersonaNotFound
	}
	if err != nil {
		return err
	}

	var operatorRole string
	err = tx.QueryRowContext(ctx, `SELECT role FROM users WHERE id = $1 FOR UPDATE`, operatorID).Scan(&operatorRole)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrOperatorNotFound
	}
	if err != nil {
		return err
	}
	if operatorRole != "model" && operatorRole != "operator" {
		return ErrInvalidOperatorRole
	}

	var assignedCount int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM managed_profiles WHERE manager_id = $1
	`, operatorID).Scan(&assignedCount); err != nil {
		return err
	}
	if assignedCount >= MaxManagedProfilesPerOperator {
		return ErrOperatorProfileLimit
	}

	res, err := tx.ExecContext(ctx, `
        UPDATE managed_profiles 
        SET manager_id = $1, updated_at = NOW() 
        WHERE id = $2 AND manager_id IS NULL
    `, operatorID, personaID)

	if err != nil {
		return err
	}

	// Check if the database actually updated a row
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return err
	}

	if rowsAffected == 0 {
		return ErrPersonaAlreadyAssigned
	}

	return tx.Commit()
}

func (r *Repository) GetOperatorPendingReplyCount(ctx context.Context, operatorID string) (int, error) {
	var exists bool
	if err := r.DB.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM users
			WHERE id = $1 AND role IN ('model', 'operator')
		)
	`, operatorID).Scan(&exists); err != nil {
		return 0, err
	}
	if !exists {
		return 0, ErrOperatorNotFound
	}

	var count int
	err := r.DB.QueryRowContext(ctx, creatorPendingRepliesCTE+`
		SELECT COUNT(*)
		FROM pending_creator_replies pending
		JOIN managed_profiles mp ON mp.id = pending.profile_id
		WHERE mp.manager_id = $1
	`, operatorID).Scan(&count)
	return count, err
}

type CreatorProfileReassignment struct {
	ProfileID       string
	ProfileName     string
	PreviousManager string
	NewManager      string
	NewManagerName  string
	PendingReplies  int
}

func (r *Repository) ReassignIdleCreatorProfiles(ctx context.Context, idleAfterSeconds int64, batchSize, maxProfiles int) ([]CreatorProfileReassignment, error) {
	if idleAfterSeconds <= 0 || batchSize <= 0 || maxProfiles <= 0 {
		return nil, errors.New("idle duration, batch size, and profile cap must be positive")
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	candidates, err := tx.QueryContext(ctx, creatorPendingRepliesCTE+`
		SELECT mp.id::text, mp.name, COALESCE(mp.manager_id::text, '')
		FROM managed_profiles mp
		WHERE EXISTS (
			SELECT 1
			FROM pending_creator_replies pending
			WHERE pending.profile_id = mp.id
			  AND pending.last_message_at <= NOW() - ($1 * INTERVAL '1 second')
		  )
		ORDER BY mp.updated_at, mp.id
		LIMIT $2
		FOR UPDATE OF mp SKIP LOCKED
	`, idleAfterSeconds, batchSize)
	if err != nil {
		return nil, err
	}

	type idleProfile struct {
		id              string
		name            string
		previousManager string
	}
	idleProfiles := make([]idleProfile, 0)
	for candidates.Next() {
		var profile idleProfile
		if err := candidates.Scan(&profile.id, &profile.name, &profile.previousManager); err != nil {
			candidates.Close()
			return nil, err
		}
		idleProfiles = append(idleProfiles, profile)
	}
	if err := candidates.Err(); err != nil {
		candidates.Close()
		return nil, err
	}
	if err := candidates.Close(); err != nil {
		return nil, err
	}

	reassigned := make([]CreatorProfileReassignment, 0)
	for _, profile := range idleProfiles {
		var pendingCount int
		err := tx.QueryRowContext(ctx, creatorPendingRepliesCTE+`
			SELECT COUNT(*)
			FROM pending_creator_replies
			WHERE profile_id = $1
			  AND last_message_at <= NOW() - ($2 * INTERVAL '1 second')
		`, profile.id, idleAfterSeconds).Scan(&pendingCount)
		if err != nil {
			return nil, err
		}
		if pendingCount == 0 {
			continue
		}

		var newManagerID, newManagerName string
		err = tx.QueryRowContext(ctx, `
			SELECT u.id::text, u.username
			FROM users u
			WHERE ($1 = '' OR u.id::text <> $1)
			  AND u.role IN ('model', 'operator')
			  AND LOWER(u.status) IN ('active', 'online')
			  AND u.last_active >= NOW() - INTERVAL '24 hours'
			  AND EXISTS (
				SELECT 1
				FROM messages reply
				WHERE reply.room_id IS NULL
				  AND reply.recipient_id IS NOT NULL
				  AND COALESCE(reply.message_kind, 'chat') = 'chat'
				  AND reply.created_at >= NOW() - INTERVAL '24 hours'
				  AND (
					reply.sender_id = u.id
					OR EXISTS (
						SELECT 1 FROM managed_profiles active_profile
						WHERE active_profile.id = reply.sender_id
						  AND active_profile.manager_id = u.id
					)
				  )
			  )
			  AND (SELECT COUNT(*) FROM managed_profiles assigned WHERE assigned.manager_id = u.id) < $2
			ORDER BY (SELECT COUNT(*) FROM managed_profiles assigned WHERE assigned.manager_id = u.id),
			         u.last_active DESC, u.id
			LIMIT 1
			FOR UPDATE OF u SKIP LOCKED
		`, profile.previousManager, maxProfiles).Scan(&newManagerID, &newManagerName)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}

		result, err := tx.ExecContext(ctx, `
			UPDATE managed_profiles
			SET manager_id = $1, updated_at = NOW()
			WHERE id = $2 AND manager_id = $3
		`, newManagerID, profile.id, profile.previousManager)
		if err != nil {
			return nil, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return nil, err
		}
		if affected == 1 {
			reassigned = append(reassigned, CreatorProfileReassignment{
				ProfileID:       profile.id,
				ProfileName:     profile.name,
				PreviousManager: profile.previousManager,
				NewManager:      newManagerID,
				NewManagerName:  newManagerName,
				PendingReplies:  pendingCount,
			})
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return reassigned, nil
}

// UnbindPersonaFromOperator removes a virtual persona from a human operator
func (r *Repository) UnbindPersonaFromOperator(ctx context.Context, operatorID string, personaID string) error {
	result, err := r.DB.ExecContext(ctx, `
		UPDATE managed_profiles SET manager_id = NULL, updated_at = NOW()
		WHERE id = $1 AND manager_id = $2
	`, personaID, operatorID)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrAssignmentNotFound
	}
	return nil
}

// GetManagedPersonasMetrics fetches performance metrics for all virtual model profiles
func (r *Repository) EnsurePersonaManagedProfiles(ctx context.Context) error {
	_, err := r.DB.ExecContext(ctx, `
		INSERT INTO user_media (user_id, url, is_primary, sort_order)
		SELECT u.id, p.avatar_url, TRUE, 0
		FROM users u
		JOIN user_profiles p ON p.user_id = u.id
		WHERE u.role = 'persona'
		  AND NULLIF(BTRIM(p.avatar_url), '') IS NOT NULL
		  AND NOT EXISTS (
		      SELECT 1 FROM user_media um
		      WHERE um.user_id = u.id AND NULLIF(BTRIM(um.url), '') IS NOT NULL
		  )
	`)
	if err != nil {
		return err
	}

	_, err = r.DB.ExecContext(ctx, `
		INSERT INTO managed_profiles (id, name, avatar_url, archetype, status)
		SELECT u.id,
		       LEFT(COALESCE(NULLIF(p.display_name, ''), u.username), 100),
		       COALESCE(p.avatar_url, ''),
		       COALESCE(NULLIF(p.intent, ''), 'General'),
		       'offline'
		FROM users u
		LEFT JOIN user_profiles p ON p.user_id = u.id
		WHERE u.role = 'persona'
		ON CONFLICT (id) DO NOTHING
	`)
	return err
}

func (r *Repository) GetManagedPersonasMetrics(ctx context.Context) ([]models.PersonaMetric, error) {
	query := creatorPendingRepliesCTE + `
		SELECT mp.id::text, mp.name, COALESCE(mp.avatar_url, ''), mp.archetype,
		       mp.status, COALESCE(mp.manager_id::text, ''),
		       COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.model_id = mp.id), 0.00),
		       (SELECT COUNT(DISTINCT CASE WHEN m.sender_id = mp.id THEN m.recipient_id ELSE m.sender_id END)
		        FROM messages m
		        WHERE m.room_id IS NULL AND m.recipient_id IS NOT NULL
		          AND (m.sender_id = mp.id OR m.recipient_id = mp.id)
		          AND m.created_at >= NOW() - INTERVAL '30 minutes'),
		       (SELECT COUNT(*) FROM pending_creator_replies p WHERE p.profile_id = mp.id),
		       (SELECT COUNT(*) FROM chat_requests cr WHERE cr.managed_profile_id = mp.id AND cr.status = 'PENDING'),
		       (SELECT COUNT(*) FROM user_media um WHERE um.user_id = mp.id),
		       COALESCE((SELECT MAX(m.created_at)::text FROM messages m
		                 WHERE m.room_id IS NULL AND (m.sender_id = mp.id OR m.recipient_id = mp.id)), '')
		FROM managed_profiles mp
		ORDER BY mp.created_at DESC, mp.id
	`
	rows, err := r.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]models.PersonaMetric, 0)
	for rows.Next() {
		var p models.PersonaMetric
		if err := rows.Scan(
			&p.ID, &p.Name, &p.AvatarURL, &p.Archetype, &p.Status, &p.ManagerID,
			&p.Revenue, &p.ActiveChats, &p.PendingReplies, &p.Unread, &p.MediaVault, &p.LastActivity,
		); err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}
func (r *Repository) CreatePersona(ctx context.Context, persona models.CreatePersonaRequest) (string, error) {
	interests, err := NormalizeOnboardingTags(persona.Interests)
	if err != nil {
		return "", err
	}
	if persona.Latitude == nil || persona.Longitude == nil {
		return "", fmt.Errorf("persona location coordinates are required")
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	if persona.Archetype == "" {
		persona.Archetype = "General"
	}

	// Persona accounts are app-visible users, but credentials are never shared with creators.
	safeName := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, strings.ToLower(persona.Name))
	if safeName == "" {
		safeName = "profile"
	}
	if len(safeName) > 24 {
		safeName = safeName[:24]
	}
	randomBytes := make([]byte, 8)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("generate persona credentials: %w", err)
	}
	suffix := hex.EncodeToString(randomBytes)

	username := fmt.Sprintf("persona_%s_%s", safeName, suffix)
	email := fmt.Sprintf("%s@virtual.local", username)

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(suffix), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash persona credentials: %w", err)
	}

	// =========================================================================
	// STEP 1: CREATE BASE USER (Role = 'model', Status = 'active')
	// =========================================================================
	var userID string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO users (email, username, password_hash, role, status)
		VALUES ($1, $2, $3, 'persona', 'active')
		RETURNING id::text
	`, email, username, string(hashedPassword)).Scan(&userID)
	if err != nil {
		return "", fmt.Errorf("create persona user: %w", err)
	}

	// =========================================================================
	// STEP 2: SETUP PROFILE (Just like Onboarding Step 2)
	// =========================================================================
	_, err = tx.ExecContext(ctx, `
		INSERT INTO user_profiles (user_id, display_name, date_of_birth, gender, bio, height_cm, avatar_url, intent, verified)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
	`, userID, persona.Name, persona.DateOfBirth, persona.Gender, persona.Bio, persona.Height, persona.AvatarURL, persona.Archetype)
	if err != nil {
		return "", fmt.Errorf("create persona profile: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO user_media (user_id, url, is_primary, sort_order)
		VALUES ($1, $2, TRUE, 0)
	`, userID, persona.AvatarURL)
	if err != nil {
		return "", fmt.Errorf("create persona discovery image: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO user_locations (user_id, latitude, longitude, city, country, country_code)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, userID, *persona.Latitude, *persona.Longitude, persona.City, persona.Country, persona.CountryCode)
	if err != nil {
		return "", fmt.Errorf("create persona location: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO user_preferences (user_id, interested_in, min_age, max_age, max_distance_km)
		VALUES ($1, 'all', 18, 99, 500)
	`, userID)
	if err != nil {
		return "", fmt.Errorf("create persona preferences: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO user_settings (user_id, global_mode) VALUES ($1, FALSE)
		ON CONFLICT (user_id) DO UPDATE SET global_mode = EXCLUDED.global_mode
	`, userID)
	if err != nil {
		return "", fmt.Errorf("create persona settings: %w", err)
	}

	for _, interest := range interests {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO user_tags (user_id, tag) VALUES ($1, $2)
		`, userID, interest); err != nil {
			return "", fmt.Errorf("create persona interest: %w", err)
		}
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO creator_stats (user_id, current_balance, total_earned, is_online)
		VALUES ($1, 0.00, 0.00, FALSE)
	`, userID)
	if err != nil {
		return "", fmt.Errorf("create persona stats: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO managed_profiles (id, name, archetype, avatar_url, status)
		VALUES ($1, $2, $3, $4, 'offline')
	`, userID, persona.Name, persona.Archetype, persona.AvatarURL)
	if err != nil {
		return "", fmt.Errorf("create managed persona profile: %w", err)
	}

	if err = tx.Commit(); err != nil {
		return "", fmt.Errorf("commit persona creation: %w", err)
	}

	return userID, nil
}
