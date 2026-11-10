package repository

import (
	"chattie-backend/models"
	"context"
	"database/sql"
)

type ADChatRepository struct {
	DB *sql.DB
}

func NewADChatRepository(db *sql.DB) *ADChatRepository {
	return &ADChatRepository{DB: db}
}

// GetOrCreateConversation finds an existing 1-on-1 thread or creates a new one safely
func (r *ADChatRepository) GetOrCreateConversation(ctx context.Context, userA string, userB string) (string, error) {
	// 1. Check if conversation already exists between these two exact users
	queryCheck := `
		SELECT c.id 
		FROM ad_conversations c
		JOIN ad_conversation_participants p1 ON c.id = p1.conversation_id
		JOIN ad_conversation_participants p2 ON c.id = p2.conversation_id
		WHERE p1.user_id = $1 AND p2.user_id = $2
		LIMIT 1
	`
	var convID string
	err := r.DB.QueryRowContext(ctx, queryCheck, userA, userB).Scan(&convID)

	if err == nil {
		return convID, nil // Found existing
	} else if err != sql.ErrNoRows {
		return "", err // DB error
	}

	// 2. Create new conversation transactionally
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	err = tx.QueryRowContext(ctx, `INSERT INTO ad_conversations DEFAULT VALUES RETURNING id`).Scan(&convID)
	if err != nil {
		return "", err
	}

	_, err = tx.ExecContext(ctx, `INSERT INTO ad_conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`, convID, userA, userB)
	if err != nil {
		return "", err
	}

	return convID, tx.Commit()
}

func (r *ADChatRepository) ResolveMessageTarget(ctx context.Context, requesterID string, targetID string) (string, string, bool, error) {
	var userID, dmControl string
	var isSubscriber bool
	err := r.DB.QueryRowContext(ctx, `
		SELECT pp.user_id::text,
			CASE WHEN pp.status = 'active' THEN pp.dm_control ELSE 'none' END,
			EXISTS (
				SELECT 1 FROM ad_subscriptions s
				WHERE s.subscriber_id = $2
				  AND s.creator_id = pp.user_id
				  AND s.status = 'active'
				  AND s.current_period_end > CURRENT_TIMESTAMP
			)
		FROM performer_profiles pp
		WHERE pp.id::text = $1 OR pp.user_id::text = $1
		ORDER BY CASE WHEN pp.id::text = $1 THEN 0 ELSE 1 END
		LIMIT 1
	`, targetID, requesterID).Scan(&userID, &dmControl, &isSubscriber)
	if err == sql.ErrNoRows {
		return targetID, "all", false, nil
	}
	return userID, dmControl, isSubscriber, err
}

func (r *ADChatRepository) IsParticipant(ctx context.Context, conversationID string, userID string) (bool, error) {
	var isParticipant bool
	err := r.DB.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM ad_conversation_participants
			WHERE conversation_id = $1 AND user_id = $2
		)
	`, conversationID, userID).Scan(&isParticipant)
	return isParticipant, err
}

func (r *ADChatRepository) GetConversations(ctx context.Context, userID string) ([]models.ADConversationSummary, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT c.id::text, other.user_id::text,
			COALESCE(pp.display_name, other_user.username),
			COALESCE(avatar.storage_key, ''),
			COALESCE(last_message.content, ''),
			COALESCE(last_message.created_at, c.updated_at),
			(SELECT COUNT(*) FROM ad_messages unread
			 WHERE unread.conversation_id = c.id
			   AND unread.sender_id <> $1 AND unread.is_read = FALSE)
		FROM ad_conversations c
		JOIN ad_conversation_participants self
		  ON self.conversation_id = c.id AND self.user_id = $1
		JOIN ad_conversation_participants other
		  ON other.conversation_id = c.id AND other.user_id <> $1
		JOIN users other_user ON other_user.id = other.user_id
		LEFT JOIN performer_profiles pp ON pp.user_id = other.user_id
		LEFT JOIN ad_assets avatar ON avatar.id = pp.avatar_asset_id
		LEFT JOIN LATERAL (
			SELECT m.content, m.created_at FROM ad_messages m
			WHERE m.conversation_id = c.id
			ORDER BY m.created_at DESC LIMIT 1
		) last_message ON TRUE
		ORDER BY COALESCE(last_message.created_at, c.updated_at) DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	conversations := make([]models.ADConversationSummary, 0)
	for rows.Next() {
		var conversation models.ADConversationSummary
		if err := rows.Scan(
			&conversation.ID,
			&conversation.OtherUserID,
			&conversation.OtherUser.DisplayName,
			&conversation.OtherUser.AvatarURL,
			&conversation.LastMessage,
			&conversation.LastMessageAt,
			&conversation.UnreadCount,
		); err != nil {
			return nil, err
		}
		conversation.ConversationID = conversation.ID
		conversation.OtherUser.ID = conversation.OtherUserID
		conversation.HasAccess = true
		conversations = append(conversations, conversation)
	}
	return conversations, rows.Err()
}

// SaveMessage persists the message to the database before broadcast (Invariant #5)
func (r *ADChatRepository) SaveMessage(ctx context.Context, msg *models.ADMessage) error {
	query := `
		INSERT INTO ad_messages (id, conversation_id, sender_id, content, media_asset_id, is_explicit, created_at)
		SELECT $1, $2, $3, $4, NULLIF($5, '')::uuid, $6, $7
		WHERE EXISTS (
			SELECT 1 FROM ad_conversation_participants
			WHERE conversation_id = $2 AND user_id = $3
		) AND (
			NULLIF($5, '') IS NULL OR EXISTS (
				SELECT 1 FROM ad_assets WHERE id = NULLIF($5, '')::uuid AND owner_id = $3
			)
		)
	`
	result, err := r.DB.ExecContext(ctx, query,
		msg.ID, msg.ConversationID, msg.SenderID, msg.Content,
		msg.MediaAssetID, msg.IsExplicit, msg.CreatedAt,
	)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return sql.ErrNoRows
	}

	if err == nil {
		// Update the thread's updated_at timestamp to bubble it to the top of the inbox
		_, err = r.DB.ExecContext(ctx, `UPDATE ad_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`, msg.ConversationID)
	}

	return err
}

// GetMessages fetches paginated history for a conversation
func (r *ADChatRepository) GetMessages(ctx context.Context, convID string, limit int, offset int) ([]models.ADMessage, error) {
	query := `
		SELECT m.id::text, m.conversation_id::text, m.sender_id::text, COALESCE(m.content, ''),
		       COALESCE(m.media_asset_id::text, ''), COALESCE(a.storage_key, ''),
		       COALESCE(a.mime_type, ''), m.is_explicit, m.is_read, m.created_at
		FROM ad_messages m
		LEFT JOIN ad_assets a ON a.id = m.media_asset_id
		WHERE m.conversation_id = $1
		ORDER BY m.created_at DESC
		LIMIT $2 OFFSET $3
	`
	rows, err := r.DB.QueryContext(ctx, query, convID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []models.ADMessage
	for rows.Next() {
		var m models.ADMessage
		if err := rows.Scan(
			&m.ID, &m.ConversationID, &m.SenderID, &m.Content,
			&m.MediaAssetID, &m.MediaURL, &m.MediaType,
			&m.IsExplicit, &m.IsRead, &m.CreatedAt,
		); err != nil {
			return nil, err
		}
		messages = append(messages, m)
	}

	if messages == nil {
		messages = []models.ADMessage{}
	}
	return messages, rows.Err()
}

// UpdateReadCursor updates the last_read_at timestamp for a participant
func (r *ADChatRepository) UpdateReadCursor(ctx context.Context, conversationID string, userID string) error {
	query := `
		INSERT INTO ad_conversation_reads (conversation_id, user_id, last_read_at)
		VALUES ($1, $2, CURRENT_TIMESTAMP)
		ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = CURRENT_TIMESTAMP
	`
	_, err := r.DB.ExecContext(ctx, query, conversationID, userID)
	if err != nil {
		return err
	}

	// Mark messages as read where sender is NOT the current user
	_, err = r.DB.ExecContext(ctx, `
		UPDATE ad_messages SET is_read = TRUE 
		WHERE conversation_id = $1 AND sender_id != $2 AND is_read = FALSE
	`, conversationID, userID)

	return err
}
