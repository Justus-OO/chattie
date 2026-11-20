package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"

	"chattie-backend/models"
)

// GetAdminRooms fetches all chat and voice spaces with live participant counts
func (r *Repository) GetAdminRooms(ctx context.Context) ([]models.AdminRoomDetail, error) {
	query := `
       SELECT 
          r.id::text, 
          r.name, 
          CASE WHEN r.icon = 'voice' THEN 'VOICE' ELSE 'TEXT' END as room_type,
          r.is_private,
          COALESCE(u.username, 'SYSTEM') as host_name,
          (SELECT COUNT(*)::int FROM room_members rm WHERE rm.room_id = r.id) as participants,
          100 as room_limit,
          COALESCE(TO_CHAR(NOW() - r.created_at, 'HH24"h "MI"m"'), '0h 0m') as uptime,
          COALESCE(r.status, 'ACTIVE') as status,
          COALESCE(r.tags, '[]'::jsonb) as tags,
          COALESCE(r.warning_level, 0) as warning_level
       FROM rooms r
       LEFT JOIN users u ON r.created_by = u.id
       ORDER BY participants DESC
    `

	rows, err := r.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rooms []models.AdminRoomDetail
	for rows.Next() {
		var rm models.AdminRoomDetail
		var tagsJSON []byte
		if err := rows.Scan(&rm.ID, &rm.Name, &rm.Type, &rm.IsPrivate, &rm.Host, &rm.Participants, &rm.Limit, &rm.Uptime, &rm.Status, &tagsJSON, &rm.WarningLevel); err != nil {
			continue
		}
		_ = json.Unmarshal(tagsJSON, &rm.Tags)
		rooms = append(rooms, rm)
	}
	return rooms, nil
}

// TerminateRoom forcefully deletes a room and kicks all participants in the DB
func (r *Repository) TerminateRoom(ctx context.Context, roomID string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, _ = tx.ExecContext(ctx, `DELETE FROM room_members WHERE room_id = $1`, roomID)
	_, _ = tx.ExecContext(ctx, `DELETE FROM room_join_requests WHERE room_id = $1`, roomID)

	_, err = tx.ExecContext(ctx, `DELETE FROM rooms WHERE id = $1`, roomID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (r *Repository) UpdateAdminRoomStatus(ctx context.Context, roomID, adminID, status string) error {
	if status != "ACTIVE" && status != "WARNING" && status != "SUSPENDED" {
		return errors.New("invalid room status")
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		UPDATE rooms SET status = $1, updated_at = CURRENT_TIMESTAMP
		WHERE id = $2
	`, status, roomID)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return sql.ErrNoRows
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO admin_audit_logs (admin_id, action, target_id, reason)
		VALUES ($1, 'ROOM_STATUS_UPDATED', $2, $3)
	`, adminID, roomID, status); err != nil {
		return err
	}
	return tx.Commit()
}

// GetRoomParticipants fetches users currently inside a room
func (r *Repository) GetRoomParticipants(ctx context.Context, roomID string) ([]models.AdminRoomParticipant, error) {
	query := `
       SELECT 
          u.id::text, 
          COALESCE(up.display_name, u.username, 'Unknown') as name,
          COALESCE(rm.role, 'member') as role,
          COALESCE(TO_CHAR(NOW() - rm.joined_at, 'MI"m ago"'), 'Just now') as joined,
          COALESCE(rm.is_muted, false) as is_muted
       FROM room_members rm
       JOIN users u ON rm.user_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE rm.room_id = $1
       ORDER BY rm.joined_at ASC
    `

	rows, err := r.DB.QueryContext(ctx, query, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var participants []models.AdminRoomParticipant
	for rows.Next() {
		var p models.AdminRoomParticipant
		if err := rows.Scan(&p.ID, &p.Name, &p.Role, &p.Joined, &p.IsMuted); err != nil {
			log.Printf("Scan error in GetRoomParticipants: %v", err)
			continue
		}
		participants = append(participants, p)
	}

	if participants == nil {
		participants = []models.AdminRoomParticipant{}
	}

	return participants, nil
}

func (r *Repository) GetAdminKnocks(ctx context.Context) ([]models.AdminRoomKnock, error) {
	query := `
       SELECT 
          rjr.id::text,
          COALESCE(up.display_name, u.username) as user_name,
          rm.name as room_name,
          COALESCE(TO_CHAR(NOW() - rjr.created_at, 'MI"m ago"'), 'Just now') as time_ago,
          COALESCE(cb.risk_score, 0) as risk_score,
          COALESCE(UPPER(st.name), 'STANDARD') as tier
       FROM room_join_requests rjr
       JOIN users u ON rjr.user_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       JOIN rooms rm ON rjr.room_id = rm.id
       LEFT JOIN client_behavior cb ON u.id = cb.user_id
       LEFT JOIN user_subscriptions us ON u.id = us.user_id AND us.status = 'active'
       LEFT JOIN subscription_tiers st ON us.tier_id = st.id
       WHERE rjr.status = 'PENDING'
       ORDER BY rjr.created_at DESC
    `

	rows, err := r.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var knocks []models.AdminRoomKnock
	for rows.Next() {
		var k models.AdminRoomKnock
		if err := rows.Scan(&k.ID, &k.User, &k.TargetRoom, &k.Time, &k.RiskScore, &k.Tier); err != nil {
			continue
		}
		knocks = append(knocks, k)
	}
	return knocks, nil
}

// ResolveKnock updates the knock status. If approved, adds the user to the room.
// It returns the UserID and RoomID so the WebSocket handler can notify the user.
func (r *Repository) ResolveKnock(ctx context.Context, knockID string, status string) (string, string, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback()

	var userID, roomID string

	// Update the request and get the user/room IDs
	err = tx.QueryRowContext(ctx, `
		UPDATE room_join_requests 
		SET status = $1, updated_at = NOW() 
		WHERE id = $2 
		RETURNING user_id::text, room_id::text
	`, status, knockID).Scan(&userID, &roomID)

	if err != nil {
		return "", "", err
	}

	// If approved, instantly grant them membership in the DB
	if status == "APPROVED" {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO room_members (room_id, user_id, role, joined_at)
			VALUES ($1, $2, 'member', NOW())
			ON CONFLICT (room_id, user_id) DO NOTHING
		`, roomID, userID)
		if err != nil {
			return "", "", err
		}
	}

	return userID, roomID, tx.Commit()
}

// KickUserFromRoom removes a participant from a room
func (r *Repository) KickUserFromRoom(ctx context.Context, roomID string, userID string) error {
	_, err := r.DB.ExecContext(ctx, `
       DELETE FROM room_members WHERE room_id = $1 AND user_id = $2
    `, roomID, userID)
	return err
}
