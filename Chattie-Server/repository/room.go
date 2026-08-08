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
	ErrVoiceLimitReached = errors.New("daily voice limit reached: upgrade to premium")
	ErrRoomLimitReached  = errors.New("room creation limit reached: upgrade to premium")
	ErrUnauthorized      = errors.New("unauthorized action")
	ErrInvalidRoomCode   = errors.New("invalid or expired room code")
)

type RoomRepository struct {
	DB *sql.DB
}

func NewRoomRepository(db *sql.DB) *RoomRepository {
	return &RoomRepository{DB: db}
}

// Helper to generate a random 6-character room code
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
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Check user tier limits for room creation
	var maxRooms, roomsUsed int
	limitQuery := `
		SELECT 
			t.max_rooms_created,
			COALESCE(u.rooms_created_used, 0)
		FROM user_subscriptions s
		JOIN subscription_tiers t ON s.tier_id = t.id
		LEFT JOIN user_daily_usage u ON s.user_id = u.user_id AND u.usage_date = CURRENT_DATE
		WHERE s.user_id = $1 AND s.status = 'active'
	`
	err = tx.QueryRowContext(ctx, limitQuery, userID).Scan(&maxRooms, &roomsUsed)
	if err != nil && err != sql.ErrNoRows {
		return err
	}

	if err == sql.ErrNoRows {
		maxRooms = 0
		roomsUsed = 0
	}

	// -1 means unlimited
	if maxRooms != -1 && roomsUsed >= maxRooms {
		return ErrRoomLimitReached
	}

	// 2. Generate unique room code
	roomCode := generateRoomCode()
	tagsJSON, _ := json.Marshal(room.Tags)

	// 3. Insert the room
	query := `
		INSERT INTO rooms (name, icon, category, description, tags, is_private, room_code, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, room_code, active_count, created_at
	`
	err = tx.QueryRowContext(ctx, query,
		room.Name, room.Icon, room.Category, room.Description,
		tagsJSON, room.IsPrivate, roomCode, userID,
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
	usageQuery := `
		INSERT INTO user_daily_usage (user_id, usage_date, rooms_created_used)
		VALUES ($1, CURRENT_DATE, 1)
		ON CONFLICT (user_id, usage_date) DO UPDATE 
		SET rooms_created_used = user_daily_usage.rooms_created_used + 1
	`
	if _, err = tx.ExecContext(ctx, usageQuery, userID); err != nil {
		return err
	}

	return tx.Commit()
}

// =====================================================================
// 2. CHECK VOICE ELIGIBILITY (For VIP Tickets)
// =====================================================================

func (r *RoomRepository) CheckAndConsumeVoiceTrial(ctx context.Context, userID string) error {
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
// 3. GET ALL ROOMS
// =====================================================================

func (r *RoomRepository) GetAllRooms(ctx context.Context) ([]models.Room, error) {
	query := `
		SELECT id, name, icon, category, description, tags, is_private, room_code, created_by, active_count, created_at
		FROM rooms
		ORDER BY active_count DESC, created_at DESC
	`
	rows, err := r.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rooms []models.Room
	for rows.Next() {
		var room models.Room
		var tagsJSON []byte
		var createdBy, roomCode sql.NullString

		if err := rows.Scan(
			&room.ID, &room.Name, &room.Icon, &room.Category,
			&room.Description, &tagsJSON, &room.IsPrivate, &roomCode,
			&createdBy, &room.ActiveCount, &room.CreatedAt,
		); err != nil {
			return nil, err
		}

		json.Unmarshal(tagsJSON, &room.Tags)
		if createdBy.Valid {
			room.CreatedBy = createdBy.String
		}
		if roomCode.Valid {
			room.RoomCode = roomCode.String
		}

		rooms = append(rooms, room)
	}

	if rooms == nil {
		rooms = []models.Room{}
	}

	return rooms, nil
}

// =====================================================================
// 4. JOIN ROOM BY CODE OR LINK (With Private Access Validation)
// =====================================================================

func (r *RoomRepository) JoinRoomByCode(ctx context.Context, userID, roomCode string) (*models.Room, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var room models.Room
	var tagsJSON []byte
	var rc sql.NullString

	query := `SELECT id, name, icon, category, description, tags, is_private, room_code, active_count, created_at FROM rooms WHERE room_code = $1`
	err = tx.QueryRowContext(ctx, query, strings.ToUpper(roomCode)).Scan(
		&room.ID, &room.Name, &room.Icon, &room.Category,
		&room.Description, &tagsJSON, &room.IsPrivate, &rc, &room.ActiveCount, &room.CreatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrInvalidRoomCode
		}
		return nil, err
	}
	json.Unmarshal(tagsJSON, &room.Tags)
	if rc.Valid {
		room.RoomCode = rc.String
	}

	// If room is private, check if they are already approved by an admin
	if room.IsPrivate {
		var status string
		err = tx.QueryRowContext(ctx, `SELECT status FROM room_join_requests WHERE room_id = $1 AND user_id = $2`, room.ID, userID).Scan(&status)
		if err != nil || status != "APPROVED" {
			return nil, errors.New("private room: request pending or access denied")
		}
	}

	// Add user to room members
	_, err = tx.ExecContext(ctx, `
		INSERT INTO room_members (room_id, user_id, role, joined_at, last_active) 
		VALUES ($1, $2, 'member', NOW(), NOW()) 
		ON CONFLICT (room_id, user_id) DO UPDATE SET last_active = NOW()
	`, room.ID, userID)
	if err != nil {
		return nil, err
	}

	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return &room, nil
}

func (r *RoomRepository) IsRoomMember(ctx context.Context, roomID, userID string) (bool, error) {
	var exists bool
	err := r.DB.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2
		)
	`, roomID, userID).Scan(&exists)
	return exists, err
}

// =====================================================================
// 5. ROOM ADMIN & MANAGEMENT DETAILS
// =====================================================================

func (r *RoomRepository) GetRoomDetails(ctx context.Context, roomID, userID string) (*models.RoomDetails, error) {
	query := `
		SELECT 
			r.id, r.name, r.icon, r.category, r.description, r.tags, 
			r.is_private, r.room_code, r.created_by, r.active_count, r.created_at,
			COALESCE(rm.role, 'member') AS user_role,
			(SELECT COUNT(*) FROM room_join_requests WHERE room_id = r.id AND status = 'PENDING') AS pending_count
		FROM rooms r
		LEFT JOIN room_members rm ON r.id = rm.room_id AND rm.user_id = $2
		WHERE r.id = $1
	`
	var details models.RoomDetails
	var tagsJSON []byte
	var createdBy, roomCode sql.NullString

	err := r.DB.QueryRowContext(ctx, query, roomID, userID).Scan(
		&details.ID, &details.Name, &details.Icon, &details.Category,
		&details.Description, &tagsJSON, &details.IsPrivate, &roomCode,
		&createdBy, &details.ActiveCount, &details.CreatedAt,
		&details.UserRole, &details.PendingCount,
	)
	if err != nil {
		return nil, err
	}

	json.Unmarshal(tagsJSON, &details.Tags)
	if createdBy.Valid {
		details.CreatedBy = createdBy.String
	}
	if roomCode.Valid {
		details.RoomCode = roomCode.String
	}
	details.InviteLink = fmt.Sprintf("https://chattie.app/rooms/join/%s", details.RoomCode)

	return &details, nil
}

func (r *RoomRepository) RequestJoinPrivateRoom(ctx context.Context, userID, roomCode string) error {
	query := `
		INSERT INTO room_join_requests (room_id, user_id, status)
		SELECT id, $1, 'PENDING' FROM rooms WHERE room_code = $2
		ON CONFLICT (room_id, user_id) DO UPDATE SET status = 'PENDING'
	`
	_, err := r.DB.ExecContext(ctx, query, userID, strings.ToUpper(roomCode))
	return err
}

func (r *RoomRepository) HandleJoinRequest(ctx context.Context, adminID, roomID, targetUserID string, approve bool) error {
	var role string
	err := r.DB.QueryRowContext(ctx, `SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, roomID, adminID).Scan(&role)
	if err != nil || (role != "creator" && role != "admin") {
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

	_, err = tx.ExecContext(ctx, `UPDATE room_join_requests SET status = $1 WHERE room_id = $2 AND user_id = $3`, status, roomID, targetUserID)
	if err != nil {
		return err
	}

	if approve {
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

func (r *RoomRepository) KickOrBanUser(ctx context.Context, adminID, roomID, targetUserID string) error {
	var role string
	err := r.DB.QueryRowContext(ctx, `SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, roomID, adminID).Scan(&role)
	if err != nil || (role != "creator" && role != "admin") {
		return ErrUnauthorized
	}

	_, err = r.DB.ExecContext(ctx, `DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`, roomID, targetUserID)
	return err
}

// =====================================================================
// 7. GET ROOM PARTICIPANTS (With Match % Calculator!)
// =====================================================================

func (r *RoomRepository) GetRoomParticipants(ctx context.Context, roomID string, currentUserID string) ([]models.RoomParticipant, error) {
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
			(50 + COALESCE(
				(
					SELECT COUNT(*) * 50.0 / NULLIF(array_length(cu.my_tags, 1), 0)
					FROM unnest(COALESCE(ARRAY(SELECT tag FROM user_tags WHERE user_id = u.id), ARRAY[]::VARCHAR[])) AS t 
					WHERE t = ANY(cu.my_tags)
				), 0
			))::INT AS match_pct

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
		if err := rows.Scan(&p.ID, &p.Name, &p.Avatar, &p.Status, &p.Role, &p.MatchPct); err != nil {
			continue
		}
		participants = append(participants, p)
	}

	if participants == nil {
		participants = []models.RoomParticipant{}
	}

	return participants, nil
}
