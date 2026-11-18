package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"chattie-backend/models"
)

// =====================================================================
// CREATOR METRICS & DASHBOARD
// =====================================================================

func (r *Repository) GetCreatorStats(ctx context.Context, modelID string) (*models.CreatorStats, error) {
	var stats models.CreatorStats

	// 1. Ensure a stats row exists for this creator
	_, err := r.DB.ExecContext(ctx, `
       INSERT INTO creator_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING
    `, modelID)
	if err != nil {
		return nil, err
	}

	// 2. Fetch basic stats
	query := `
       SELECT current_balance, total_earned, is_online 
       FROM creator_stats WHERE user_id = $1
    `
	err = r.DB.QueryRowContext(ctx, query, modelID).Scan(&stats.Balance, &stats.TotalEarned, &stats.IsOnline)
	if err != nil {
		return nil, err
	}

	// 3. Fetch 24H Earnings
	err = r.DB.QueryRowContext(ctx, `
       SELECT COALESCE(SUM(amount), 0) FROM transactions 
       WHERE model_id = $1 AND amount > 0 AND tx_type <> 'PAYOUT_REVERSAL'
         AND created_at >= NOW() - INTERVAL '24 hours'
    `, modelID).Scan(&stats.Earnings24H)
	if err != nil {
		return nil, err
	}

	// 4. Fetch Pending Requests count for this creator's assigned profiles
	err = r.DB.QueryRowContext(ctx, `
       SELECT COUNT(*) FROM chat_requests cr
       JOIN managed_profiles mp ON cr.managed_profile_id = mp.id
       WHERE mp.manager_id = $1 AND cr.status = 'PENDING'
    `, modelID).Scan(&stats.PendingReqs)
	if err != nil {
		return nil, err
	}

	if err := r.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM managed_profiles WHERE manager_id = $1
	`, modelID).Scan(&stats.ManagedProfiles); err != nil {
		return nil, err
	}

	if err := r.DB.QueryRowContext(ctx, `
		WITH creator_chat_users AS (
			SELECT $1::uuid AS user_id
			UNION
			SELECT mp.id
			FROM managed_profiles mp
			JOIN users profile_user ON profile_user.id = mp.id
			WHERE mp.manager_id = $1
		)
		SELECT COUNT(DISTINCT CASE
			WHEN m.sender_id = creator_chat_users.user_id THEN m.recipient_id
			ELSE m.sender_id
		END)
		FROM messages m
		JOIN creator_chat_users
		  ON m.sender_id = creator_chat_users.user_id
		  OR m.recipient_id = creator_chat_users.user_id
		WHERE m.room_id IS NULL
		  AND m.recipient_id IS NOT NULL
		  AND m.created_at >= NOW() - INTERVAL '30 minutes'
	`, modelID).Scan(&stats.ActiveChats); err != nil {
		return nil, err
	}

	rows, err := r.DB.QueryContext(ctx, `
		SELECT TO_CHAR(days.day_start, 'Dy'), COALESCE(SUM(t.amount), 0)
		FROM generate_series(
			CURRENT_DATE - INTERVAL '6 days',
			CURRENT_DATE,
			INTERVAL '1 day'
		) AS days(day_start)
		LEFT JOIN transactions t
		  ON t.model_id = $1
		 AND t.amount > 0
		  AND t.tx_type <> 'PAYOUT_REVERSAL'
		 AND t.created_at >= days.day_start
		 AND t.created_at < days.day_start + INTERVAL '1 day'
		GROUP BY days.day_start
		ORDER BY days.day_start
	`, modelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stats.WeeklyEarnings = make([]models.CreatorEarningDay, 0, 7)
	for rows.Next() {
		var day models.CreatorEarningDay
		if err := rows.Scan(&day.Day, &day.Amount); err != nil {
			return nil, err
		}
		stats.WeeklyEarnings = append(stats.WeeklyEarnings, day)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &stats, nil
}

// =====================================================================
// FINANCIAL LEDGER & PAYOUTS
// =====================================================================

func (r *Repository) GetTransactions(ctx context.Context, modelID string) ([]models.Transaction, error) {
	query := `
       SELECT 
          t.id::text, t.tx_type, t.amount, t.status, t.created_at,
          COALESCE(p.display_name, 'SYSTEM_BANK')
       FROM transactions t
       LEFT JOIN users u ON t.client_id = u.id
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE t.model_id = $1
       ORDER BY t.created_at DESC LIMIT 100
    `

	rows, err := r.DB.QueryContext(ctx, query, modelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	txs := make([]models.Transaction, 0)
	for rows.Next() {
		var t models.Transaction
		var createdAt time.Time
		if err := rows.Scan(&t.ID, &t.Type, &t.Amount, &t.Status, &createdAt, &t.User); err != nil {
			return nil, err
		}
		t.Date = createdAt.Format("2006-01-02")
		t.Time = createdAt.Format("15:04")
		txs = append(txs, t)
	}
	return txs, nil
}

func (r *Repository) RequestPayout(ctx context.Context, modelID string, amount float64) error {
	if amount <= 0 {
		return errors.New("invalid payout amount")
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var currentBalance float64
	err = tx.QueryRowContext(ctx, `SELECT current_balance FROM creator_stats WHERE user_id = $1 FOR UPDATE`, modelID).Scan(&currentBalance)
	if err != nil {
		return err
	}

	if currentBalance < amount {
		return errors.New("insufficient funds")
	}

	_, err = tx.ExecContext(ctx, `
       UPDATE creator_stats SET current_balance = current_balance - $1, updated_at = NOW() WHERE user_id = $2
    `, amount, modelID)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `
       INSERT INTO transactions (model_id, tx_type, amount, status) 
       VALUES ($1, 'PAYOUT_WIRE', $2, 'PENDING')
    `, modelID, -amount)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// =====================================================================
// CREATOR PORTFOLIO & STATUS MANAGEMENT
// =====================================================================

// GetAssignedProfiles fetches the specific personas assigned to this creator for chatting
func (r *Repository) GetAssignedProfiles(ctx context.Context, creatorID string) ([]models.ManagedProfile, error) {
	query := `
       SELECT 
          mp.id::text,
          CASE WHEN EXISTS (SELECT 1 FROM users profile_user WHERE profile_user.id = mp.id)
               THEN mp.id::text ELSE mp.manager_id::text END,
          COALESCE(NULLIF(mp.name, ''), NULLIF(p.display_name, ''), ''),
          COALESCE(NULLIF(mp.avatar_url, ''), NULLIF(p.avatar_url, ''), ''),
          mp.status,
          COALESCE(NULLIF(mp.bio, ''), NULLIF(p.bio, ''), ''),
          (SELECT COUNT(*)::int FROM chat_requests cr WHERE cr.managed_profile_id = mp.id AND cr.status = 'PENDING') AS pending_count
       FROM managed_profiles mp
       LEFT JOIN user_profiles p ON p.user_id = mp.id
       WHERE mp.manager_id = $1
       ORDER BY mp.created_at ASC
    `

	rows, err := r.DB.QueryContext(ctx, query, creatorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	profiles := make([]models.ManagedProfile, 0)
	for rows.Next() {
		var p models.ManagedProfile
		if err := rows.Scan(&p.ID, &p.ChatUserID, &p.Name, &p.Avatar, &p.Status, &p.Bio, &p.Pending); err != nil {
			return nil, err
		}
		profiles = append(profiles, p)
	}
	return profiles, nil
}

// ResolveManagedProfileChatIdentity maps an assigned profile to the user account
// used as its direct-message identity. Older creator records can have a managed
// profile without a matching user row; those conversations belong to the manager.
func (r *Repository) ResolveManagedProfileChatIdentity(ctx context.Context, profileID, creatorID string) (string, error) {
	var chatUserID string
	err := r.DB.QueryRowContext(ctx, `
		SELECT COALESCE(profile_user.id::text, mp.manager_id::text)
		FROM managed_profiles mp
		LEFT JOIN users profile_user ON profile_user.id = mp.id
		WHERE mp.id = $1 AND mp.manager_id = $2
	`, profileID, creatorID).Scan(&chatUserID)
	if err != nil {
		return "", err
	}
	if chatUserID == "" {
		return "", sql.ErrNoRows
	}
	return chatUserID, nil
}

// UpdateProfileStatus allows the creator to toggle their persona's online/offline status
func (r *Repository) UpdateProfileStatus(ctx context.Context, profileID string, creatorID string, status string) error {
	result, err := r.DB.ExecContext(ctx, `
       UPDATE managed_profiles SET status = $1, updated_at = NOW() 
       WHERE id = $2 AND manager_id = $3
    `, status, profileID, creatorID)
	if err != nil {
		return err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if updated == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// =====================================================================
// CHAT QUEUE (Handling Incoming Client Chats on Assigned Personas)
// =====================================================================

func (r *Repository) GetChatQueue(ctx context.Context, profileID string) ([]models.ChatQueueItem, error) {
	query := `
       SELECT 
          cr.id::text, u.id::text, COALESCE(p.display_name, u.username), COALESCE(p.avatar_url, ''),
          cr.tip_amount, cr.status, cr.created_at,
          (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE client_id = u.id AND amount > 0) AS lifetime_spend
       FROM chat_requests cr
       JOIN users u ON cr.client_id = u.id
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE cr.managed_profile_id = $1 AND cr.status IN ('PENDING', 'ACTIVE')
       ORDER BY cr.created_at DESC
    `

	rows, err := r.DB.QueryContext(ctx, query, profileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	queue := make([]models.ChatQueueItem, 0)
	for rows.Next() {
		var q models.ChatQueueItem
		if err := rows.Scan(&q.ID, &q.ClientID, &q.ClientName, &q.ClientAvatar, &q.TipAmount, &q.Status, &q.TimeAdded, &q.LifetimeSpend); err != nil {
			return nil, err
		}
		q.IsFlagged = (q.ClientAvatar == "" && q.LifetimeSpend == 0)
		queue = append(queue, q)
	}
	return queue, nil
}

func (r *Repository) ProcessQueueAction(ctx context.Context, reqID string, profileID string, action string) error {
	newStatus := "REJECTED"
	if action == "accept" {
		newStatus = "ACTIVE"
	}
	_, err := r.DB.ExecContext(ctx, `
       UPDATE chat_requests SET status = $1, updated_at = NOW() 
       WHERE id = $2 AND managed_profile_id = $3
    `, newStatus, reqID, profileID)
	return err
}

func (r *Repository) GetChatQueueForProfile(ctx context.Context, profileID string) ([]models.ChatQueueItem, error) {
	return r.GetChatQueue(ctx, profileID)
}

// GetProfileMedia fetches media items for a specific managed persona
func (r *Repository) GetProfileMedia(ctx context.Context, profileID string, creatorID string) ([]models.MediaItem, error) {
	chatUserID, err := r.ResolveManagedProfileChatIdentity(ctx, profileID, creatorID)
	if err != nil {
		return nil, err
	}

	query := `
       SELECT id::text, url, is_primary, created_at 
       FROM user_media 
       WHERE user_id = $1 
       ORDER BY created_at DESC
    `
	rows, err := r.DB.QueryContext(ctx, query, chatUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	mediaList := make([]models.MediaItem, 0)
	for rows.Next() {
		var m models.MediaItem
		if err := rows.Scan(&m.ID, &m.URL, &m.IsPrimary, &m.CreatedAt); err != nil {
			continue
		}
		mediaList = append(mediaList, m)
	}
	return mediaList, nil
}

// UpdateCreatorOnlineStatus toggles the creator's overall operational availability
func (r *Repository) UpdateCreatorOnlineStatus(ctx context.Context, creatorID string, isOnline bool) error {
	_, err := r.DB.ExecContext(ctx, `
       INSERT INTO creator_stats (user_id, is_online, updated_at) 
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE 
       SET is_online = EXCLUDED.is_online, updated_at = NOW()
    `, creatorID, isOnline)
	return err
}
