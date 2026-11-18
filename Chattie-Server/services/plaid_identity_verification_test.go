package services

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPlaidCreateLinkTokenUsesIdentityVerificationTemplate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/link/token/create" {
			t.Errorf("path = %q, want /link/token/create", r.URL.Path)
		}
		if r.Header.Get("PLAID-CLIENT-ID") != "client-id" || r.Header.Get("PLAID-SECRET") != "secret" {
			t.Error("Plaid authentication headers were not set")
		}

		var request struct {
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
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if request.ClientName != "Chattie" ||
			request.Language != "en" ||
			len(request.CountryCodes) != 1 || request.CountryCodes[0] != "US" ||
			len(request.Products) != 1 || request.Products[0] != "identity_verification" ||
			request.User.ClientUserID != "user-123" ||
			request.IdentityVerification.TemplateID != "template-123" {
			t.Errorf("unexpected Link token request: %+v", request)
		}
		_, _ = io.WriteString(w, `{"link_token":"link-sandbox-token"}`)
	}))
	defer server.Close()

	service := NewPlaidIdentityVerificationService("client-id", "secret", "template-123", "US", "sandbox")
	service.baseURL = server.URL
	service.client = server.Client()

	token, err := service.CreateLinkToken(context.Background(), "user-123")
	if err != nil {
		t.Fatalf("CreateLinkToken() error = %v", err)
	}
	if token != "link-sandbox-token" {
		t.Fatalf("CreateLinkToken() = %q, want link-sandbox-token", token)
	}
}

func TestPlaidGetIdentityVerificationRequiresMatchingUser(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/identity_verification/get" {
			t.Errorf("path = %q, want /identity_verification/get", r.URL.Path)
		}
		var request map[string]string
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if request["identity_verification_id"] != "idv-123" {
			t.Errorf("identity_verification_id = %q, want idv-123", request["identity_verification_id"])
		}
		_, _ = io.WriteString(w, `{"id":"idv-123","client_user_id":"user-123","status":"success"}`)
	}))
	defer server.Close()

	service := NewPlaidIdentityVerificationService("client-id", "secret", "template-123", "US", "sandbox")
	service.baseURL = server.URL
	service.client = server.Client()

	verification, err := service.GetIdentityVerification(context.Background(), "idv-123", "user-123")
	if err != nil {
		t.Fatalf("GetIdentityVerification() error = %v", err)
	}
	if verification.Status != "success" {
		t.Fatalf("status = %q, want success", verification.Status)
	}
	if _, err := service.GetIdentityVerification(context.Background(), "idv-123", "another-user"); err == nil {
		t.Fatal("GetIdentityVerification() accepted a session belonging to another user")
	}
}

func TestPlaidAPIErrorDoesNotExposeResponseBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "sensitive Plaid error details", http.StatusUnauthorized)
	}))
	defer server.Close()

	service := NewPlaidIdentityVerificationService("client-id", "secret", "template-123", "US", "sandbox")
	service.baseURL = server.URL
	service.client = server.Client()
	_, err := service.CreateLinkToken(context.Background(), "user-123")
	if err == nil {
		t.Fatal("CreateLinkToken() error = nil, want upstream error")
	}
	if strings.Contains(err.Error(), "sensitive Plaid error details") {
		t.Fatalf("upstream response body leaked into error: %v", err)
	}
}

func TestPlaidServiceRequiresSandboxConfiguration(t *testing.T) {
	service := NewPlaidIdentityVerificationService("", "", "", "US", "sandbox")
	if service.Available() {
		t.Fatal("Available() = true without credentials and template")
	}
	if _, err := service.CreateLinkToken(context.Background(), "user-123"); err != ErrPlaidNotConfigured {
		t.Fatalf("CreateLinkToken() error = %v, want %v", err, ErrPlaidNotConfigured)
	}
}
