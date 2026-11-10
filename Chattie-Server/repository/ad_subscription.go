package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"chattie-backend/models"
)

type ADSubscriptionRepository struct {
	DB *sql.DB
}

func NewADSubscriptionRepository(db *sql.DB) *ADSubscriptionRepository {
	return &ADSubscriptionRepository{DB: db}
}

// Subscribe atomically charges the user and activates/extends the subscription
func (r *ADSubscriptionRepository) Subscribe(ctx context.Context, subscriberID string, creatorProfileID string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var creatorID string
	var priceCents int64
	err = tx.QueryRowContext(ctx, `
		SELECT user_id::text, subscription_price_cents
		FROM performer_profiles
		WHERE id::text = $1 AND status = 'active'
	`, creatorProfileID).Scan(&creatorID, &priceCents)
	if err != nil {
		return err
	}
	if creatorID == subscriberID {
		return errors.New("cannot subscribe to yourself")
	}
	if priceCents < 0 {
		return errors.New("invalid subscription price")
	}
	if priceCents == 0 {
		return errors.New("creator subscription is not available")
	}

	// 1. Check buyer balance
	var balance int64
	err = tx.QueryRowContext(ctx, `SELECT available_balance_cents FROM ad_wallets WHERE user_id = $1 FOR UPDATE`, subscriberID).Scan(&balance)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && balance < priceCents) {
		return errors.New("insufficient funds")
	}
	if err != nil {
		return err
	}

	// 2. Deduct from Buyer
	_, err = tx.ExecContext(ctx, `UPDATE ad_wallets SET available_balance_cents = available_balance_cents - $1 WHERE user_id = $2`, priceCents, subscriberID)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description) 
		VALUES ($1, $2, 'subscription_purchase', $3, 'Creator Subscription (30 Days)')
	`, subscriberID, -priceCents, creatorID)
	if err != nil {
		return err
	}

	// 3. Credit Creator (80% cut)
	creatorCut := int64(float64(priceCents) * 0.80)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO ad_wallets (user_id, pending_balance_cents) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET pending_balance_cents = ad_wallets.pending_balance_cents + $2
	`, creatorID, creatorCut)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO ad_ledger_entries (user_id, amount_cents, transaction_type, reference_id, description) 
		VALUES ($1, $2, 'subscription_earning', $3, 'New Subscriber')
	`, creatorID, creatorCut, subscriberID)
	if err != nil {
		return err
	}

	// 4. Activate or Extend Subscription (30 days)
	now := time.Now()
	nextMonth := now.AddDate(0, 1, 0)

	query := `
		INSERT INTO ad_subscriptions (subscriber_id, creator_id, status, current_period_start, current_period_end)
		VALUES ($1, $2, 'active', $3, $4)
		ON CONFLICT (subscriber_id, creator_id) DO UPDATE SET
			status = 'active',
			current_period_start = $3,
			-- If already active and not expired, add 30 days to the existing end date. Otherwise, start from today.
			current_period_end = CASE 
				WHEN ad_subscriptions.current_period_end > $3 THEN ad_subscriptions.current_period_end + INTERVAL '30 days'
				ELSE $4 
			END
	`
	_, err = tx.ExecContext(ctx, query, subscriberID, creatorID, now, nextMonth)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// GetMySubscriptions fetches creators the user is currently subscribed to
func (r *ADSubscriptionRepository) GetMySubscriptions(ctx context.Context, subscriberID string) ([]models.ADSubscription, error) {
	query := `
		SELECT s.id::text, s.subscriber_id::text, pp.id::text, s.status,
		       s.current_period_start, s.current_period_end
		FROM ad_subscriptions s
		JOIN performer_profiles pp ON pp.user_id = s.creator_id
		WHERE s.subscriber_id = $1 AND s.status = 'active' AND s.current_period_end > CURRENT_TIMESTAMP
	`
	rows, err := r.DB.QueryContext(ctx, query, subscriberID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subs []models.ADSubscription
	for rows.Next() {
		var s models.ADSubscription
		if err := rows.Scan(&s.ID, &s.SubscriberID, &s.CreatorID, &s.Status, &s.CurrentPeriodStart, &s.CurrentPeriodEnd); err != nil {
			continue
		}
		subs = append(subs, s)
	}

	if subs == nil {
		subs = []models.ADSubscription{}
	}
	return subs, nil
}
