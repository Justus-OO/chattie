package repository

import (
	"chattie-backend/models"
	"context"
	"database/sql"
	"errors"
)

type AdminRepository struct {
	DB *sql.DB
}

var ErrModerationTargetMismatch = errors.New("moderation target does not match the report")

func NewAdminRepository(db *sql.DB) *AdminRepository {
	return &AdminRepository{DB: db}
}

// GetPendingQueue fetches unresolved reports and flags, including the exact evidence
func (r *AdminRepository) GetPendingQueue(ctx context.Context) ([]models.ModerationItem, error) {
	query := `
       WITH report_counts AS (
          SELECT reports.reported_id,
                 COUNT(DISTINCT reports.reporter_id) FILTER (WHERE reporters.role = 'client') AS report_count
          FROM reports
          LEFT JOIN users reporters ON reporters.id = reports.reporter_id
          WHERE reports.status = 'pending'
            AND reports.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
          GROUP BY reports.reported_id
       )
       SELECT
          r.id::text,
          COALESCE(tu.username, r.reported_username, 'Deleted Account'),
          COALESCE(r.reported_id::text, ''),
          COALESCE(u.username, 'System Flag'),
          COALESCE(tu.username, r.reported_username, 'Deleted Account'),
          r.reason,
          CASE 
             WHEN cb.risk_score > 80 OR COALESCE(rc.report_count, 0) >= 10 THEN 'CRITICAL'
             WHEN cb.risk_score > 50 OR COALESCE(rc.report_count, 0) >= 5 THEN 'HIGH'
             ELSE 'MEDIUM'
          END as severity,
          TO_CHAR(r.created_at, 'HH24:MI:SS'),
          r.status,
          COALESCE(r.description, 'Flagged by system or user.'),
          COALESCE(r.ai_triage_summary, ''),
          COALESCE(cb.risk_score, 0),
          COALESCE(cs.last_ip, 'Unknown'),
          COALESCE(cs.location, 'Unknown'),
          'Reports: ' || COALESCE(rc.report_count, 0) || ' | Flags: ' || COALESCE(cb.flags_count, 0) as history,
          COALESCE(rc.report_count, 0)
       FROM reports r
       LEFT JOIN users u ON r.reporter_id = u.id
       LEFT JOIN users tu ON r.reported_id = tu.id
       LEFT JOIN report_counts rc ON rc.reported_id = r.reported_id
       LEFT JOIN client_behavior cb ON cb.user_id = r.reported_id
       LEFT JOIN client_security cs ON cs.user_id = r.reported_id
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
			&item.ID, &item.User, &item.UserID, &item.Reporter, &item.TargetProfile, &item.Type,
			&item.Severity, &item.Time, &item.Status, &rawDescription, &item.AISummary,
			&item.RiskScore, &item.IP, &item.Location, &item.History, &item.ReportCount,
		); err != nil {
			return nil, err
		}

		item.Evidence = []models.Evidence{
			{
				Sender: item.Reporter,
				Text:   rawDescription,
				Time:   item.Time,
			},
		}
		item.Content = rawDescription

		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

// ResolveIncident applies punitive actions and logs the audit trail
func (r *AdminRepository) ResolveIncident(ctx context.Context, adminID string, req models.ResolveIncidentRequest) error {
	if req.IncidentID == "" {
		return errors.New("incident is required")
	}
	switch req.ActionType {
	case "DISMISS", "FORMAL WARNING", "SHADOWBAN", "DEVICE/IP BAN":
	default:
		return errors.New("unsupported moderation action")
	}
	if req.ActionType != "DISMISS" && req.TargetID == "" {
		return errors.New("target is required for punitive actions")
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var actualTargetID sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT reported_id::text
		FROM reports
		WHERE id = $1 AND status = 'pending'
		FOR UPDATE
	`, req.IncidentID).Scan(&actualTargetID)
	if errors.Is(err, sql.ErrNoRows) {
		return sql.ErrNoRows
	}
	if err != nil {
		return err
	}
	if actualTargetID.Valid && actualTargetID.String != req.TargetID {
		return ErrModerationTargetMismatch
	}
	if !actualTargetID.Valid && (req.TargetID != "" || req.ActionType != "DISMISS") {
		return ErrModerationTargetMismatch
	}

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

			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if err == nil && userIP != "" {
				if _, err := tx.ExecContext(ctx, `
                INSERT INTO banned_ips (ip_address, reason) 
                VALUES ($1, $2) ON CONFLICT DO NOTHING
             `, userIP, req.Note); err != nil {
					return err
				}
			}

		} else if req.ActionType == "SHADOWBAN" {
			userStatus = "suspended"
		} else if req.ActionType == "FORMAL WARNING" {
			userStatus = "flagged"
		}

		_, err = tx.ExecContext(ctx, `
			UPDATE users
			SET status = $1,
			    token_version = CASE WHEN $1 = 'banned' THEN token_version + 1 ELSE token_version END,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $2
		`, userStatus, req.TargetID)
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
		if err := tx.QueryRowContext(ctx, "SELECT username FROM users WHERE id = $1", adminID).Scan(&adminUsername); err != nil {
			return err
		}
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

	rules := make([]models.FirewallRule, 0)
	for rows.Next() {
		var rule models.FirewallRule
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.Active, &rule.Desc); err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	return rules, nil
}

func (r *AdminRepository) ToggleFirewallRule(ctx context.Context, adminID, ruleID string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var name string
	var active bool
	err = tx.QueryRowContext(ctx, `
		UPDATE firewall_rules
		SET is_active = NOT is_active, updated_at = NOW()
		WHERE id = $1
		RETURNING name, is_active
	`, ruleID).Scan(&name, &active)
	if errors.Is(err, sql.ErrNoRows) {
		return sql.ErrNoRows
	}
	if err != nil {
		return err
	}
	action := "FIREWALL_RULE_DISABLED"
	if active {
		action = "FIREWALL_RULE_ENABLED"
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO admin_audit_logs (admin_id, action, reason)
		VALUES ($1, $2, $3)
	`, adminID, action, name); err != nil {
		return err
	}
	return tx.Commit()
}
