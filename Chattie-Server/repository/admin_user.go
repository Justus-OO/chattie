package repository

import (
	"chattie-backend/models"
	"context"
)

// GetAdminClientDirectory fetches all standard users with their nested metadata
func (r *Repository) GetAdminClientDirectory(ctx context.Context) ([]models.AdminUserDetail, error) {
	query := `
		SELECT 
			u.id::text, u.username, u.email, UPPER(u.status), 
			TO_CHAR(u.created_at, 'YYYY-MM-DD') as join_date,
			COALESCE(TO_CHAR(u.last_active, 'Mon DD, YYYY HH12:MI AM'), 'Never') as last_active,
			COALESCE(UPPER(st.name), 'STANDARD') as tier,
			COALESCE(SUM(t.amount), 0.00) as total_spend,
			COALESCE(cb.payment_method, 'None'), COALESCE(cb.is_recurring, false), COALESCE(TO_CHAR(cb.next_billing_date, 'YYYY-MM-DD'), 'N/A'),
			COALESCE(beh.risk_score, 0), COALESCE(beh.flags_count, 0),
			(SELECT COUNT(id) FROM messages WHERE sender_id = u.id) as messages_sent,
			COALESCE(sec.last_ip, 'Unknown'), COALESCE(sec.location, 'Unknown'), COALESCE(sec.device_type, 'Unknown')
		FROM users u
		LEFT JOIN user_subscriptions us ON u.id = us.user_id AND us.status = 'active'
		LEFT JOIN subscription_tiers st ON us.tier_id = st.id
		LEFT JOIN transactions t ON u.id = t.client_id AND t.status = 'COMPLETED'
		LEFT JOIN client_billing cb ON u.id = cb.user_id
		LEFT JOIN client_behavior beh ON u.id = beh.user_id
		LEFT JOIN client_security sec ON u.id = sec.user_id
		WHERE u.role = 'client'
		GROUP BY u.id, st.name, cb.payment_method, cb.is_recurring, cb.next_billing_date, beh.risk_score, beh.flags_count, sec.last_ip, sec.location, sec.device_type
		ORDER BY total_spend DESC, u.created_at DESC
	`

	rows, err := r.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var clients []models.AdminUserDetail
	for rows.Next() {
		var c models.AdminUserDetail
		if err := rows.Scan(
			&c.ID, &c.Username, &c.Email, &c.Status, &c.JoinDate, &c.LastActive, &c.Tier, &c.TotalSpend,
			&c.Billing.PaymentMethod, &c.Billing.Recurring, &c.Billing.NextBilling,
			&c.Behavior.RiskScore, &c.Behavior.Flags, &c.Behavior.MessagesSent,
			&c.Security.LastIp, &c.Security.Location, &c.Security.Device,
		); err != nil {
			continue
		}

		// Ensure UI matches exact casing
		if c.Tier == "FREE" {
			c.Tier = "STANDARD"
		}
		clients = append(clients, c)
	}
	return clients, nil
}

// GetAdminClientTelemetry gets the top bar statistics
func (r *Repository) GetAdminClientTelemetry(ctx context.Context) (models.AdminClientTelemetry, error) {
	var tel models.AdminClientTelemetry

	query := `
		SELECT 
			COUNT(u.id) as total_users,
			COUNT(CASE WHEN st.name = 'vip' THEN 1 END) as vip_count,
			COUNT(CASE WHEN st.name = 'premium' THEN 1 END) as premium_count,
			COUNT(CASE WHEN u.last_active >= NOW() - INTERVAL '24 hours' THEN 1 END) as daily_active
		FROM users u
		LEFT JOIN user_subscriptions us ON u.id = us.user_id AND us.status = 'active'
		LEFT JOIN subscription_tiers st ON us.tier_id = st.id
		WHERE u.role = 'client'
	`
	err := r.DB.QueryRowContext(ctx, query).Scan(&tel.TotalUsers, &tel.VipCount, &tel.PremiumCount, &tel.DailyActive)
	return tel, err
}

// ToggleClientBan switches a user between BANNED and ACTIVE
func (r *Repository) ToggleClientBan(ctx context.Context, userID string) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE users 
		SET status = CASE WHEN status = 'banned' THEN 'active' ELSE 'banned' END,
		    updated_at = NOW()
		WHERE id = $1
	`, userID)
	return err
}

// RevokeClientTier downgrades a user to the free/standard tier
func (r *Repository) RevokeClientTier(ctx context.Context, userID string) error {
	// Find the 'free' tier ID
	var freeTierID int
	r.DB.QueryRowContext(ctx, "SELECT id FROM subscription_tiers WHERE name = 'free' LIMIT 1").Scan(&freeTierID)

	_, err := r.DB.ExecContext(ctx, `
		UPDATE user_subscriptions 
		SET tier_id = $1, updated_at = NOW(), status = 'cancelled'
		WHERE user_id = $2
	`, freeTierID, userID)
	return err
}
