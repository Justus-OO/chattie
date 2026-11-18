package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"chattie-backend/models"
)

var (
	ErrInvalidModelRole       = errors.New("model role required")
	ErrManagedProfileNotFound = errors.New("managed profile not found")
)

func (r *Repository) GetModelSettings(ctx context.Context, modelID string) (models.ModelSettings, error) {
	var settings models.ModelSettings
	err := r.DB.QueryRowContext(ctx, `
		SELECT COALESCE(cs.is_online, FALSE), COALESCE(op.ai_drafts_enabled, FALSE)
		FROM users u
		LEFT JOIN creator_stats cs ON cs.user_id = u.id
		LEFT JOIN operator_profiles op ON op.user_id = u.id
		WHERE u.id = $1 AND u.role = 'model'
	`, modelID).Scan(&settings.IsOnline, &settings.AIDraftsEnabled)
	return settings, err
}

func (r *Repository) UpdateModelAIDrafts(ctx context.Context, modelID string, enabled bool) error {
	result, err := r.DB.ExecContext(ctx, `
		INSERT INTO operator_profiles (user_id, ai_drafts_enabled)
		SELECT u.id, $2
		FROM users u
		WHERE u.id = $1 AND u.role = 'model'
		ON CONFLICT (user_id) DO UPDATE
		SET ai_drafts_enabled = EXCLUDED.ai_drafts_enabled,
		    updated_at = CURRENT_TIMESTAMP
	`, modelID, enabled)
	if err != nil {
		return fmt.Errorf("save model AI draft preference: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check model AI draft preference update: %w", err)
	}
	if updated == 0 {
		return ErrInvalidModelRole
	}
	return nil
}

func (r *Repository) IsModelAIDraftsEnabled(ctx context.Context, modelID string) (bool, error) {
	settings, err := r.GetModelSettings(ctx, modelID)
	if err != nil {
		return false, err
	}
	return settings.AIDraftsEnabled, nil
}

func (r *Repository) UpdateManagedProfileDetails(ctx context.Context, modelID, profileID string, input models.UpdateManagedProfileRequest) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin managed profile update: %w", err)
	}
	defer tx.Rollback()

	var role sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT profile_user.role
		FROM managed_profiles mp
		LEFT JOIN users profile_user ON profile_user.id = mp.id
		WHERE mp.id = $1 AND mp.manager_id = $2
		FOR UPDATE OF mp
	`, profileID, modelID).Scan(&role)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrManagedProfileNotFound
		}
		return fmt.Errorf("validate managed profile ownership: %w", err)
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE managed_profiles
		SET name = $1, avatar_url = $2, bio = $3, updated_at = CURRENT_TIMESTAMP
		WHERE id = $4 AND manager_id = $5
	`, input.Name, input.AvatarURL, input.Bio, profileID, modelID)
	if err != nil {
		return fmt.Errorf("update managed profile: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check managed profile update: %w", err)
	}
	if updated != 1 {
		return ErrManagedProfileNotFound
	}

	if role.Valid && role.String == "persona" {
		result, err = tx.ExecContext(ctx, `
			UPDATE user_profiles
			SET display_name = $1, avatar_url = $2, bio = $3
			WHERE user_id = $4
		`, input.Name, input.AvatarURL, input.Bio, profileID)
		if err != nil {
			return fmt.Errorf("update persona profile details: %w", err)
		}
		updated, err = result.RowsAffected()
		if err != nil {
			return fmt.Errorf("check persona profile update: %w", err)
		}
		if updated != 1 {
			return errors.New("assigned persona profile metadata is missing")
		}

		var primaryMediaID string
		err = tx.QueryRowContext(ctx, `
			SELECT id::text
			FROM user_media
			WHERE user_id = $1
			ORDER BY is_primary DESC, sort_order ASC, created_at ASC
			LIMIT 1
			FOR UPDATE
		`, profileID).Scan(&primaryMediaID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("load persona avatar media: %w", err)
		}
		if errors.Is(err, sql.ErrNoRows) {
			_, err = tx.ExecContext(ctx, `
				INSERT INTO user_media (user_id, url, is_primary, sort_order)
				VALUES ($1, $2, TRUE, 0)
			`, profileID, input.AvatarURL)
			if err != nil {
				return fmt.Errorf("create persona avatar media: %w", err)
			}
		} else {
			if _, err = tx.ExecContext(ctx, `
				UPDATE user_media SET is_primary = FALSE WHERE user_id = $1
			`, profileID); err != nil {
				return fmt.Errorf("clear persona primary avatar: %w", err)
			}
			if _, err = tx.ExecContext(ctx, `
				UPDATE user_media
				SET url = $2, is_primary = TRUE, sort_order = 0
				WHERE id = $1::uuid
			`, primaryMediaID, input.AvatarURL); err != nil {
				return fmt.Errorf("save persona primary avatar: %w", err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit managed profile update: %w", err)
	}
	return nil
}
