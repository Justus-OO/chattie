package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var (
	ErrPlaidNotConfigured                     = errors.New("Plaid Identity Verification is not configured")
	ErrPlaidIdentityVerificationUserMismatch = errors.New("Plaid verification session does not belong to this user")
)

type PlaidAPIError struct {
	StatusCode int
}

func (e *PlaidAPIError) Error() string {
	return fmt.Sprintf("Plaid returned HTTP %d", e.StatusCode)
}

type PlaidIdentityVerificationService struct {
	clientID   string
	secret     string
	templateID string
	country    string
	clientName string
	baseURL    string
	client     *http.Client
}

type PlaidIdentityVerification struct {
	ID           string
	ClientUserID string
	Status       string
}

func NewPlaidIdentityVerificationService(clientID, secret, templateID, country, environment string) *PlaidIdentityVerificationService {
	baseURL := ""
	switch strings.ToLower(strings.TrimSpace(environment)) {
	case "sandbox":
		baseURL = "https://sandbox.plaid.com"
	case "production":
		baseURL = "https://production.plaid.com"
	}

	return &PlaidIdentityVerificationService{
		clientID:   strings.TrimSpace(clientID),
		secret:     strings.TrimSpace(secret),
		templateID: strings.TrimSpace(templateID),
		country:    strings.ToUpper(strings.TrimSpace(country)),
		clientName: "Chattie",
		baseURL:    baseURL,
		client:     &http.Client{Timeout: 25 * time.Second},
	}
}

func (s *PlaidIdentityVerificationService) Available() bool {
	return s != nil &&
		s.clientID != "" &&
		s.secret != "" &&
		s.templateID != "" &&
		s.country != "" &&
		s.baseURL != "" &&
		s.client != nil
}

func (s *PlaidIdentityVerificationService) CreateLinkToken(ctx context.Context, clientUserID string) (string, error) {
	if !s.Available() {
		return "", ErrPlaidNotConfigured
	}
	if strings.TrimSpace(clientUserID) == "" {
		return "", errors.New("Plaid Link token requires a client user ID")
	}

	payload := struct {
		ClientName    string   `json:"client_name"`
		Language      string   `json:"language"`
		CountryCodes  []string `json:"country_codes"`
		Products      []string `json:"products"`
		User          struct {
			ClientUserID string `json:"client_user_id"`
		} `json:"user"`
		IdentityVerification struct {
			TemplateID string `json:"template_id"`
		} `json:"identity_verification"`
	}{
		ClientName:   s.clientName,
		Language:     "en",
		CountryCodes: []string{s.country},
		Products:     []string{"identity_verification"},
	}
	payload.User.ClientUserID = clientUserID
	payload.IdentityVerification.TemplateID = s.templateID

	var response struct {
		LinkToken string `json:"link_token"`
	}
	if err := s.post(ctx, "/link/token/create", payload, &response); err != nil {
		return "", err
	}
	if strings.TrimSpace(response.LinkToken) == "" {
		return "", errors.New("Plaid did not return a Link token")
	}
	return response.LinkToken, nil
}

func (s *PlaidIdentityVerificationService) GetIdentityVerification(
	ctx context.Context,
	identityVerificationID, expectedClientUserID string,
) (*PlaidIdentityVerification, error) {
	if !s.Available() {
		return nil, ErrPlaidNotConfigured
	}
	if strings.TrimSpace(identityVerificationID) == "" || strings.TrimSpace(expectedClientUserID) == "" {
		return nil, errors.New("Plaid verification lookup requires session and user IDs")
	}

	var response struct {
		ID           string `json:"id"`
		ClientUserID string `json:"client_user_id"`
		Status       string `json:"status"`
	}
	if err := s.post(ctx, "/identity_verification/get", map[string]string{
		"identity_verification_id": identityVerificationID,
	}, &response); err != nil {
		return nil, err
	}
	if response.ID != identityVerificationID {
		return nil, errors.New("Plaid returned a different verification session")
	}
	if response.ClientUserID != expectedClientUserID {
		return nil, ErrPlaidIdentityVerificationUserMismatch
	}
	switch response.Status {
	case "active", "success", "failed", "expired", "canceled", "pending_review":
	default:
		return nil, fmt.Errorf("Plaid returned an unknown verification status")
	}

	return &PlaidIdentityVerification{
		ID:           response.ID,
		ClientUserID: response.ClientUserID,
		Status:       response.Status,
	}, nil
}

func (s *PlaidIdentityVerificationService) post(ctx context.Context, path string, payload, output any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode Plaid request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create Plaid request: %w", err)
	}
	req.Header.Set("PLAID-CLIENT-ID", s.clientID)
	req.Header.Set("PLAID-SECRET", s.secret)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("send Plaid request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return &PlaidAPIError{StatusCode: resp.StatusCode}
	}

	const maxResponseBytes = 1 << 20
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return fmt.Errorf("read Plaid response: %w", err)
	}
	if len(responseBody) > maxResponseBytes {
		return errors.New("Plaid response exceeded the size limit")
	}
	if err := json.Unmarshal(responseBody, output); err != nil {
		return errors.New("Plaid returned an invalid response")
	}
	return nil
}
