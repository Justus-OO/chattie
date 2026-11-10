package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"chattie-backend/models"
	"github.com/google/uuid"
)

type ADFinanceRepository struct {
	DB *sql.DB
}

func NewADFinanceRepository(db *sql.DB) *ADFinanceRepository {
	return &ADFinanceRepository{DB: db}
}

// CreateDepositIntent creates a pending record for a wallet top-up
func (r *ADFinanceRepository) CreateDepositIntent(ctx context.Context, intent *models.ADDepositIntent) error {
	query := `
		INSERT INTO ad_deposit_intents (id, user_id, amount_cents, provider, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	_, err := r.DB.ExecContext(ctx, query,
		intent.ID, intent.UserID, intent.AmountCents, intent.Provider,
		intent.Status, intent.CreatedAt, intent.UpdatedAt,
	)
	return err
}

func (r *ADFinanceRepository) GetDepositIntent(ctx context.Context, intentID string, userID string) (*models.ADDepositIntent, error) {
	var intent models.ADDepositIntent
	err := r.DB.QueryRowContext(ctx, `
		SELECT id::text, user_id::text, amount_cents, provider, status, created_at, updated_at
		FROM ad_deposit_intents WHERE id = $1 AND user_id = $2
	`, intentID, userID).Scan(
		&intent.ID, &intent.UserID, &intent.AmountCents, &intent.Provider,
		&intent.Status, &intent.CreatedAt, &intent.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &intent, nil
}

func (r *ADFinanceRepository) SendTip(ctx context.Context, senderID string, creatorID string, amountCents int64, message string) (string, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	var creatorUserID string
	err = tx.QueryRowContext(ctx, `
		SELECT user_id::text FROM performer_profiles
		WHERE (id::text = $1 OR user_id::text = $1) AND status = 'active'
		FOR UPDATE
	`, creatorID).Scan(&creatorUserID)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", errors.New("creator not found or unavailable")
		}
		return "", err
	}
	if senderID == creatorUserID {
		return "", errors.New("you cannot tip yourself")
	}

	var balance int64
	err = tx.QueryRowContext(ctx, `
		SELECT available_balance_cents FROM ad_wallets WHERE user_id = $1 FOR UPDATE
	`, senderID).Scan(&balance)
	if err != nil || balance < amountCents {
		return "", errors.New("insufficient funds")
	}

	tipID := uuid.New().String()
	if _, err := tx.ExecContext(ctx, `
		UPDATE ad_wallets
		SET available_balance_cents = available_balance_cents - $1, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $2
	`, amountCents, senderID); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_wallets (user_id, pending_balance_cents)
		VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET
			pending_balance_cents = ad_wallets.pending_balance_cents + EXCLUDED.pending_balance_cents,
			updated_at = CURRENT_TIMESTAMP
	`, creatorUserID, amountCents); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
		VALUES ($1, $2, 'tip_sent', $3, $4), ($5, $6, 'tip_received', $3, $4)
	`, senderID, -amountCents, tipID, message, creatorUserID, amountCents); err != nil {
		return "", err
	}
	return tipID, tx.Commit()
}

// RequestWithdrawal atomically checks cleared balance, deducts it, and creates a withdrawal record
func (r *ADFinanceRepository) RequestWithdrawal(ctx context.Context, withdrawal *models.ADWithdrawal) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Lock the wallet row to prevent race conditions
	var pendingBalance int64
	err = tx.QueryRowContext(ctx, `SELECT pending_balance_cents FROM ad_wallets WHERE user_id = $1 FOR UPDATE`, withdrawal.UserID).Scan(&pendingBalance)
	if err != nil {
		return errors.New("wallet not found")
	}

	// 2. Validate sufficient cleared/pending funds
	if pendingBalance < withdrawal.AmountCents {
		return errors.New("insufficient cleared funds for payout")
	}

	// 3. Deduct from wallet's pending/cleared balance (reserving it)
	_, err = tx.ExecContext(ctx, `UPDATE ad_wallets SET pending_balance_cents = pending_balance_cents - $1 WHERE user_id = $2`, withdrawal.AmountCents, withdrawal.UserID)
	if err != nil {
		return err
	}

	// 4. Create the withdrawal request record
	query := `
		INSERT INTO ad_withdrawals (id, user_id, amount_cents, payout_method_id, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	_, err = tx.ExecContext(ctx, query,
		withdrawal.ID, withdrawal.UserID, withdrawal.AmountCents,
		withdrawal.PayoutMethodID, withdrawal.Status, withdrawal.CreatedAt, withdrawal.UpdatedAt,
	)
	if err != nil {
		return err
	}

	// 5. Log it to the immutable ledger as a pending debit
	_, err = tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
		VALUES ($1, $2, 'withdrawal', $3, 'Payout requested')
	`, withdrawal.UserID, -withdrawal.AmountCents, withdrawal.ID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// AddPayoutMethod securely stores a creator's withdrawal destination
func (r *ADFinanceRepository) AddPayoutMethod(ctx context.Context, methodID string, userID string, provider string, accountNumber string, accountName string) error {
	query := `
		INSERT INTO ad_payout_methods (id, user_id, provider, account_number, account_name) 
		VALUES ($1, $2, $3, $4, $5)
	`
	_, err := r.DB.ExecContext(ctx, query, methodID, userID, provider, accountNumber, accountName)
	return err
}

// GetEarnings fetches the creator's earnings summary from their wallet
func (r *ADFinanceRepository) GetEarnings(ctx context.Context, userID string) (map[string]interface{}, error) {
	query := `SELECT available_balance_cents, pending_balance_cents FROM ad_wallets WHERE user_id = $1`
	var available, pending int64

	err := r.DB.QueryRowContext(ctx, query, userID).Scan(&available, &pending)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}

	return map[string]interface{}{
		"total_earned_cents": available + pending,
		"pending_cents":      pending,
		"available_cents":    available,
		"history":            []interface{}{},
	}, nil
}

// GetWithdrawals fetches the creator's withdrawal request history
func (r *ADFinanceRepository) GetWithdrawals(ctx context.Context, userID string) ([]map[string]interface{}, error) {
	query := `
		SELECT id, amount_cents, status, created_at 
		FROM ad_withdrawals 
		WHERE user_id = $1 
		ORDER BY created_at DESC LIMIT 50
	`
	rows, err := r.DB.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var withdrawals []map[string]interface{}
	for rows.Next() {
		var id, status string
		var amount int64
		var createdAt time.Time
		if err := rows.Scan(&id, &amount, &status, &createdAt); err == nil {
			withdrawals = append(withdrawals, map[string]interface{}{
				"id":           id,
				"amount_cents": amount,
				"status":       status,
				"created_at":   createdAt,
			})
		}
	}

	if withdrawals == nil {
		withdrawals = []map[string]interface{}{}
	}
	return withdrawals, nil
}
