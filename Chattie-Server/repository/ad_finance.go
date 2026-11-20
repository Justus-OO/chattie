package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"chattie-backend/models"
	"github.com/google/uuid"
)

type ADFinanceRepository struct {
	DB *sql.DB
}

type ADPayoutMethod struct {
	ID            string
	UserID        string
	Provider      string
	AccountNumber string
	AccountName   string
	BankCode      string
}

var (
	ErrInsufficientClearedFunds = errors.New("insufficient cleared funds for payout")
	ErrPayoutMethodNotFound     = errors.New("payout method not found")
	ErrWithdrawalInProgress     = errors.New("an earlier withdrawal is still being processed")
	ErrInvalidWithdrawal        = errors.New("invalid withdrawal amounts")
	ErrWithdrawalNotFound       = errors.New("withdrawal not found for provider result")
	ErrWithdrawalConflict       = errors.New("provider result conflicts with the recorded withdrawal status")
	ErrEarningsOnHold           = errors.New("creator earnings are on hold")
	ErrTippingLockedOut         = errors.New("tipping is temporarily locked after consecutive card payment failures")
)

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

	tipID, err := r.sendTipTx(ctx, tx, senderID, creatorID, amountCents, message)
	if err != nil {
		return "", err
	}
	return tipID, tx.Commit()
}

func (r *ADFinanceRepository) SendLiveTip(ctx context.Context, senderID string, sessionID string, amountCents int64, message string) (string, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	var creatorID string
	var hasAccess bool
	err = tx.QueryRowContext(ctx, `
		SELECT ls.creator_id::text,
			(ls.creator_id = $2 OR ls.price_cents = 0
				OR EXISTS (
					SELECT 1 FROM ad_live_entitlements e
					WHERE e.user_id = $2 AND e.session_id = ls.id
				)
				OR EXISTS (
					SELECT 1 FROM ad_subscriptions sub
					WHERE sub.subscriber_id = $2 AND sub.creator_id = ls.creator_id
					  AND sub.status = 'active' AND sub.current_period_end > CURRENT_TIMESTAMP
				)
			) AS has_access
		FROM ad_live_sessions ls
		WHERE ls.id = $1 AND ls.status = 'live'
		FOR SHARE OF ls
	`, sessionID, senderID).Scan(&creatorID, &hasAccess)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", errors.New("live session not found")
		}
		return "", err
	}
	if !hasAccess {
		return "", errors.New("live session access required")
	}

	tipID, err := r.sendTipTx(ctx, tx, senderID, creatorID, amountCents, message)
	if err != nil {
		return "", err
	}
	return tipID, tx.Commit()
}

func (r *ADFinanceRepository) sendTipTx(ctx context.Context, tx *sql.Tx, senderID string, creatorID string, amountCents int64, message string) (string, error) {
	if amountCents <= 0 {
		return "", errors.New("tip amount must be positive")
	}
	var creatorUserID string
	err := tx.QueryRowContext(ctx, `
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
	tippingLockEnabled, err := firewallRuleActive(ctx, tx, "RUL_3")
	if err != nil {
		return "", fmt.Errorf("check tipping firewall rule: %w", err)
	}
	if tippingLockEnabled {
		var locked bool
		if err := tx.QueryRowContext(ctx, `
			SELECT COUNT(*) = 2 AND BOOL_AND(status = 'failed')
			FROM (
				SELECT status FROM ad_payment_intents
				WHERE user_id = $1 AND provider IN ('paystack', 'stripe')
				ORDER BY created_at DESC, id DESC
				LIMIT 2
			) recent_card_attempts
		`, senderID).Scan(&locked); err != nil {
			return "", fmt.Errorf("check recent card payment attempts: %w", err)
		}
		if locked {
			return "", ErrTippingLockedOut
		}
	}

	var balance int64
	err = tx.QueryRowContext(ctx, `
		SELECT available_balance_cents FROM ad_wallets WHERE user_id = $1 FOR UPDATE
	`, senderID).Scan(&balance)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && balance < amountCents) {
		return "", errors.New("insufficient funds")
	}
	if err != nil {
		return "", err
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
	if err := addADPendingEarning(ctx, tx, creatorUserID, "tips", amountCents); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
		VALUES ($1, $2, 'tip_sent', $3, $4), ($5, $6, 'tip_received', $3, $4)
	`, senderID, -amountCents, tipID, message, creatorUserID, amountCents); err != nil {
		return "", err
	}
	return tipID, nil
}

func (r *ADFinanceRepository) GetTipSenderName(ctx context.Context, senderID string) (string, error) {
	var name string
	err := r.DB.QueryRowContext(ctx, `
		SELECT COALESCE(NULLIF(pp.display_name, ''), NULLIF(u.username, ''), 'Viewer')
		FROM users u
		LEFT JOIN performer_profiles pp ON pp.user_id = u.id
		WHERE u.id = $1
	`, senderID).Scan(&name)
	return name, err
}

// RequestWithdrawal reserves cleared funds and creates a payout request atomically.
func (r *ADFinanceRepository) RequestWithdrawal(ctx context.Context, withdrawal *models.ADWithdrawal) error {
	if withdrawal.AmountCents <= 0 || withdrawal.FeeCents < 0 ||
		withdrawal.PayoutAmountCents <= 0 || withdrawal.FeeCents > withdrawal.AmountCents ||
		withdrawal.PayoutAmountCents != withdrawal.AmountCents-withdrawal.FeeCents {
		return ErrInvalidWithdrawal
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var payoutMethodExists bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM ad_payout_methods WHERE id = $1 AND user_id = $2)
	`, withdrawal.PayoutMethodID, withdrawal.UserID).Scan(&payoutMethodExists); err != nil {
		return err
	}
	if !payoutMethodExists {
		return ErrPayoutMethodNotFound
	}

	var availableBalance int64
	err = tx.QueryRowContext(ctx, `SELECT available_balance_cents FROM ad_wallets WHERE user_id = $1 FOR UPDATE`, withdrawal.UserID).Scan(&availableBalance)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrInsufficientClearedFunds
		}
		return err
	}

	var unresolved bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM ad_withdrawals
			WHERE user_id = $1 AND status IN ('requested', 'submitting', 'submission_unknown', 'processing')
		)
	`, withdrawal.UserID).Scan(&unresolved); err != nil {
		return err
	}
	if unresolved {
		return ErrWithdrawalInProgress
	}

	if availableBalance < withdrawal.AmountCents {
		return ErrInsufficientClearedFunds
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE ad_wallets
		SET available_balance_cents = available_balance_cents - $1, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $2 AND available_balance_cents >= $1
	`, withdrawal.AmountCents, withdrawal.UserID)
	if err != nil {
		return err
	}
	if rows, err := result.RowsAffected(); err != nil {
		return err
	} else if rows != 1 {
		return ErrInsufficientClearedFunds
	}

	// 4. Create the withdrawal request record
	query := `
		INSERT INTO ad_withdrawals (
			id, user_id, amount_cents, payout_amount_cents, fee_cents,
			payout_method_id, status, provider, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`
	_, err = tx.ExecContext(ctx, query,
		withdrawal.ID, withdrawal.UserID, withdrawal.AmountCents, withdrawal.PayoutAmountCents,
		withdrawal.FeeCents, withdrawal.PayoutMethodID, withdrawal.Status, withdrawal.Provider,
		withdrawal.CreatedAt, withdrawal.UpdatedAt,
	)
	if err != nil {
		return err
	}

	// 5. Log it to the immutable ledger as a pending debit
	_, err = tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
		VALUES (
			$1, $2, 'withdrawal', $3,
			'Payout requested; wallet debit includes any disclosed payout fee'
		)
	`, withdrawal.UserID, -withdrawal.AmountCents, withdrawal.ID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (r *ADFinanceRepository) BeginWithdrawalSubmission(ctx context.Context, withdrawalID, providerReference string) error {
	result, err := r.DB.ExecContext(ctx, `
		UPDATE ad_withdrawals
		SET status = 'submitting', provider_reference = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND status = 'requested'
	`, withdrawalID, providerReference)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return errors.New("withdrawal is no longer awaiting provider submission")
	}
	return nil
}

func (r *ADFinanceRepository) RecoverFailedWithdrawalReversals(ctx context.Context, limit int) (int, error) {
	if limit <= 0 {
		return 0, errors.New("recovery batch size must be positive")
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
		SELECT w.id::text, w.user_id::text, w.amount_cents
		FROM ad_withdrawals w
		WHERE w.status = 'failed'
		  AND NOT EXISTS (
			SELECT 1 FROM ad_ledger_entries l
			WHERE l.reference_id = w.id::text AND l.transaction_type = 'withdrawal_reversal'
		  )
		ORDER BY w.updated_at ASC
		LIMIT $1
		FOR UPDATE OF w SKIP LOCKED
	`, limit)
	if err != nil {
		return 0, err
	}
	type reversal struct {
		id, userID string
		amount     int64
	}
	pending := make([]reversal, 0)
	for rows.Next() {
		var item reversal
		if err := rows.Scan(&item.id, &item.userID, &item.amount); err != nil {
			rows.Close()
			return 0, err
		}
		pending = append(pending, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}

	for _, item := range pending {
		result, err := tx.ExecContext(ctx, `
			UPDATE ad_wallets
			SET available_balance_cents = available_balance_cents + $1, updated_at = CURRENT_TIMESTAMP
			WHERE user_id = $2
		`, item.amount, item.userID)
		if err != nil {
			return 0, err
		}
		if affected, err := result.RowsAffected(); err != nil {
			return 0, err
		} else if affected != 1 {
			return 0, fmt.Errorf("wallet missing while recovering failed withdrawal %s", item.id)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
			VALUES ($1, $2, 'withdrawal_reversal', $3, 'Recovered failed payout reversal')
		`, item.userID, item.amount, item.id); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(pending), nil
}

func (r *ADFinanceRepository) RecoverStaleUnsubmittedWithdrawals(ctx context.Context, limit int) (int, error) {
	if limit <= 0 {
		return 0, errors.New("recovery batch size must be positive")
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
		SELECT id::text, user_id::text, amount_cents
		FROM ad_withdrawals
		WHERE status = 'requested'
		  AND created_at < CURRENT_TIMESTAMP - INTERVAL '2 minutes'
		ORDER BY created_at ASC
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	`, limit)
	if err != nil {
		return 0, err
	}
	type staleWithdrawal struct {
		id, userID string
		amount     int64
	}
	pending := make([]staleWithdrawal, 0)
	for rows.Next() {
		var item staleWithdrawal
		if err := rows.Scan(&item.id, &item.userID, &item.amount); err != nil {
			rows.Close()
			return 0, err
		}
		pending = append(pending, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}

	recovered := 0
	for _, item := range pending {
		result, err := tx.ExecContext(ctx, `
			UPDATE ad_withdrawals
			SET status = 'failed', failure_reason = 'Payout was not started before request expired',
				updated_at = CURRENT_TIMESTAMP
			WHERE id = $1 AND status = 'requested'
		`, item.id)
		if err != nil {
			return 0, err
		}
		if affected, err := result.RowsAffected(); err != nil {
			return 0, err
		} else if affected != 1 {
			continue
		}
		result, err = tx.ExecContext(ctx, `
			UPDATE ad_wallets
			SET available_balance_cents = available_balance_cents + $1, updated_at = CURRENT_TIMESTAMP
			WHERE user_id = $2
		`, item.amount, item.userID)
		if err != nil {
			return 0, err
		}
		if affected, err := result.RowsAffected(); err != nil {
			return 0, err
		} else if affected != 1 {
			return 0, fmt.Errorf("wallet missing while recovering unsubmitted withdrawal %s", item.id)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
			VALUES ($1, $2, 'withdrawal_reversal', $3, 'Released expired payout that was never submitted')
		`, item.userID, item.amount, item.id); err != nil {
			return 0, err
		}
		recovered++
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return recovered, nil
}

// AddPayoutMethod securely stores a creator's withdrawal destination
func (r *ADFinanceRepository) AddPayoutMethodWithBank(ctx context.Context, methodID, userID, provider, accountNumber, accountName, bankCode string) error {
	_, err := r.DB.ExecContext(ctx, `
		INSERT INTO ad_payout_methods (id, user_id, provider, account_number, account_name, bank_code)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, methodID, userID, provider, accountNumber, accountName, bankCode)
	return err
}

func (r *ADFinanceRepository) GetPayoutMethod(ctx context.Context, userID, methodID string) (*ADPayoutMethod, error) {
	var method ADPayoutMethod
	err := r.DB.QueryRowContext(ctx, `
		SELECT id::text, user_id::text, provider, account_number, COALESCE(account_name, ''), COALESCE(bank_code, '')
		FROM ad_payout_methods WHERE id = $1 AND user_id = $2
	`, methodID, userID).Scan(
		&method.ID, &method.UserID, &method.Provider, &method.AccountNumber, &method.AccountName, &method.BankCode,
	)
	if err != nil {
		return nil, err
	}
	return &method, nil
}

func (r *ADFinanceRepository) SetWithdrawalProvider(ctx context.Context, withdrawalID, provider, providerReference, conversationID string) error {
	if strings.TrimSpace(providerReference) == "" && strings.TrimSpace(conversationID) == "" {
		return errors.New("provider acceptance requires a reference")
	}
	result, err := r.DB.ExecContext(ctx, `
		UPDATE ad_withdrawals SET status = 'processing',
			provider_reference = $3, provider_conversation_id = $4, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND status = 'submitting' AND provider = $2
	`, withdrawalID, provider, providerReference, conversationID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		var settled bool
		err := r.DB.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM ad_withdrawals
				WHERE id = $1 AND provider = $2 AND status IN ('paid', 'failed')
				  AND (($3 <> '' AND provider_reference = $3)
				    OR ($4 <> '' AND provider_conversation_id = $4))
			)
		`, withdrawalID, provider, providerReference, conversationID).Scan(&settled)
		if err != nil {
			return err
		}
		if !settled {
			return errors.New("withdrawal is no longer awaiting provider submission")
		}
	}
	return nil
}

func (r *ADFinanceRepository) FailWithdrawalBeforeSubmission(ctx context.Context, withdrawalID, reason string) error {
	if strings.TrimSpace(reason) == "" {
		return errors.New("a failure reason is required")
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var userID string
	var amount int64
	err = tx.QueryRowContext(ctx, `
		UPDATE ad_withdrawals
		SET status = 'failed', failure_reason = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND status IN ('requested', 'submitting')
		  AND (provider_reference = '' OR provider_reference = id::text)
		  AND provider_conversation_id = ''
		RETURNING user_id::text, amount_cents
	`, withdrawalID, reason).Scan(&userID, &amount)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE ad_wallets
		SET available_balance_cents = available_balance_cents + $1, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $2
	`, amount, userID)
	if err != nil {
		return err
	}
	if rows, err := result.RowsAffected(); err != nil {
		return err
	} else if rows != 1 {
		return errors.New("wallet missing while reversing pre-submission withdrawal")
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
		VALUES ($1, $2, 'withdrawal_reversal', $3, $4)
	`, userID, amount, withdrawalID, "Payout validation failed before provider submission: "+strings.TrimSpace(reason)); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *ADFinanceRepository) CompleteWithdrawal(ctx context.Context, provider, reference, conversationID string, paid bool, reason string) error {
	if strings.TrimSpace(provider) == "" || (strings.TrimSpace(reference) == "" && strings.TrimSpace(conversationID) == "") {
		return errors.New("provider and transfer reference are required")
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	status := "paid"
	if !paid {
		status = "failed"
	}
	var withdrawalID, userID string
	var amount int64
	err = tx.QueryRowContext(ctx, `
		UPDATE ad_withdrawals SET status = $4, failure_reason = NULLIF($5, ''), updated_at = CURRENT_TIMESTAMP
		WHERE (provider = $1 OR ($1 = 'paystack' AND provider IN ('paystack_bank', 'paystack_mobile_money')))
		  AND status IN ('submitting', 'processing')
		  AND (($2 <> '' AND provider_reference = $2) OR ($3 <> '' AND provider_conversation_id = $3))
		RETURNING id::text, user_id::text, amount_cents
	`, provider, reference, conversationID, status, reason).Scan(&withdrawalID, &userID, &amount)
	if err == sql.ErrNoRows {
		var existingStatus string
		err = tx.QueryRowContext(ctx, `
			SELECT status FROM ad_withdrawals
			WHERE (provider = $1 OR ($1 = 'paystack' AND provider IN ('paystack_bank', 'paystack_mobile_money')))
			  AND (($2 <> '' AND provider_reference = $2) OR ($3 <> '' AND provider_conversation_id = $3))
		`, provider, reference, conversationID).Scan(&existingStatus)
		if err == sql.ErrNoRows {
			return ErrWithdrawalNotFound
		}
		if err != nil {
			return err
		}
		expectedStatus := "paid"
		if !paid {
			expectedStatus = "failed"
		}
		if existingStatus != expectedStatus {
			return ErrWithdrawalConflict
		}
		return tx.Commit()
	}
	if err != nil {
		return err
	}
	if !paid {
		result, err := tx.ExecContext(ctx, `
			UPDATE ad_wallets SET available_balance_cents = available_balance_cents + $1, updated_at = CURRENT_TIMESTAMP
			WHERE user_id = $2
		`, amount, userID)
		if err != nil {
			return err
		}
		if rows, err := result.RowsAffected(); err != nil {
			return err
		} else if rows != 1 {
			return errors.New("wallet missing while reversing failed withdrawal")
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
			VALUES ($1, $2, 'withdrawal_reversal', $3, 'Failed payout returned to cleared earnings')
		`, userID, amount, withdrawalID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *ADFinanceRepository) GetPendingEarningsClearance(ctx context.Context) ([]map[string]interface{}, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT w.user_id::text, COALESCE(NULLIF(pp.display_name, ''), u.username, 'Creator'),
			w.pending_balance_cents, COALESCE(earnings.source, 'legacy'),
			COALESCE(earnings.balance_cents, 0), CASE
				WHEN LOWER(u.status) NOT IN ('active', 'online') THEN 'Account is not active'
				WHEN COALESCE(pp.status, '') <> 'active' THEN 'Creator profile is not active'
				WHEN EXISTS (
					SELECT 1 FROM ad_reports report
					WHERE report.status IN ('pending', 'reviewed')
					  AND (
					       (report.target_type = 'creator' AND report.target_id = u.id)
					       OR (report.target_type = 'post' AND report.target_id IN (
					           SELECT post.id FROM ad_posts post WHERE post.creator_id = u.id
					       ))
					       OR (report.target_type = 'comment' AND report.target_id IN (
					           SELECT comment.id FROM ad_post_comments comment
					           JOIN ad_posts post ON post.id = comment.post_id
					           WHERE post.creator_id = u.id
					       ))
					  )
				) THEN 'Unresolved creator, post, or comment reports'
				ELSE ''
			END
		FROM ad_wallets w
		JOIN users u ON u.id = w.user_id
		LEFT JOIN performer_profiles pp ON pp.user_id = w.user_id
		LEFT JOIN ad_pending_earnings earnings ON earnings.user_id = w.user_id
		WHERE w.pending_balance_cents > 0
		ORDER BY w.pending_balance_cents DESC, w.user_id, earnings.source
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	results := make([]map[string]interface{}, 0)
	indexes := make(map[string]int)
	for rows.Next() {
		var userID, name, source, holdReason string
		var pending, sourceBalance int64
		if err := rows.Scan(&userID, &name, &pending, &source, &sourceBalance, &holdReason); err != nil {
			return nil, err
		}
		index, exists := indexes[userID]
		if !exists {
			index = len(results)
			indexes[userID] = index
			results = append(results, map[string]interface{}{
				"user_id": userID, "creator_name": name, "pending_cents": pending,
				"eligible_ppv_cents": int64(0), "hold_reason": holdReason,
				"pending_by_source": map[string]int64{},
			})
		}
		entry := results[index]
		sources := entry["pending_by_source"].(map[string]int64)
		sources[source] = sourceBalance
		if source == "ppv" && holdReason == "" {
			entry["eligible_ppv_cents"] = sourceBalance
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

func (r *ADFinanceRepository) ClearCreatorEarnings(ctx context.Context, userID, adminID, reason, source string, amount int64) error {
	if amount <= 0 || strings.TrimSpace(reason) == "" {
		return errors.New("a positive amount and clearance reason are required")
	}
	switch source {
	case "tips", "subscriptions", "live_pass", "chat", "legacy":
	default:
		return errors.New("manual clearance is only available for tips and other non-PPV earnings")
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if holdReason, err := getEarningsHoldReason(ctx, tx, userID); err != nil {
		return err
	} else if holdReason != "" {
		return fmt.Errorf("%w: %s", ErrEarningsOnHold, holdReason)
	}
	var pending int64
	if err := tx.QueryRowContext(ctx, `
		SELECT w.pending_balance_cents FROM ad_wallets w
		WHERE w.user_id = $1 FOR UPDATE OF w
	`, userID).Scan(&pending); err != nil {
		return err
	}
	var sourceBalance int64
	if err := tx.QueryRowContext(ctx, `
		SELECT balance_cents FROM ad_pending_earnings
		WHERE user_id = $1 AND source = $2 FOR UPDATE
	`, userID, source).Scan(&sourceBalance); err != nil {
		return err
	}
	if amount > pending || amount > sourceBalance {
		return errors.New("clearance amount exceeds pending earnings for the selected source")
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE ad_wallets SET pending_balance_cents = pending_balance_cents - $1,
			available_balance_cents = available_balance_cents + $1, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $2
	`, amount, userID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE ad_pending_earnings
		SET balance_cents = balance_cents - $1, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $2 AND source = $3
	`, amount, userID, source); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_earnings_clearances (user_id, admin_id, source, amount_cents, reason)
		VALUES ($1, $2, $3, $4, $5)
	`, userID, adminID, source, amount, strings.TrimSpace(reason)); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *ADFinanceRepository) AutoClearPPEarnings(ctx context.Context, userID, adminID string) (int64, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if holdReason, err := getEarningsHoldReason(ctx, tx, userID); err != nil {
		return 0, err
	} else if holdReason != "" {
		return 0, fmt.Errorf("%w: %s", ErrEarningsOnHold, holdReason)
	}
	var walletPending int64
	if err := tx.QueryRowContext(ctx, `
		SELECT pending_balance_cents FROM ad_wallets WHERE user_id = $1 FOR UPDATE
	`, userID).Scan(&walletPending); err != nil {
		return 0, err
	}
	var ppvPending int64
	if err := tx.QueryRowContext(ctx, `
		SELECT balance_cents FROM ad_pending_earnings
		WHERE user_id = $1 AND source = 'ppv' FOR UPDATE
	`, userID).Scan(&ppvPending); err != nil {
		return 0, err
	}
	if ppvPending <= 0 || ppvPending > walletPending {
		return 0, errors.New("no consistent PPV earnings are eligible for clearance")
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE ad_wallets
		SET pending_balance_cents = pending_balance_cents - $1,
		    available_balance_cents = available_balance_cents + $1,
		    updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $2
	`, ppvPending, userID); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE ad_pending_earnings
		SET balance_cents = 0, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $1 AND source = 'ppv'
	`, userID); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_earnings_clearances (user_id, admin_id, source, amount_cents, reason)
		VALUES ($1, $2, 'ppv', $3, 'Automatic PPV clearance after eligibility checks')
	`, userID, adminID, ppvPending); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return ppvPending, nil
}

func getEarningsHoldReason(ctx context.Context, tx *sql.Tx, userID string) (string, error) {
	var reason string
	err := tx.QueryRowContext(ctx, `
		SELECT CASE
			WHEN LOWER(u.status) NOT IN ('active', 'online') THEN 'Account is not active'
			WHEN COALESCE(pp.status, '') <> 'active' THEN 'Creator profile is not active'
			WHEN EXISTS (
				SELECT 1 FROM ad_reports report
				WHERE report.status IN ('pending', 'reviewed')
				  AND (
				       (report.target_type = 'creator' AND report.target_id = u.id)
				       OR (report.target_type = 'post' AND report.target_id IN (
				           SELECT post.id FROM ad_posts post WHERE post.creator_id = u.id
				       ))
				       OR (report.target_type = 'comment' AND report.target_id IN (
				           SELECT comment.id FROM ad_post_comments comment
				           JOIN ad_posts post ON post.id = comment.post_id
				           WHERE post.creator_id = u.id
				       ))
				  )
			) THEN 'Unresolved creator, post, or comment reports'
			ELSE ''
		END
		FROM users u
		LEFT JOIN performer_profiles pp ON pp.user_id = u.id
		WHERE u.id = $1
	`, userID).Scan(&reason)
	if err != nil {
		return "", err
	}
	return reason, nil
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
		SELECT id::text, amount_cents, payout_amount_cents, fee_cents, status, created_at, provider,
			COALESCE(failure_reason, ''), COALESCE(provider_reference, '')
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
		var id, status, provider, failureReason, providerReference string
		var amount, payoutAmount, fee int64
		var createdAt time.Time
		if err := rows.Scan(&id, &amount, &payoutAmount, &fee, &status, &createdAt, &provider, &failureReason, &providerReference); err != nil {
			return nil, err
		}
		withdrawals = append(withdrawals, map[string]interface{}{
			"id": id, "amount_cents": amount, "payout_amount_cents": payoutAmount,
			"fee_cents": fee, "status": status, "created_at": createdAt,
			"provider": provider, "provider_reference": providerReference, "failure_reason": failureReason,
		})
	}

	if withdrawals == nil {
		withdrawals = []map[string]interface{}{}
	}
	return withdrawals, rows.Err()
}
