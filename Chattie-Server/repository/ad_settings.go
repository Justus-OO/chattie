package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"time"

	"chattie-backend/models"
)

type ADSettingsRepository struct {
	DB *sql.DB
}

func NewADSettingsRepository(db *sql.DB) *ADSettingsRepository {
	return &ADSettingsRepository{DB: db}
}

// UpdateCreatorStatus safely changes a creator's state.
func (r *ADSettingsRepository) UpdateCreatorStatus(ctx context.Context, userID string, newStatus string) error {
	switch newStatus {
	case "paused", "active", "deactivated":
	default:
		return errors.New("invalid creator status")
	}
	query := `UPDATE performer_profiles SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`
	result, err := r.DB.ExecContext(ctx, query, newStatus, userID)
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

// UpsertCreatorSettings updates watermarking and geo-blocking preferences
func (r *ADSettingsRepository) UpsertCreatorSettings(ctx context.Context, settings *models.ADCreatorSettings) error {
	var regionsJSON, emailJSON, pushJSON interface{}
	if settings.BlockedRegions != nil {
		encoded, err := json.Marshal(settings.BlockedRegions)
		if err != nil {
			return err
		}
		regionsJSON = string(encoded)
	}
	if settings.NotificationEmail != nil {
		if !json.Valid(settings.NotificationEmail) {
			return errors.New("invalid email notification preferences")
		}
		emailJSON = string(settings.NotificationEmail)
	}
	if settings.NotificationPush != nil {
		if !json.Valid(settings.NotificationPush) {
			return errors.New("invalid push notification preferences")
		}
		pushJSON = string(settings.NotificationPush)
	}
	var defaultPPVCents, withdrawThresholdCents interface{}
	if settings.DefaultPPV != nil {
		if math.IsNaN(*settings.DefaultPPV) || math.IsInf(*settings.DefaultPPV, 0) || *settings.DefaultPPV < 0 || *settings.DefaultPPV > float64(math.MaxInt64)/100 {
			return errors.New("default PPV cannot be negative")
		}
		defaultPPVCents = int64(math.Round(*settings.DefaultPPV * 100))
	}
	if settings.WithdrawThreshold != nil {
		if math.IsNaN(*settings.WithdrawThreshold) || math.IsInf(*settings.WithdrawThreshold, 0) || *settings.WithdrawThreshold < 0 || *settings.WithdrawThreshold > float64(math.MaxInt64)/100 {
			return errors.New("withdrawal threshold cannot be negative")
		}
		withdrawThresholdCents = int64(math.Round(*settings.WithdrawThreshold * 100))
	}

	query := `
		INSERT INTO ad_creator_settings (
			user_id, watermark_enabled, watermark_text, geo_block_enabled, blocked_regions,
			show_explicit_content, discoverable, notification_email, notification_push,
			default_ppv_cents, auto_withdraw, withdraw_threshold_cents, updated_at
		) VALUES (
			$1, COALESCE($2, TRUE), COALESCE($3, ''), COALESCE($4, FALSE),
			COALESCE($5::jsonb, '[]'::jsonb), COALESCE($6, FALSE), COALESCE($7, TRUE),
			COALESCE($8::jsonb, '{"subs":true,"tips":true,"messages":false,"marketing":false}'::jsonb),
			COALESCE($9::jsonb, '{"subs":true,"tips":true,"messages":true,"mentions":true}'::jsonb),
			COALESCE($10, 0), COALESCE($11, FALSE), COALESCE($12, 0), CURRENT_TIMESTAMP
		)
		ON CONFLICT (user_id) DO UPDATE SET
			watermark_enabled = COALESCE($2, ad_creator_settings.watermark_enabled),
			watermark_text = COALESCE($3, ad_creator_settings.watermark_text),
			geo_block_enabled = COALESCE($4, ad_creator_settings.geo_block_enabled),
			blocked_regions = COALESCE($5::jsonb, ad_creator_settings.blocked_regions),
			show_explicit_content = COALESCE($6, ad_creator_settings.show_explicit_content),
			discoverable = COALESCE($7, ad_creator_settings.discoverable),
			notification_email = COALESCE($8::jsonb, ad_creator_settings.notification_email),
			notification_push = COALESCE($9::jsonb, ad_creator_settings.notification_push),
			default_ppv_cents = COALESCE($10, ad_creator_settings.default_ppv_cents),
			auto_withdraw = COALESCE($11, ad_creator_settings.auto_withdraw),
			withdraw_threshold_cents = COALESCE($12, ad_creator_settings.withdraw_threshold_cents),
			updated_at = CURRENT_TIMESTAMP
	`
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, query,
		settings.UserID, settings.WatermarkEnabled, settings.WatermarkText,
		settings.GeoBlockEnabled, regionsJSON, settings.ShowExplicitContent, settings.Discoverable,
		emailJSON, pushJSON, defaultPPVCents, settings.AutoWithdraw, withdrawThresholdCents,
	)
	if err != nil {
		return err
	}
	if settings.Paused != nil {
		status := "active"
		if *settings.Paused {
			status = "paused"
		}
		result, err := tx.ExecContext(ctx, `
			UPDATE performer_profiles SET status = $1, updated_at = CURRENT_TIMESTAMP
			WHERE user_id = $2 AND status IN ('active', 'paused')
		`, status, settings.UserID)
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
	}
	return tx.Commit()
}

// QueueDataExport reuses your existing export_jobs table for After Dark archives
func (r *ADSettingsRepository) QueueDataExport(ctx context.Context, jobID string, userID string) error {
	query := `
		INSERT INTO export_jobs (id, user_id, export_type, status, created_at, updated_at)
		VALUES ($1, $2, 'after_dark_archive', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`
	_, err := r.DB.ExecContext(ctx, query, jobID, userID)
	return err
}

// GetSettings fetches the creator's After Dark configuration
func (r *ADSettingsRepository) GetSettings(ctx context.Context, userID string) (map[string]interface{}, error) {
	query := `
		SELECT COALESCE(s.watermark_enabled, TRUE),
			COALESCE(pp.status = 'paused', FALSE),
			COALESCE(pp.dm_control, 'all'),
			COALESCE(s.geo_block_enabled, FALSE),
			COALESCE(s.blocked_regions, '[]'::jsonb)::text,
			COALESCE(s.watermark_text, ''),
			COALESCE(s.show_explicit_content, FALSE),
			COALESCE(s.discoverable, TRUE),
			COALESCE(s.notification_email, '{"subs":true,"tips":true,"messages":false,"marketing":false}'::jsonb)::text,
			COALESCE(s.notification_push, '{"subs":true,"tips":true,"messages":true,"mentions":true}'::jsonb)::text,
			COALESCE(s.default_ppv_cents, 0),
			COALESCE(s.auto_withdraw, FALSE),
			COALESCE(s.withdraw_threshold_cents, 0)
		FROM users u
		LEFT JOIN performer_profiles pp ON pp.user_id = u.id
		LEFT JOIN ad_creator_settings s ON s.user_id = u.id
		WHERE u.id = $1
	`

	var watermarkEnabled, isPaused, geoBlockEnabled bool
	var settingsShowExplicit, settingsDiscoverable, autoWithdraw bool
	var dmControl, blockedRegions, watermarkText, notificationEmail, notificationPush string
	var defaultPPVCents, withdrawThresholdCents int64
	err := r.DB.QueryRowContext(ctx, query, userID).Scan(
		&watermarkEnabled, &isPaused, &dmControl, &geoBlockEnabled, &blockedRegions,
		&watermarkText, &settingsShowExplicit, &settingsDiscoverable,
		&notificationEmail, &notificationPush, &defaultPPVCents, &autoWithdraw, &withdrawThresholdCents,
	)

	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"watermark_enabled":     watermarkEnabled,
		"watermark_text":        watermarkText,
		"is_paused":             isPaused,
		"dm_control":            dmControl,
		"geo_block_enabled":     geoBlockEnabled,
		"blocked_regions":       json.RawMessage(blockedRegions),
		"show_explicit_content": settingsShowExplicit,
		"discoverable":          settingsDiscoverable,
		"notification_email":    json.RawMessage(notificationEmail),
		"notification_push":     json.RawMessage(notificationPush),
		"default_ppv":           float64(defaultPPVCents) / 100,
		"auto_withdraw":         autoWithdraw,
		"withdraw_threshold":    float64(withdrawThresholdCents) / 100,
	}, nil
}

// GetTransactionHistory fetches a user's wallet ledger
func (r *ADFinanceRepository) GetTransactionHistory(ctx context.Context, userID string) ([]map[string]interface{}, error) {
	query := `
		SELECT id::text, transaction_type, amount_cents, reference_id,
		       COALESCE(description, ''), created_at
		FROM ad_ledger_entries
		WHERE user_id = $1
		ORDER BY created_at DESC LIMIT 50
	`
	rows, err := r.DB.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transactions []map[string]interface{}
	for rows.Next() {
		var id, txType, referenceID, description string
		var amountCents int64
		var createdAt time.Time

		if err := rows.Scan(&id, &txType, &amountCents, &referenceID, &description, &createdAt); err != nil {
			return nil, err
		}
		transactions = append(transactions, map[string]interface{}{
			"id":               id,
			"transaction_type": txType,
			"amount_cents":     amountCents,
			"reference_id":     referenceID,
			"description":      description,
			"status":           "completed",
			"created_at":       createdAt,
		})
	}

	if transactions == nil {
		transactions = []map[string]interface{}{}
	}
	return transactions, rows.Err()
}

// GetPayoutMethods fetches a creator's saved withdrawal destinations
func (r *ADFinanceRepository) GetPayoutMethods(ctx context.Context, userID string) ([]map[string]interface{}, error) {
	query := `SELECT id, provider, account_number, account_name, is_default FROM ad_payout_methods WHERE user_id = $1`
	rows, err := r.DB.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var methods []map[string]interface{}
	for rows.Next() {
		var id, provider, accNum, accName string
		var isDefault bool

		if err := rows.Scan(&id, &provider, &accNum, &accName, &isDefault); err == nil {
			// Mask the account number for security (e.g., *******1234)
			maskedAcc := accNum
			if len(accNum) > 4 {
				maskedAcc = "****" + accNum[len(accNum)-4:]
			}

			methods = append(methods, map[string]interface{}{
				"id":             id,
				"provider":       provider,
				"account_number": maskedAcc,
				"account_name":   accName,
				"is_default":     isDefault,
			})
		}
	}

	if methods == nil {
		methods = []map[string]interface{}{}
	}
	return methods, nil
}
