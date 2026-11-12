package services

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type PaystackGateway struct {
	SecretKey  string
	PublicKey  string // Needed for frontend SDK mount
	Currency   string
	HTTPClient *http.Client
	// REMOVED: PremiumPlanCode and VIPPlanCode
}

type PaystackBank struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

type PaystackTransfer struct {
	Code      string `json:"transfer_code"`
	Reference string `json:"reference"`
	Status    string `json:"status"`
}

func NewPaystackGateway() *PaystackGateway {
	currency := strings.ToUpper(strings.TrimSpace(os.Getenv("PAYSTACK_CURRENCY")))
	return &PaystackGateway{
		SecretKey: os.Getenv("PAYSTACK_SECRET_KEY"),
		PublicKey: os.Getenv("PAYSTACK_PUBLIC_KEY"),
		Currency:  currency,
		// UPGRADE: Never use http.DefaultClient in production; always enforce timeouts
		HTTPClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// CreateSubscription uses dynamic price data passed from the DB instead of resolving Paystack Plan Codes
func (p *PaystackGateway) CreateSubscription(ctx context.Context, email, userID string, price float64, months int) (*CheckoutSession, error) {
	// Paystack expects amounts in subunits (e.g., Kobo for NGN, Cents for USD, Cents for KES)
	amountInSubunits := int64(math.Round(price * 100))

	payload := map[string]interface{}{
		"email":  email,
		"amount": amountInSubunits,
		"metadata": map[string]string{
			"user_id": userID,
			"months":  fmt.Sprintf("%d", months), // Track the duration purchased
		},
		// UPGRADE: Explicitly enable African payment channels (M-Pesa, Mobile Money, Cards)
		"channels": []string{"card", "mobile_money", "mpesa", "eft", "bank"},
	}
	if callbackURL := strings.TrimSpace(os.Getenv("PAYSTACK_CALLBACK_URL")); callbackURL != "" {
		payload["callback_url"] = callbackURL
	}
	if p.Currency != "" {
		payload["currency"] = p.Currency
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
		ClientSecret: res.Data.AccessCode,
		PublicKey:    p.PublicKey,
		PaymentURL:   res.Data.AuthorizationURL, // Fallback URL
	}, nil
}

func (p *PaystackGateway) CreateADCheckout(ctx context.Context, email, userID, intentID string, amountMinor int64, paymentType string) (*CheckoutSession, error) {
	if p.SecretKey == "" || p.PublicKey == "" {
		return nil, fmt.Errorf("Paystack is not configured")
	}
	if amountMinor < 1 || intentID == "" || userID == "" {
		return nil, fmt.Errorf("invalid After Dark checkout details")
	}
	payload := map[string]interface{}{
		"email":     email,
		"amount":    amountMinor,
		"currency":  "KES",
		"reference": intentID,
		"metadata": map[string]string{
			"user_id":      userID,
			"intent_id":    intentID,
			"payment_type": paymentType,
		},
		"channels": []string{"card", "mobile_money", "mpesa"},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode After Dark Paystack checkout: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.paystack.co/transaction/initialize", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.SecretKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Paystack checkout request failed: %w", err)
	}
	defer resp.Body.Close()
	var result struct {
		Status  bool   `json:"status"`
		Message string `json:"message"`
		Data    struct {
			AccessCode string `json:"access_code"`
			Reference  string `json:"reference"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode Paystack checkout response: %w", err)
	}
	if !result.Status || result.Data.Reference != intentID || result.Data.AccessCode == "" {
		return nil, fmt.Errorf("Paystack rejected After Dark checkout: %s", result.Message)
	}
	return &CheckoutSession{
		Provider:     "paystack",
		SessionID:    result.Data.Reference,
		ClientSecret: result.Data.AccessCode,
		PublicKey:    p.PublicKey,
	}, nil
}

func (p *PaystackGateway) ListPayoutBanks(ctx context.Context, recipientType string) ([]PaystackBank, error) {
	if p.SecretKey == "" {
		return nil, fmt.Errorf("Paystack is not configured")
	}
	if recipientType != "bank" && recipientType != "mobile_money" {
		return nil, fmt.Errorf("unsupported Paystack payout destination type")
	}
	endpoint := "https://api.paystack.co/bank?country=kenya"
	if recipientType == "mobile_money" {
		endpoint += "&type=mobile_money"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.SecretKey)
	resp, err := p.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Paystack bank list request failed: %w", err)
	}
	defer resp.Body.Close()
	var result struct {
		Status  bool   `json:"status"`
		Message string `json:"message"`
		Data    []struct {
			Code string `json:"code"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode Paystack bank list: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !result.Status {
		return nil, fmt.Errorf("Paystack bank list rejected: %s", result.Message)
	}
	banks := make([]PaystackBank, 0, len(result.Data))
	for _, bank := range result.Data {
		if bank.Code != "" && bank.Name != "" {
			banks = append(banks, PaystackBank{Code: bank.Code, Name: bank.Name})
		}
	}
	return banks, nil
}

func (p *PaystackGateway) CreateTransferRecipient(ctx context.Context, recipientType, name, accountNumber, bankCode string) (string, error) {
	if p.SecretKey == "" {
		return "", fmt.Errorf("Paystack is not configured")
	}
	paystackType := "nuban"
	if recipientType == "mobile_money" {
		paystackType = "mobile_money"
	} else if recipientType != "bank" {
		return "", fmt.Errorf("unsupported Paystack payout destination type")
	}
	payload := map[string]string{
		"type": paystackType, "name": name, "account_number": accountNumber,
		"bank_code": bankCode, "currency": "KES",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encode Paystack transfer recipient: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.paystack.co/transferrecipient", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+p.SecretKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.HTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("Paystack recipient request failed: %w", err)
	}
	defer resp.Body.Close()
	var result struct {
		Status  bool   `json:"status"`
		Message string `json:"message"`
		Data    struct {
			RecipientCode string `json:"recipient_code"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode Paystack recipient response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !result.Status || result.Data.RecipientCode == "" {
		return "", fmt.Errorf("Paystack rejected transfer recipient: %s", result.Message)
	}
	return result.Data.RecipientCode, nil
}

func (p *PaystackGateway) InitiateTransfer(ctx context.Context, amountMinor int64, recipientCode, reference, reason string) (*PaystackTransfer, error) {
	if p.SecretKey == "" {
		return nil, fmt.Errorf("Paystack is not configured")
	}
	if amountMinor < 1 || recipientCode == "" || reference == "" {
		return nil, fmt.Errorf("invalid Paystack transfer details")
	}
	body, err := json.Marshal(map[string]interface{}{
		"source": "balance", "amount": amountMinor, "recipient": recipientCode,
		"reference": reference, "reason": reason, "currency": "KES",
	})
	if err != nil {
		return nil, fmt.Errorf("encode Paystack transfer: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.paystack.co/transfer", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.SecretKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Paystack transfer request failed: %w", err)
	}
	defer resp.Body.Close()
	var result struct {
		Status  bool   `json:"status"`
		Message string `json:"message"`
		Data    struct {
			TransferCode string `json:"transfer_code"`
			Reference    string `json:"reference"`
			Status       string `json:"status"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode Paystack transfer response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !result.Status || result.Data.Reference != reference {
		return nil, fmt.Errorf("Paystack rejected transfer: %s", result.Message)
	}
	return &PaystackTransfer{Code: result.Data.TransferCode, Reference: result.Data.Reference, Status: result.Data.Status}, nil
}

func (p *PaystackGateway) VerifyPayment(ctx context.Context, reference string) (bool, error) {
	verification, err := p.VerifyPaymentDetails(ctx, reference)
	if err != nil {
		return false, err
	}
	return verification.Paid, nil
}

func (p *PaystackGateway) VerifyPaymentDetails(ctx context.Context, reference string) (*PaymentVerification, error) {
	url := fmt.Sprintf("https://api.paystack.co/transaction/verify/%s", reference)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+p.SecretKey)

	resp, err := p.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("paystack verify request failed: %w", err)
	}
	defer resp.Body.Close()

	var res struct {
		Status  bool   `json:"status"`
		Message string `json:"message"`
		Data    struct {
			Status        string         `json:"status"`
			Amount        int64          `json:"amount"`
			Currency      string         `json:"currency"`
			Metadata      map[string]any `json:"metadata"`
			Authorization struct {
				AuthorizationCode string `json:"authorization_code"`
				CardType          string `json:"card_type"`
				Last4             string `json:"last4"`
				ExpMonth          string `json:"exp_month"`
				ExpYear           string `json:"exp_year"`
				Bank              string `json:"bank"`
				Channel           string `json:"channel"`
				Signature         string `json:"signature"`
				Reusable          bool   `json:"reusable"`
			} `json:"authorization"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, fmt.Errorf("paystack verify decode error: %w", err)
	}

	userID, _ := res.Data.Metadata["user_id"].(string)
	verification := &PaymentVerification{
		Paid:        res.Status && res.Data.Status == "success",
		AmountMinor: res.Data.Amount,
		Currency:    strings.ToUpper(res.Data.Currency),
		UserID:      userID,
	}
	authorization := res.Data.Authorization
	if verification.Paid && authorization.Reusable &&
		strings.EqualFold(authorization.Channel, "card") &&
		authorization.AuthorizationCode != "" && len(authorization.Last4) == 4 {
		digest := sha256.Sum256([]byte(authorization.AuthorizationCode))
		methodID := authorization.Signature
		if methodID == "" {
			methodID = hex.EncodeToString(digest[:])
		}
		expMonth, _ := strconv.Atoi(authorization.ExpMonth)
		expYear, _ := strconv.Atoi(authorization.ExpYear)
		verification.PaymentMethod = &PaymentMethodInfo{
			ProviderMethodID: methodID,
			Authorization:    authorization.AuthorizationCode,
			Brand:            authorization.CardType,
			Last4:            authorization.Last4,
			ExpMonth:         expMonth,
			ExpYear:          expYear,
			Bank:             authorization.Bank,
		}
	}
	return verification, nil
}

func (p *PaystackGateway) CurrencyCode() string { return p.Currency }

func (p *PaystackGateway) DeactivateAuthorization(ctx context.Context, authorizationCode string) error {
	if p.SecretKey == "" {
		return fmt.Errorf("Paystack is not configured")
	}
	if strings.TrimSpace(authorizationCode) == "" {
		return fmt.Errorf("Paystack authorization is missing")
	}
	body, err := json.Marshal(map[string]string{"authorization_code": authorizationCode})
	if err != nil {
		return fmt.Errorf("encode Paystack authorization request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.paystack.co/customer/deactivate_authorization", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create Paystack authorization request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+p.SecretKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("Paystack authorization deactivation request failed: %w", err)
	}
	defer resp.Body.Close()
	var result struct {
		Status  bool   `json:"status"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("decode Paystack authorization response: %w", err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices || !result.Status {
		return fmt.Errorf("Paystack could not deactivate authorization: %s", result.Message)
	}
	return nil
}
