package repository

import (
	"chattie-backend/models"
	"context"
	"database/sql"
	"errors"
)

type ADLiveRepository struct {
	DB *sql.DB
}

func NewADLiveRepository(db *sql.DB) *ADLiveRepository {
	return &ADLiveRepository{DB: db}
}

// StartSession creates a new live broadcast record
func (r *ADLiveRepository) StartSession(ctx context.Context, session *models.ADLiveSession) error {
	query := `
		INSERT INTO ad_live_sessions (id, creator_id, status, price_cents, started_at)
		VALUES ($1, $2, $3, $4, $5)
	`
	_, err := r.DB.ExecContext(ctx, query, session.ID, session.CreatorID, session.Status, session.PriceCents, session.StartedAt)
	return err
}

// EndSession safely closes an active broadcast
func (r *ADLiveRepository) EndSession(ctx context.Context, sessionID string, creatorID string) error {
	query := `UPDATE ad_live_sessions SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE id = $1 AND creator_id = $2 AND status = 'live'`
	res, err := r.DB.ExecContext(ctx, query, sessionID, creatorID)
	if err != nil {
		return err
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		return errors.New("session not found, not owned by you, or already ended")
	}
	return nil
}

func (r *ADLiveRepository) GetLiveSessions(ctx context.Context, creatorID string) ([]models.ADLiveSession, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT ls.id::text, COALESCE(pp.id::text, ls.creator_id::text),
			COALESCE(pp.display_name, u.username), u.username,
			COALESCE(avatar.storage_key, ''), ls.status, ls.price_cents,
			ls.started_at, ls.ended_at
		FROM ad_live_sessions ls
		JOIN users u ON u.id = ls.creator_id
		LEFT JOIN performer_profiles pp ON pp.user_id = ls.creator_id
		LEFT JOIN ad_assets avatar ON avatar.id = pp.avatar_asset_id
		WHERE ls.status = 'live'
		  AND ($1 = '' OR ls.creator_id::text = $1 OR pp.id::text = $1)
		ORDER BY ls.started_at DESC
	`, creatorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sessions := make([]models.ADLiveSession, 0)
	for rows.Next() {
		var session models.ADLiveSession
		var endedAt sql.NullTime
		if err := rows.Scan(
			&session.ID, &session.CreatorID, &session.DisplayName,
			&session.Username, &session.AvatarURL, &session.Status,
			&session.PriceCents, &session.StartedAt, &endedAt,
		); err != nil {
			return nil, err
		}
		if endedAt.Valid {
			session.EndedAt = &endedAt.Time
		}
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

func (r *ADLiveRepository) IsSessionCreator(ctx context.Context, sessionID string, creatorID string) (bool, error) {
	var isCreator bool
	err := r.DB.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM ad_live_sessions WHERE id = $1 AND creator_id = $2
		)
	`, sessionID, creatorID).Scan(&isCreator)
	return isCreator, err
}

func (r *ADLiveRepository) LeaveSession(ctx context.Context, sessionID string, viewerID string) error {
	result, err := r.DB.ExecContext(ctx, `
		UPDATE ad_live_stage_requests
		SET status = 'left', updated_at = CURRENT_TIMESTAMP
		WHERE session_id = $1 AND viewer_id = $2 AND status IN ('requested', 'approved', 'on_stage')
		  AND EXISTS (SELECT 1 FROM ad_live_sessions WHERE id = $1 AND status = 'live')
	`, sessionID, viewerID)
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
	return nil
}

// VerifyAccess checks if the viewer is allowed into the room (Subscription OR Session Pass)
func (r *ADLiveRepository) VerifyAccess(ctx context.Context, viewerID string, sessionID string) (bool, error) {
	query := `
		SELECT EXISTS (
			SELECT 1 FROM ad_live_sessions ls
			WHERE ls.id = $2 AND ls.status = 'live' AND (
				ls.creator_id = $1 OR ls.price_cents = 0
				OR EXISTS (SELECT 1 FROM ad_live_entitlements e WHERE e.user_id = $1 AND e.session_id = ls.id)
				OR EXISTS (
					SELECT 1 FROM ad_subscriptions sub
					WHERE sub.subscriber_id = $1 AND sub.creator_id = ls.creator_id
					  AND sub.status = 'active' AND sub.current_period_end > CURRENT_TIMESTAMP
				)
			)
		)
	`
	var hasAccess bool
	err := r.DB.QueryRowContext(ctx, query, viewerID, sessionID).Scan(&hasAccess)
	return hasAccess, err
}

func (r *ADLiveRepository) DenyStageRequest(ctx context.Context, sessionID string, viewerID string, creatorID string) error {
	result, err := r.DB.ExecContext(ctx, `
		UPDATE ad_live_stage_requests sr
		SET status = 'denied', updated_at = CURRENT_TIMESTAMP
		FROM ad_live_sessions ls
		WHERE sr.session_id = ls.id AND sr.session_id = $1 AND sr.viewer_id = $2
		  AND ls.creator_id = $3 AND ls.status = 'live'
		  AND sr.status = 'requested'
	`, sessionID, viewerID, creatorID)
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
	return nil
}

// UpsertStageRequest manages the co-streaming state machine
func (r *ADLiveRepository) UpsertStageRequest(ctx context.Context, sessionID string, viewerID string, status string) error {
	var query string
	switch status {
	case "requested":
		query = `
			INSERT INTO ad_live_stage_requests (session_id, viewer_id, status, updated_at)
			SELECT $1, $2, 'requested', CURRENT_TIMESTAMP
			WHERE EXISTS (SELECT 1 FROM ad_live_sessions WHERE id = $1 AND status = 'live')
			ON CONFLICT (session_id, viewer_id) DO UPDATE SET
				status = 'requested', updated_at = CURRENT_TIMESTAMP
		`
	case "approved":
		query = `
			UPDATE ad_live_stage_requests
			SET status = 'approved', updated_at = CURRENT_TIMESTAMP
			WHERE session_id = $1 AND viewer_id = $2 AND status = 'requested'
			  AND EXISTS (SELECT 1 FROM ad_live_sessions WHERE id = $1 AND status = 'live')
		`
	case "removed":
		query = `
			UPDATE ad_live_stage_requests
			SET status = 'removed', updated_at = CURRENT_TIMESTAMP
			WHERE session_id = $1 AND viewer_id = $2 AND status IN ('approved', 'on_stage')
			  AND EXISTS (SELECT 1 FROM ad_live_sessions WHERE id = $1 AND status = 'live')
		`
	default:
		return errors.New("invalid live stage status")
	}
	result, err := r.DB.ExecContext(ctx, query, sessionID, viewerID)
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
	return nil
}
