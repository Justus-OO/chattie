package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type BillingPayment struct {
	Reference         string
	UserID            string
	Provider          string
	ProviderSessionID string
	MerchantRequestID string
	Months            int
	AmountMinor       int64
	Currency          string
	Status            string
	ReceiptNumber     string
}

func (r *Repository) CreateBillingPaymentIntent(ctx context.Context, userID, provider string, months int, amountMinor int64, currency string) (string, error) {
	if months < 1 || amountMinor < 1 || strings.TrimSpace(userID) == "" {
		return "", fmt.Errorf("invalid billing payment intent")
	}
	reference := uuid.NewString()
	_, err := r.DB.ExecContext(ctx, `
		INSERT INTO billing_payment_intents
			(reference, user_id, provider, months, amount_minor, currency, status)
		VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
		reference, userID, provider, months, amountMinor, strings.ToUpper(currency))
	if err != nil {
		return "", fmt.Errorf("create billing payment intent: %w", err)
	}
	return reference, nil
}

func (r *Repository) SetBillingProviderSession(ctx context.Context, reference, sessionID, merchantRequestID string) error {
	result, err := r.DB.ExecContext(ctx, `
		UPDATE billing_payment_intents
		SET provider_session_id = $2, merchant_request_id = NULLIF($3, ''), updated_at = NOW()
		WHERE reference = $1 AND status = 'pending'`,
		reference, sessionID, merchantRequestID)
	if err != nil {
		return fmt.Errorf("save billing provider session: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check billing provider session update: %w", err)
	}
	if count != 1 {
		return fmt.Errorf("billing payment intent is no longer pending")
	}
	return nil
}

func (r *Repository) GetBillingPaymentByReference(ctx context.Context, reference, userID string) (*BillingPayment, error) {
	return r.getBillingPayment(ctx, `
		SELECT reference, user_id::text, provider, COALESCE(provider_session_id, ''),
		       COALESCE(merchant_request_id, ''), months, amount_minor, currency, status,
		       COALESCE(receipt_number, '')
		FROM billing_payment_intents
		WHERE reference = $1 AND user_id = $2`,
		reference, userID)
}

func (r *Repository) GetBillingPaymentByProviderSession(ctx context.Context, provider, sessionID string) (*BillingPayment, error) {
	return r.getBillingPayment(ctx, `
		SELECT reference, user_id::text, provider, COALESCE(provider_session_id, ''),
		       COALESCE(merchant_request_id, ''), months, amount_minor, currency, status,
		       COALESCE(receipt_number, '')
		FROM billing_payment_intents
		WHERE provider = $1 AND provider_session_id = $2`,
		provider, sessionID)
}

func (r *Repository) getBillingPayment(ctx context.Context, query string, args ...interface{}) (*BillingPayment, error) {
	var payment BillingPayment
	err := r.DB.QueryRowContext(ctx, query, args...).Scan(
		&payment.Reference, &payment.UserID, &payment.Provider, &payment.ProviderSessionID,
		&payment.MerchantRequestID, &payment.Months, &payment.AmountMinor, &payment.Currency,
		&payment.Status, &payment.ReceiptNumber)
	if err != nil {
		return nil, err
	}
	return &payment, nil
}

func (r *Repository) UpdateBillingPaymentStatus(ctx context.Context, reference, status, receipt string) error {
	switch status {
	case "pending", "failed":
	default:
		return fmt.Errorf("invalid billing payment status")
	}
	_, err := r.DB.ExecContext(ctx, `
		UPDATE billing_payment_intents
		SET status = $2, receipt_number = NULLIF($3, ''), updated_at = NOW()
		WHERE reference = $1 AND status <> 'paid'`,
		reference, status, receipt)
	if err != nil {
		return fmt.Errorf("update billing payment status: %w", err)
	}
	return nil
}

func (r *Repository) MarkBillingPaymentFailed(ctx context.Context, reference string) (bool, error) {
	result, err := r.DB.ExecContext(ctx, `
		UPDATE billing_payment_intents
		SET status = 'failed', updated_at = NOW()
		WHERE reference = $1 AND status = 'pending'`,
		reference)
	if err != nil {
		return false, fmt.Errorf("mark billing payment failed: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("check billing payment failure update: %w", err)
	}
	return rows == 1, nil
}

func (r *Repository) SetBillingPaymentReceipt(ctx context.Context, reference, receipt string) error {
	if strings.TrimSpace(receipt) == "" {
		return nil
	}
	_, err := r.DB.ExecContext(ctx, `
		UPDATE billing_payment_intents
		SET receipt_number = $2, updated_at = NOW()
		WHERE reference = $1`,
		reference, receipt)
	if err != nil {
		return fmt.Errorf("save billing provider receipt: %w", err)
	}
	return nil
}

func (r *Repository) CompleteBillingPayment(ctx context.Context, reference, userID string) (int, bool, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, false, err
	}
	defer tx.Rollback()

	var storedUserID, status string
	var months int
	err = tx.QueryRowContext(ctx, `
		SELECT user_id::text, months, status
		FROM billing_payment_intents
		WHERE reference = $1
		FOR UPDATE`, reference).Scan(&storedUserID, &months, &status)
	if err != nil {
		return 0, false, err
	}
	if storedUserID != userID {
		return 0, false, fmt.Errorf("billing payment does not belong to user")
	}
	if status == "paid" {
		return months, false, nil
	}

	if err := upgradeToPremiumTx(ctx, tx, userID, months); err != nil {
		return 0, false, err
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE billing_payment_intents
		SET status = 'paid', paid_at = $2, updated_at = $2
		WHERE reference = $1`,
		reference, time.Now())
	if err != nil {
		return 0, false, err
	}
	if err := tx.Commit(); err != nil {
		return 0, false, err
	}
	return months, true, nil
}
