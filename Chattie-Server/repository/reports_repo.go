package repository

import (
	"context"
	"fmt"
	"time"
)

// ============================================================================
// DATA MODELS
// ============================================================================

type UserAuditProfile struct {
	UserID           string
	Username         string
	Email            string
	Role             string
	Status           string
	RiskScore        int
	LifetimeSpend    float64 // Upgraded: Fetches real transaction total
	JoinedAt         time.Time
	ActionLogs       []AuditLog
	ModerationEvents []ModerationEvent
}

type AuditLog struct {
	Time   time.Time
	Action string
	IP     string
}

type ModerationEvent struct {
	Date   time.Time
	Type   string
	Reason string
}

type FinancialLedgerReport struct {
	Period       string
	GrossRevenue float64
	NetRevenue   float64
	TotalPayouts float64
	Transactions []FinancialTx
	TopEarners   []EarnerSummary
}

type FinancialTx struct {
	ID     string
	Date   time.Time
	Type   string
	Amount float64
	Status string
}

type EarnerSummary struct {
	UserID   string
	Username string
	Revenue  float64
}

type SecurityTelemetry struct {
	ActiveBans      int
	FirewallDrops   int
	HighRiskUsers   int
	RecentIncidents []SecurityIncident
}

type SecurityIncident struct {
	Timestamp time.Time
	IP        string
	Severity  string
	Detail    string
}

// ============================================================================
// REPOSITORY METHODS
// ============================================================================

// GetUserAuditProfile fetches comprehensive audit data and lifetime spend for a user
func (r *Repository) GetUserAuditProfile(userID string) (*UserAuditProfile, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	user, err := r.GetUserByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("fetch user profile: %w", err)
	}

	profile := &UserAuditProfile{
		UserID:   userID,
		Username: user.Username,
		Email:    user.Email,
		Role:     user.Role,
		Status:   user.Status,
		JoinedAt: user.CreatedAt,
	}

	// 1. Fetch Risk Score
	_ = r.DB.QueryRowContext(ctx, "SELECT COALESCE(risk_score, 0) FROM client_behavior WHERE user_id = $1", userID).Scan(&profile.RiskScore)

	// 2. Fetch Actual Lifetime Spend (As a Client)
	_ = r.DB.QueryRowContext(ctx, "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE client_id = $1 AND status = 'COMPLETED'", userID).Scan(&profile.LifetimeSpend)

	// 3. Fetch Action Logs safely
	actionRows, err := r.DB.QueryContext(ctx, `
       SELECT created_at, action_type, COALESCE(ip_address, 'Unknown') 
       FROM user_action_logs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`, userID)
	if err != nil {
		return nil, fmt.Errorf("fetch action logs: %w", err)
	}
	defer actionRows.Close()

	for actionRows.Next() {
		var log AuditLog
		if err := actionRows.Scan(&log.Time, &log.Action, &log.IP); err == nil {
			profile.ActionLogs = append(profile.ActionLogs, log)
		}
	}

	// 4. Fetch Moderation History safely
	modRows, err := r.DB.QueryContext(ctx, `
       SELECT created_at, action, COALESCE(reason, 'No reason provided') 
       FROM admin_audit_logs
       WHERE target_id = $1
       ORDER BY created_at DESC
       LIMIT 20`, userID)
	if err != nil {
		return nil, fmt.Errorf("fetch moderation events: %w", err)
	}
	defer modRows.Close()

	for modRows.Next() {
		var evt ModerationEvent
		if err := modRows.Scan(&evt.Date, &evt.Type, &evt.Reason); err == nil {
			profile.ModerationEvents = append(profile.ModerationEvents, evt)
		}
	}

	return profile, nil
}

// GetFinancialLedger fetches platform financial summary with strict timeouts
func (r *Repository) GetFinancialLedger(year int, month int) (*FinancialLedgerReport, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	period := fmt.Sprintf("%d-%02d", year, month)
	report := &FinancialLedgerReport{Period: period}

	// 1. Fetch Transactions
	txRows, err := r.DB.QueryContext(ctx, `
       SELECT id, created_at, tx_type, amount, status FROM transactions
       WHERE EXTRACT(YEAR FROM created_at) = $1 AND EXTRACT(MONTH FROM created_at) = $2
       ORDER BY created_at DESC
       LIMIT 100`, year, month)
	if err != nil {
		return nil, fmt.Errorf("fetch transactions: %w", err)
	}
	defer txRows.Close()

	for txRows.Next() {
		var tx FinancialTx
		if err := txRows.Scan(&tx.ID, &tx.Date, &tx.Type, &tx.Amount, &tx.Status); err == nil {
			report.Transactions = append(report.Transactions, tx)
			if tx.Status == "COMPLETED" {
				report.GrossRevenue += tx.Amount
			}
		}
	}

	// Calculate net revenue (Standard 30% platform cut)
	report.NetRevenue = report.GrossRevenue * 0.30
	report.TotalPayouts = report.GrossRevenue * 0.70

	// 2. Fetch Top Earners
	earnerRows, err := r.DB.QueryContext(ctx, `
       SELECT u.id, u.username, COALESCE(SUM(t.amount), 0) as revenue
       FROM users u
       INNER JOIN transactions t ON u.id = t.model_id
       WHERE u.role = 'model' 
         AND t.status = 'COMPLETED'
         AND EXTRACT(YEAR FROM t.created_at) = $1
         AND EXTRACT(MONTH FROM t.created_at) = $2
       GROUP BY u.id, u.username
       ORDER BY revenue DESC
       LIMIT 10`, year, month)
	if err != nil {
		return nil, fmt.Errorf("fetch top earners: %w", err)
	}
	defer earnerRows.Close()

	for earnerRows.Next() {
		var earner EarnerSummary
		if err := earnerRows.Scan(&earner.UserID, &earner.Username, &earner.Revenue); err == nil {
			report.TopEarners = append(report.TopEarners, earner)
		}
	}

	return report, nil
}

// GetSecurityTelemetry fetches security metrics aggregating real system events
func (r *Repository) GetSecurityTelemetry() (*SecurityTelemetry, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	telem := &SecurityTelemetry{}

	// 1. Count active bans
	_ = r.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM banned_ips").Scan(&telem.ActiveBans)

	// 2. Count ACTUAL firewall drops/blocks (Assuming we log blocks in user_action_logs)
	_ = r.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM user_action_logs WHERE action_type IN ('LOGIN_BLOCKED', 'IP_BANNED', 'RATE_LIMITED') AND created_at > NOW() - INTERVAL '24 hours'").Scan(&telem.FirewallDrops)

	// 3. Count high-risk users
	_ = r.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM client_behavior WHERE risk_score >= 70").Scan(&telem.HighRiskUsers)

	// 4. Fetch recent incidents dynamically assigning severity based on action
	incidentRows, err := r.DB.QueryContext(ctx, `
       SELECT 
           created_at, 
           COALESCE(ip_address, 'Unknown'), 
           CASE 
               WHEN action_type IN ('ACCOUNT_BANNED', 'PAYMENT_FRAUD') THEN 'CRITICAL'
               WHEN action_type IN ('LOGIN_FAILED', 'RATE_LIMITED') THEN 'HIGH'
               ELSE 'MEDIUM'
           END as severity,
           action_type as detail
       FROM user_action_logs
       WHERE action_type IN ('ACCOUNT_BANNED', 'PAYMENT_FRAUD', 'LOGIN_FAILED', 'RATE_LIMITED', 'REPORT_FILED')
         AND created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC
       LIMIT 20`)
	if err != nil {
		return nil, fmt.Errorf("fetch recent incidents: %w", err)
	}
	defer incidentRows.Close()

	for incidentRows.Next() {
		var incident SecurityIncident
		if err := incidentRows.Scan(&incident.Timestamp, &incident.IP, &incident.Severity, &incident.Detail); err == nil {
			telem.RecentIncidents = append(telem.RecentIncidents, incident)
		}
	}

	return telem, nil
}
