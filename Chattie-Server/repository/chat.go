package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"chattie-backend/models"
)

type ChatRepository struct {
	DB *sql.DB
}

func NewChatRepository(db *sql.DB) *ChatRepository {
	return &ChatRepository{DB: db}
}

func (r *ChatRepository) IsUserAutoMuted(ctx context.Context, userID string) (bool, error) {
	var muted bool
	err := r.DB.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM user_chat_mutes
			WHERE user_id = $1 AND muted_until > CURRENT_TIMESTAMP
		)
	`, userID).Scan(&muted)
	return muted, err
}

func (r *ChatRepository) RecordExplicitFilterHit(ctx context.Context, userID string) (bool, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	enabled, err := firewallRuleActive(ctx, tx, "RUL_4")
	if err != nil {
		return false, err
	}
	if !enabled {
		return false, tx.Commit()
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM user_filter_hits
		WHERE user_id = $1 AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 day'
	`, userID); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO user_filter_hits (user_id) VALUES ($1)
	`, userID); err != nil {
		return false, err
	}
	var hitCount int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM user_filter_hits
		WHERE user_id = $1 AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
	`, userID).Scan(&hitCount); err != nil {
		return false, err
	}
	muted := hitCount >= 3
	if muted {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO user_chat_mutes (user_id, muted_until, reason)
			VALUES ($1, CURRENT_TIMESTAMP + INTERVAL '1 hour', 'Repeated profanity filter hits')
			ON CONFLICT (user_id) DO UPDATE SET
				muted_until = GREATEST(user_chat_mutes.muted_until, EXCLUDED.muted_until),
				reason = EXCLUDED.reason
		`, userID); err != nil {
			return false, err
		}
	}
	return muted, tx.Commit()
}

func (r *ChatRepository) SaveMessage(msg *models.Message) error {
	// Fallback to text if frontend sends text instead of content
	content := msg.Content
	if content == "" {
		content = msg.Text
	}
	if msg.MessageKind == "" {
		msg.MessageKind = "chat"
	}

	// Using NULLIF safely converts empty strings to NULL for UUIDs
	// Added media column to the insert statement
	tx, err := r.DB.BeginTx(context.Background(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	query := `
       INSERT INTO messages (sender_id, recipient_id, room_id, content, media, status, message_kind, call_mode, client_message_id, is_ai_generated)
       VALUES (
          NULLIF($1, '')::uuid, 
          NULLIF($2, '')::uuid, 
          NULLIF($3, ''),
          $4, 
          $5,
          $6,
          $7,
          NULLIF($8, ''),
          NULLIF($9, ''),
          $10
       )
       ON CONFLICT (sender_id, client_message_id)
          WHERE client_message_id IS NOT NULL
          DO NOTHING
       RETURNING id, created_at
    `
	err = tx.QueryRowContext(
		context.Background(),
		query,
		msg.SenderID,
		msg.RecipientID,
		msg.RoomID,
		content,
		msg.Media, // Inject the media attachment URL
		msg.Status,
		msg.MessageKind,
		msg.CallMode,
		msg.ClientMessageID,
		msg.IsAIGenerated,
	).Scan(&msg.ID, &msg.CreatedAt)
	if err == sql.ErrNoRows && msg.ClientMessageID != "" {
		var existingContent, existingMedia, existingStatus, existingMessageKind, existingCallMode string
		var existingIsAIGenerated bool
		err = tx.QueryRowContext(context.Background(), `
			SELECT id, created_at, content, COALESCE(media, ''), status, message_kind, COALESCE(call_mode, ''), is_ai_generated
			FROM messages
			WHERE sender_id = NULLIF($1, '')::uuid
			  AND client_message_id = $2
			  AND recipient_id IS NOT DISTINCT FROM NULLIF($3, '')::uuid
			  AND room_id IS NOT DISTINCT FROM NULLIF($4, '')
		`, msg.SenderID, msg.ClientMessageID, msg.RecipientID, msg.RoomID).Scan(
			&msg.ID,
			&msg.CreatedAt,
			&existingContent,
			&existingMedia,
			&existingStatus,
			&existingMessageKind,
			&existingCallMode,
			&existingIsAIGenerated,
		)
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("client message id is already used by another conversation")
		}
		if err != nil {
			return err
		}
		if existingContent != content || existingMedia != msg.Media || existingStatus != msg.Status ||
			existingMessageKind != msg.MessageKind || existingCallMode != msg.CallMode ||
			existingIsAIGenerated != msg.IsAIGenerated {
			return errors.New("client message id was reused with different message content")
		}
		return tx.Commit()
	}
	if err != nil {
		return err
	}

	if msg.EarnedByCreatorID != "" {
		if _, err := tx.ExecContext(context.Background(), `
			INSERT INTO creator_stats (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING
		`, msg.EarnedByCreatorID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(context.Background(), `
			UPDATE creator_stats
			SET current_balance = current_balance + 0.01,
			    total_earned = total_earned + 0.01,
			    updated_at = NOW()
			WHERE user_id = $1
		`, msg.EarnedByCreatorID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(context.Background(), `
			INSERT INTO transactions (model_id, client_id, tx_type, amount, status, message_id)
			VALUES ($1, NULLIF($2, '')::uuid, 'CHAT_REPLY', 0.01, 'COMPLETED', $3)
		`, msg.EarnedByCreatorID, msg.RecipientID, msg.ID); err != nil {
			return err
		}
	}

	if msg.RecipientID != "" && msg.RoomID == "" {
		if _, err := tx.ExecContext(context.Background(), `
			UPDATE ai_auto_reply_jobs
			SET status = 'cancelled'
			WHERE user_id = $1 AND partner_id = $2
			  AND status IN ('pending', 'processing')
		`, msg.SenderID, msg.RecipientID); err != nil {
			return err
		}
		if !msg.IsAIGenerated {
			if _, err := tx.ExecContext(context.Background(), `
				INSERT INTO ai_auto_reply_jobs (user_id, partner_id, source_message_id, due_at)
				SELECT preference.user_id, preference.partner_id, $3, CURRENT_TIMESTAMP + INTERVAL '5 hours'
				FROM ai_dm_preferences preference
				WHERE preference.user_id = $1
				  AND preference.partner_id = $2
				  AND preference.auto_reply_enabled = TRUE
				ON CONFLICT (user_id, partner_id, source_message_id) DO NOTHING
			`, msg.RecipientID, msg.SenderID, msg.ID); err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

func (r *ChatRepository) IsRoomMember(ctx context.Context, roomID, userID string) (bool, error) {
	var isMember bool
	err := r.DB.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM room_members rm
			JOIN rooms r ON r.id = rm.room_id AND r.status = 'ACTIVE'
			WHERE rm.room_id = $1 AND rm.user_id = $2
			  AND NOT EXISTS (
			    SELECT 1 FROM room_bans b WHERE b.room_id = rm.room_id AND b.user_id = rm.user_id
			  )
			  AND (
			    r.content_mode <> 'mature'
			    OR EXISTS (
			      SELECT 1 FROM user_profiles p
			      WHERE p.user_id = rm.user_id
			        AND p.date_of_birth <= CURRENT_DATE - INTERVAL '18 years'
			    )
			  )
		)
	`, roomID, userID).Scan(&isMember)
	return isMember, err
}

func (r *ChatRepository) GetRoomMessages(roomID string, limit int, currentUserIDs ...string) ([]models.Message, error) {
	currentUserID := ""
	if len(currentUserIDs) > 0 {
		currentUserID = currentUserIDs[0]
	}
	query := `
       SELECT 
          m.id, 
          COALESCE(m.sender_id::text, ''), 
          COALESCE(up.display_name, 'Unknown'),
          COALESCE(up.avatar_url, ''),
          COALESCE(m.recipient_id::text, ''), 
          COALESCE(m.room_id::text, ''), 
          COALESCE(m.content, ''), 
          COALESCE(m.media, ''), 
          COALESCE(m.status, 'sent'), 
          m.created_at,
          m.is_pinned,
          COALESCE(m.pinned_by::text, ''),
          m.pinned_at,
          COALESCE((
             SELECT rm.role FROM room_members rm
             WHERE rm.room_id::text = m.room_id::text AND rm.user_id = m.sender_id
          ), 'member'),
          COALESCE((
             SELECT json_agg(json_build_object('emoji', reactions.emoji, 'count', reactions.reaction_count, 'reacted', reactions.reacted))
             FROM (
                SELECT emoji, COUNT(*)::INT AS reaction_count, BOOL_OR(user_id = NULLIF($3, '')::uuid) AS reacted
                FROM room_message_reactions
                WHERE message_id = m.id
                GROUP BY emoji
             ) reactions
          ), '[]'::json)::text
       FROM (
          SELECT * FROM messages
          WHERE room_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2
       ) m
       LEFT JOIN user_profiles up ON m.sender_id = up.user_id
       ORDER BY m.created_at ASC, m.id ASC
    `
	rows, err := r.DB.Query(query, roomID, limit, currentUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []models.Message
	for rows.Next() {
		var msg models.Message
		var pinnedAt sql.NullTime
		var reactionsJSON []byte
		if err := rows.Scan(
			&msg.ID,
			&msg.SenderID,
			&msg.SenderName,
			&msg.AvatarURL,
			&msg.RecipientID,
			&msg.RoomID,
			&msg.Content,
			&msg.Media,
			&msg.Status,
			&msg.CreatedAt,
			&msg.IsPinned,
			&msg.PinnedBy,
			&pinnedAt,
			&msg.Role,
			&reactionsJSON,
		); err != nil {
			return nil, err
		}
		if pinnedAt.Valid {
			msg.PinnedAt = &pinnedAt.Time
		}
		if err := json.Unmarshal(reactionsJSON, &msg.Reactions); err != nil {
			return nil, err
		}
		messages = append(messages, msg)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if messages == nil {
		messages = []models.Message{}
	}

	return messages, nil
}

func (r *ChatRepository) GetDirectMessages(userID string, partnerID string, limit int) ([]models.Message, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `
       SELECT 
          m.id, 
          COALESCE(m.sender_id::text, ''), 
          COALESCE(up.display_name, 'Unknown'),
          COALESCE(up.avatar_url, ''),
          COALESCE(m.recipient_id::text, ''), 
          COALESCE(m.room_id::text, ''), 
          COALESCE(m.content, ''), 
          COALESCE(m.media, ''), 
          COALESCE(m.status, 'sent'), 
          m.created_at
          , m.is_pinned,
          COALESCE(m.pinned_by::text, ''),
          m.pinned_at,
          COALESCE(m.message_kind, 'chat'),
          COALESCE(m.call_mode, ''),
          COALESCE(m.is_ai_generated, FALSE)
       FROM (
          SELECT *
          FROM messages
          WHERE (sender_id = $1 AND recipient_id = $2)
             OR (sender_id = $2 AND recipient_id = $1)
          ORDER BY created_at DESC, id DESC
          LIMIT $3
       ) m
       LEFT JOIN user_profiles up ON m.sender_id = up.user_id
       ORDER BY m.created_at ASC, m.id ASC
    `
	rows, err := r.DB.Query(query, userID, partnerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []models.Message
	for rows.Next() {
		var msg models.Message
		var pinnedAt sql.NullTime
		if err := rows.Scan(
			&msg.ID,
			&msg.SenderID,
			&msg.SenderName,
			&msg.AvatarURL,
			&msg.RecipientID,
			&msg.RoomID,
			&msg.Content,
			&msg.Media,
			&msg.Status,
			&msg.CreatedAt,
			&msg.IsPinned,
			&msg.PinnedBy,
			&pinnedAt,
			&msg.MessageKind,
			&msg.CallMode,
			&msg.IsAIGenerated,
		); err != nil {
			return nil, err
		}
		if pinnedAt.Valid {
			msg.PinnedAt = &pinnedAt.Time
		}
		messages = append(messages, msg)
	}

	if messages == nil {
		messages = []models.Message{}
	}
	return messages, nil
}

func (r *ChatRepository) ResolveManagedProfileChatIdentity(ctx context.Context, profileID, creatorID string) (string, error) {
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

func (r *ChatRepository) PinDirectMessage(userID, partnerID, messageID string, pinned bool) error {
	result, err := r.DB.Exec(`
		UPDATE messages
		SET is_pinned = $1,
		    pinned_by = CASE WHEN $1 THEN $2::uuid ELSE NULL END,
		    pinned_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END
		WHERE id = $3::uuid
		  AND room_id IS NULL
		  AND ((sender_id = $2::uuid AND recipient_id = $4::uuid)
		    OR (sender_id = $4::uuid AND recipient_id = $2::uuid))
	`, pinned, userID, messageID, partnerID)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *ChatRepository) GetInbox(userID string) ([]models.InboxItem, error) {
	// UPGRADE: Handled cases where a message has an image but no text (shows '📷 Image' in inbox preview)
	query := `
        WITH recent_messages AS (
            SELECT
                CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS partner_id,
                CASE 
                    WHEN COALESCE(content, '') = '' AND COALESCE(media, '') != '' THEN '📷 Image'
                    ELSE COALESCE(content, '') 
                END AS last_message,
                created_at AS last_message_time,
                status,
                sender_id,
                ROW_NUMBER() OVER(PARTITION BY CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END ORDER BY created_at DESC) as rn
            FROM messages
            WHERE sender_id = $1 OR recipient_id = $1
        ),
        unread_counts AS (
            SELECT
                sender_id AS partner_id,
                COUNT(*) as unread_count
            FROM messages
            WHERE recipient_id = $1 AND status = 'sent'
            GROUP BY sender_id
        ),
        lifetime_spend AS (
            SELECT client_id, COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE status = 'COMPLETED' AND client_id IS NOT NULL
            GROUP BY client_id
        )
        SELECT 
            rm.partner_id as room_id, -- Using partner_id as room_id for DMs
            rm.partner_id,
            COALESCE(up.display_name, 'Unknown'),
            COALESCE(up.avatar_url, ''),
            COALESCE(up.bio, ''),
            COALESCE(spend.total, 0),
            rm.last_message,
            rm.last_message_time,
            COALESCE(uc.unread_count, 0) as unread_count,
            COALESCE(u.status, 'offline')
        FROM recent_messages rm
        JOIN users u ON u.id = rm.partner_id
        LEFT JOIN user_profiles up ON up.user_id = rm.partner_id
        LEFT JOIN unread_counts uc ON uc.partner_id = rm.partner_id
        LEFT JOIN lifetime_spend spend ON spend.client_id = rm.partner_id
        WHERE rm.rn = 1
        ORDER BY rm.last_message_time DESC;
    `
	rows, err := r.DB.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var inbox []models.InboxItem
	for rows.Next() {
		var item models.InboxItem
		if err := rows.Scan(
			&item.RoomID, &item.PartnerID, &item.PartnerName, &item.AvatarURL, &item.Bio, &item.LifetimeSpend,
			&item.LastMessage, &item.LastMessageTime, &item.UnreadCount, &item.Status,
		); err != nil {
			return nil, err
		}
		item.IsMuted = false // Default unless you add a mute preferences table later
		inbox = append(inbox, item)
	}

	if inbox == nil {
		inbox = []models.InboxItem{}
	}

	return inbox, nil
}

// AutoCreateReport is called when the real-time WebSocket filter catches a violation
func (r *ChatRepository) AutoCreateReport(reportedID, reporter, reason, originalContent string) error {
	var reporterUUID interface{}
	if reporter != "SYSTEM" && reporter != "SYSTEM_NSFW" {
		reporterUUID = reporter
	}

	// We store the ORIGINAL uncensored message in the 'description' field for evidence
	query := `
        INSERT INTO reports (reporter_id, reported_id, reason, status, description)
        VALUES (NULLIF($1, '')::uuid, NULLIF($2, '')::uuid, 'Automated Flag', 'pending', $3)
    `
	_, err := r.DB.Exec(query, reporterUUID, reportedID, originalContent)
	return err
}

// GetUserInsights retrieves contextual user data for models/operators when they open a chat
func (r *ChatRepository) GetUserInsights(ctx context.Context, targetUserID string) (models.UserInsight, error) {
	var insight models.UserInsight
	var rawPreferences string

	// Grabs join date, totals up transactions, fetches behavior risk scores and preferences
	query := `
        SELECT 
            TO_CHAR(u.created_at, 'YYYY-MM-DD') as join_date,
            COALESCE((SELECT SUM(amount) FROM transactions WHERE user_id = u.id), 0.00) as total_spent,
            COALESCE(cb.risk_score, 0) as risk_score,
            COALESCE(cb.flags_count, 0) as previous_flags,
            COALESCE(up.interested_in, '') as preferences
        FROM users u
        LEFT JOIN client_behavior cb ON u.id = cb.user_id
        LEFT JOIN user_preferences up ON u.id = up.user_id
        WHERE u.id = $1
    `

	err := r.DB.QueryRowContext(ctx, query, targetUserID).Scan(
		&insight.JoinDate,
		&insight.TotalSpent,
		&insight.RiskScore,
		&insight.PreviousFlags,
		&rawPreferences,
	)

	if err != nil && err != sql.ErrNoRows {
		return insight, err
	}

	// Simple CSV split for preferences (e.g. "brunettes,sports,casual")
	if rawPreferences != "" {
		insight.Preferences = strings.Split(rawPreferences, ",")
	} else {
		insight.Preferences = []string{"None specified"}
	}

	// Flag for frontend UI warning if user has a sketchy history
	if insight.RiskScore > 50 {
		insight.IsSuspicious = true
	}

	return insight, nil
}

// SetUserOnlineStatus updates user presence in users and creator_stats tables
func (r *ChatRepository) SetUserOnlineStatus(userID string, isOnline bool) error {
	status := "offline"
	if isOnline {
		status = "online"
	}

	_, err := r.DB.Exec(`
		UPDATE users 
		SET status = $1, updated_at = NOW() 
		WHERE id = $2
	`, status, userID)
	if err != nil {
		return err
	}

	// Also sync creator stats presence if user is a model
	_, _ = r.DB.Exec(`
		UPDATE creator_stats 
		SET is_online = $1 
		WHERE user_id = $2
	`, isOnline, userID)

	return nil
}

// MarkMessagesAsRead updates all incoming unread messages from a target partner to 'read'
func (r *ChatRepository) MarkMessagesAsRead(userID string, partnerID string) error {
	_, err := r.DB.Exec(`
		UPDATE messages 
		SET status = 'read' 
		WHERE recipient_id = $1 AND sender_id = $2 AND status = 'sent'
	`, userID, partnerID)
	return err
}

func (r *ChatRepository) ReadReceiptsEnabled(userID string) (bool, error) {
	var enabled bool
	err := r.DB.QueryRow(`
		SELECT COALESCE(privacy_read_receipts, TRUE)
		FROM user_settings WHERE user_id = $1
	`, userID).Scan(&enabled)
	if err == sql.ErrNoRows {
		return true, nil
	}
	return enabled, err
}
