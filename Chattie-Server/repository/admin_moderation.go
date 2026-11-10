package repository

import (
	"chattie-backend/models"
	"context"
	"database/sql"
)

type AdminRepository struct {
	DB *sql.DB
}

func NewAdminRepository(db *sql.DB) *AdminRepository {
	return &AdminRepository{DB: db}
}

// GetPendingQueue fetches unresolved reports and flags, including the exact evidence
func (r *AdminRepository) GetPendingQueue(ctx context.Context) ([]models.ModerationItem, error) {
	query := `
       SELECT 
          r.id::text,
          COALESCE(u.username, 'Unknown User'),
          r.reporter_id::text,
          COALESCE(tu.username, 'System Flag'),
          r.reason,
          CASE 
             WHEN cb.risk_score > 80 THEN 'CRITICAL'
             WHEN cb.risk_score > 50 THEN 'HIGH'
             ELSE 'MEDIUM'
          END as severity,
          TO_CHAR(r.created_at, 'HH24:MI:SS'),
          r.status,
          COALESCE(r.description, 'Flagged by system or user.'),
          COALESCE(cb.risk_score, 0),
          COALESCE(cs.last_ip, 'Unknown'),
          COALESCE(cs.location, 'Unknown'),
          'Flags: ' || COALESCE(cb.flags_count, 0) as history
       FROM reports r
       LEFT JOIN users u ON r.reporter_id = u.id
       LEFT JOIN users tu ON r.reported_id = tu.id
       LEFT JOIN client_behavior cb ON r.reporter_id = cb.user_id
       LEFT JOIN client_security cs ON r.reporter_id = cs.user_id
       WHERE r.status = 'pending'
       ORDER BY cb.risk_score DESC, r.created_at DESC
       LIMIT 50;
    `
	rows, err := r.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.ModerationItem
	for rows.Next() {
		var item models.ModerationItem
		var rawDescription string

		if err := rows.Scan(
			&item.ID, &item.User, &item.UserID, &item.TargetProfile, &item.Type,
			&item.Severity, &item.Time, &item.Status, &rawDescription,
			&item.RiskScore, &item.IP, &item.Location, &item.History,
		); err != nil {
			return nil, err
		}

		// Inject the stored description as direct message evidence
		item.Evidence = []models.Evidence{
			{
				Sender: item.User,
				Text:   rawDescription,
				Time:   item.Time,
			},
		} // <-- Added the missing closing brace here

		items = append(items, item) // <-- Fixed typo from 'item =' to 'items ='
	}
	return items, nil
}

// ResolveIncident applies punitive actions and logs the audit trail
func (r *AdminRepository) ResolveIncident(ctx context.Context, adminID string, req models.ResolveIncidentRequest) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	status := "resolved"
	if req.ActionType == "DISMISS" {
		status = "dismissed"
	}
	_, err = tx.ExecContext(ctx, "UPDATE reports SET status = $1 WHERE id = $2", status, req.IncidentID)
	if err != nil {
		return err
	}

	if req.ActionType != "DISMISS" {
		userStatus := "active"

		if req.ActionType == "DEVICE/IP BAN" {
			userStatus = "banned"

			// Extract the user's latest IP address from the action logs
			var userIP string
			err := tx.QueryRowContext(ctx, `
             SELECT ip_address FROM user_action_logs 
             WHERE user_id = $1 AND ip_address IS NOT NULL 
             ORDER BY created_at DESC LIMIT 1
          `, req.TargetID).Scan(&userIP)

			// Insert into the global ban list so the middleware blocks them
			if err == nil && userIP != "" {
				_, _ = tx.ExecContext(ctx, `
                INSERT INTO banned_ips (ip_address, reason) 
                VALUES ($1, $2) ON CONFLICT DO NOTHING
             `, userIP, req.Note)
			}

		} else if req.ActionType == "SHADOWBAN" {
			userStatus = "suspended"
		} else if req.ActionType == "FORMAL WARNING" {
			userStatus = "flagged"
		}

		_, err = tx.ExecContext(ctx, "UPDATE users SET status = $1 WHERE id = $2", userStatus, req.TargetID)
		if err != nil {
			return err
		}

		_, err = tx.ExecContext(ctx, "UPDATE client_behavior SET flags_count = flags_count + 1 WHERE user_id = $1", req.TargetID)
		if err != nil {
			return err
		}
	}

	adminUsername := "SYSTEM"
	if adminID != "" {
		tx.QueryRowContext(ctx, "SELECT username FROM users WHERE id = $1", adminID).Scan(&adminUsername)
	}

	_, err = tx.ExecContext(ctx, `
       INSERT INTO admin_audit_logs (admin_id, admin_username, action, target_id, reason)
       VALUES (NULLIF($1, '')::uuid, $2, $3, NULLIF($4, '')::uuid, $5)
    `, adminID, adminUsername, req.ActionType, req.TargetID, req.Note)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// NEW: Fetches the chronological telemetry for a specific user
func (r *AdminRepository) GetUserTelemetry(ctx context.Context, targetUserID string) ([]models.ActionLog, error) {
	query := `
       SELECT action_type, COALESCE(target_id::text, ''), COALESCE(metadata::text, ''), COALESCE(ip_address, '')
       FROM user_action_logs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100
    `
	rows, err := r.DB.QueryContext(ctx, query, targetUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []models.ActionLog
	for rows.Next() {
		var l models.ActionLog
		if err := rows.Scan(&l.ActionType, &l.TargetID, &l.Metadata, &l.IP); err != nil {
			continue
		}
		logs = append(logs, l)
	}
	return logs, nil
}

// GetAuditLogs retrieves the admin action history
func (r *AdminRepository) GetAuditLogs(ctx context.Context) ([]models.AuditLog, error) {
	query := `
       SELECT 
          id::text, 
          COALESCE(admin_username, 'SYSTEM'), 
          action, 
          COALESCE((SELECT username FROM users WHERE id = target_id), 'Unknown'), 
          reason,
          TO_CHAR(created_at, 'HH24:MI:SS') as time,
          TO_CHAR(created_at, 'YYYY-MM-DD') as date
       FROM admin_audit_logs 
       ORDER BY created_at DESC LIMIT 100
    `
	rows, err := r.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []models.AuditLog
	for rows.Next() {
		var l models.AuditLog
		if err := rows.Scan(&l.ID, &l.Admin, &l.Action, &l.Target, &l.Reason, &l.Time, &l.Date); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, nil
}

// GetFirewallRules and ToggleFirewallRule
func (r *AdminRepository) GetFirewallRules(ctx context.Context) ([]models.FirewallRule, error) {
	rows, err := r.DB.QueryContext(ctx, "SELECT id, name, is_active, description FROM firewall_rules ORDER BY id ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []models.FirewallRule
	for rows.Next() {
		var rule models.FirewallRule
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.Active, &rule.Desc); err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	return rules, nil
}

func (r *AdminRepository) ToggleFirewallRule(ctx context.Context, ruleID string) error {
	_, err := r.DB.ExecContext(ctx, "UPDATE firewall_rules SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1", ruleID)
	return err
}
