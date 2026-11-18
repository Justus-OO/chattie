package repository

import (
	"context"
	"time"

	"chattie-backend/models"
)

func (r *AdminRepository) GetFinanceAnalytics(ctx context.Context, since time.Time) (*models.AdminFinanceAnalytics, error) {
	analytics := &models.AdminFinanceAnalytics{
		RevenueBySource:      make([]models.AdminFinanceRevenueTotal, 0),
		DailyRevenue:         make([]models.AdminFinanceDailyRevenue, 0),
		CreatorPayouts:       make([]models.AdminFinancePayoutStatus, 0),
		AfterDarkWithdrawals: make([]models.AdminFinancePayoutStatus, 0),
	}

	rows, err := r.DB.QueryContext(ctx, `
		SELECT source, currency, SUM(amount_minor)::bigint, COUNT(*)::bigint
		FROM (
			SELECT 'MAIN_APP_SUBSCRIPTION' AS source, currency, amount_minor, paid_at AS settled_at
			FROM billing_payment_intents
			WHERE status = 'paid' AND paid_at >= $1
			UNION ALL
			SELECT 'AFTER_DARK_' || UPPER(payment_type), UPPER(currency), amount_cents, updated_at
			FROM ad_payment_intents
			WHERE status = 'completed' AND updated_at >= $1
		) payments
		GROUP BY source, currency
		ORDER BY currency, source
	`, since)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var total models.AdminFinanceRevenueTotal
		if err := rows.Scan(&total.Source, &total.Currency, &total.AmountMinor, &total.PaymentCount); err != nil {
			rows.Close()
			return nil, err
		}
		analytics.RevenueBySource = append(analytics.RevenueBySource, total)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	rows, err = r.DB.QueryContext(ctx, `
		SELECT settled_at::date::text, source, currency,
		       SUM(amount_minor)::bigint, COUNT(*)::bigint
		FROM (
			SELECT 'MAIN_APP_SUBSCRIPTION' AS source, currency, amount_minor, paid_at AS settled_at
			FROM billing_payment_intents
			WHERE status = 'paid' AND paid_at >= $1
			UNION ALL
			SELECT 'AFTER_DARK_' || UPPER(payment_type), UPPER(currency), amount_cents, updated_at
			FROM ad_payment_intents
			WHERE status = 'completed' AND updated_at >= $1
		) payments
		GROUP BY settled_at::date, source, currency
		ORDER BY settled_at::date DESC, currency, source
	`, since)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var daily models.AdminFinanceDailyRevenue
		if err := rows.Scan(&daily.Date, &daily.Source, &daily.Currency, &daily.AmountMinor, &daily.PaymentCount); err != nil {
			rows.Close()
			return nil, err
		}
		analytics.DailyRevenue = append(analytics.DailyRevenue, daily)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	err = r.DB.QueryRowContext(ctx, `
		SELECT
			(SELECT COUNT(*) FROM user_subscriptions
			 WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW())),
			(SELECT COUNT(*) FROM ad_subscriptions
			 WHERE status = 'active' AND current_period_end > NOW())
	`).Scan(&analytics.ActiveMainSubscriptions, &analytics.ActiveADSubscriptions)
	if err != nil {
		return nil, err
	}

	rows, err = r.DB.QueryContext(ctx, `
		SELECT status, COUNT(*)::bigint, COALESCE(SUM(amount_cents), 0)::bigint
		FROM creator_payout_requests
		GROUP BY status
		ORDER BY status
	`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var payout models.AdminFinancePayoutStatus
		if err := rows.Scan(&payout.Status, &payout.RequestCount, &payout.AmountMinor); err != nil {
			rows.Close()
			return nil, err
		}
		analytics.CreatorPayouts = append(analytics.CreatorPayouts, payout)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	rows, err = r.DB.QueryContext(ctx, `
		SELECT status, COUNT(*)::bigint, COALESCE(SUM(payout_amount_cents), 0)::bigint
		FROM ad_withdrawals
		GROUP BY status
		ORDER BY status
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var payout models.AdminFinancePayoutStatus
		if err := rows.Scan(&payout.Status, &payout.RequestCount, &payout.AmountMinor); err != nil {
			return nil, err
		}
		analytics.AfterDarkWithdrawals = append(analytics.AfterDarkWithdrawals, payout)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return analytics, nil
}
