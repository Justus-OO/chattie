package repository

import (
	"chattie-backend/models"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/rand"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

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

	var operators []models.OperatorDetail
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
			continue
		}

		op.DisplayName = op.Username // Fallback display name
		op.Security.Locked = (op.Status == "SUSPENDED")
		op.Performance.AvgReplyTime = "14s" // Example derived metric

		// Fetch bound personas for this operator
		op.Personas, _ = r.getPersonasForManager(ctx, op.ID)

		operators = append(operators, op)
	}
	return operators, nil
}

// Helper to fetch personas for a specific manager ID
func (r *Repository) getPersonasForManager(ctx context.Context, managerID string) ([]models.PersonaMetric, error) {
	query := `
		SELECT id::text, name, COALESCE(avatar_url, ''), status, manager_id::text
		FROM managed_profiles 
		WHERE manager_id = $1
	`
	rows, err := r.DB.QueryContext(ctx, query, managerID)
	if err != nil {
		return []models.PersonaMetric{}, err
	}
	defer rows.Close()

	var personas []models.PersonaMetric
	for rows.Next() {
		var p models.PersonaMetric
		if err := rows.Scan(&p.ID, &p.Name, &p.AvatarURL, &p.Status, &p.ManagerID); err == nil {
			personas = append(personas, p)
		}
	}
	return personas, nil
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
		UPDATE operator_profiles SET auto_pilot = $1, updated_at = NOW() WHERE user_id = $2
	`, active, operatorID)
	return err
}
func (r *Repository) BindPersonaToOperator(ctx context.Context, operatorID string, personaID string) error {
	res, err := r.DB.ExecContext(ctx, `
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

	// If 0 rows were updated, it means the persona ID doesn't exist OR it already has a manager_id
	if rowsAffected == 0 {
		return errors.New("persona already assigned or not found")
	}

	return nil
}

// UnbindPersonaFromOperator removes a virtual persona from a human operator
func (r *Repository) UnbindPersonaFromOperator(ctx context.Context, personaID string) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE managed_profiles SET manager_id = NULL, updated_at = NOW() WHERE id = $1
	`, personaID)
	return err
}

// GetManagedPersonasMetrics fetches performance metrics for all virtual model profiles
func (r *Repository) GetManagedPersonasMetrics(ctx context.Context) ([]models.PersonaMetric, error) {
	query := `
		SELECT mp.id::text, mp.name, COALESCE(mp.avatar_url, ''), mp.status, COALESCE(mp.manager_id::text, ''),
			   COALESCE(SUM(t.amount), 0.00) as total_revenue
		FROM managed_profiles mp
		LEFT JOIN transactions t ON t.model_id = mp.id
		GROUP BY mp.id, mp.name, mp.avatar_url, mp.status, mp.manager_id
	`
	rows, err := r.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.PersonaMetric
	for rows.Next() {
		var p models.PersonaMetric
		if err := rows.Scan(&p.ID, &p.Name, &p.AvatarURL, &p.Status, &p.ManagerID, &p.Revenue); err != nil {
			continue
		}
		list = append(list, p)
	}
	return list, nil
}
func (r *Repository) CreatePersona(ctx context.Context, name, archetype, avatarUrl string) (string, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	if archetype == "" {
		archetype = "General"
	}

	// 1. Generate unique dummy credentials
	safeName := strings.ToLower(strings.ReplaceAll(name, " ", ""))
	randomBytes := make([]byte, 4)
	rand.Read(randomBytes)
	suffix := hex.EncodeToString(randomBytes)

	username := fmt.Sprintf("persona_%s_%s", safeName, suffix)
	email := fmt.Sprintf("%s@virtual.local", username)

	// Dummy password
	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(suffix), bcrypt.DefaultCost)

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
		return "", err
	}

	// =========================================================================
	// STEP 2: SETUP PROFILE (Just like Onboarding Step 2)
	// =========================================================================
	_, err = tx.ExecContext(ctx, `
		INSERT INTO user_profiles (user_id, display_name, date_of_birth, gender, bio, height_cm, avatar_url, intent, verified)
		VALUES ($1, $2, '2000-01-01', 'Female', 'I am a virtual persona.', 165, $3, $4, TRUE)
	`, userID, name, avatarUrl, archetype)
	if err != nil {
		return "", err
	}

	// =========================================================================
	// STEP 3: SETUP LOCATION (Just like Onboarding Step 3)
	// We give them a default 0,0 location so distance math doesn't crash
	// =========================================================================
	_, err = tx.ExecContext(ctx, `
		INSERT INTO user_locations (user_id, latitude, longitude, city, country)
		VALUES ($1, 0.0, 0.0, 'Global', 'Virtual')
	`, userID)
	if err != nil {
		return "", err
	}

	// =========================================================================
	// STEP 4: SETUP PREFERENCES (Just like Onboarding Step 4)
	// =========================================================================
	_, err = tx.ExecContext(ctx, `
		INSERT INTO user_preferences (user_id, interested_in, min_age, max_age, max_distance_km)
		VALUES ($1, 'All', 18, 99, 10000)
	`, userID)
	if err != nil {
		return "", err
	}

	// =========================================================================
	// STEP 5: INITIALIZE SETTINGS
	// =========================================================================
	_, err = tx.ExecContext(ctx, `
		INSERT INTO user_settings (user_id, global_mode) VALUES ($1, TRUE)
	`, userID)
	if err != nil {
		return "", err
	}

	// =========================================================================
	// STEP 6: CREATOR STATS (So they have their own ledger/wallet)
	// =========================================================================
	_, err = tx.ExecContext(ctx, `
		INSERT INTO creator_stats (user_id, current_balance, total_earned, is_online)
		VALUES ($1, 0.00, 0.00, FALSE)
	`, userID)
	if err != nil {
		return "", err
	}

	// =========================================================================
	// STEP 7: ADMIN MANAGEMENT (Links the User ID to the admin UI for operators)
	// =========================================================================
	_, err = tx.ExecContext(ctx, `
		INSERT INTO managed_profiles (id, name, archetype, avatar_url, status)
		VALUES ($1, $2, $3, $4, 'offline')
	`, userID, name, archetype, avatarUrl)
	if err != nil {
		return "", err
	}

	// Commit everything!
	if err = tx.Commit(); err != nil {
		return "", err
	}

	return userID, nil
}
