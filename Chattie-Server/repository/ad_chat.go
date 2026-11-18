package repository

import (
	"chattie-backend/models"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

const ChatAccessPriceCents int64 = 1000

type ADChatRepository struct {
	DB *sql.DB
}

func NewADChatRepository(db *sql.DB) *ADChatRepository {
	return &ADChatRepository{DB: db}
}

// GetOrCreateConversation finds an existing 1-on-1 thread or creates a new one safely
func (r *ADChatRepository) GetOrCreateConversation(ctx context.Context, userA string, userB string) (string, error) {
	if userA == userB {
		return "", errors.New("conversation participants must be different users")
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	firstUser, secondUser := userA, userB
	if firstUser > secondUser {
		firstUser, secondUser = secondUser, firstUser
	}
	if _, err := tx.ExecContext(ctx, `
		SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))
	`, firstUser, secondUser); err != nil {
		return "", err
	}

	var convID string
	err = tx.QueryRowContext(ctx, `
		SELECT c.id
		FROM ad_conversations c
		JOIN ad_conversation_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
		JOIN ad_conversation_participants p2 ON p2.conversation_id = c.id AND p2.user_id = $2
		LIMIT 1
	`, userA, userB).Scan(&convID)
	if err == nil {
		if err := tx.Commit(); err != nil {
			return "", err
		}
		return convID, nil
	}
	if err != sql.ErrNoRows {
		return "", err
	}

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

func (r *ADChatRepository) HasChatEntitlement(ctx context.Context, userID string, creatorID string) (bool, error) {
	var entitled bool
	err := r.DB.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM ad_chat_entitlements
			WHERE user_id = $1 AND creator_id = $2
		)
	`, userID, creatorID).Scan(&entitled)
	return entitled, err
}

func (r *ADChatRepository) CanSendMessage(ctx context.Context, conversationID string, userID string) (bool, error) {
	var allowed bool
	err := r.DB.QueryRowContext(ctx, `
		SELECT CASE
			WHEN creator.user_id IS NULL THEN TRUE
			WHEN creator.status <> 'active' THEN FALSE
			WHEN creator.dm_control = 'none' THEN FALSE
			WHEN creator.user_id = $2 THEN TRUE
			WHEN creator.dm_control = 'all' THEN TRUE
			ELSE EXISTS (
				SELECT 1 FROM ad_subscriptions s
				WHERE s.subscriber_id = $2
				  AND s.creator_id = creator.user_id
				  AND s.status = 'active'
				  AND s.current_period_end > CURRENT_TIMESTAMP
			) OR EXISTS (
				SELECT 1 FROM ad_chat_entitlements e
				WHERE e.user_id = $2 AND e.creator_id = creator.user_id
			)
		END
		FROM ad_conversation_participants self
		JOIN ad_conversation_participants other
		  ON other.conversation_id = self.conversation_id AND other.user_id <> self.user_id
		LEFT JOIN performer_profiles creator ON creator.user_id = other.user_id
		WHERE self.conversation_id = $1 AND self.user_id = $2
		LIMIT 1
	`, conversationID, userID).Scan(&allowed)
	return allowed, err
}

func (r *ADChatRepository) PurchaseChatAccess(ctx context.Context, conversationID string, buyerID string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var creatorID string
	err = tx.QueryRowContext(ctx, `
		SELECT pp.user_id::text
		FROM ad_conversation_participants buyer
		JOIN ad_conversation_participants creator_participant
		  ON creator_participant.conversation_id = buyer.conversation_id
		 AND creator_participant.user_id <> buyer.user_id
		JOIN performer_profiles pp ON pp.user_id = creator_participant.user_id
		WHERE buyer.conversation_id = $1 AND buyer.user_id = $2
		FOR UPDATE OF pp
	`, conversationID, buyerID).Scan(&creatorID)
	if err != nil {
		return err
	}
	if creatorID == buyerID {
		return errors.New("creators cannot purchase their own chat")
	}

	var dmControl string
	err = tx.QueryRowContext(ctx, `
		SELECT dm_control FROM performer_profiles
		WHERE user_id = $1 AND status = 'active'
	`, creatorID).Scan(&dmControl)
	if err != nil {
		return err
	}
	switch dmControl {
	case "none":
		return errors.New("creator is not accepting direct messages")
	case "all":
		return errors.New("chat access is already included")
	case "subscribers":
	default:
		return errors.New("creator messaging policy is invalid")
	}

	var isSubscriber bool
	err = tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM ad_subscriptions
			WHERE subscriber_id = $1 AND creator_id = $2
			  AND status = 'active' AND current_period_end > CURRENT_TIMESTAMP
		)
	`, buyerID, creatorID).Scan(&isSubscriber)
	if err != nil {
		return err
	}
	if isSubscriber {
		return errors.New("chat access is already included")
	}

	var hasEntitlement bool
	err = tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM ad_chat_entitlements
			WHERE user_id = $1 AND creator_id = $2
		)
	`, buyerID, creatorID).Scan(&hasEntitlement)
	if err != nil {
		return err
	}
	if hasEntitlement {
		return nil
	}

	var balance int64
	err = tx.QueryRowContext(ctx, `
		SELECT available_balance_cents FROM ad_wallets WHERE user_id = $1 FOR UPDATE
	`, buyerID).Scan(&balance)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if errors.Is(err, sql.ErrNoRows) || balance < ChatAccessPriceCents {
		return errors.New("insufficient funds")
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE ad_wallets SET available_balance_cents = available_balance_cents - $1
		WHERE user_id = $2
	`, ChatAccessPriceCents, buyerID)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
		VALUES ($1, $2, 'chat_unlock_purchase', $3, 'One-time creator chat access')
	`, buyerID, -ChatAccessPriceCents, conversationID)
	if err != nil {
		return err
	}
	creatorCut := ChatAccessPriceCents * 80 / 100
	_, err = tx.ExecContext(ctx, `
		INSERT INTO ad_wallets (user_id, pending_balance_cents) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE
		SET pending_balance_cents = ad_wallets.pending_balance_cents + $2
	`, creatorID, creatorCut)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
		VALUES ($1, $2, 'chat_unlock_earning', $3, 'One-time creator chat access')
	`, creatorID, creatorCut, conversationID)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO ad_chat_entitlements (user_id, creator_id, payment_ref)
		VALUES ($1, $2, $3)
	`, buyerID, creatorID, conversationID)
	if err != nil {
		return err
	}
	return tx.Commit()
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
			   AND unread.sender_id <> $1 AND unread.is_read = FALSE),
			CASE
				WHEN pp.user_id IS NULL THEN TRUE
				WHEN pp.status <> 'active' THEN FALSE
				WHEN COALESCE(pp.dm_control, 'all') = 'all' THEN TRUE
				WHEN pp.dm_control = 'none' THEN FALSE
				ELSE EXISTS (
					SELECT 1 FROM ad_subscriptions s
					WHERE s.subscriber_id = $1 AND s.creator_id = other.user_id
					  AND s.status = 'active' AND s.current_period_end > CURRENT_TIMESTAMP
				) OR EXISTS (
					SELECT 1 FROM ad_chat_entitlements e
					WHERE e.user_id = $1 AND e.creator_id = other.user_id
				)
			END,
			CASE WHEN pp.user_id IS NULL THEN 'all'
			     WHEN pp.status = 'active' THEN pp.dm_control
			     ELSE 'none' END,
			$2::bigint,
			EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = $1 AND b.blocked_id = other.user_id),
			EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = other.user_id AND b.blocked_id = $1)
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
	`, userID, ChatAccessPriceCents)
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
			&conversation.HasAccess,
			&conversation.DMControl,
			&conversation.ChatPriceCents,
			&conversation.BlockedByMe,
			&conversation.BlockedMe,
		); err != nil {
			return nil, err
		}
		conversation.ConversationID = conversation.ID
		conversation.OtherUser.ID = conversation.OtherUserID
		conversations = append(conversations, conversation)
	}
	return conversations, rows.Err()
}

// SaveMessage persists the message to the database before broadcast (Invariant #5)
func (r *ADChatRepository) SaveMessage(ctx context.Context, msg *models.ADMessage) error {
	query := `
		WITH inserted AS (
			INSERT INTO ad_messages (
				id, conversation_id, sender_id, content, media_asset_id, is_explicit,
				message_kind, call_mode, reply_to_message_id, created_at
			)
			SELECT $1, $2, $3, $4, NULLIF($5, '')::uuid, $6, $7, NULLIF($8, ''), NULLIF($9, '')::uuid, $10
			WHERE EXISTS (
				SELECT 1 FROM ad_conversation_participants
				WHERE conversation_id = $2 AND user_id = $3
			) AND NOT EXISTS (
				SELECT 1 FROM ad_conversation_participants other
				JOIN blocks b ON (b.blocker_id = other.user_id AND b.blocked_id = $3)
					OR (b.blocker_id = $3 AND b.blocked_id = other.user_id)
				WHERE other.conversation_id = $2 AND other.user_id <> $3
			) AND (
				NULLIF($5, '') IS NULL OR EXISTS (
					SELECT 1 FROM ad_assets WHERE id = NULLIF($5, '')::uuid AND owner_id = $3
				)
			) AND (
				NULLIF($9, '') IS NULL OR EXISTS (
					SELECT 1 FROM ad_messages reply
					WHERE reply.id = NULLIF($9, '')::uuid AND reply.conversation_id = $2
				)
			)
			RETURNING id, conversation_id, sender_id, content, media_asset_id, is_explicit,
				is_read, message_kind, call_mode, reply_to_message_id, is_pinned, pinned_by,
				pinned_at, created_at
		),
		bumped AS (
			UPDATE ad_conversations c
			SET updated_at = CURRENT_TIMESTAMP
			FROM inserted
			WHERE c.id = inserted.conversation_id
			RETURNING c.id
		)
		SELECT inserted.id::text, inserted.conversation_id::text, inserted.sender_id::text,
			inserted.content, COALESCE(inserted.media_asset_id::text, ''),
			COALESCE(asset.storage_key, ''), COALESCE(asset.mime_type, ''),
			inserted.is_explicit, inserted.is_read, inserted.message_kind, COALESCE(inserted.call_mode, ''),
			COALESCE(inserted.reply_to_message_id::text, ''), inserted.is_pinned,
			COALESCE(inserted.pinned_by::text, ''), inserted.pinned_at, inserted.created_at
		FROM inserted
		JOIN bumped ON bumped.id = inserted.conversation_id
		LEFT JOIN ad_assets asset ON asset.id = inserted.media_asset_id
	`
	var pinnedAt sql.NullTime
	err := r.DB.QueryRowContext(ctx, query,
		msg.ID, msg.ConversationID, msg.SenderID, msg.Content,
		msg.MediaAssetID, msg.IsExplicit, msg.MessageKind, msg.CallMode,
		msg.ReplyToMessageID, msg.CreatedAt,
	).Scan(
		&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.Content,
		&msg.MediaAssetID, &msg.MediaURL, &msg.MediaType,
		&msg.IsExplicit, &msg.IsRead, &msg.MessageKind, &msg.CallMode,
		&msg.ReplyToMessageID, &msg.IsPinned, &msg.PinnedBy, &pinnedAt, &msg.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return sql.ErrNoRows
	}
	if err != nil {
		return err
	}
	if pinnedAt.Valid {
		msg.PinnedAt = &pinnedAt.Time
	}
	return nil
}

// GetMessages fetches paginated history for a conversation
func (r *ADChatRepository) GetMessages(ctx context.Context, convID string, userID string, limit int, offset int) ([]models.ADMessage, error) {
	query := `
		SELECT m.id::text, m.conversation_id::text, m.sender_id::text, COALESCE(m.content, ''),
		       COALESCE(m.media_asset_id::text, ''), COALESCE(a.storage_key, ''),
		       COALESCE(a.mime_type, ''), m.is_explicit, m.is_read,
		       m.message_kind, COALESCE(m.call_mode, ''), COALESCE(m.reply_to_message_id::text, ''),
		       m.is_pinned, COALESCE(m.pinned_by::text, ''), m.pinned_at, m.created_at,
		       COALESCE((
		           SELECT json_agg(json_build_object(
		               'emoji', grouped.emoji, 'count', grouped.reaction_count, 'reacted', grouped.reacted
		           ))
		           FROM (
		               SELECT r.emoji, COUNT(*) AS reaction_count, BOOL_OR(r.user_id = $4) AS reacted
		               FROM ad_message_reactions r
		               WHERE r.message_id = m.id
		               GROUP BY r.emoji
		           ) grouped
		       ), '[]'::json)::text
		FROM ad_messages m
		LEFT JOIN ad_assets a ON a.id = m.media_asset_id
		WHERE m.conversation_id = $1
		ORDER BY m.created_at DESC
		LIMIT $2 OFFSET $3
	`
	rows, err := r.DB.QueryContext(ctx, query, convID, limit, offset, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []models.ADMessage
	for rows.Next() {
		var m models.ADMessage
		var reactionsJSON []byte
		var pinnedAt sql.NullTime
		if err := rows.Scan(
			&m.ID, &m.ConversationID, &m.SenderID, &m.Content,
			&m.MediaAssetID, &m.MediaURL, &m.MediaType,
			&m.IsExplicit, &m.IsRead, &m.MessageKind, &m.CallMode, &m.ReplyToMessageID,
			&m.IsPinned, &m.PinnedBy, &pinnedAt, &m.CreatedAt, &reactionsJSON,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(reactionsJSON, &m.Reactions); err != nil {
			return nil, err
		}
		if pinnedAt.Valid {
			m.PinnedAt = &pinnedAt.Time
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

	_, err = r.DB.ExecContext(ctx, `
		UPDATE ad_messages SET is_read = TRUE
		WHERE conversation_id = $1 AND sender_id <> $2 AND is_read = FALSE
	`, conversationID, userID)
	return err
}

func (r *ADChatRepository) GetOtherParticipant(ctx context.Context, conversationID string, userID string) (string, error) {
	var otherUserID string
	err := r.DB.QueryRowContext(ctx, `
		SELECT user_id::text FROM ad_conversation_participants
		WHERE conversation_id = $1 AND user_id <> $2
		LIMIT 1
	`, conversationID, userID).Scan(&otherUserID)
	return otherUserID, err
}

func (r *ADChatRepository) IsBlocked(ctx context.Context, userA string, userB string) (bool, error) {
	var blocked bool
	err := r.DB.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM blocks
			WHERE (blocker_id = $1 AND blocked_id = $2)
			   OR (blocker_id = $2 AND blocked_id = $1)
		)
	`, userA, userB).Scan(&blocked)
	return blocked, err
}

func (r *ADChatRepository) SetBlock(ctx context.Context, blockerID string, blockedID string, blocked bool) error {
	if blocked {
		tx, err := r.DB.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()

		lockedUsers, err := lockUsersInOrder(ctx, tx, blockerID, blockedID)
		if err != nil {
			return err
		}
		if len(lockedUsers) != 2 {
			return ErrUserNotFound
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO blocks (blocker_id, blocked_id)
			VALUES ($1, $2)
			ON CONFLICT (blocker_id, blocked_id) DO NOTHING
		`, blockerID, blockedID); err != nil {
			return err
		}
		return tx.Commit()
	}
	_, err := r.DB.ExecContext(ctx, `
		DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2
	`, blockerID, blockedID)
	return err
}

func (r *ADChatRepository) PinMessage(ctx context.Context, conversationID, userID, messageID string, pinned bool) error {
	result, err := r.DB.ExecContext(ctx, `
		UPDATE ad_messages
		SET is_pinned = $1,
		    pinned_by = CASE WHEN $1 THEN $2::uuid ELSE NULL END,
		    pinned_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END
		WHERE id = $3 AND conversation_id = $4
		  AND EXISTS (
		      SELECT 1 FROM ad_conversation_participants
		      WHERE conversation_id = $4 AND user_id = $2
		  )
	`, pinned, userID, messageID, conversationID)
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

func (r *ADChatRepository) ToggleMessageReaction(ctx context.Context, conversationID, userID, messageID, emoji string) (bool, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2 || ':' || $3))
	`, messageID, userID, emoji); err != nil {
		return false, err
	}

	var participant bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM ad_conversation_participants p
			JOIN ad_messages m ON m.conversation_id = p.conversation_id
			WHERE p.conversation_id = $1 AND p.user_id = $2 AND m.id = $3
		)
	`, conversationID, userID, messageID).Scan(&participant); err != nil {
		return false, err
	}
	if !participant {
		return false, sql.ErrNoRows
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO ad_message_reactions (message_id, user_id, emoji)
		VALUES ($1, $2, $3)
		ON CONFLICT (message_id, user_id, emoji) DO NOTHING
	`, messageID, userID, emoji)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if affected > 0 {
		if err := tx.Commit(); err != nil {
			return false, err
		}
		return true, nil
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM ad_message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3
	`, messageID, userID, emoji); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return false, nil
}

func (r *ADChatRepository) GetMessageReactions(ctx context.Context, conversationID, userID, messageID string) ([]models.ADMessageReaction, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT r.emoji, COUNT(*)::int, BOOL_OR(r.user_id = $3)
		FROM ad_message_reactions r
		JOIN ad_messages m ON m.id = r.message_id AND m.conversation_id = $1
		WHERE r.message_id = $2
		GROUP BY r.emoji
		ORDER BY r.emoji
	`, conversationID, messageID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	reactions := make([]models.ADMessageReaction, 0)
	for rows.Next() {
		var reaction models.ADMessageReaction
		if err := rows.Scan(&reaction.Emoji, &reaction.Count, &reaction.Reacted); err != nil {
			return nil, err
		}
		reactions = append(reactions, reaction)
	}
	return reactions, rows.Err()
}
