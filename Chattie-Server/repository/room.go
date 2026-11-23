package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"chattie-backend/models"
)

var (
	ErrVoiceLimitReached       = errors.New("daily voice limit reached: upgrade to premium")
	ErrRoomLimitReached        = errors.New("room creation limit reached: upgrade to premium")
	ErrUnauthorized            = errors.New("unauthorized action")
	ErrInvalidRoomCode         = errors.New("invalid or expired room code")
	ErrRoomNotFound            = errors.New("room not found")
	ErrRoomPrivate             = errors.New("this room requires approval")
	ErrRoomBanned              = errors.New("you are banned from this room")
	ErrRoomAgeRestricted       = errors.New("this room is for adults only")
	ErrRoomMuted               = errors.New("you are muted in this room")
	ErrRoomReadOnly            = errors.New("only room moderators can post")
	ErrRoomMediaDisabled       = errors.New("media is disabled in this room")
	ErrRoomLinksDisabled       = errors.New("links are disabled in this room")
	ErrRoomSlowMode            = errors.New("slow mode is enabled; wait before posting again")
	ErrInvalidRoomSettings     = errors.New("invalid room settings")
	ErrRoomCreatorRequired     = errors.New("room creator must transfer ownership before leaving")
	ErrVoiceSessionUnavailable = errors.New("voice is unavailable or already active")
	ErrVoiceSessionNotActive   = errors.New("there is no active voice session")
)

type RoomRepository struct {
	DB *sql.DB
}

func NewRoomRepository(db *sql.DB) *RoomRepository {
	return &RoomRepository{DB: db}
}

// Helper to generate a random 6-character room code (removed confusing chars like 1, I, 0, O)
func generateRoomCode() string {
	chars := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	var sb strings.Builder
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	for i := 0; i < 6; i++ {
		sb.WriteByte(chars[rng.Intn(len(chars))])
	}
	return sb.String()
}

// =====================================================================
// 1. CREATE ROOM (With Subscription / Trial Limits & Room Codes)
// =====================================================================

func (r *RoomRepository) CreateRoom(ctx context.Context, room *models.Room, userID string) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Check the user's tier limit.
	var maxRooms int
	limitQuery := `
       SELECT t.max_rooms_created
       FROM user_subscriptions s
       JOIN subscription_tiers t ON s.tier_id = t.id
       WHERE s.user_id = $1 AND s.status = 'active'
    `
	err = tx.QueryRowContext(ctx, limitQuery, userID).Scan(&maxRooms)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if err == sql.ErrNoRows {
		maxRooms = 0
	}

	if maxRooms != -1 {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO user_daily_usage (user_id, usage_date, rooms_created_used)
			VALUES ($1, CURRENT_DATE, 0)
			ON CONFLICT (user_id, usage_date) DO NOTHING
		`, userID); err != nil {
			return err
		}

		var roomsUsed int
		if err := tx.QueryRowContext(ctx, `
			SELECT COALESCE(rooms_created_used, 0)
			FROM user_daily_usage
			WHERE user_id = $1 AND usage_date = CURRENT_DATE
			FOR UPDATE
		`, userID).Scan(&roomsUsed); err != nil {
			return err
		}

		// -1 means unlimited
		if roomsUsed >= maxRooms {
			return ErrRoomLimitReached
		}
	}

	// 2. Generate unique room code
	roomCode := generateRoomCode()
	tagsJSON, err := json.Marshal(room.Tags)
	if err != nil {
		return err
	}
	if room.ContentMode == "" {
		room.ContentMode = "general"
	}
	room.ContentMode = strings.ToLower(strings.TrimSpace(room.ContentMode))
	if room.ContentMode != "general" && room.ContentMode != "mature" {
		return ErrInvalidRoomSettings
	}
	if room.SlowModeSeconds < 0 || room.SlowModeSeconds > 300 {
		return ErrInvalidRoomSettings
	}
	if room.ContentMode == "mature" {
		var isAdult bool
		if err := tx.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM user_profiles
				WHERE user_id = $1 AND date_of_birth <= CURRENT_DATE - INTERVAL '18 years'
			)
		`, userID).Scan(&isAdult); err != nil {
			return err
		}
		if !isAdult {
			return ErrRoomAgeRestricted
		}
	}

	// 3. Insert the room
	query := `
       INSERT INTO rooms (
          name, icon, category, description, tags, is_private, room_code, created_by,
          is_voice_room, rules, content_mode, allow_media, allow_links, slow_mode_seconds, is_read_only
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, room_code, active_count, created_at
    `
	err = tx.QueryRowContext(ctx, query,
		strings.TrimSpace(room.Name), room.Icon, room.Category, strings.TrimSpace(room.Description),
		string(tagsJSON), room.IsPrivate, roomCode, userID, room.IsVoiceRoom, room.Rules, room.ContentMode,
		room.AllowMedia, room.AllowLinks, room.SlowModeSeconds, room.IsReadOnly,
	).Scan(&room.ID, &room.RoomCode, &room.ActiveCount, &room.CreatedAt)

	if err != nil {
		return err
	}

	// 4. Automatically add the creator to room_members as 'creator'
	_, err = tx.ExecContext(ctx, `
       INSERT INTO room_members (room_id, user_id, role, joined_at, last_active)
       VALUES ($1, $2, 'creator', NOW(), NOW())
       ON CONFLICT (room_id, user_id) DO UPDATE SET role = 'creator'
    `, room.ID, userID)
	if err != nil {
		return err
	}

	// 5. Update daily usage counter
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO user_daily_usage (user_id, usage_date, rooms_created_used)
		VALUES ($1, CURRENT_DATE, 1)
		ON CONFLICT (user_id, usage_date) DO UPDATE
		SET rooms_created_used = COALESCE(user_daily_usage.rooms_created_used, 0) + 1
	`, userID); err != nil {
		return err
	}

	return tx.Commit()
}

// =====================================================================
// UPDATE ROOM DETAILS
// =====================================================================

func (r *RoomRepository) UpdateRoom(ctx context.Context, roomID, userID string, update models.RoomUpdate) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var role string
	err := r.DB.QueryRowContext(ctx, `SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, roomID, userID).Scan(&role)
	if err != nil || (role != "creator" && role != "admin") {
		return ErrUnauthorized
	}

	description := update.Description
	if description == nil {
		description = update.Desc
	}
	var name, desc, category, icon, rules, contentMode interface{}
	var tags interface{}
	var isPrivate, isVoiceRoom, allowMedia, allowLinks, isReadOnly interface{}
	var slowMode interface{}
	if update.Name != nil {
		value := strings.TrimSpace(*update.Name)
		name = value
	}
	if description != nil {
		desc = strings.TrimSpace(*description)
	}
	if update.Category != nil {
		category = strings.TrimSpace(*update.Category)
	}
	if update.Icon != nil {
		icon = strings.TrimSpace(*update.Icon)
	}
	if update.Tags != nil {
		encoded, err := json.Marshal(*update.Tags)
		if err != nil {
			return err
		}
		tags = string(encoded)
	}
	if update.IsPrivate != nil {
		isPrivate = *update.IsPrivate
	}
	if update.IsVoiceRoom != nil {
		isVoiceRoom = *update.IsVoiceRoom
	}
	if update.Rules != nil {
		rules = strings.TrimSpace(*update.Rules)
	}
	if update.ContentMode != nil {
		mode := strings.ToLower(strings.TrimSpace(*update.ContentMode))
		if mode != "general" && mode != "mature" {
			return ErrInvalidRoomSettings
		}
		if mode == "mature" {
			var underageMembers int
			if err := r.DB.QueryRowContext(ctx, `
				SELECT COUNT(*)
				FROM room_members rm
				LEFT JOIN user_profiles p ON p.user_id = rm.user_id
				WHERE rm.room_id = $1
				  AND (p.date_of_birth IS NULL OR p.date_of_birth > CURRENT_DATE - INTERVAL '18 years')
			`, roomID).Scan(&underageMembers); err != nil {
				return err
			}
			if underageMembers > 0 {
				return ErrRoomAgeRestricted
			}
		}
		contentMode = mode
	}
	if update.AllowMedia != nil {
		allowMedia = *update.AllowMedia
	}
	if update.AllowLinks != nil {
		allowLinks = *update.AllowLinks
	}
	if update.SlowModeSeconds != nil {
		if *update.SlowModeSeconds < 0 || *update.SlowModeSeconds > 300 {
			return ErrInvalidRoomSettings
		}
		slowMode = *update.SlowModeSeconds
	}
	if update.IsReadOnly != nil {
		isReadOnly = *update.IsReadOnly
	}

	_, err = r.DB.ExecContext(ctx, `
		UPDATE rooms
		SET name = COALESCE($1, name),
		    description = COALESCE($2, description),
		    category = COALESCE($3, category),
		    icon = COALESCE($4, icon),
		    tags = COALESCE($5::jsonb, tags),
		    is_private = COALESCE($6, is_private),
		    is_voice_room = COALESCE($7, is_voice_room),
		    rules = COALESCE($8, rules),
		    content_mode = COALESCE($9, content_mode),
		    allow_media = COALESCE($10, allow_media),
		    allow_links = COALESCE($11, allow_links),
		    slow_mode_seconds = COALESCE($12, slow_mode_seconds),
		    is_read_only = COALESCE($13, is_read_only),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $14
	`, name, desc, category, icon, tags, isPrivate, isVoiceRoom, rules, contentMode,
		allowMedia, allowLinks, slowMode, isReadOnly, roomID)
	return err
}

// =====================================================================
// 2. CHECK VOICE ELIGIBILITY (For VIP Tickets)
// =====================================================================

func (r *RoomRepository) CheckAndConsumeVoiceTrial(ctx context.Context, userID string) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var maxVoice, voiceUsed int
	limitQuery := `
       SELECT 
          t.max_daily_voice_joins,
          COALESCE(u.voice_joins_used, 0)
       FROM user_subscriptions s
       JOIN subscription_tiers t ON s.tier_id = t.id
       LEFT JOIN user_daily_usage u ON s.user_id = u.user_id AND u.usage_date = CURRENT_DATE
       WHERE s.user_id = $1 AND s.status = 'active'
    `
	err = tx.QueryRowContext(ctx, limitQuery, userID).Scan(&maxVoice, &voiceUsed)

	if err == sql.ErrNoRows {
		maxVoice = 1
		voiceUsed = 0
	} else if err != nil {
		return err
	}

	if maxVoice != -1 && voiceUsed >= maxVoice {
		return ErrVoiceLimitReached
	}

	usageQuery := `
       INSERT INTO user_daily_usage (user_id, usage_date, voice_joins_used)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (user_id, usage_date) DO UPDATE 
       SET voice_joins_used = user_daily_usage.voice_joins_used + 1
    `
	if _, err = tx.ExecContext(ctx, usageQuery, userID); err != nil {
		return err
	}

	return tx.Commit()
}

// =====================================================================
// 3. GET ALL ROOMS (With Pagination, Search & Category Filters)
// =====================================================================

func (r *RoomRepository) GetAllRooms(ctx context.Context, limit int, offset int, search string, category string) ([]models.Room, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	query := `
       SELECT r.id, r.name, COALESCE(r.icon, ''), COALESCE(r.category, ''),
              COALESCE(r.description, ''), COALESCE(r.tags, '[]'::jsonb), r.is_private,
              r.created_by, COUNT(rm.user_id)::INT, r.created_at,
              r.is_voice_room, r.rules, r.content_mode, r.allow_media, r.allow_links,
              r.slow_mode_seconds, r.is_read_only, r.updated_at
       FROM rooms r
       LEFT JOIN room_members rm ON rm.room_id = r.id
       WHERE r.is_private = FALSE AND r.status = 'ACTIVE'
    `
	var args []interface{}
	paramIdx := 1

	if search != "" {
		query += fmt.Sprintf(` AND (r.name ILIKE $%d OR r.description ILIKE $%d OR r.tags::text ILIKE $%d)`, paramIdx, paramIdx, paramIdx)
		args = append(args, "%"+search+"%")
		paramIdx++
	}
	if category != "" {
		query += fmt.Sprintf(` AND r.category = $%d`, paramIdx)
		args = append(args, category)
		paramIdx++
	}

	query += fmt.Sprintf(` GROUP BY r.id ORDER BY COUNT(rm.user_id) DESC, r.created_at DESC, r.id LIMIT $%d OFFSET $%d`, paramIdx, paramIdx+1)
	args = append(args, limit, offset)

	rows, err := r.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rooms []models.Room
	for rows.Next() {
		var room models.Room
		var tagsJSON []byte
		var createdBy sql.NullString

		if err := rows.Scan(
			&room.ID, &room.Name, &room.Icon, &room.Category,
			&room.Description, &tagsJSON, &room.IsPrivate,
			&createdBy, &room.MemberCount, &room.CreatedAt, &room.IsVoiceRoom, &room.Rules,
			&room.ContentMode, &room.AllowMedia, &room.AllowLinks, &room.SlowModeSeconds,
			&room.IsReadOnly, &room.UpdatedAt,
		); err != nil {
			return nil, err
		}

		if err := json.Unmarshal(tagsJSON, &room.Tags); err != nil {
			return nil, err
		}
		room.ActiveCount = room.MemberCount
		if createdBy.Valid {
			room.CreatedBy = createdBy.String
		}

		rooms = append(rooms, room)
	}

	if rooms == nil {
		rooms = []models.Room{}
	}

	return rooms, nil
}

func (r *RoomRepository) GetMyRooms(ctx context.Context, userID string) ([]models.Room, error) {
	query := `
		SELECT r.id, r.name, COALESCE(r.icon, ''), COALESCE(r.category, ''),
		       COALESCE(r.description, ''), COALESCE(r.tags, '[]'::jsonb), r.is_private,
		       CASE WHEN rm.role IN ('creator', 'admin') THEN r.room_code END,
		       r.created_by, r.active_count, r.created_at, r.is_voice_room,
		       r.rules, r.content_mode, r.allow_media, r.allow_links, r.slow_mode_seconds,
		       r.is_read_only, r.updated_at, rm.role
		FROM room_members rm
		JOIN rooms r ON r.id = rm.room_id
		WHERE rm.user_id = $1 AND r.status = 'ACTIVE'
		ORDER BY rm.last_active DESC NULLS LAST, r.updated_at DESC, r.id
	`
	rows, err := r.DB.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rooms := make([]models.Room, 0)
	for rows.Next() {
		var room models.Room
		var tagsJSON []byte
		var createdBy sql.NullString
		if err := rows.Scan(
			&room.ID, &room.Name, &room.Icon, &room.Category, &room.Description, &tagsJSON,
			&room.IsPrivate, &room.RoomCode, &createdBy, &room.ActiveCount, &room.CreatedAt,
			&room.IsVoiceRoom, &room.Rules, &room.ContentMode, &room.AllowMedia, &room.AllowLinks,
			&room.SlowModeSeconds, &room.IsReadOnly, &room.UpdatedAt, &room.UserRole,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(tagsJSON, &room.Tags); err != nil {
			return nil, err
		}
		if createdBy.Valid {
			room.CreatedBy = createdBy.String
		}
		rooms = append(rooms, room)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return rooms, nil
}

// =====================================================================
// 4. JOIN ROOM BY CODE OR LINK (With Banning & Private Access Validation)
// =====================================================================

func (r *RoomRepository) JoinRoomByCode(ctx context.Context, userID, roomCode string) (*models.Room, error) {
	var roomID string
	if err := r.DB.QueryRowContext(ctx, `SELECT id FROM rooms WHERE room_code = $1`, strings.ToUpper(strings.TrimSpace(roomCode))).Scan(&roomID); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrInvalidRoomCode
		}
		return nil, err
	}
	return r.JoinRoom(ctx, userID, roomID)
}

func (r *RoomRepository) JoinRoom(ctx context.Context, userID, roomID string) (*models.Room, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var room models.Room
	var tagsJSON []byte
	var createdBy sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT id, name, COALESCE(icon, ''), COALESCE(category, ''),
		       COALESCE(description, ''), COALESCE(tags, '[]'::jsonb), is_private,
		       created_by, active_count, created_at, is_voice_room, rules, content_mode,
		       allow_media, allow_links, slow_mode_seconds, is_read_only, updated_at
		FROM rooms WHERE id = $1 AND status = 'ACTIVE'
	`, roomID).Scan(
		&room.ID, &room.Name, &room.Icon, &room.Category, &room.Description, &tagsJSON,
		&room.IsPrivate, &createdBy, &room.ActiveCount, &room.CreatedAt, &room.IsVoiceRoom,
		&room.Rules, &room.ContentMode, &room.AllowMedia, &room.AllowLinks,
		&room.SlowModeSeconds, &room.IsReadOnly, &room.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrRoomNotFound
		}
		return nil, err
	}
	if err := json.Unmarshal(tagsJSON, &room.Tags); err != nil {
		return nil, err
	}
	if createdBy.Valid {
		room.CreatedBy = createdBy.String
	}

	var banned bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM room_bans WHERE room_id = $1 AND user_id = $2)`, room.ID, userID).Scan(&banned); err != nil {
		return nil, err
	}
	if banned {
		return nil, ErrRoomBanned
	}
	if room.ContentMode == "mature" {
		var isAdult bool
		if err := tx.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM user_profiles
				WHERE user_id = $1 AND date_of_birth <= CURRENT_DATE - INTERVAL '18 years'
			)
		`, userID).Scan(&isAdult); err != nil {
			return nil, err
		}
		if !isAdult {
			return nil, ErrRoomAgeRestricted
		}
	}
	if room.IsPrivate {
		var approved bool
		if err := tx.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM room_join_requests
				WHERE room_id = $1 AND user_id = $2 AND status = 'APPROVED'
			)
			OR EXISTS (
				SELECT 1 FROM room_members
				WHERE room_id = $1 AND user_id = $2
			)
		`, room.ID, userID).Scan(&approved); err != nil {
			return nil, err
		}
		if !approved {
			return nil, ErrRoomPrivate
		}
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO room_members (room_id, user_id, role, joined_at, last_active)
		VALUES ($1, $2, 'member', NOW(), NOW())
		ON CONFLICT (room_id, user_id) DO UPDATE SET last_active = NOW()
	`, room.ID, userID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &room, nil
}

// =====================================================================
// LEAVE ROOM
// =====================================================================
func (r *RoomRepository) LeaveRoom(ctx context.Context, roomID string, userID string) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	var role string
	if err := r.DB.QueryRowContext(ctx, `
		SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2
	`, roomID, userID).Scan(&role); err != nil {
		if err == sql.ErrNoRows {
			return ErrUnauthorized
		}
		return err
	}
	if role == "creator" {
		return ErrRoomCreatorRequired
	}

	res, err := r.DB.ExecContext(ctx, `DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`, roomID, userID)
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return errors.New("you are not a member of this room")
	}
	return nil
}

func (r *RoomRepository) IsRoomMember(ctx context.Context, roomID, userID string) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	var exists bool
	err := r.DB.QueryRowContext(ctx, `
       SELECT EXISTS(
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
    `, roomID, userID).Scan(&exists)
	return exists, err
}

func (r *RoomRepository) ValidateRoomMessage(ctx context.Context, roomID, userID, content, media string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	var status, contentMode, role string
	var allowMedia, allowLinks, isReadOnly, isMuted bool
	var slowMode int
	err = tx.QueryRowContext(ctx, `
		SELECT r.status, r.content_mode, r.allow_media, r.allow_links,
		       r.is_read_only, r.slow_mode_seconds, rm.role, COALESCE(rm.is_muted, FALSE)
		FROM rooms r
		JOIN room_members rm ON rm.room_id = r.id
		WHERE r.id = $1 AND rm.user_id = $2
		FOR UPDATE OF rm
	`, roomID, userID).Scan(&status, &contentMode, &allowMedia, &allowLinks, &isReadOnly, &slowMode, &role, &isMuted)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", ErrUnauthorized
		}
		return "", err
	}
	if status != "ACTIVE" {
		return "", ErrRoomNotFound
	}
	var banned bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM room_bans WHERE room_id = $1 AND user_id = $2)`, roomID, userID).Scan(&banned); err != nil {
		return "", err
	}
	if banned {
		return "", ErrRoomBanned
	}
	moderator := role == "creator" || role == "admin" || role == "moderator"
	if isMuted && !moderator {
		return "", ErrRoomMuted
	}
	if isReadOnly && !moderator {
		return "", ErrRoomReadOnly
	}
	if media != "" && !allowMedia {
		return "", ErrRoomMediaDisabled
	}
	lowerContent := strings.ToLower(content)
	if !allowLinks && (strings.Contains(lowerContent, "http://") || strings.Contains(lowerContent, "https://") || strings.Contains(lowerContent, "www.")) {
		return "", ErrRoomLinksDisabled
	}

	var isAdult bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM user_profiles
			WHERE user_id = $1 AND date_of_birth <= CURRENT_DATE - INTERVAL '18 years'
		)
	`, userID).Scan(&isAdult); err != nil {
		return "", err
	}
	if contentMode == "mature" && !isAdult {
		return "", ErrRoomAgeRestricted
	}

	var updated time.Time
	err = tx.QueryRowContext(ctx, `
		UPDATE room_members
		SET last_message_at = CURRENT_TIMESTAMP, last_active = CURRENT_TIMESTAMP
		WHERE room_id = $1 AND user_id = $2
		  AND (
		    $3 = 0 OR $4 = TRUE OR last_message_at IS NULL
		    OR last_message_at <= CURRENT_TIMESTAMP - ($3 * INTERVAL '1 second')
		  )
		RETURNING last_message_at
	`, roomID, userID, slowMode, moderator).Scan(&updated)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", ErrRoomSlowMode
		}
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return contentMode, nil
}

// =====================================================================
// 5. ROOM ADMIN & MANAGEMENT DETAILS
// =====================================================================

func (r *RoomRepository) GetRoomDetails(ctx context.Context, roomID, userID string) (*models.RoomDetails, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	query := `
       SELECT r.id, r.name, COALESCE(r.icon, ''), COALESCE(r.category, ''),
              COALESCE(r.description, ''), COALESCE(r.tags, '[]'::jsonb), r.is_private,
              CASE WHEN rm.role IN ('creator', 'admin') THEN r.room_code END,
              r.created_by, r.active_count, r.created_at,
              r.is_voice_room, r.rules, r.content_mode, r.allow_media, r.allow_links,
              r.slow_mode_seconds, r.is_read_only, r.updated_at, rm.role,
              (rm.user_id IS NOT NULL),
              EXISTS (
                  SELECT 1 FROM room_join_requests jr
                  WHERE jr.room_id = r.id AND jr.user_id = $2 AND jr.status = 'PENDING'
              ),
              CASE WHEN rm.role IN ('creator', 'admin')
                   THEN (SELECT COUNT(*) FROM room_join_requests WHERE room_id = r.id AND status = 'PENDING')
                   ELSE 0 END
       FROM rooms r
       LEFT JOIN room_members rm ON r.id = rm.room_id AND rm.user_id = $2
       WHERE r.id = $1 AND r.status = 'ACTIVE'
    `
	var details models.RoomDetails
	var tagsJSON []byte
	var createdBy, roomCode, userRole sql.NullString

	err := r.DB.QueryRowContext(ctx, query, roomID, userID).Scan(
		&details.ID, &details.Name, &details.Icon, &details.Category, &details.Description,
		&tagsJSON, &details.IsPrivate, &roomCode, &createdBy, &details.ActiveCount,
		&details.CreatedAt, &details.IsVoiceRoom, &details.Rules, &details.ContentMode,
		&details.AllowMedia, &details.AllowLinks, &details.SlowModeSeconds,
		&details.IsReadOnly, &details.UpdatedAt, &userRole, &details.IsMember,
		&details.HasPendingRequest, &details.PendingCount,
	)
	if err != nil {
		return nil, err
	}

	if err := json.Unmarshal(tagsJSON, &details.Tags); err != nil {
		return nil, err
	}
	if createdBy.Valid {
		details.CreatedBy = createdBy.String
	}
	if userRole.Valid {
		details.UserRole = userRole.String
	}
	if roomCode.Valid && details.UserRole != "" {
		details.RoomCode = roomCode.String
	}
	if details.RoomCode != "" && (details.UserRole == "creator" || details.UserRole == "admin") {
		details.InviteLink = fmt.Sprintf("/rooms/%s?invite=%s", details.ID, details.RoomCode)
	}

	return &details, nil
}

func (r *RoomRepository) GetRoomVoiceSession(ctx context.Context, roomID string) (*models.RoomVoiceSession, error) {
	session := &models.RoomVoiceSession{}
	var startedAt sql.NullTime
	err := r.DB.QueryRowContext(ctx, `
		SELECT COALESCE(started_by::text, ''), started_at
		FROM room_voice_sessions
		WHERE room_id = $1 AND active = TRUE
	`, roomID).Scan(&session.StartedBy, &startedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return session, nil
		}
		return nil, err
	}
	session.Active = true
	if startedAt.Valid {
		session.StartedAt = &startedAt.Time
	}
	return session, nil
}

func (r *RoomRepository) StartRoomVoiceSession(ctx context.Context, roomID, userID string) (*models.RoomVoiceSession, error) {
	session := &models.RoomVoiceSession{}
	err := r.DB.QueryRowContext(ctx, `
		INSERT INTO room_voice_sessions (room_id, started_by, active, started_at, ended_at)
		SELECT r.id, $2, TRUE, CURRENT_TIMESTAMP, NULL
		FROM rooms r
		WHERE r.id = $1 AND r.status = 'ACTIVE' AND r.is_voice_room = TRUE
		  AND EXISTS (
		    SELECT 1 FROM room_members rm
		    WHERE rm.room_id = r.id AND rm.user_id = $2 AND rm.role IN ('creator', 'admin')
		  )
		ON CONFLICT (room_id) DO UPDATE
		SET started_by = EXCLUDED.started_by,
		    active = TRUE,
		    started_at = CURRENT_TIMESTAMP,
		    ended_at = NULL
		WHERE room_voice_sessions.active = FALSE
		RETURNING started_by::text, started_at
	`, roomID, userID).Scan(&session.StartedBy, &session.StartedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrVoiceSessionUnavailable
		}
		return nil, err
	}
	session.Active = true
	return session, nil
}

func (r *RoomRepository) EndRoomVoiceSession(ctx context.Context, roomID, userID string) error {
	result, err := r.DB.ExecContext(ctx, `
		UPDATE room_voice_sessions vs
		SET active = FALSE, ended_at = CURRENT_TIMESTAMP
		WHERE vs.room_id = $1 AND vs.active = TRUE
		  AND EXISTS (
		    SELECT 1 FROM room_members rm
		    WHERE rm.room_id = vs.room_id AND rm.user_id = $2 AND rm.role IN ('creator', 'admin')
		  )
	`, roomID, userID)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return ErrVoiceSessionNotActive
	}
	return nil
}

func (r *RoomRepository) GetRoomMemberRole(ctx context.Context, roomID, userID string) (string, error) {
	var role string
	err := r.DB.QueryRowContext(ctx, `
		SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2
	`, roomID, userID).Scan(&role)
	return role, err
}

func (r *RoomRepository) RequestJoinPrivateRoom(ctx context.Context, userID, roomCode string) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var roomID string
	if err := r.DB.QueryRowContext(ctx, `SELECT id FROM rooms WHERE room_code = $1 AND is_private = TRUE AND status = 'ACTIVE'`, strings.ToUpper(strings.TrimSpace(roomCode))).Scan(&roomID); err != nil {
		return ErrRoomNotFound
	}
	return r.RequestJoinPrivateRoomByID(ctx, userID, roomID)
}

func (r *RoomRepository) RequestJoinPrivateRoomByID(ctx context.Context, userID, roomID string) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var isPrivate bool
	var contentMode string
	if err := r.DB.QueryRowContext(ctx, `SELECT is_private, content_mode FROM rooms WHERE id = $1 AND status = 'ACTIVE'`, roomID).Scan(&isPrivate, &contentMode); err != nil {
		if err == sql.ErrNoRows {
			return ErrRoomNotFound
		}
		return err
	}
	if !isPrivate {
		return errors.New("room is public")
	}
	if contentMode == "mature" {
		var isAdult bool
		if err := r.DB.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM user_profiles
				WHERE user_id = $1 AND date_of_birth <= CURRENT_DATE - INTERVAL '18 years'
			)
		`, userID).Scan(&isAdult); err != nil {
			return err
		}
		if !isAdult {
			return ErrRoomAgeRestricted
		}
	}
	var banned bool
	if err := r.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM room_bans WHERE room_id = $1 AND user_id = $2)`, roomID, userID).Scan(&banned); err != nil {
		return err
	}
	if banned {
		return ErrRoomBanned
	}

	_, err := r.DB.ExecContext(ctx, `
		INSERT INTO room_join_requests (room_id, user_id, status, created_at)
		VALUES ($1, $2, 'PENDING', CURRENT_TIMESTAMP)
		ON CONFLICT (room_id, user_id) DO UPDATE
		SET status = 'PENDING', created_at = CURRENT_TIMESTAMP
	`, roomID, userID)
	return err
}

func (r *RoomRepository) HandleJoinRequest(ctx context.Context, adminID, roomID, targetUserID string, approve bool) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var actorRole string
	err := r.DB.QueryRowContext(ctx, `SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, roomID, adminID).Scan(&actorRole)
	if err != nil || (actorRole != "creator" && actorRole != "admin" && actorRole != "moderator") || targetUserID == adminID {
		return ErrUnauthorized
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	status := "REJECTED"
	if approve {
		status = "APPROVED"
	}

	result, err := tx.ExecContext(ctx, `UPDATE room_join_requests SET status = $1 WHERE room_id = $2 AND user_id = $3 AND status = 'PENDING'`, status, roomID, targetUserID)
	if err != nil {
		return err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if updated == 0 {
		return ErrRoomNotFound
	}

	if approve {
		var contentMode string
		if err := tx.QueryRowContext(ctx, `SELECT content_mode FROM rooms WHERE id = $1 AND status = 'ACTIVE'`, roomID).Scan(&contentMode); err != nil {
			if err == sql.ErrNoRows {
				return ErrRoomNotFound
			}
			return err
		}
		if contentMode == "mature" {
			var isAdult bool
			if err := tx.QueryRowContext(ctx, `
				SELECT EXISTS (
					SELECT 1 FROM user_profiles
					WHERE user_id = $1 AND date_of_birth <= CURRENT_DATE - INTERVAL '18 years'
				)
			`, targetUserID).Scan(&isAdult); err != nil {
				return err
			}
			if !isAdult {
				return ErrRoomAgeRestricted
			}
		}
		var banned bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM room_bans WHERE room_id = $1 AND user_id = $2)`, roomID, targetUserID).Scan(&banned); err != nil {
			return err
		}
		if banned {
			return ErrRoomBanned
		}
		_, err = tx.ExecContext(ctx, `
          INSERT INTO room_members (room_id, user_id, role, joined_at) 
          VALUES ($1, $2, 'member', NOW()) 
          ON CONFLICT (room_id, user_id) DO NOTHING
       `, roomID, targetUserID)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (r *RoomRepository) KickOrBanUser(ctx context.Context, adminID, roomID, targetUserID string, ban bool) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var actorRole string
	err := r.DB.QueryRowContext(ctx, `SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, roomID, adminID).Scan(&actorRole)
	if err != nil || (actorRole != "creator" && actorRole != "admin" && actorRole != "moderator") || targetUserID == adminID {
		return ErrUnauthorized
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var targetRole string
	if err := tx.QueryRowContext(ctx, `
		SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2
	`, roomID, targetUserID).Scan(&targetRole); err != nil {
		if err == sql.ErrNoRows {
			return ErrRoomNotFound
		}
		return err
	}
	if targetRole == "creator" || (targetRole == "admin" && actorRole != "creator") ||
		(targetRole == "moderator" && actorRole == "moderator") {
		return ErrUnauthorized
	}

	// 1. Eject from room
	_, err = tx.ExecContext(ctx, `DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`, roomID, targetUserID)
	if err != nil {
		return err
	}

	// 2. Insert into Ban table if ban is true
	if ban {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO room_bans (room_id, user_id, banned_by, banned_at) 
			VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING
		`, roomID, targetUserID, adminID)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

// =====================================================================
// 7. GET ROOM PARTICIPANTS (With Match % Calculator)
// =====================================================================

func (r *RoomRepository) GetRoomParticipants(ctx context.Context, roomID string, currentUserID string) ([]models.RoomParticipant, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	query := `
       WITH current_user_tags AS (
          SELECT COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = $2), ARRAY[]::VARCHAR[]) AS my_tags
       )
       SELECT DISTINCT 
          u.id, 
          COALESCE(up.display_name, u.username) AS name, 
          COALESCE((SELECT url FROM user_media WHERE user_id = u.id ORDER BY is_primary DESC, created_at ASC LIMIT 1), '') AS avatar, 
          COALESCE(u.status, 'offline') AS status,
          COALESCE(rm.role, 'member') AS role,
          COALESCE(rm.is_muted, FALSE) AS is_muted,
          ` + tagCompatibilityScoreSQL("cu.my_tags", "COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[])") + ` AS match_pct

       FROM room_members rm
       JOIN users u ON rm.user_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       CROSS JOIN current_user_tags cu
       WHERE rm.room_id = $1
       LIMIT 50
    `
	rows, err := r.DB.QueryContext(ctx, query, roomID, currentUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var participants []models.RoomParticipant
	for rows.Next() {
		var p models.RoomParticipant
		if err := rows.Scan(&p.ID, &p.Name, &p.Avatar, &p.Status, &p.Role, &p.IsMuted, &p.MatchPct); err != nil {
			return nil, err
		}
		participants = append(participants, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if participants == nil {
		participants = []models.RoomParticipant{}
	}

	return participants, nil
}

func (r *RoomRepository) GetPendingJoinRequests(ctx context.Context, roomID, adminID string) ([]models.RoomJoinRequest, error) {
	var role string
	if err := r.DB.QueryRowContext(ctx, `
		SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2
	`, roomID, adminID).Scan(&role); err != nil || (role != "creator" && role != "admin") {
		return nil, ErrUnauthorized
	}

	rows, err := r.DB.QueryContext(ctx, `
		SELECT jr.id, jr.room_id::text, jr.user_id::text, jr.status, jr.created_at,
		       COALESCE(up.display_name, u.username), COALESCE(up.avatar_url, '')
		FROM room_join_requests jr
		JOIN users u ON u.id = jr.user_id
		LEFT JOIN user_profiles up ON up.user_id = u.id
		WHERE jr.room_id = $1 AND jr.status = 'PENDING'
		ORDER BY jr.created_at ASC, jr.id
		LIMIT 100
	`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	requests := make([]models.RoomJoinRequest, 0)
	for rows.Next() {
		var request models.RoomJoinRequest
		if err := rows.Scan(
			&request.ID, &request.RoomID, &request.UserID, &request.Status,
			&request.CreatedAt, &request.UserName, &request.Avatar,
		); err != nil {
			return nil, err
		}
		requests = append(requests, request)
	}
	return requests, rows.Err()
}

func (r *RoomRepository) SetRoomMemberRole(ctx context.Context, roomID, actorID, targetID, role string) error {
	if role != "admin" && role != "moderator" && role != "member" {
		return errors.New("role must be admin, moderator, or member")
	}
	var actorRole string
	if err := r.DB.QueryRowContext(ctx, `
		SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2
	`, roomID, actorID).Scan(&actorRole); err != nil || actorRole != "creator" {
		return ErrUnauthorized
	}
	result, err := r.DB.ExecContext(ctx, `
		UPDATE room_members
		SET role = $1
		WHERE room_id = $2 AND user_id = $3 AND role <> 'creator' AND user_id <> $4
	`, role, roomID, targetID, actorID)
	if err != nil {
		return err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if updated == 0 {
		return ErrRoomNotFound
	}
	return nil
}

func (r *RoomRepository) SetRoomMemberMuted(ctx context.Context, roomID, actorID, targetID string, muted bool) error {
	var actorRole string
	if err := r.DB.QueryRowContext(ctx, `
		SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2
	`, roomID, actorID).Scan(&actorRole); err != nil || (actorRole != "creator" && actorRole != "admin" && actorRole != "moderator") {
		return ErrUnauthorized
	}
	result, err := r.DB.ExecContext(ctx, `
		UPDATE room_members
		SET is_muted = $1
		WHERE room_id = $2 AND user_id = $3 AND role NOT IN ('creator', 'admin', 'moderator')
	`, muted, roomID, targetID)
	if err != nil {
		return err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if updated == 0 {
		return ErrRoomNotFound
	}
	return nil
}

func (r *RoomRepository) PinRoomMessage(ctx context.Context, roomID, actorID, messageID string, pinned bool) error {
	var role string
	if err := r.DB.QueryRowContext(ctx, `
		SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2
	`, roomID, actorID).Scan(&role); err != nil || (role != "creator" && role != "admin" && role != "moderator") {
		return ErrUnauthorized
	}
	result, err := r.DB.ExecContext(ctx, `
		UPDATE messages
		SET is_pinned = $1,
		    pinned_by = CASE WHEN $1 THEN $2::uuid ELSE NULL END,
		    pinned_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END
		WHERE id = $3 AND room_id = $4
	`, pinned, actorID, messageID, roomID)
	if err != nil {
		return err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if updated == 0 {
		return ErrRoomNotFound
	}
	return nil
}

func (r *RoomRepository) ToggleRoomMessageReaction(ctx context.Context, roomID, userID, messageID, emoji string) (bool, error) {
	var member bool
	if err := r.DB.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM room_members rm
			JOIN rooms r ON r.id = rm.room_id AND r.status = 'ACTIVE'
			JOIN messages m ON m.room_id = r.id::text AND m.id = $3
			WHERE rm.room_id = $1 AND rm.user_id = $2
		)
	`, roomID, userID, messageID).Scan(&member); err != nil {
		return false, err
	}
	if !member {
		return false, ErrUnauthorized
	}
	result, err := r.DB.ExecContext(ctx, `
		INSERT INTO room_message_reactions (message_id, user_id, emoji)
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
		return true, nil
	}
	_, err = r.DB.ExecContext(ctx, `
		DELETE FROM room_message_reactions
		WHERE message_id = $1 AND user_id = $2 AND emoji = $3
	`, messageID, userID, emoji)
	return false, err
}
