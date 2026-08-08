package repository

import (
	"context"
	"encoding/json"
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

// TerminateRoom forcefully deletes a room and kicks all participants
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
			log.Printf("Scan error in GetRoomParticipants: %v", err) // Helpful log if anything else comes up
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

// ResolveKnock approves or rejects a pending join request
func (r *Repository) ResolveKnock(ctx context.Context, knockID string, status string) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE room_join_requests SET status = $1 WHERE id = $2
	`, status, knockID)
	return err
}

// KickUserFromRoom removes a participant from a room
func (r *Repository) KickUserFromRoom(ctx context.Context, roomID string, userID string) error {
	_, err := r.DB.ExecContext(ctx, `
		DELETE FROM room_members WHERE room_id = $1 AND user_id = $2
	`, roomID, userID)
	return err
}
