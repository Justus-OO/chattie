package repository

import (
	"context"

	"chattie-backend/models"
)

func (r *AdminRepository) GetDashboardTelemetry(ctx context.Context) (*models.AdminDashboardTelemetry, error) {
	telemetry := &models.AdminDashboardTelemetry{
		RecentActivity: make([]models.AdminDashboardActivity, 0),
	}

	err := r.DB.QueryRowContext(ctx, `
		SELECT
			(SELECT COUNT(*) FROM users WHERE role = 'client'),
			(SELECT COUNT(*) FROM users
			 WHERE role = 'client' AND last_active >= NOW() - INTERVAL '24 hours'),
			(SELECT COUNT(*) FROM users WHERE role IN ('model', 'operator')),
			(SELECT COUNT(*) FROM users u
			 JOIN creator_stats cs ON cs.user_id = u.id
			 WHERE u.role IN ('model', 'operator')
			   AND LOWER(u.status) IN ('active', 'online')
			   AND cs.is_online = TRUE),
			(SELECT COUNT(*) FROM rooms
			 WHERE UPPER(status) = 'ACTIVE' AND is_voice_room = FALSE),
			(SELECT COUNT(*) FROM room_voice_sessions vs
			 JOIN rooms r ON r.id = vs.room_id
			 WHERE vs.active = TRUE AND UPPER(r.status) = 'ACTIVE'),
			(SELECT COUNT(*) FROM reports WHERE LOWER(status) = 'pending'),
			(SELECT COUNT(*) FROM billing_payment_intents
			 WHERE status = 'paid' AND paid_at >= NOW() - INTERVAL '24 hours')
			+ (SELECT COUNT(*) FROM ad_payment_intents
			 WHERE status = 'completed' AND updated_at >= NOW() - INTERVAL '24 hours')
	`).Scan(
		&telemetry.TotalUsers,
		&telemetry.ActiveUsers24h,
		&telemetry.TotalCreators,
		&telemetry.OnlineCreators,
		&telemetry.OpenTextRooms,
		&telemetry.ActiveVoiceRooms,
		&telemetry.PendingReports,
		&telemetry.PaidCheckouts24h,
	)
	if err != nil {
		return nil, err
	}

	rows, err := r.DB.QueryContext(ctx, `
		SELECT id, created_at, event_type, description
		FROM (
			SELECT 'user-' || al.id::text AS id, al.created_at,
			       'USER'::text AS event_type,
			       COALESCE(u.username, 'System') || ' · ' || REPLACE(al.action_type, '_', ' ') AS description
			FROM user_action_logs al
			LEFT JOIN users u ON u.id = al.user_id
			UNION ALL
			SELECT 'admin-' || al.id::text, al.created_at,
			       'ADMIN'::text,
			       COALESCE(al.admin_username, 'System') || ' · ' || REPLACE(al.action, '_', ' ')
			FROM admin_audit_logs al
		) activity
		ORDER BY created_at DESC
		LIMIT 20
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var activity models.AdminDashboardActivity
		if err := rows.Scan(&activity.ID, &activity.CreatedAt, &activity.Type, &activity.Description); err != nil {
			return nil, err
		}
		telemetry.RecentActivity = append(telemetry.RecentActivity, activity)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	telemetry.DatabaseHealthy = true
	return telemetry, nil
}
