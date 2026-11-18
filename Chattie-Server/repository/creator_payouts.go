package repository

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"chattie-backend/models"
)

var (
	ErrCreatorPayoutNotFound          = errors.New("creator payout request not found")
	ErrCreatorPayoutConflict          = errors.New("creator payout request is no longer actionable")
	ErrCreatorPayoutBalance           = errors.New("insufficient available balance")
	ErrCreatorPayoutMethod            = errors.New("payout wallet is not configured for this network")
	ErrCreatorPayoutKeyReuse          = errors.New("payout idempotency key was reused with different request data")
	ErrCreatorPayoutDuplicate         = errors.New("payout request already exists for this idempotency key")
	ErrCreatorPayoutInvalidSubmission = errors.New("crypto amount or transaction hash is invalid for the payout network")
)

const minimumCreatorPayoutCents int64 = 5000

func isCreatorPayoutNetwork(network string) bool {
	return models.IsSupportedCreatorPayoutNetwork(network)
}

func (r *Repository) GetCreatorPayoutMethods(ctx context.Context, creatorID string) ([]models.CreatorPayoutMethod, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT asset_network, wallet_address, updated_at
		FROM creator_payout_methods
		WHERE creator_id = $1
		ORDER BY asset_network
	`, creatorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	methods := make([]models.CreatorPayoutMethod, 0)
	for rows.Next() {
		var method models.CreatorPayoutMethod
		if err := rows.Scan(&method.AssetNetwork, &method.WalletAddress, &method.UpdatedAt); err != nil {
			return nil, err
		}
		methods = append(methods, method)
	}
	return methods, rows.Err()
}

func (r *Repository) UpsertCreatorPayoutMethod(ctx context.Context, creatorID, network, walletAddress string) error {
	if !isCreatorPayoutNetwork(network) {
		return errors.New("unsupported creator payout network")
	}
	_, err := r.DB.ExecContext(ctx, `
		INSERT INTO creator_payout_methods (creator_id, asset_network, wallet_address)
		VALUES ($1, $2, $3)
		ON CONFLICT (creator_id, asset_network) DO UPDATE
		SET wallet_address = EXCLUDED.wallet_address, updated_at = NOW()
	`, creatorID, network, walletAddress)
	return err
}

func (r *Repository) GetCreatorPayoutRequests(ctx context.Context, creatorID string) ([]models.CreatorPayoutRequest, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id::text, amount_cents, asset_network, wallet_address, status,
		       COALESCE(crypto_amount::text, ''), COALESCE(transaction_hash, ''),
		       COALESCE(rejection_reason, ''), created_at, updated_at, paid_at
		FROM creator_payout_requests
		WHERE creator_id = $1
		ORDER BY created_at DESC
		LIMIT 100
	`, creatorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCreatorPayoutRequests(rows, false)
}

func (r *Repository) GetAdminCreatorPayoutRequests(ctx context.Context, status string) ([]models.CreatorPayoutRequest, error) {
	query := `
		SELECT pr.id::text, pr.creator_id::text,
		       COALESCE(NULLIF(up.display_name, ''), u.username), u.email,
		       pr.amount_cents, pr.asset_network, pr.wallet_address, pr.status,
		       COALESCE(pr.crypto_amount::text, ''), COALESCE(pr.transaction_hash, ''),
		       COALESCE(pr.rejection_reason, ''), pr.created_at, pr.updated_at, pr.paid_at
		FROM creator_payout_requests pr
		JOIN users u ON u.id = pr.creator_id
		LEFT JOIN user_profiles up ON up.user_id = u.id
	`
	var rows *sql.Rows
	var err error
	if status == "" || status == "ALL" {
		rows, err = r.DB.QueryContext(ctx, query+` ORDER BY pr.created_at DESC LIMIT 500`)
	} else {
		rows, err = r.DB.QueryContext(ctx, query+` WHERE pr.status = $1 ORDER BY pr.created_at DESC LIMIT 500`, status)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCreatorPayoutRequests(rows, true)
}

func scanCreatorPayoutRequests(rows *sql.Rows, includeCreator bool) ([]models.CreatorPayoutRequest, error) {
	requests := make([]models.CreatorPayoutRequest, 0)
	for rows.Next() {
		var request models.CreatorPayoutRequest
		var paidAt sql.NullTime
		if includeCreator {
			if err := rows.Scan(
				&request.ID,
				&request.CreatorID,
				&request.CreatorName,
				&request.CreatorEmail,
				&request.AmountCents,
				&request.AssetNetwork,
				&request.WalletAddress,
				&request.Status,
				&request.CryptoAmount,
				&request.TransactionHash,
				&request.RejectionReason,
				&request.CreatedAt,
				&request.UpdatedAt,
				&paidAt,
			); err != nil {
				return nil, err
			}
		} else if err := rows.Scan(
			&request.ID,
			&request.AmountCents,
			&request.AssetNetwork,
			&request.WalletAddress,
			&request.Status,
			&request.CryptoAmount,
			&request.TransactionHash,
			&request.RejectionReason,
			&request.CreatedAt,
			&request.UpdatedAt,
			&paidAt,
		); err != nil {
			return nil, err
		}
		if paidAt.Valid {
			request.PaidAt = &paidAt.Time
		}
		requests = append(requests, request)
	}
	return requests, rows.Err()
}

func (r *Repository) RequestCreatorCryptoPayout(ctx context.Context, creatorID, idempotencyKey string, amountCents int64, network string) error {
	if amountCents < minimumCreatorPayoutCents {
		return errors.New("minimum withdrawal is $50.00")
	}
	if !isCreatorPayoutNetwork(network) {
		return errors.New("unsupported creator payout network")
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `
		INSERT INTO creator_stats (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING
	`, creatorID)
	if err != nil {
		return err
	}

	var availableCents int64
	if err := tx.QueryRowContext(ctx, `
		SELECT ROUND(current_balance * 100)::bigint
		FROM creator_stats
		WHERE user_id = $1
		FOR UPDATE
	`, creatorID).Scan(&availableCents); err != nil {
		return err
	}

	var existingAmountCents int64
	var existingNetwork string
	err = tx.QueryRowContext(ctx, `
		SELECT amount_cents, asset_network
		FROM creator_payout_requests
		WHERE creator_id = $1 AND idempotency_key = $2
	`, creatorID, idempotencyKey).Scan(&existingAmountCents, &existingNetwork)
	if err == nil {
		if existingAmountCents != amountCents || existingNetwork != network {
			return ErrCreatorPayoutKeyReuse
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		return ErrCreatorPayoutDuplicate
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	if amountCents > availableCents {
		return ErrCreatorPayoutBalance
	}

	var walletAddress string
	if err := tx.QueryRowContext(ctx, `
		SELECT wallet_address
		FROM creator_payout_methods
		WHERE creator_id = $1 AND asset_network = $2
	`, creatorID, network).Scan(&walletAddress); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrCreatorPayoutMethod
		}
		return err
	}
	if !models.IsValidCreatorPayoutWallet(network, walletAddress) {
		return ErrCreatorPayoutMethod
	}

	var requestID string
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO creator_payout_requests (creator_id, idempotency_key, amount_cents, asset_network, wallet_address)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id::text
	`, creatorID, idempotencyKey, amountCents, network, walletAddress).Scan(&requestID); err != nil {
		return err
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE creator_stats
		SET current_balance = current_balance - ($2::numeric / 100), updated_at = NOW()
		WHERE user_id = $1 AND ROUND(current_balance * 100)::bigint >= $2
	`, creatorID, amountCents)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected != 1 {
		return ErrCreatorPayoutBalance
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO transactions (model_id, tx_type, amount, status, payout_request_id)
		VALUES ($1, 'CRYPTO_PAYOUT', -($2::numeric / 100), 'PENDING', $3)
	`, creatorID, amountCents, requestID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (r *Repository) ReviewCreatorPayout(ctx context.Context, requestID, adminID, action, reason, cryptoAmount, transactionHash string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var creatorID, status, network string
	var amountCents int64
	err = tx.QueryRowContext(ctx, `
		SELECT creator_id::text, amount_cents, status, asset_network
		FROM creator_payout_requests
		WHERE id = $1
		FOR UPDATE
	`, requestID).Scan(&creatorID, &amountCents, &status, &network)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrCreatorPayoutNotFound
	}
	if err != nil {
		return err
	}

	switch action {
	case "APPROVE":
		if status != "PENDING" {
			return ErrCreatorPayoutConflict
		}
		result, err := tx.ExecContext(ctx, `
			UPDATE creator_payout_requests
			SET status = 'APPROVED', reviewed_by = $2, updated_at = NOW()
			WHERE id = $1
		`, requestID, adminID)
		if err != nil {
			return err
		}
		if affected, err := result.RowsAffected(); err != nil {
			return err
		} else if affected != 1 {
			return ErrCreatorPayoutConflict
		}
		result, err = tx.ExecContext(ctx, `
			UPDATE transactions
			SET status = 'PROCESSING'
			WHERE payout_request_id = $1 AND tx_type = 'CRYPTO_PAYOUT'
		`, requestID)
		if err != nil {
			return err
		}
		if affected, err := result.RowsAffected(); err != nil {
			return err
		} else if affected != 1 {
			return errors.New("payout ledger entry is missing")
		}

	case "REJECT":
		if status != "PENDING" && status != "APPROVED" {
			return ErrCreatorPayoutConflict
		}
		reason = strings.TrimSpace(reason)
		if reason == "" {
			return errors.New("rejection reason is required")
		}
		result, err := tx.ExecContext(ctx, `
			UPDATE creator_stats
			SET current_balance = current_balance + ($2::numeric / 100), updated_at = NOW()
			WHERE user_id = $1
		`, creatorID, amountCents)
		if err != nil {
			return err
		}
		if affected, err := result.RowsAffected(); err != nil {
			return err
		} else if affected != 1 {
			return errors.New("creator balance could not be restored")
		}
		result, err = tx.ExecContext(ctx, `
			UPDATE transactions
			SET status = 'REJECTED'
			WHERE payout_request_id = $1 AND tx_type = 'CRYPTO_PAYOUT'
		`, requestID)
		if err != nil {
			return err
		}
		if affected, err := result.RowsAffected(); err != nil {
			return err
		} else if affected != 1 {
			return errors.New("payout ledger entry is missing")
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO transactions (model_id, tx_type, amount, status, payout_request_id)
			VALUES ($1, 'PAYOUT_REVERSAL', $2::numeric / 100, 'COMPLETED', $3)
		`, creatorID, amountCents, requestID)
		if err != nil {
			return err
		}
		result, err = tx.ExecContext(ctx, `
			UPDATE creator_payout_requests
			SET status = 'REJECTED', rejection_reason = $2, reviewed_by = $3, updated_at = NOW()
			WHERE id = $1
		`, requestID, reason, adminID)
		if err != nil {
			return err
		}
		if affected, err := result.RowsAffected(); err != nil {
			return err
		} else if affected != 1 {
			return ErrCreatorPayoutConflict
		}

	case "PAID":
		if status != "APPROVED" {
			return ErrCreatorPayoutConflict
		}
		transactionHash = strings.TrimSpace(transactionHash)
		if !models.IsValidCreatorCryptoAmount(cryptoAmount) ||
			!models.IsValidCreatorPayoutTransactionHashForNetwork(network, transactionHash) {
			return ErrCreatorPayoutInvalidSubmission
		}
		result, err := tx.ExecContext(ctx, `
			UPDATE creator_payout_requests
			SET status = 'PAID', crypto_amount = $2::numeric(30,12), transaction_hash = $3,
			    reviewed_by = $4, paid_at = NOW(), updated_at = NOW()
			WHERE id = $1
		`, requestID, cryptoAmount, transactionHash, adminID)
		if err != nil {
			return err
		}
		if affected, err := result.RowsAffected(); err != nil {
			return err
		} else if affected != 1 {
			return ErrCreatorPayoutConflict
		}
		result, err = tx.ExecContext(ctx, `
			UPDATE transactions
			SET status = 'COMPLETED'
			WHERE payout_request_id = $1 AND tx_type = 'CRYPTO_PAYOUT'
		`, requestID)
		if err != nil {
			return err
		}
		if affected, err := result.RowsAffected(); err != nil {
			return err
		} else if affected != 1 {
			return errors.New("payout ledger entry is missing")
		}

	default:
		return errors.New("unsupported creator payout action")
	}
	return tx.Commit()
}
