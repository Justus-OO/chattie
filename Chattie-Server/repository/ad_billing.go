package repository

import (
	"context"
	"database/sql"
	"errors"

	"chattie-backend/models"
)

type ADBillingRepository struct {
	DB *sql.DB
}

func NewADBillingRepository(db *sql.DB) *ADBillingRepository {
	return &ADBillingRepository{DB: db}
}

// GetWallet fetches the user's current cached balance
func (r *ADBillingRepository) GetWallet(ctx context.Context, userID string) (*models.ADWallet, error) {
	query := `SELECT user_id::text, available_balance_cents, pending_balance_cents, updated_at FROM ad_wallets WHERE user_id = $1`
	var w models.ADWallet
	err := r.DB.QueryRowContext(ctx, query, userID).Scan(&w.UserID, &w.AvailableBalanceCents, &w.PendingBalanceCents, &w.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			// Return a zero-balance wallet if they don't have one yet
			return &models.ADWallet{UserID: userID, AvailableBalanceCents: 0, PendingBalanceCents: 0}, nil
		}
		return nil, err
	}
	return &w, nil
}

// PurchasePPV handles deducting from wallet, crediting creator, and granting post access atomically
func (r *ADBillingRepository) PurchasePPV(ctx context.Context, buyerID string, creatorID string, postID string, priceCents int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Use the post's current price and owner; checkout values from the client are untrusted.
	var postCreatorID string
	var currentPrice int64
	var accessType string
	err = tx.QueryRowContext(ctx, `
		SELECT creator_id::text, price_cents, access_type
		FROM ad_posts
		WHERE id = $1 AND status = 'published'
		FOR UPDATE
	`, postID).Scan(&postCreatorID, &currentPrice, &accessType)
	if err != nil {
		return err
	}
	if accessType != "ppv" || currentPrice <= 0 {
		return errors.New("post is not available for PPV purchase")
	}
	if buyerID == postCreatorID {
		return errors.New("creators cannot purchase their own post")
	}
	creatorID = postCreatorID
	priceCents = currentPrice

	var alreadyEntitled bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM ad_post_entitlements WHERE user_id = $1 AND post_id = $2
		)
	`, buyerID, postID).Scan(&alreadyEntitled); err != nil {
		return err
	}
	if alreadyEntitled {
		return errors.New("post is already unlocked")
	}

	// 1. Check buyer balance
	var balance int64
	err = tx.QueryRowContext(ctx, `SELECT available_balance_cents FROM ad_wallets WHERE user_id = $1 FOR UPDATE`, buyerID).Scan(&balance)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if err == sql.ErrNoRows || balance < priceCents {
		return errors.New("insufficient funds")
	}

	// 2. Deduct from Buyer
	_, err = tx.ExecContext(ctx, `UPDATE ad_wallets SET available_balance_cents = available_balance_cents - $1 WHERE user_id = $2`, priceCents, buyerID)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description) VALUES ($1, $2, 'ppv_purchase', $3, 'Unlocked PPV Post')`, buyerID, -priceCents, postID)
	if err != nil {
		return err
	}

	// 3. Credit Creator (Using 80% payout logic as an example)
	creatorCut := int64(float64(priceCents) * 0.80)

	// Upsert creator wallet
	_, err = tx.ExecContext(ctx, `
		INSERT INTO ad_wallets (user_id, pending_balance_cents) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET pending_balance_cents = ad_wallets.pending_balance_cents + $2
	`, creatorID, creatorCut)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description) VALUES ($1, $2, 'ppv_earning', $3, 'PPV Post Unlocked')`, creatorID, creatorCut, postID)
	if err != nil {
		return err
	}

	// 4. Grant Entitlement
	_, err = tx.ExecContext(ctx, `INSERT INTO ad_post_entitlements (user_id, post_id, payment_ref) VALUES ($1, $2, 'wallet_transfer')`, buyerID, postID)
	if err != nil {
		return err
	}

	return tx.Commit()
}
