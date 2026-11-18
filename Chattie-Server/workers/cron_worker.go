package workers

import (
	"context"
	"log"
	"time"

	"chattie-backend/repository"
	"chattie-backend/services"
)

type CronWorker struct {
	Repo     *repository.Repository
	NotifSvc *services.NotificationService
}

func NewCronWorker(repo *repository.Repository, notifSvc *services.NotificationService) *CronWorker {
	return &CronWorker{
		Repo:     repo,
		NotifSvc: notifSvc,
	}
}

// Start boots up the background timers with context for graceful shutdown
func (w *CronWorker) Start(ctx context.Context) {
	log.Println("[CRON ENGINE] Booting up background tasks...")

	// 1. Define Schedules
	dailyTicker := time.NewTicker(24 * time.Hour)
	hourlyTicker := time.NewTicker(1 * time.Hour)
	verificationCleanupTicker := time.NewTicker(10 * time.Minute)

	go func() {
		defer dailyTicker.Stop()
		defer hourlyTicker.Stop()
		defer verificationCleanupTicker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("[CRON ENGINE] Shutting down gracefully...")
				return

			// Pass the context down into the batches
			case <-dailyTicker.C:
				w.runDailyJobs(ctx)

			case <-hourlyTicker.C:
				w.runHourlyJobs(ctx)

			case <-verificationCleanupTicker.C:
				w.cleanupUnverifiedAccounts(ctx)
			}
		}
	}()
	go w.enforceReportThreshold(ctx)
	go w.cleanupUnverifiedAccounts(ctx)
}

// ============================================================================
// JOB BATCHES
// ============================================================================

func (w *CronWorker) runDailyJobs(ctx context.Context) {
	log.Println("[CRON] Executing Daily Batch...")
	w.checkInactiveUsers(ctx)
	w.cleanupDailyUsageLogs(ctx)
}

func (w *CronWorker) runHourlyJobs(ctx context.Context) {
	log.Println("[CRON] Executing Hourly Batch...")
	w.enforceReportThreshold(ctx)
	w.processExpiredSubscriptions(ctx)
	w.cleanupGhostRooms(ctx)
}

func (w *CronWorker) enforceReportThreshold(ctx context.Context) {
	query := `
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
			WHERE target.role = 'client'
			  AND target.status <> 'banned'
			  AND report.reporter_id <> target.id
			  AND report.created_at > COALESCE((
				  SELECT MAX(review.reviewed_at)
				  FROM account_review_requests review
				  WHERE review.user_id = target.id
				    AND review.status = 'reinstated'
			  ), '-infinity'::timestamptz)
			GROUP BY target.id
			HAVING COUNT(DISTINCT report.reporter_id) >= 10
		),
		newly_restricted AS (
			UPDATE users target
			SET status = 'banned',
			    token_version = token_version + 1,
			    updated_at = CURRENT_TIMESTAMP
			FROM eligible
			WHERE target.id = eligible.id
			  AND target.status <> 'banned'
			RETURNING target.id, eligible.report_count
		),
		audit AS (
			INSERT INTO admin_audit_logs (admin_id, admin_username, action, target_id, reason)
			SELECT NULL, 'SYSTEM', 'AUTO_REPORT_RESTRICTION', id,
			       'Restricted after ' || report_count || ' distinct client reports in 30 days'
			FROM newly_restricted
			RETURNING target_id
		)
		INSERT INTO notifications (user_id, event_type, title, message, icon, payload)
		SELECT newly_restricted.id, 'ACCOUNT_RESTRICTED', 'Account restricted',
		       'Your account was restricted after receiving multiple user reports. You can request a review.',
		       'shield-alert',
		       jsonb_build_object('reason', 'report_threshold', 'reportCount', newly_restricted.report_count)
		FROM newly_restricted
		RETURNING user_id::text
	`
	rows, err := w.Repo.DB.QueryContext(ctx, query)
	if err != nil {
		log.Printf("[CRON ERROR] Failed to enforce report threshold: %v", err)
		return
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			log.Printf("[CRON ERROR] Failed to read restricted account: %v", err)
			continue
		}
		count++
		w.NotifSvc.DisconnectUser(userID)
		user, err := w.Repo.GetUserByID(ctx, userID)
		if err != nil {
			log.Printf("[CRON WARN] Failed to load restricted account %s: %v", userID, err)
			continue
		}
		if user.Email != "" {
			if err := w.NotifSvc.SendTemplatedEmail(ctx, user.Email, "account_banned", map[string]interface{}{
				"Username": user.Username,
			}); err != nil {
				log.Printf("[CRON WARN] Failed to email restricted account %s: %v", userID, err)
			}
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[CRON ERROR] Failed while processing restricted accounts: %v", err)
	}
	if count > 0 {
		log.Printf("[CRON] Automatically restricted %d accounts after reaching the report threshold.", count)
	}
}

// ============================================================================
// SPECIFIC CRON TASKS
// ============================================================================

// 1. Nudge users who haven't logged in for exactly 7 days
func (w *CronWorker) checkInactiveUsers(ctx context.Context) {
	query := `
       SELECT id FROM users 
       WHERE status = 'active' 
       AND last_active < NOW() - INTERVAL '7 days'
       AND last_active > NOW() - INTERVAL '8 days'
    `

	rows, err := w.Repo.DB.QueryContext(ctx, query)
	if err != nil {
		log.Printf("[CRON ERROR] Failed to query inactive users: %v", err)
		return
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err == nil {
			if err := w.NotifSvc.ProcessInactivityAlert(ctx, userID); err != nil {
				log.Printf("[CRON WARN] Failed to send inactivity alert to %s: %v", userID, err)
			} else {
				count++
			}
		}
	}
	if count > 0 {
		log.Printf("[CRON] Sent 'We Miss You' alerts to %d inactive users.", count)
	}
}

// 2. Automatically downgrade expired premium subscriptions
func (w *CronWorker) processExpiredSubscriptions(ctx context.Context) {
	query := `
       WITH expired_users AS (
          UPDATE user_subscriptions us
          SET tier_id = (SELECT id FROM subscription_tiers WHERE name = 'free' LIMIT 1),
              status = 'expired',
              updated_at = CURRENT_TIMESTAMP
          WHERE us.expires_at < CURRENT_TIMESTAMP AND us.status = 'active'
          RETURNING us.user_id
       )
       SELECT user_id FROM expired_users;
    `

	rows, err := w.Repo.DB.QueryContext(ctx, query)
	if err != nil {
		log.Printf("[CRON ERROR] Failed to process expired subscriptions: %v", err)
		return
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err == nil {
			count++
		}
	}
	if count > 0 {
		log.Printf("[CRON] Automatically downgraded %d expired subscriptions to free tier.", count)
	}
}

// 3. Keep the DB lean by deleting old swipe trackers
func (w *CronWorker) cleanupDailyUsageLogs(ctx context.Context) {
	query := `DELETE FROM user_daily_usage WHERE usage_date < CURRENT_DATE - INTERVAL '7 days'`

	res, err := w.Repo.DB.ExecContext(ctx, query)
	if err != nil {
		log.Printf("[CRON ERROR] Failed to clean up daily usage logs: %v", err)
		return
	}

	deleted, _ := res.RowsAffected()
	if deleted > 0 {
		log.Printf("[CRON] DB Hygiene: Cleared %d old daily usage records.", deleted)
	}
}

// 4. Suspend abandoned user-created rooms
func (w *CronWorker) cleanupGhostRooms(ctx context.Context) {
	query := `
       UPDATE rooms 
       SET status = 'SUSPENDED' 
       WHERE active_count = 0 
       AND created_at < NOW() - INTERVAL '48 hours' 
       AND status = 'ACTIVE'
    `

	res, err := w.Repo.DB.ExecContext(ctx, query)
	if err != nil {
		log.Printf("[CRON ERROR] Failed to clean up ghost rooms: %v", err)
		return
	}

	suspended, _ := res.RowsAffected()
	if suspended > 0 {
		log.Printf("[CRON] Suspended %d abandoned ghost rooms.", suspended)
	}
}

func (w *CronWorker) cleanupUnverifiedAccounts(ctx context.Context) {
	result, err := w.Repo.DB.ExecContext(ctx, `
		DELETE FROM users AS u
		WHERE u.provider = 'local'
		  AND u.status = 'onboarding'
		  AND u.email_verified_at IS NULL
		  AND COALESCE(
			  (SELECT MAX(otp.expires_at) FROM user_otps otp WHERE otp.user_id = u.id),
			  u.created_at + INTERVAL '10 minutes'
		  ) <= CURRENT_TIMESTAMP
	`)
	if err != nil {
		log.Printf("[CRON ERROR] Failed to remove expired unverified accounts: %v", err)
		return
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		log.Printf("[CRON ERROR] Failed to count removed unverified accounts: %v", err)
		return
	}
	if deleted > 0 {
		log.Printf("[CRON] Removed %d local accounts that passed OTP expiry without verification.", deleted)
	}
}
