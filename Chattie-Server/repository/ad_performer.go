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
			id::text, user_id::text, status, verification_ref, payout_method_id, 
			policy_version, COALESCE(decision_reason_code, ''), submitted_at
		FROM performer_applications
		WHERE user_id = $1
		ORDER BY submitted_at DESC
		LIMIT 1
	`
	row := r.DB.QueryRowContext(ctx, query, userID)

	var app models.PerformerApplication

	err := row.Scan(
		&app.ID, &app.UserID, &app.Status, &app.VerificationRef,
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
		(id, user_id, status, verification_ref, payout_method_id, policy_version, submitted_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	_, err = tx.ExecContext(ctx, appQuery,
		app.ID, app.UserID, app.Status, app.VerificationRef,
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
