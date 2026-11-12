package repository

import (
	"context"
	"errors"
	"time"
)

var ErrAuthChallengeRateLimited = errors.New("too many verification codes requested")

type AuthDetails struct {
	UserID           string
	Email            string
	PhoneNumber      string
	PhoneVerified    bool
	Provider         string
	TokenVersion     int64
	TwoFactorEnabled bool
	TwoFactorChannel string
}

type AuthChallenge struct {
	ID       string
	UserID   string
	Channel  string
	CodeHash string
	Attempts int
}

func (r *Repository) GetAuthDetailsByUserID(ctx context.Context, userID string) (*AuthDetails, error) {
	return r.getAuthDetails(ctx, `WHERE u.id = $1`, userID)
}

func (r *Repository) GetAuthDetailsByEmail(ctx context.Context, email string) (*AuthDetails, error) {
	return r.getAuthDetails(ctx, `WHERE LOWER(u.email) = LOWER($1)`, email)
}

func (r *Repository) getAuthDetails(ctx context.Context, where string, arg string) (*AuthDetails, error) {
	query := `
		SELECT u.id::text, u.email, COALESCE(up.phone_number, ''),
		       COALESCE(up.phone_verified_at IS NOT NULL, FALSE),
		       COALESCE(u.provider, 'local'), COALESCE(u.token_version, 1),
		       COALESCE(us.two_factor_enabled, FALSE), COALESCE(us.two_factor_channel, 'email')
		FROM users u
		LEFT JOIN user_profiles up ON up.user_id = u.id
		LEFT JOIN user_settings us ON us.user_id = u.id
		` + where
	var details AuthDetails
	err := r.DB.QueryRowContext(ctx, query, arg).Scan(
		&details.UserID, &details.Email, &details.PhoneNumber, &details.PhoneVerified,
		&details.Provider, &details.TokenVersion, &details.TwoFactorEnabled, &details.TwoFactorChannel,
	)
	if err != nil {
		return nil, err
	}
	return &details, nil
}

func (r *Repository) CreateAuthChallenge(ctx context.Context, id, userID, purpose, channel, codeHash string, expiresAt time.Time) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var recentCount int
	err = tx.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM auth_verification_codes
		WHERE user_id = $1 AND purpose = $2
		  AND created_at > CURRENT_TIMESTAMP - INTERVAL '15 minutes'
	`, userID, purpose).Scan(&recentCount)
	if err != nil {
		return err
	}
	if recentCount >= 3 {
		return ErrAuthChallengeRateLimited
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE auth_verification_codes
		SET consumed_at = CURRENT_TIMESTAMP
		WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL
	`, userID, purpose)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO auth_verification_codes (id, user_id, purpose, channel, code_hash, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, id, userID, purpose, channel, codeHash, expiresAt)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (r *Repository) GetAuthChallenge(ctx context.Context, id, purpose string) (*AuthChallenge, error) {
	var challenge AuthChallenge
	err := r.DB.QueryRowContext(ctx, `
		SELECT id::text, user_id::text, channel, code_hash, attempts
		FROM auth_verification_codes
		WHERE id = $1 AND purpose = $2 AND consumed_at IS NULL
		  AND expires_at > CURRENT_TIMESTAMP AND attempts < 5
	`, id, purpose).Scan(&challenge.ID, &challenge.UserID, &challenge.Channel, &challenge.CodeHash, &challenge.Attempts)
	if err != nil {
		return nil, err
	}
	return &challenge, nil
}

func (r *Repository) RecordAuthChallengeFailure(ctx context.Context, id string) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE auth_verification_codes
		SET attempts = attempts + 1
		WHERE id = $1 AND consumed_at IS NULL
		  AND expires_at > CURRENT_TIMESTAMP AND attempts < 5
	`, id)
	return err
}

func (r *Repository) ConsumeAuthChallenge(ctx context.Context, id, purpose string) (string, error) {
	var userID string
	err := r.DB.QueryRowContext(ctx, `
		UPDATE auth_verification_codes
		SET consumed_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND purpose = $2 AND consumed_at IS NULL
		  AND expires_at > CURRENT_TIMESTAMP AND attempts < 5
		RETURNING user_id::text
	`, id, purpose).Scan(&userID)
	return userID, err
}

func (r *Repository) CompletePasswordReset(ctx context.Context, id, userID, passwordHash string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		UPDATE auth_verification_codes
		SET consumed_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND user_id = $2 AND purpose = 'password_reset'
		  AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP AND attempts < 5
	`, id, userID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return errors.New("password reset challenge is no longer valid")
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE users SET password_hash = $1, token_version = token_version + 1,
		                 updated_at = CURRENT_TIMESTAMP
		WHERE id = $2
	`, passwordHash, userID)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP
		WHERE user_id = $1 AND revoked_at IS NULL
	`, userID); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *Repository) UpdatePasswordAndRevokeOtherSessions(ctx context.Context, userID, passwordHash string) (int64, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var version int64
	err = tx.QueryRowContext(ctx, `
		UPDATE users SET password_hash = $1, token_version = token_version + 1,
		                 updated_at = CURRENT_TIMESTAMP
		WHERE id = $2
		RETURNING token_version
	`, passwordHash, userID).Scan(&version)
	if err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP
		WHERE user_id = $1 AND revoked_at IS NULL
	`, userID); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return version, nil
}

func (r *Repository) SetTwoFactor(ctx context.Context, userID string, enabled bool, channel string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `
		INSERT INTO user_settings (user_id, two_factor_enabled, two_factor_channel, updated_at)
		VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
		ON CONFLICT (user_id) DO UPDATE SET
			two_factor_enabled = EXCLUDED.two_factor_enabled,
			two_factor_channel = EXCLUDED.two_factor_channel,
			updated_at = CURRENT_TIMESTAMP
	`, userID, enabled, channel)
	if err != nil {
		return err
	}
	if enabled && channel == "sms" {
		_, err = tx.ExecContext(ctx, `
			UPDATE user_profiles SET phone_verified_at = COALESCE(phone_verified_at, CURRENT_TIMESTAMP)
			WHERE user_id = $1 AND NULLIF(BTRIM(phone_number), '') IS NOT NULL
		`, userID)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *Repository) IncrementTokenVersion(ctx context.Context, userID string) (int64, error) {
	var version int64
	err := r.DB.QueryRowContext(ctx, `
		UPDATE users SET token_version = token_version + 1
		WHERE id = $1
		RETURNING token_version
	`, userID).Scan(&version)
	return version, err
}

func (r *Repository) GetTokenVersion(ctx context.Context, userID string) (int64, error) {
	var version int64
	err := r.DB.QueryRowContext(ctx, `SELECT token_version FROM users WHERE id = $1`, userID).Scan(&version)
	return version, err
}
