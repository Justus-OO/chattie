package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

type PaystackGateway struct {
	SecretKey  string
	PublicKey  string // Needed for frontend SDK mount
	HTTPClient *http.Client
	// REMOVED: PremiumPlanCode and VIPPlanCode
}

func NewPaystackGateway() *PaystackGateway {
	return &PaystackGateway{
		SecretKey: os.Getenv("PAYSTACK_SECRET_KEY"),
		PublicKey: os.Getenv("PAYSTACK_PUBLIC_KEY"),
		// UPGRADE: Never use http.DefaultClient in production; always enforce timeouts
		HTTPClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// CreateSubscription uses dynamic price data passed from the DB instead of resolving Paystack Plan Codes
func (p *PaystackGateway) CreateSubscription(ctx context.Context, email, userID string, price float64, months int) (*CheckoutSession, error) {
	// Paystack expects amounts in subunits (e.g., Kobo for NGN, Cents for USD, Cents for KES)
	amountInSubunits := int64(price * 100)

	payload := map[string]interface{}{
		"email":  email,
		"amount": amountInSubunits, // UPGRADE: Dynamic price from the database
		"metadata": map[string]string{
			"user_id": userID,
			"months":  fmt.Sprintf("%d", months), // Track the duration purchased
		},
		// UPGRADE: Explicitly enable African payment channels (M-Pesa, Mobile Money, Cards)
		"channels": []string{"card", "mobile_money", "mpesa", "eft", "bank"},
		// Note: callback_url is intentionally omitted because PaystackPop handles it inline via JS
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("paystack payload encode error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.paystack.co/transaction/initialize", bytes.NewBuffer(bodyBytes))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+p.SecretKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("paystack initialize request failed: %w", err)
	}
	defer resp.Body.Close()

	var res struct {
		Status  bool   `json:"status"`
		Message string `json:"message"`
		Data    struct {
			AuthorizationURL string `json:"authorization_url"`
			AccessCode       string `json:"access_code"` // CRITICAL: Required for the inline popup
			Reference        string `json:"reference"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, fmt.Errorf("paystack response decode error: %w", err)
	}

	if !res.Status {
		return nil, fmt.Errorf("paystack transaction rejection: %s", res.Message)
	}

	return &CheckoutSession{
		Provider:     "paystack",
		SessionID:    res.Data.Reference,
		ClientSecret: res.Data.AccessCode, // Mounts directly into window.PaystackPop.setup()
		PublicKey:    p.PublicKey,
		PaymentURL:   res.Data.AuthorizationURL, // Fallback URL
	}, nil
}

func (p *PaystackGateway) VerifyPayment(ctx context.Context, reference string) (bool, error) {
	url := fmt.Sprintf("https://api.paystack.co/transaction/verify/%s", reference)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, err
	}

	req.Header.Set("Authorization", "Bearer "+p.SecretKey)

	resp, err := p.HTTPClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("paystack verify request failed: %w", err)
	}
	defer resp.Body.Close()

	var res struct {
		Status  bool   `json:"status"`
		Message string `json:"message"`
		Data    struct {
			Status string `json:"status"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return false, fmt.Errorf("paystack verify decode error: %w", err)
	}

	// Verify both the API call success AND the actual payment state
	return res.Status && res.Data.Status == "success", nil
}
