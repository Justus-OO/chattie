package repository

import (
	"context"
	"database/sql"

	"chattie-backend/models"
)

type ADPerformerRepository struct {
	DB *sql.DB
}

func NewADPerformerRepository(db *sql.DB) *ADPerformerRepository {
	return &ADPerformerRepository{DB: db}
}

func (r *ADPerformerRepository) GetApplicationByUserID(ctx context.Context, userID string) (*models.PerformerApplication, error) {
	query := `
		SELECT 
			id::text, user_id::text, creator_alias, status, COALESCE(verification_ref, ''), COALESCE(payout_method_id, ''),
			policy_version, COALESCE(decision_reason_code, ''), submitted_at
		FROM performer_applications
		WHERE user_id = $1
		ORDER BY submitted_at DESC
		LIMIT 1
	`
	row := r.DB.QueryRowContext(ctx, query, userID)

	var app models.PerformerApplication

	err := row.Scan(
		&app.ID, &app.UserID, &app.CreatorAlias, &app.Status, &app.VerificationRef,
		&app.PayoutMethodID, &app.PolicyVersion, &app.DecisionReasonCode, &app.SubmittedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &app, nil
}

func (r *ADPerformerRepository) SubmitApplication(ctx context.Context, app *models.PerformerApplication, consents []models.PerformerConsent) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	appQuery := `
		INSERT INTO performer_applications 
		(id, user_id, creator_alias, status, verification_ref, payout_method_id, policy_version, submitted_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	_, err = tx.ExecContext(ctx, appQuery,
		app.ID, app.UserID, app.CreatorAlias, app.Status, app.VerificationRef,
		app.PayoutMethodID, app.PolicyVersion, app.SubmittedAt,
	)
	if err != nil {
		return err
	}

	consentQuery := `
		INSERT INTO performer_consents (id, user_id, consent_type, policy_version, accepted_at)
		VALUES ($1, $2, $3, $4, $5)
	`
	for _, c := range consents {
		_, err = tx.ExecContext(ctx, consentQuery, c.ID, c.UserID, c.ConsentType, c.PolicyVersion, c.AcceptedAt)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (r *ADPerformerRepository) ApproveEligibleApplications(ctx context.Context) (int64, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		UPDATE performer_applications AS application
		SET status = 'approved',
		    decision_reason_code = 'auto_approved_verified_consent',
		    reviewed_at = CURRENT_TIMESTAMP
		FROM user_profiles AS profile
		WHERE application.user_id = profile.user_id
		  AND application.status = 'pending'
		  AND profile.verified = TRUE
		  AND profile.date_of_birth <= CURRENT_DATE - INTERVAL '18 years'
		  AND BTRIM(application.creator_alias) <> ''
		  AND BTRIM(application.policy_version) <> ''
		  AND NOT EXISTS (
		      SELECT 1
		      FROM performer_applications AS approved
		      WHERE approved.user_id = application.user_id
		        AND approved.status = 'approved'
		  )
		  AND EXISTS (
		      SELECT 1
		      FROM user_action_logs AS verification
		      WHERE verification.user_id = application.user_id
		        AND verification.action_type = 'KYC_VERIFICATION_PASSED'
		  )
		  AND (
		      SELECT COUNT(DISTINCT consent.consent_type)
		      FROM performer_consents AS consent
		      WHERE consent.user_id = application.user_id
		        AND consent.policy_version = application.policy_version
		        AND consent.accepted_at >= application.submitted_at
		        AND consent.consent_type IN (
		            'age_attestation',
		            'content_ownership',
		            'revenue_split',
		            'zero_tolerance'
		        )
		  ) = 4
		  AND application.id = (
		      SELECT latest.id
		      FROM performer_applications AS latest
		      WHERE latest.user_id = application.user_id
		        AND latest.status = 'pending'
		      ORDER BY latest.submitted_at DESC
		      LIMIT 1
		  )
	`)
	if err != nil {
		return 0, err
	}
	approvedCount, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO performer_profiles (user_id, display_name, username, status)
		SELECT DISTINCT ON (application.user_id)
			application.user_id,
			COALESCE(NULLIF(BTRIM(application.creator_alias), ''), users.username),
			LEFT(
				REGEXP_REPLACE(LOWER(COALESCE(NULLIF(BTRIM(users.username), ''), application.creator_alias, 'creator')), '[^a-z0-9_]+', '_', 'g'),
				60
			) || '_' || LEFT(REPLACE(application.user_id::text, '-', ''), 32),
			'active'
		FROM performer_applications AS application
		JOIN users ON users.id = application.user_id
		WHERE application.status = 'approved'
		ORDER BY application.user_id, application.reviewed_at DESC NULLS LAST, application.submitted_at DESC
		ON CONFLICT (user_id) DO UPDATE
		SET status = 'active', updated_at = CURRENT_TIMESTAMP
		WHERE performer_profiles.status = 'pending'
	`)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return approvedCount, nil
}
