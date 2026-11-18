package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"chattie-backend/models"
)

func (r *AdminRepository) GetAfterDarkAutoApprove(ctx context.Context) (bool, error) {
	var enabled bool
	err := r.DB.QueryRowContext(ctx, `
		SELECT auto_approve_new_posts
		FROM ad_afterdark_moderation_settings
		WHERE id = 1
	`).Scan(&enabled)
	return enabled, err
}

func (r *AdminRepository) SetAfterDarkAutoApprove(ctx context.Context, adminID string, enabled bool) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var previous bool
	if err := tx.QueryRowContext(ctx, `
		SELECT auto_approve_new_posts
		FROM ad_afterdark_moderation_settings
		WHERE id = 1
		FOR UPDATE
	`).Scan(&previous); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE ad_afterdark_moderation_settings
		SET auto_approve_new_posts = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = 1
	`, enabled, adminID); err != nil {
		return err
	}
	if previous != enabled {
		action := "AFTER_DARK_AUTO_APPROVE_DISABLED"
		if enabled {
			action = "AFTER_DARK_AUTO_APPROVE_ENABLED"
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO admin_audit_logs (admin_id, action, reason)
			VALUES ($1, $2, $3)
		`, adminID, action, "Auto-approval applies only to new After Dark posts"); err != nil {
			return err
		}
	}
	return tx.Commit()
}

type RegionalCountry struct {
	CountryCode string `json:"country_code"`
	UserCount   int    `json:"user_count"`
	Blocked     bool   `json:"blocked"`
}

func (r *AdminRepository) GetRegionalCountries(ctx context.Context) ([]RegionalCountry, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT countries.country_code, countries.user_count,
		       (blocks.country_code IS NOT NULL) AS blocked
		FROM (
			SELECT country_code::text AS country_code, COUNT(*)::int AS user_count
			FROM user_locations
			WHERE country_code IS NOT NULL
			GROUP BY country_code
			UNION
			SELECT country_code::text AS country_code, 0 AS user_count
			FROM regional_country_blocks
		) countries
		LEFT JOIN regional_country_blocks blocks
		  ON blocks.country_code::text = countries.country_code
		ORDER BY countries.country_code
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	countries := make([]RegionalCountry, 0)
	for rows.Next() {
		var country RegionalCountry
		if err := rows.Scan(&country.CountryCode, &country.UserCount, &country.Blocked); err != nil {
			return nil, err
		}
		countries = append(countries, country)
	}
	return countries, rows.Err()
}

func (r *AdminRepository) BlockRegionalCountry(ctx context.Context, adminID, countryCode string) (bool, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		INSERT INTO regional_country_blocks (country_code, created_by)
		VALUES ($1, $2)
		ON CONFLICT (country_code) DO NOTHING
	`, countryCode, adminID)
	if err != nil {
		return false, fmt.Errorf("block regional country: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if changed == 1 {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO admin_audit_logs (admin_id, action, reason)
			VALUES ($1, 'COUNTRY_BLOCKED', $2)
		`, adminID, countryCode); err != nil {
			return false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return changed == 1, nil
}

func (r *AdminRepository) UnblockRegionalCountry(ctx context.Context, adminID, countryCode string) (bool, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		DELETE FROM regional_country_blocks WHERE country_code = $1
	`, countryCode)
	if err != nil {
		return false, fmt.Errorf("unblock regional country: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if changed == 1 {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO admin_audit_logs (admin_id, action, reason)
			VALUES ($1, 'COUNTRY_UNBLOCKED', $2)
		`, adminID, countryCode); err != nil {
			return false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return changed == 1, nil
}

var (
	ErrModerationTermExists  = errors.New("moderation term already exists")
	ErrModerationTermMissing = errors.New("moderation term not found")
)

func (r *AdminRepository) GetModerationTerms(ctx context.Context) ([]models.AdminModerationTerm, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id::text, word, category, created_at
		FROM flagged_words
		ORDER BY category, word
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	terms := make([]models.AdminModerationTerm, 0)
	for rows.Next() {
		var term models.AdminModerationTerm
		if err := rows.Scan(&term.ID, &term.Word, &term.Category, &term.CreatedAt); err != nil {
			return nil, err
		}
		terms = append(terms, term)
	}
	return terms, rows.Err()
}

func (r *AdminRepository) CreateModerationTerm(ctx context.Context, adminID, word, category string) error {
	category = strings.ToLower(strings.TrimSpace(category))
	if category != "social" && category != "profanity" {
		return errors.New("unsupported moderation category")
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var id string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO flagged_words (word, category)
		VALUES ($1, $2)
		ON CONFLICT (word) DO NOTHING
		RETURNING id::text
	`, strings.TrimSpace(word), category).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrModerationTermExists
	}
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO admin_audit_logs (admin_id, action, reason)
		VALUES ($1, 'MODERATION_TERM_ADDED', $2)
	`, adminID, category+": "+strings.TrimSpace(word)); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *AdminRepository) DeleteModerationTerm(ctx context.Context, adminID, termID string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var word, category string
	err = tx.QueryRowContext(ctx, `
		DELETE FROM flagged_words
		WHERE id = $1
		RETURNING word, category
	`, termID).Scan(&word, &category)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrModerationTermMissing
	}
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO admin_audit_logs (admin_id, action, reason)
		VALUES ($1, 'MODERATION_TERM_REMOVED', $2)
	`, adminID, category+": "+word); err != nil {
		return err
	}
	return tx.Commit()
}
