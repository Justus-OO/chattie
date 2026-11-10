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

	go func() {
		defer dailyTicker.Stop()
		defer hourlyTicker.Stop()

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
			}
		}
	}()
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
	w.processExpiredSubscriptions(ctx)
	w.cleanupGhostRooms(ctx)
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
