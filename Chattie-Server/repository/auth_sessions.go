package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type AuthSession struct {
	ID         string    `json:"id"`
	UserAgent  string    `json:"user_agent"`
	IPAddress  string    `json:"ip_address"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at"`
	IsCurrent  bool      `json:"is_current"`
}

func (r *Repository) CreateAuthSession(ctx context.Context, id, userID string, tokenVersion int64, userAgent, ipAddress string, expiresAt time.Time) error {
	_, err := r.DB.ExecContext(ctx, `
		INSERT INTO auth_sessions (id, user_id, token_version, user_agent, ip_address, expires_at)
		VALUES ($1, $2, $3, $4, NULLIF($5, '')::inet, $6)
	`, id, userID, tokenVersion, userAgent, ipAddress, expiresAt)
	return err
}

func (r *SettingsRepository) ListAuthSessions(ctx context.Context, userID, currentID string) ([]AuthSession, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT s.id::text, s.user_agent, COALESCE(s.ip_address::text, ''),
		       s.created_at, s.last_seen_at, s.id::text = $2
		FROM auth_sessions s
		JOIN users u ON u.id = s.user_id AND u.token_version = s.token_version
		WHERE s.user_id = $1 AND s.revoked_at IS NULL
		  AND s.expires_at > CURRENT_TIMESTAMP
		ORDER BY s.id::text = $2 DESC, s.last_seen_at DESC
	`, userID, currentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sessions := make([]AuthSession, 0)
	for rows.Next() {
		var session AuthSession
		if err := rows.Scan(
			&session.ID, &session.UserAgent, &session.IPAddress,
			&session.CreatedAt, &session.LastSeenAt, &session.IsCurrent,
		); err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

func (r *SettingsRepository) RevokeAuthSession(ctx context.Context, userID, sessionID string) (bool, error) {
	result, err := r.DB.ExecContext(ctx, `
		UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
	`, sessionID, userID)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count == 1, err
}

func (r *SettingsRepository) TerminateOtherAuthSessions(ctx context.Context, userID, currentID, userAgent, ipAddress string) (int64, string, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, "", err
	}
	defer tx.Rollback()

	var version int64
	if err := tx.QueryRowContext(ctx, `
		UPDATE users SET token_version = token_version + 1
		WHERE id = $1 RETURNING token_version
	`, userID).Scan(&version); err != nil {
		return 0, "", err
	}

	if currentID != "" {
		result, err := tx.ExecContext(ctx, `
			UPDATE auth_sessions
			SET token_version = $3, last_seen_at = CURRENT_TIMESTAMP,
			    expires_at = CURRENT_TIMESTAMP + INTERVAL '72 hours'
			WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
		`, currentID, userID, version)
		if err != nil {
			return 0, "", err
		}
		updated, err := result.RowsAffected()
		if err != nil {
			return 0, "", err
		}
		if updated == 0 {
			currentID = ""
		}
	}

	if currentID == "" {
		currentID = uuid.NewString()
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO auth_sessions (id, user_id, token_version, user_agent, ip_address, expires_at)
			VALUES ($1, $2, $3, $4, NULLIF($5, '')::inet, CURRENT_TIMESTAMP + INTERVAL '72 hours')
		`, currentID, userID, version, userAgent, ipAddress); err != nil {
			return 0, "", err
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP
		WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL
	`, userID, currentID); err != nil {
		return 0, "", err
	}
	if err := tx.Commit(); err != nil {
		return 0, "", err
	}
	return version, currentID, nil
}
