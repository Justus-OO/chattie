package repository

import (
	"chattie-backend/models"
	"context"
	"database/sql"
)

// =====================================================================
// SUBSCRIPTION / VIP UPGRADE
// =====================================================================

// UpgradeToPremium sets the user's tier to 'premium' (id=2) and extends their expiration date
func (r *Repository) UpgradeToPremium(ctx context.Context, userID string, months int) error {
	// Assuming tier_id = 2 is 'premium' based on your SQL seed data
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
	_, err := r.DB.ExecContext(ctx, query, userID, months)
	return err
}

// =====================================================================
// MODERATION & REPORTS
// =====================================================================

// SubmitReport handles reports from both direct profiles and manual username entry
func (r *Repository) SubmitReport(ctx context.Context, reporterID string, req models.ReportRequest) error {
	var targetID sql.NullString

	// If a username was provided instead of an ID, look up the UUID first
	if req.ReportedUsername != "" && req.ReportedID == "" {
		err := r.DB.QueryRowContext(ctx, "SELECT id FROM users WHERE username = $1", req.ReportedUsername).Scan(&targetID)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
	} else if req.ReportedID != "" {
		targetID = sql.NullString{String: req.ReportedID, Valid: true}
	}

	// Insert the report securely
	query := `
       INSERT INTO reports (reporter_id, reported_id, reported_username, reason, description) 
       VALUES ($1, $2, $3, $4, $5)
    `
	_, err := r.DB.ExecContext(ctx, query, reporterID, targetID, req.ReportedUsername, req.Reason, req.Description)
	return err
}

// =====================================================================
// GUIDELINES
// =====================================================================

// AgreeToGuidelines updates the user_settings table
func (r *Repository) AgreeToGuidelines(ctx context.Context, userID string) error {
	_, err := r.DB.ExecContext(ctx, "UPDATE user_settings SET guidelines_agreed = TRUE WHERE user_id = $1", userID)
	return err
}
