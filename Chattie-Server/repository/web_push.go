package repository

import (
	"context"
	"errors"
)

var ErrWebPushSubscriptionOwned = errors.New("push subscription belongs to another account")

type WebPushSubscription struct {
	Endpoint string
	P256DH   string
	Auth     string
}

func (r *Repository) SaveWebPushSubscription(ctx context.Context, userID string, subscription WebPushSubscription) error {
	result, err := r.DB.ExecContext(ctx, `
		INSERT INTO web_push_subscriptions (endpoint, user_id, p256dh, auth)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (endpoint) DO UPDATE SET
			p256dh = EXCLUDED.p256dh,
			auth = EXCLUDED.auth,
			updated_at = CURRENT_TIMESTAMP
		WHERE web_push_subscriptions.user_id = EXCLUDED.user_id
	`, subscription.Endpoint, userID, subscription.P256DH, subscription.Auth)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrWebPushSubscriptionOwned
	}
	return nil
}

func (r *Repository) DeleteWebPushSubscription(ctx context.Context, userID, endpoint string) error {
	_, err := r.DB.ExecContext(ctx, `
		DELETE FROM web_push_subscriptions WHERE user_id = $1 AND endpoint = $2
	`, userID, endpoint)
	return err
}

func (r *Repository) ListWebPushSubscriptions(ctx context.Context, userID string) ([]WebPushSubscription, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT endpoint, p256dh, auth
		FROM web_push_subscriptions WHERE user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	subscriptions := make([]WebPushSubscription, 0)
	for rows.Next() {
		var subscription WebPushSubscription
		if err := rows.Scan(&subscription.Endpoint, &subscription.P256DH, &subscription.Auth); err != nil {
			return nil, err
		}
		subscriptions = append(subscriptions, subscription)
	}
	return subscriptions, rows.Err()
}

func (r *Repository) DeleteWebPushSubscriptionByEndpoint(ctx context.Context, endpoint string) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM web_push_subscriptions WHERE endpoint = $1`, endpoint)
	return err
}
