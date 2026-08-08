package repository

import (
	"chattie-backend/models"
	"database/sql"
)

type ChatRepository struct {
	DB *sql.DB
}

func NewChatRepository(db *sql.DB) *ChatRepository {
	return &ChatRepository{DB: db}
}

func (r *ChatRepository) SaveMessage(msg *models.Message) error {
	// Fallback to text if frontend sends text instead of content
	content := msg.Content
	if content == "" {
		content = msg.Text
	}

	// Using NULLIF safely converts empty strings to NULL for UUIDs
	// Added media column to the insert statement
	query := `
       INSERT INTO messages (sender_id, recipient_id, room_id, content, media, status)
       VALUES (
          NULLIF($1, '')::uuid, 
          NULLIF($2, '')::uuid, 
          NULLIF($3, '')::uuid, 
          $4, 
          $5,
          $6
       )
       RETURNING id, created_at
    `
	return r.DB.QueryRow(
		query,
		msg.SenderID,
		msg.RecipientID,
		msg.RoomID,
		content,
		msg.Media, // Inject the media attachment URL
		msg.Status,
	).Scan(&msg.ID, &msg.CreatedAt)
}

func (r *ChatRepository) GetRoomMessages(roomID string, limit int) ([]models.Message, error) {
	// Added LEFT JOIN to user_profiles to grab SenderName and AvatarURL
	// Added COALESCE for the new media field
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
       FROM messages m
       LEFT JOIN user_profiles up ON m.sender_id = up.user_id
       WHERE m.room_id = $1
       ORDER BY m.created_at ASC
       LIMIT $2
    `
	rows, err := r.DB.Query(query, roomID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []models.Message
	for rows.Next() {
		var msg models.Message
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
		); err != nil {
			return nil, err
		}
		messages = append(messages, msg)
	}

	if messages == nil {
		messages = []models.Message{}
	}

	return messages, nil
}

func (r *ChatRepository) GetDirectMessages(userID string, partnerID string, limit int) ([]models.Message, error) {
	// Added LEFT JOIN to user_profiles to grab SenderName and AvatarURL
	// Added COALESCE for the new media field
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
       FROM messages m
       LEFT JOIN user_profiles up ON m.sender_id = up.user_id
       WHERE (m.sender_id = $1 AND m.recipient_id = $2) 
          OR (m.sender_id = $2 AND m.recipient_id = $1)
       ORDER BY m.created_at ASC
       LIMIT $3
    `
	rows, err := r.DB.Query(query, userID, partnerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []models.Message
	for rows.Next() {
		var msg models.Message
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
		); err != nil {
			return nil, err
		}
		messages = append(messages, msg)
	}

	if messages == nil {
		messages = []models.Message{}
	}
	return messages, nil
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
        )
        SELECT 
            rm.partner_id as room_id, -- Using partner_id as room_id for DMs
            rm.partner_id,
            COALESCE(up.display_name, 'Unknown'),
            COALESCE(up.avatar_url, ''),
            rm.last_message,
            rm.last_message_time,
            COALESCE(uc.unread_count, 0) as unread_count,
            COALESCE(u.status, 'offline')
        FROM recent_messages rm
        JOIN users u ON u.id = rm.partner_id
        LEFT JOIN user_profiles up ON up.user_id = rm.partner_id
        LEFT JOIN unread_counts uc ON uc.partner_id = rm.partner_id
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
			&item.RoomID, &item.PartnerID, &item.PartnerName, &item.AvatarURL,
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
