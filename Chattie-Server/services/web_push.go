package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"chattie-backend/repository"
	webpush "github.com/SherClockHolmes/webpush-go"
)

type WebPushService struct {
	repo       *repository.Repository
	publicKey  string
	privateKey string
	subscriber string
}

func NewWebPushService(repo *repository.Repository) *WebPushService {
	return &WebPushService{
		repo:       repo,
		publicKey:  strings.TrimSpace(os.Getenv("VAPID_PUBLIC_KEY")),
		privateKey: strings.TrimSpace(os.Getenv("VAPID_PRIVATE_KEY")),
		subscriber: strings.TrimSpace(os.Getenv("VAPID_SUBJECT")),
	}
}

func (s *WebPushService) PublicKey() string {
	return s.publicKey
}

func (s *WebPushService) Configured() bool {
	return s.publicKey != "" && s.privateKey != "" && s.subscriber != ""
}

func (s *WebPushService) Send(ctx context.Context, userID, title, body string) error {
	if !s.Configured() {
		return errors.New("Web Push VAPID configuration is incomplete")
	}
	subscriptions, err := s.repo.ListWebPushSubscriptions(ctx, userID)
	if err != nil {
		return fmt.Errorf("load Web Push subscriptions: %w", err)
	}
	payload, err := json.Marshal(map[string]string{
		"title": title,
		"body":  body,
		"url":   "/notifications",
	})
	if err != nil {
		return fmt.Errorf("encode Web Push payload: %w", err)
	}

	var failures []error
	for _, subscription := range subscriptions {
		if err := ctx.Err(); err != nil {
			return err
		}
		response, sendErr := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
			Endpoint: subscription.Endpoint,
			Keys: webpush.Keys{
				P256dh: subscription.P256DH,
				Auth:   subscription.Auth,
			},
		}, &webpush.Options{
			Subscriber:      s.subscriber,
			VAPIDPublicKey:  s.publicKey,
			VAPIDPrivateKey: s.privateKey,
			TTL:             60,
			HTTPClient:      &http.Client{Timeout: 10 * time.Second},
		})
		if sendErr != nil {
			failures = append(failures, fmt.Errorf("send Web Push notification: %w", sendErr))
			continue
		}
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
		if response.StatusCode == http.StatusGone || response.StatusCode == http.StatusNotFound {
			if err := s.repo.DeleteWebPushSubscriptionByEndpoint(ctx, subscription.Endpoint); err != nil {
				failures = append(failures, fmt.Errorf("remove expired Web Push subscription: %w", err))
			}
			continue
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			failures = append(failures, fmt.Errorf("Web Push endpoint returned HTTP %d", response.StatusCode))
		}
	}
	return errors.Join(failures...)
}
