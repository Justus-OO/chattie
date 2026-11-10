package repository

import (
	"chattie-backend/models"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
)

// =====================================================================
// SUBSCRIPTION / VIP UPGRADE
// =====================================================================

// UpgradeToPremium sets the user's tier, resets limits immediately, and logs the audit trail.
func (r *Repository) UpgradeToPremium(ctx context.Context, userID string, months int) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Extend or activate the subscription
	query := `
       INSERT INTO user_subscriptions (user_id, tier_id, status, expires_at)
       VALUES ($1, 2, 'active', NOW() + INTERVAL '1 month' * $2)
       ON CONFLICT (user_id) 
       DO UPDATE SET 
          tier_id = 2,
          status = 'active',
          expires_at = CASE 
             WHEN user_subscriptions.expires_at > NOW() 
             THEN user_subscriptions.expires_at + INTERVAL '1 month' * $2
             ELSE NOW() + INTERVAL '1 month' * $2
          END,
          updated_at = NOW()
    `
	if _, err := tx.ExecContext(ctx, query, userID, months); err != nil {
		return err
	}

	// 2. REAL WORLD LOGIC: Reset daily limits immediately so the user can enjoy premium perks right now
	resetQuery := `
       UPDATE user_daily_usage 
       SET swipes_used = 0, super_likes_used = 0, voice_joins_used = 0, rooms_created_used = 0
       WHERE user_id = $1 AND usage_date = CURRENT_DATE
    `
	if _, err := tx.ExecContext(ctx, resetQuery, userID); err != nil {
		return err
	}

	// 3. Log the action for admin analytics/auditing
	metaBytes, _ := json.Marshal(map[string]int{"months_purchased": months, "tier_id": 2})
	logQuery := `
       INSERT INTO user_action_logs (user_id, action_type, metadata) 
       VALUES ($1, 'UPGRADED_PREMIUM', $2)
    `
	if _, err := tx.ExecContext(ctx, logQuery, userID, string(metaBytes)); err != nil {
		return err
	}

	return tx.Commit()
}

// =====================================================================
// MODERATION & REPORTS
// =====================================================================

// SubmitReport handles reports, enforces immediate blocking, breaks matches, and dings the target's risk score.
func (r *Repository) SubmitReport(ctx context.Context, reporterID string, req models.ReportRequest) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var targetID sql.NullString
	reportedUsername := req.ReportedUsername

	// 1. Resolve UUID and fetch username for permanent evidence
	if reportedUsername != "" && req.ReportedID == "" {
		err = tx.QueryRowContext(ctx, "SELECT id FROM users WHERE username = $1", reportedUsername).Scan(&targetID)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
	} else if req.ReportedID != "" {
		targetID = sql.NullString{String: req.ReportedID, Valid: true}
		tx.QueryRowContext(ctx, "SELECT username FROM users WHERE id = $1", req.ReportedID).Scan(&reportedUsername)
	}

	// 2. Insert the actual report
	query := `
       INSERT INTO reports (reporter_id, reported_id, reported_username, reason, description) 
       VALUES ($1, $2, $3, $4, $5)
    `
	if _, err := tx.ExecContext(ctx, query, reporterID, targetID, reportedUsername, req.Reason, req.Description); err != nil {
		return err
	}

	// 3. TRUST & SAFETY LOGIC: If we identified the user, instantly block and penalize them
	if targetID.Valid {
		reportedUUID := targetID.String

		// A. Auto-Block (Prevents them from seeing the reporter again)
		_, err = tx.ExecContext(ctx, `
          INSERT INTO blocks (blocker_id, blocked_id, created_at) 
          VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING
       `, reporterID, reportedUUID)
		if err != nil {
			return err
		}

		// B. Break Match & overwrite interactions to PASS
		_, err = tx.ExecContext(ctx, `
          INSERT INTO interactions (actor_id, target_id, action_type, is_match)
          VALUES ($1, $2, 'PASS', FALSE)
          ON CONFLICT (actor_id, target_id) DO UPDATE SET action_type = 'PASS', is_match = FALSE
       `, reporterID, reportedUUID)
		if err != nil {
			return err
		}

		_, err = tx.ExecContext(ctx, `
          UPDATE interactions SET is_match = FALSE 
          WHERE actor_id = $1 AND target_id = $2
       `, reportedUUID, reporterID)
		if err != nil {
			return err
		}

		// C. Penalize the reported user's risk profile (Increases risk score by 15%, max 100)
		_, err = tx.ExecContext(ctx, `
          UPDATE client_behavior 
          SET flags_count = flags_count + 1,
             risk_score = LEAST(risk_score + 15, 100),
             last_flagged_at = NOW(),
             updated_at = NOW()
          WHERE user_id = $1
       `, reportedUUID)
		if err != nil {
			log.Printf("Warning: Failed to update client behavior for %s", reportedUUID)
		}
	}

	// 4. Log the action
	metaBytes, _ := json.Marshal(map[string]string{"reason": req.Reason, "target_username": reportedUsername})
	if _, err := tx.ExecContext(ctx, `INSERT INTO user_action_logs (user_id, action_type, target_id, metadata) VALUES ($1, 'SUBMITTED_REPORT', $2, $3)`, reporterID, targetID, string(metaBytes)); err != nil {
		return err
	}

	return tx.Commit()
}

// =====================================================================
// GUIDELINES
// =====================================================================

// AgreeToGuidelines updates the user_settings table and permanently logs the agreement.
func (r *Repository) AgreeToGuidelines(ctx context.Context, userID string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Update the setting
	if _, err := tx.ExecContext(ctx, "UPDATE user_settings SET guidelines_agreed = TRUE WHERE user_id = $1", userID); err != nil {
		return err
	}

	// 2. REAL WORLD LOGIC: Log this for Legal / Compliance reasons
	metaBytes, _ := json.Marshal(map[string]string{"version": "1.0", "agreed_at": "true"})
	if _, err := tx.ExecContext(ctx, `INSERT INTO user_action_logs (user_id, action_type, metadata) VALUES ($1, 'AGREED_TO_GUIDELINES', $2)`, userID, string(metaBytes)); err != nil {
		return err
	}

	return tx.Commit()
}

// GetActiveBillingPlans fetches dynamic pricing from the database
func (r *Repository) GetActiveBillingPlans(ctx context.Context) ([]models.BillingPlan, error) {
	query := `
       SELECT duration_months, price, monthly_breakdown, save_percentage, is_popular 
       FROM billing_plans 
       WHERE is_active = TRUE 
       ORDER BY duration_months ASC
    `
	rows, err := r.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var plans []models.BillingPlan
	for rows.Next() {
		var p models.BillingPlan
		var duration int

		if err := rows.Scan(&duration, &p.Price, &p.Monthly, &p.Save, &p.IsPopular); err != nil {
			return nil, err
		}

		// Map to match the exact JSON structure React expects
		p.ID = duration
		if duration == 1 {
			p.Duration = "1 Month"
		} else {
			p.Duration = fmt.Sprintf("%d Months", duration)
		}

		plans = append(plans, p)
	}

	return plans, nil
}

// =====================================================================
// GATEWAY MAPPING
// =====================================================================

// GetPlanPrice fetches the exact price amount for the requested duration
func (r *Repository) GetPlanPrice(ctx context.Context, durationMonths int) (float64, error) {
	var price float64
	query := `
       SELECT price 
       FROM billing_plans 
       WHERE duration_months = $1 AND is_active = TRUE
    `

	// Query the database for the exact price amount associated with this duration
	err := r.DB.QueryRowContext(ctx, query, durationMonths).Scan(&price)
	if err != nil {
		if err == sql.ErrNoRows {
			return 0, fmt.Errorf("no active billing plan found for %d months", durationMonths)
		}
		return 0, err
	}

	return price, nil
}
