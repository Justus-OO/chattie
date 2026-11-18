package repository

import (
	"context"
	"database/sql"
	"errors"

	"chattie-backend/models"
)

var ErrCreatorApplicationNotEligible = errors.New("creator application does not meet approval requirements")

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

func (r *ADPerformerRepository) ListPendingApplications(ctx context.Context) ([]models.AdminPerformerApplication, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT application.id::text, application.user_id::text, users.username, users.email,
		       application.creator_alias, application.status, COALESCE(application.policy_version, ''),
		       COALESCE(application.decision_reason_code, ''),
		       COALESCE(application.ai_triage_summary, ''),
		       application.submitted_at,
		       (
		           COALESCE(profile.verified, FALSE)
		           AND BTRIM(application.creator_alias) <> ''
		           AND BTRIM(COALESCE(application.policy_version, '')) <> ''
		           AND profile.date_of_birth <= CURRENT_DATE - INTERVAL '18 years'
		           AND EXISTS (
		               SELECT 1 FROM user_action_logs verification
		               WHERE verification.user_id = application.user_id
		                 AND verification.action_type = 'KYC_VERIFICATION_PASSED'
		           )
		           AND (
		               SELECT COUNT(DISTINCT consent.consent_type)
		               FROM performer_consents consent
		               WHERE consent.user_id = application.user_id
		                 AND consent.policy_version = application.policy_version
		                 AND consent.accepted_at >= application.submitted_at
		                 AND consent.consent_type IN ('age_attestation', 'content_ownership', 'revenue_split', 'zero_tolerance')
		           ) = 4
		           AND NOT EXISTS (
		               SELECT 1 FROM performer_applications approved
		               WHERE approved.user_id = application.user_id
		                 AND approved.status = 'approved'
		           )
		       ) AS eligible_for_approval
		FROM performer_applications application
		JOIN users ON users.id = application.user_id
		LEFT JOIN user_profiles profile ON profile.user_id = application.user_id
		WHERE application.status = 'pending'
		ORDER BY application.submitted_at ASC
		LIMIT 200
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	applications := make([]models.AdminPerformerApplication, 0)
	for rows.Next() {
		var application models.AdminPerformerApplication
		if err := rows.Scan(
			&application.ID, &application.UserID, &application.Username, &application.Email,
			&application.CreatorAlias, &application.Status, &application.PolicyVersion,
			&application.DecisionReasonCode, &application.AISummary, &application.SubmittedAt,
			&application.EligibleForApproval,
		); err != nil {
			return nil, err
		}
		applications = append(applications, application)
	}
	return applications, rows.Err()
}

func (r *ADPerformerRepository) ReviewApplication(ctx context.Context, adminID, applicationID, decision string) error {
	if decision != "approve" && decision != "reject" {
		return errors.New("creator application decision is invalid")
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var userID string
	if err := tx.QueryRowContext(ctx, `
		SELECT user_id::text
		FROM performer_applications
		WHERE id = $1 AND status = 'pending'
		FOR UPDATE
	`, applicationID).Scan(&userID); err != nil {
		return err
	}
	if decision == "approve" {
		var eligible bool
		if err := tx.QueryRowContext(ctx, `
			SELECT (
			    COALESCE(profile.verified, FALSE)
			    AND BTRIM(application.creator_alias) <> ''
			    AND BTRIM(COALESCE(application.policy_version, '')) <> ''
			    AND profile.date_of_birth <= CURRENT_DATE - INTERVAL '18 years'
			    AND EXISTS (
			        SELECT 1 FROM user_action_logs verification
			        WHERE verification.user_id = application.user_id
			          AND verification.action_type = 'KYC_VERIFICATION_PASSED'
			    )
			    AND (
			        SELECT COUNT(DISTINCT consent.consent_type)
			        FROM performer_consents consent
			        WHERE consent.user_id = application.user_id
			          AND consent.policy_version = application.policy_version
			          AND consent.accepted_at >= application.submitted_at
			          AND consent.consent_type IN ('age_attestation', 'content_ownership', 'revenue_split', 'zero_tolerance')
			    ) = 4
			    AND NOT EXISTS (
			        SELECT 1 FROM performer_applications approved
			        WHERE approved.user_id = application.user_id
			          AND approved.status = 'approved'
			    )
			)
			FROM performer_applications application
			LEFT JOIN user_profiles profile ON profile.user_id = application.user_id
			WHERE application.id = $1 AND application.status = 'pending'
		`, applicationID).Scan(&eligible); err != nil {
			return err
		}
		if !eligible {
			return ErrCreatorApplicationNotEligible
		}
	}

	status := "rejected"
	reasonCode := "admin_rejected"
	if decision == "approve" {
		status = "approved"
		reasonCode = "admin_approved"
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE performer_applications
		SET status = $1, decision_reason_code = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP
		WHERE id = $4 AND status = 'pending' AND user_id = $5
	`, status, reasonCode, adminID, applicationID, userID); err != nil {
		return err
	}
	if decision == "approve" {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO performer_profiles (user_id, display_name, username, status)
			SELECT application.user_id,
			       COALESCE(NULLIF(BTRIM(application.creator_alias), ''), users.username),
			       LEFT(
			           REGEXP_REPLACE(LOWER(COALESCE(NULLIF(BTRIM(users.username), ''), application.creator_alias, 'creator')), '[^a-z0-9_]+', '_', 'g'),
			           60
			       ) || '_' || LEFT(REPLACE(application.user_id::text, '-', ''), 32),
			       'active'
			FROM performer_applications application
			JOIN users ON users.id = application.user_id
			WHERE application.id = $1
			ON CONFLICT (user_id) DO UPDATE
			SET status = 'active', updated_at = CURRENT_TIMESTAMP
			WHERE performer_profiles.status = 'pending'
		`, applicationID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
