package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
)

var ErrADPaymentUnavailable = errors.New("After Dark payment item is unavailable")
var ErrADWalletCoversPurchase = errors.New("wallet balance now covers the full PPV purchase")

type ADPaymentIntent struct {
	ID                    string
	UserID                string
	PaymentType           string
	TargetID              string
	CreatorID             string
	AmountCents           int64
	Currency              string
	SettlementAmountCents int64
	SettlementCurrency    string
	WalletAmountCents     int64
	ExchangeRate          float64
	Provider              string
	ProviderSessionID     string
	MerchantRequestID     string
	Status                string
	Message               string
	ReceiptNumber         string
}

func (r *ADFinanceRepository) CreateADPaymentIntent(ctx context.Context, userID, paymentType, targetID, provider string, amountCents int64, useWallet bool, message, currency string, kesPerUSD float64) (*ADPaymentIntent, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider != "paystack" && provider != "mpesa" && provider != "stripe" {
		return nil, fmt.Errorf("unsupported After Dark payment provider")
	}
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if currency != "KES" && currency != "USD" {
		return nil, fmt.Errorf("unsupported After Dark payment currency")
	}
	if (currency == "USD" && provider != "stripe") || (currency == "KES" && provider == "stripe") {
		return nil, fmt.Errorf("payment provider does not support the selected currency")
	}
	paymentType = strings.ToLower(strings.TrimSpace(paymentType))
	if len(message) > 500 {
		return nil, fmt.Errorf("payment message is too long")
	}
	if useWallet && paymentType != "ppv" {
		return nil, fmt.Errorf("wallet contributions are only supported for PPV posts")
	}

	intent := &ADPaymentIntent{
		ID:          uuid.NewString(),
		UserID:      userID,
		PaymentType: paymentType,
		TargetID:    strings.TrimSpace(targetID),
		AmountCents: amountCents,
		Currency:    currency,
		Provider:    provider,
		Status:      "pending",
		Message:     strings.TrimSpace(message),
	}

	var err error
	switch paymentType {
	case "deposit":
		if amountCents < 1 {
			return nil, fmt.Errorf("payment amount must be positive")
		}
		if intent.TargetID != "" {
			return nil, fmt.Errorf("deposit cannot have a target")
		}
	case "tip":
		if amountCents < 1 {
			return nil, fmt.Errorf("payment amount must be positive")
		}
		intent.CreatorID, err = r.resolveTipCreator(ctx, userID, intent.TargetID)
		if err != nil {
			return nil, err
		}
	case "live_tip":
		if amountCents < 1 {
			return nil, fmt.Errorf("payment amount must be positive")
		}
		if len(message) > 120 {
			return nil, fmt.Errorf("live tip message is too long")
		}
		intent.CreatorID, err = r.resolveLiveTipCreator(ctx, userID, intent.TargetID)
		if err != nil {
			return nil, err
		}
	case "subscription":
		price, creatorID, err := r.creatorSubscriptionPrice(ctx, userID, intent.TargetID)
		if err != nil {
			return nil, err
		}
		intent.CreatorID, intent.AmountCents = creatorID, price
	case "ppv":
		// Price and entitlement are rechecked under lock when the PPV intent is created.
	case "live_pass":
		price, creatorID, err := r.livePassPrice(ctx, userID, intent.TargetID)
		if err != nil {
			return nil, err
		}
		intent.CreatorID, intent.AmountCents = creatorID, price
	default:
		return nil, fmt.Errorf("unsupported After Dark payment type")
	}
	if paymentType == "ppv" {
		return r.createADPPVPaymentIntent(ctx, intent, kesPerUSD, useWallet)
	}
	intent.SettlementAmountCents = intent.AmountCents
	intent.SettlementCurrency = "KES"
	intent.ExchangeRate = 1
	if currency == "USD" {
		usdMinor, err := usdMinorFromKESMinor(intent.SettlementAmountCents, kesPerUSD)
		if err != nil {
			return nil, err
		}
		intent.AmountCents = usdMinor
		intent.ExchangeRate = kesPerUSD
	}
	if provider == "mpesa" && intent.SettlementAmountCents%100 != 0 {
		return nil, fmt.Errorf("M-Pesa payments must be in whole Kenyan shillings; choose Paystack for fractional amounts")
	}

	_, err = r.DB.ExecContext(ctx, `
		INSERT INTO ad_payment_intents
			(id, user_id, payment_type, target_id, creator_id, amount_cents, currency,
			 settlement_amount_cents, settlement_currency, wallet_amount_cents, exchange_rate, provider, status, message)
		VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, '')::uuid, $6, $7, $8, $9, 0, $10, $11, 'pending', $12)`,
		intent.ID, intent.UserID, intent.PaymentType, intent.TargetID, intent.CreatorID,
		intent.AmountCents, intent.Currency, intent.SettlementAmountCents,
		intent.SettlementCurrency, intent.ExchangeRate, intent.Provider, intent.Message)
	if err != nil {
		return nil, fmt.Errorf("create After Dark payment intent: %w", err)
	}
	return intent, nil
}

func (r *ADFinanceRepository) createADPPVPaymentIntent(ctx context.Context, intent *ADPaymentIntent, kesPerUSD float64, useWallet bool) (*ADPaymentIntent, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var creatorID, accessType string
	var priceCents int64
	if err := tx.QueryRowContext(ctx, `
		SELECT creator_id::text, access_type, price_cents
		FROM ad_posts
		WHERE id = $1 AND status = 'published'
		FOR UPDATE`, intent.TargetID).Scan(&creatorID, &accessType, &priceCents); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrADPaymentUnavailable
		}
		return nil, err
	}
	if accessType != "ppv" || priceCents < 1 {
		return nil, ErrADPaymentUnavailable
	}
	if creatorID == intent.UserID {
		return nil, fmt.Errorf("creators cannot purchase their own post")
	}
	var alreadyEntitled bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM ad_post_entitlements WHERE user_id = $1 AND post_id = $2
		)`, intent.UserID, intent.TargetID).Scan(&alreadyEntitled); err != nil {
		return nil, err
	}
	if alreadyEntitled {
		return nil, fmt.Errorf("post is already unlocked")
	}
	var pendingCheckout bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM ad_payment_intents
			WHERE user_id = $1 AND target_id = $2 AND payment_type = 'ppv' AND status = 'pending'
		)`, intent.UserID, intent.TargetID).Scan(&pendingCheckout); err != nil {
		return nil, err
	}
	if pendingCheckout {
		return nil, fmt.Errorf("a PPV checkout for this post is already pending")
	}

	var walletAmount int64
	if useWallet {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO ad_wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
			intent.UserID); err != nil {
			return nil, err
		}
		var availableBalance int64
		if err := tx.QueryRowContext(ctx, `
			SELECT available_balance_cents FROM ad_wallets WHERE user_id = $1 FOR UPDATE`,
			intent.UserID).Scan(&availableBalance); err != nil {
			return nil, err
		}
		walletAmount = walletContributionCents(availableBalance, priceCents)
	}
	if useWallet && walletAmount >= priceCents {
		return nil, ErrADWalletCoversPurchase
	}

	providerSettlementCents := priceCents - walletAmount
	intent.CreatorID = creatorID
	intent.SettlementAmountCents = priceCents
	intent.SettlementCurrency = "KES"
	intent.WalletAmountCents = walletAmount
	intent.ExchangeRate = 1
	intent.AmountCents = providerSettlementCents
	if intent.Currency == "USD" {
		intent.AmountCents, err = usdMinorFromKESMinor(providerSettlementCents, kesPerUSD)
		if err != nil {
			return nil, err
		}
		intent.ExchangeRate = kesPerUSD
	}
	if intent.Provider == "mpesa" && providerSettlementCents%100 != 0 {
		return nil, fmt.Errorf("M-Pesa payments must be in whole Kenyan shillings; choose Paystack for fractional amounts")
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_payment_intents
			(id, user_id, payment_type, target_id, creator_id, amount_cents, currency,
			 settlement_amount_cents, settlement_currency, wallet_amount_cents, exchange_rate, provider, status, message)
		VALUES ($1, $2, 'ppv', $3, $4, $5, $6, $7, 'KES', $8, $9, $10, 'pending', $11)`,
		intent.ID, intent.UserID, intent.TargetID, creatorID, intent.AmountCents, intent.Currency,
		intent.SettlementAmountCents, intent.WalletAmountCents, intent.ExchangeRate, intent.Provider, intent.Message); err != nil {
		return nil, fmt.Errorf("create After Dark PPV payment intent: %w", err)
	}
	if walletAmount > 0 {
		result, err := tx.ExecContext(ctx, `
			UPDATE ad_wallets
			SET available_balance_cents = available_balance_cents - $1, updated_at = CURRENT_TIMESTAMP
			WHERE user_id = $2 AND available_balance_cents >= $1`,
			walletAmount, intent.UserID)
		if err != nil {
			return nil, err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return nil, err
		}
		if rows != 1 {
			return nil, fmt.Errorf("wallet balance changed during checkout")
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
			VALUES ($1, $2, 'wallet_reserve', $3, 'Wallet contribution reserved for PPV checkout')`,
			intent.UserID, -walletAmount, intent.ID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit After Dark PPV checkout: %w", err)
	}
	return intent, nil
}

func walletContributionCents(availableBalance, priceCents int64) int64 {
	if availableBalance <= 0 || priceCents <= 0 {
		return 0
	}
	if availableBalance < priceCents {
		return availableBalance
	}
	return priceCents
}

func usdMinorFromKESMinor(kesMinor int64, kesPerUSD float64) (int64, error) {
	if kesMinor < 1 || kesPerUSD <= 0 {
		return 0, fmt.Errorf("valid KES amount and exchange rate are required")
	}
	usdMinor := int64(math.Round(float64(kesMinor) / kesPerUSD))
	if usdMinor < 1 {
		return 0, fmt.Errorf("converted USD amount is below one cent")
	}
	return usdMinor, nil
}

func (r *ADFinanceRepository) resolveTipCreator(ctx context.Context, senderID, targetID string) (string, error) {
	var creatorID string
	err := r.DB.QueryRowContext(ctx, `
		SELECT user_id::text FROM performer_profiles
		WHERE (id::text = $1 OR user_id::text = $1) AND status = 'active'`,
		targetID).Scan(&creatorID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrADPaymentUnavailable
		}
		return "", err
	}
	if creatorID == senderID {
		return "", fmt.Errorf("you cannot tip yourself")
	}
	return creatorID, nil
}

func (r *ADFinanceRepository) resolveLiveTipCreator(ctx context.Context, senderID, sessionID string) (string, error) {
	var creatorID string
	var allowed bool
	err := r.DB.QueryRowContext(ctx, `
		SELECT s.creator_id::text,
			(s.creator_id = $2 OR s.price_cents = 0 OR EXISTS (
				SELECT 1 FROM ad_live_entitlements e
				WHERE e.user_id = $2 AND e.session_id = s.id
			) OR EXISTS (
				SELECT 1 FROM ad_subscriptions sub
				WHERE sub.subscriber_id = $2 AND sub.creator_id = s.creator_id
				  AND sub.status = 'active' AND sub.current_period_end > CURRENT_TIMESTAMP
			))
		FROM ad_live_sessions s
		WHERE s.id = $1 AND s.status = 'live'`,
		sessionID, senderID).Scan(&creatorID, &allowed)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrADPaymentUnavailable
		}
		return "", err
	}
	if !allowed {
		return "", fmt.Errorf("payment or active subscription required to tip in this live session")
	}
	if creatorID == senderID {
		return "", fmt.Errorf("you cannot tip yourself")
	}
	return creatorID, nil
}

func (r *ADFinanceRepository) creatorSubscriptionPrice(ctx context.Context, subscriberID, targetID string) (int64, string, error) {
	var creatorID string
	var price int64
	err := r.DB.QueryRowContext(ctx, `
		SELECT user_id::text, subscription_price_cents
		FROM performer_profiles
		WHERE (id::text = $1 OR user_id::text = $1) AND status = 'active'`,
		targetID).Scan(&creatorID, &price)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, "", ErrADPaymentUnavailable
		}
		return 0, "", err
	}
	if creatorID == subscriberID {
		return 0, "", fmt.Errorf("cannot subscribe to yourself")
	}
	if price < 1 {
		return 0, "", fmt.Errorf("creator subscription is not available")
	}
	return price, creatorID, nil
}

func (r *ADFinanceRepository) livePassPrice(ctx context.Context, buyerID, sessionID string) (int64, string, error) {
	var creatorID string
	var price int64
	err := r.DB.QueryRowContext(ctx, `
		SELECT creator_id::text, price_cents
		FROM ad_live_sessions
		WHERE id = $1 AND status = 'live'`,
		sessionID).Scan(&creatorID, &price)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, "", ErrADPaymentUnavailable
		}
		return 0, "", err
	}
	if creatorID == buyerID {
		return 0, "", fmt.Errorf("creators cannot purchase their own live pass")
	}
	if price < 1 {
		return 0, "", fmt.Errorf("this live session does not require a paid pass")
	}
	return price, creatorID, nil
}

func (r *ADFinanceRepository) SetADPaymentProviderSession(ctx context.Context, intentID, sessionID, merchantID string) error {
	result, err := r.DB.ExecContext(ctx, `
		UPDATE ad_payment_intents
		SET provider_session_id = $2, merchant_request_id = NULLIF($3, ''), updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND status = 'pending'`,
		intentID, sessionID, merchantID)
	if err != nil {
		return fmt.Errorf("save After Dark provider session: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check After Dark provider session update: %w", err)
	}
	if rows != 1 {
		return fmt.Errorf("After Dark payment intent is no longer pending")
	}
	return nil
}

func (r *ADFinanceRepository) UpdateADPaymentStatus(ctx context.Context, intentID, status string) error {
	if status != "pending" && status != "failed" {
		return fmt.Errorf("invalid After Dark payment status")
	}
	if status == "failed" {
		_, err := r.MarkADPaymentFailed(ctx, intentID)
		return err
	}
	_, err := r.DB.ExecContext(ctx, `
		UPDATE ad_payment_intents
		SET status = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND status = 'pending'`,
		intentID, status)
	if err != nil {
		return fmt.Errorf("update After Dark payment status: %w", err)
	}
	return nil
}

func (r *ADFinanceRepository) MarkADPaymentFailed(ctx context.Context, intentID string) (bool, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin After Dark payment failure transaction: %w", err)
	}
	defer tx.Rollback()

	var userID string
	var walletAmount int64
	err = tx.QueryRowContext(ctx, `
		UPDATE ad_payment_intents
		SET status = 'failed', updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND status = 'pending'
		RETURNING user_id::text, wallet_amount_cents`,
		intentID).Scan(&userID, &walletAmount)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("mark After Dark payment failed: %w", err)
	}
	if walletAmount > 0 {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO ad_wallets (user_id, available_balance_cents)
			VALUES ($1, $2)
			ON CONFLICT (user_id) DO UPDATE SET
				available_balance_cents = ad_wallets.available_balance_cents + EXCLUDED.available_balance_cents,
				updated_at = CURRENT_TIMESTAMP`,
			userID, walletAmount); err != nil {
			return false, fmt.Errorf("release reserved After Dark wallet funds: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
			VALUES ($1, $2, 'wallet_release', $3, 'Released wallet contribution after failed PPV checkout')`,
			userID, walletAmount, intentID); err != nil {
			return false, fmt.Errorf("record released After Dark wallet funds: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("commit After Dark payment failure: %w", err)
	}
	return true, nil
}

func (r *ADFinanceRepository) GetADPaymentIntent(ctx context.Context, intentID, userID string) (*ADPaymentIntent, error) {
	return r.getADPaymentIntent(ctx, `
		SELECT id::text, user_id::text, payment_type, COALESCE(target_id, ''),
		       COALESCE(creator_id::text, ''), amount_cents, currency,
		       settlement_amount_cents, settlement_currency, wallet_amount_cents, exchange_rate::float8, provider,
		       COALESCE(provider_session_id, ''), COALESCE(merchant_request_id, ''),
		       status, COALESCE(message, ''), COALESCE(receipt_number, '')
		FROM ad_payment_intents WHERE id = $1 AND user_id = $2`,
		intentID, userID)
}

func (r *ADFinanceRepository) GetADPaymentByProviderSession(ctx context.Context, provider, sessionID string) (*ADPaymentIntent, error) {
	return r.getADPaymentIntent(ctx, `
		SELECT id::text, user_id::text, payment_type, COALESCE(target_id, ''),
		       COALESCE(creator_id::text, ''), amount_cents, currency,
		       settlement_amount_cents, settlement_currency, wallet_amount_cents, exchange_rate::float8, provider,
		       COALESCE(provider_session_id, ''), COALESCE(merchant_request_id, ''),
		       status, COALESCE(message, ''), COALESCE(receipt_number, '')
		FROM ad_payment_intents WHERE provider = $1 AND provider_session_id = $2`,
		provider, sessionID)
}

func (r *ADFinanceRepository) getADPaymentIntent(ctx context.Context, query string, args ...interface{}) (*ADPaymentIntent, error) {
	var intent ADPaymentIntent
	err := r.DB.QueryRowContext(ctx, query, args...).Scan(
		&intent.ID, &intent.UserID, &intent.PaymentType, &intent.TargetID, &intent.CreatorID,
		&intent.AmountCents, &intent.Currency, &intent.SettlementAmountCents,
		&intent.SettlementCurrency, &intent.WalletAmountCents, &intent.ExchangeRate, &intent.Provider, &intent.ProviderSessionID,
		&intent.MerchantRequestID, &intent.Status, &intent.Message, &intent.ReceiptNumber)
	if err != nil {
		return nil, err
	}
	return &intent, nil
}

func (r *ADFinanceRepository) CompleteADPayment(ctx context.Context, intentID string, amountCents int64, currency, receipt string) (*ADPaymentIntent, bool, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()

	var intent ADPaymentIntent
	err = tx.QueryRowContext(ctx, `
		SELECT id::text, user_id::text, payment_type, COALESCE(target_id, ''),
		       COALESCE(creator_id::text, ''), amount_cents, currency,
		       settlement_amount_cents, settlement_currency, wallet_amount_cents, exchange_rate::float8, provider,
		       COALESCE(provider_session_id, ''), COALESCE(merchant_request_id, ''),
		       status, COALESCE(message, ''), COALESCE(receipt_number, '')
		FROM ad_payment_intents WHERE id = $1 FOR UPDATE`,
		intentID).Scan(
		&intent.ID, &intent.UserID, &intent.PaymentType, &intent.TargetID, &intent.CreatorID,
		&intent.AmountCents, &intent.Currency, &intent.SettlementAmountCents,
		&intent.SettlementCurrency, &intent.WalletAmountCents, &intent.ExchangeRate, &intent.Provider, &intent.ProviderSessionID,
		&intent.MerchantRequestID, &intent.Status, &intent.Message, &intent.ReceiptNumber)
	if err != nil {
		return nil, false, err
	}
	if intent.Status == "completed" {
		return &intent, false, nil
	}
	if intent.Status != "pending" {
		return nil, false, fmt.Errorf("After Dark payment is not pending")
	}
	if amountCents != intent.AmountCents || !strings.EqualFold(currency, intent.Currency) {
		return nil, false, fmt.Errorf("provider payment does not match After Dark order")
	}

	switch intent.PaymentType {
	case "deposit":
		err = applyADDeposit(ctx, tx, &intent)
	case "subscription":
		err = applyADSubscription(ctx, tx, &intent)
	case "ppv":
		err = applyADPPV(ctx, tx, &intent)
	case "tip", "live_tip":
		err = applyADTip(ctx, tx, &intent)
	case "live_pass":
		err = applyADLivePass(ctx, tx, &intent)
	default:
		err = fmt.Errorf("unsupported After Dark payment type")
	}
	if err != nil {
		return nil, false, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE ad_payment_intents
		SET status = 'completed', receipt_number = NULLIF($2, ''), updated_at = $3
		WHERE id = $1`,
		intent.ID, receipt, time.Now()); err != nil {
		return nil, false, err
	}
	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	intent.Status = "completed"
	intent.ReceiptNumber = receipt
	return &intent, true, nil
}

func applyADDeposit(ctx context.Context, tx *sql.Tx, intent *ADPaymentIntent) error {
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_wallets (user_id, available_balance_cents)
		VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET
			available_balance_cents = ad_wallets.available_balance_cents + EXCLUDED.available_balance_cents,
			updated_at = CURRENT_TIMESTAMP`,
		intent.UserID, intent.SettlementAmountCents); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
		VALUES ($1, $2, 'deposit', $3, 'After Dark wallet deposit')`,
		intent.UserID, intent.SettlementAmountCents, intent.ID)
	return err
}

func applyADSubscription(ctx context.Context, tx *sql.Tx, intent *ADPaymentIntent) error {
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
		VALUES ($1, $2, 'subscription_purchase', $3, 'Creator subscription (30 days)')`,
		intent.UserID, -intent.SettlementAmountCents, intent.ID); err != nil {
		return err
	}
	if err := creditADCreator(ctx, tx, intent.CreatorID, intent.SettlementAmountCents, "subscription_earning", "subscriptions", intent.ID, "New subscriber"); err != nil {
		return err
	}
	now := time.Now()
	_, err := tx.ExecContext(ctx, `
		INSERT INTO ad_subscriptions (subscriber_id, creator_id, status, current_period_start, current_period_end)
		VALUES ($1, $2, 'active', $3::timestamptz, $3::timestamptz + INTERVAL '30 days')
		ON CONFLICT (subscriber_id, creator_id) DO UPDATE SET
			status = 'active',
			current_period_start = $3::timestamptz,
			current_period_end = CASE
				WHEN ad_subscriptions.current_period_end > $3::timestamptz THEN ad_subscriptions.current_period_end + INTERVAL '30 days'
				ELSE $3::timestamptz + INTERVAL '30 days'
			END`,
		intent.UserID, intent.CreatorID, now)
	return err
}

func applyADPPV(ctx context.Context, tx *sql.Tx, intent *ADPaymentIntent) error {
	var status, accessType string
	err := tx.QueryRowContext(ctx, `
		SELECT status, access_type FROM ad_posts WHERE id = $1 AND creator_id = $2 FOR UPDATE`,
		intent.TargetID, intent.CreatorID).Scan(&status, &accessType)
	if err != nil {
		return err
	}
	if status != "published" || accessType != "ppv" {
		return ErrADPaymentUnavailable
	}
	var entitled bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM ad_post_entitlements WHERE user_id = $1 AND post_id = $2)`,
		intent.UserID, intent.TargetID).Scan(&entitled); err != nil {
		return err
	}
	if entitled {
		return nil
	}
	providerSettlementCents := intent.SettlementAmountCents - intent.WalletAmountCents
	if providerSettlementCents < 1 {
		return fmt.Errorf("invalid PPV provider settlement amount")
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
		VALUES ($1, $2, 'ppv_purchase', $3, 'Unlocked PPV post')`,
		intent.UserID, -providerSettlementCents, intent.ID); err != nil {
		return err
	}
	if err := creditADCreator(ctx, tx, intent.CreatorID, intent.SettlementAmountCents, "ppv_earning", "ppv", intent.ID, "PPV post unlocked"); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO ad_post_entitlements (user_id, post_id, payment_ref)
		VALUES ($1, $2, $3) ON CONFLICT (user_id, post_id) DO NOTHING`,
		intent.UserID, intent.TargetID, intent.ID)
	return err
}

func applyADTip(ctx context.Context, tx *sql.Tx, intent *ADPaymentIntent) error {
	if intent.CreatorID == "" || intent.CreatorID == intent.UserID {
		return fmt.Errorf("invalid tip recipient")
	}
	if intent.PaymentType == "live_tip" {
		var isLive bool
		if err := tx.QueryRowContext(ctx, `
			SELECT EXISTS (SELECT 1 FROM ad_live_sessions WHERE id = $1 AND creator_id = $2 AND status = 'live')`,
			intent.TargetID, intent.CreatorID).Scan(&isLive); err != nil {
			return err
		}
		if !isLive {
			return ErrADPaymentUnavailable
		}
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
		VALUES ($1, $2, 'tip_sent', $3, $4)`,
		intent.UserID, -intent.SettlementAmountCents, intent.ID, intent.Message); err != nil {
		return err
	}
	return creditADCreator(ctx, tx, intent.CreatorID, intent.SettlementAmountCents, "tip_received", "tips", intent.ID, intent.Message)
}

func applyADLivePass(ctx context.Context, tx *sql.Tx, intent *ADPaymentIntent) error {
	var status string
	err := tx.QueryRowContext(ctx, `
		SELECT status FROM ad_live_sessions WHERE id = $1 AND creator_id = $2 FOR UPDATE`,
		intent.TargetID, intent.CreatorID).Scan(&status)
	if err != nil {
		return err
	}
	if status != "live" {
		return ErrADPaymentUnavailable
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
		VALUES ($1, $2, 'ppv_purchase', $3, 'Live session pass')`,
		intent.UserID, -intent.SettlementAmountCents, intent.ID); err != nil {
		return err
	}
	if err := creditADCreator(ctx, tx, intent.CreatorID, intent.SettlementAmountCents, "ppv_earning", "live_pass", intent.ID, "Live session pass sold"); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO ad_live_entitlements (session_id, user_id, payment_ref)
		VALUES ($1, $2, $3)
		ON CONFLICT (session_id, user_id) DO NOTHING`,
		intent.TargetID, intent.UserID, intent.ID)
	return err
}

func creditADCreator(ctx context.Context, tx *sql.Tx, creatorID string, amount int64, transactionType, source, referenceID, description string) error {
	creatorCut := amount * 80 / 100
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO ad_wallets (user_id, pending_balance_cents)
		VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET
			pending_balance_cents = ad_wallets.pending_balance_cents + EXCLUDED.pending_balance_cents,
			updated_at = CURRENT_TIMESTAMP`,
		creatorID, creatorCut); err != nil {
		return err
	}
	if err := addADPendingEarning(ctx, tx, creatorID, source, creatorCut); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description)
		VALUES ($1, $2, $3, $4, $5)`,
		creatorID, creatorCut, transactionType, referenceID, description)
	return err
}

func addADPendingEarning(ctx context.Context, tx *sql.Tx, userID, source string, amount int64) error {
	if amount <= 0 {
		return errors.New("pending earnings amount must be positive")
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO ad_pending_earnings (user_id, source, balance_cents)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, source) DO UPDATE
		SET balance_cents = ad_pending_earnings.balance_cents + EXCLUDED.balance_cents,
		    updated_at = CURRENT_TIMESTAMP
	`, userID, source, amount)
	return err
}
