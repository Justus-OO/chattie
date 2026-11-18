package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"chattie-backend/middlewares"
)

func TestGetCheckoutConfigRejectsUnknownCountry(t *testing.T) {
	handler := &ADPaymentsHandler{}
	request := httptest.NewRequest(http.MethodGet, "/api/afterdark/payments/checkout-config", nil)
	response := httptest.NewRecorder()

	handler.GetCheckoutConfig(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d", http.StatusServiceUnavailable, response.Code)
	}
	if !strings.Contains(response.Body.String(), "Could not determine your country") {
		t.Fatalf("expected country detection error, got %q", response.Body.String())
	}
}

func TestCreateCheckoutRejectsUnknownCountryBeforeProviderSelection(t *testing.T) {
	handler := &ADPaymentsHandler{}
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/afterdark/payments/checkout",
		strings.NewReader(`{"payment_type":"ppv","target_id":"post-1","amount_cents":100}`),
	)
	ctx := context.WithValue(request.Context(), middlewares.UserIDKey, "viewer-1")
	request = request.WithContext(ctx)
	response := httptest.NewRecorder()

	handler.CreateCheckout(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d", http.StatusServiceUnavailable, response.Code)
	}
	if !strings.Contains(response.Body.String(), "Could not determine your country") {
		t.Fatalf("expected country detection error, got %q", response.Body.String())
	}
}

func TestGetCheckoutConfigUsesKenyanProvidersWithoutStripeConfiguration(t *testing.T) {
	handler := &ADPaymentsHandler{}
	request := httptest.NewRequest(http.MethodGet, "/api/afterdark/payments/checkout-config", nil)
	ctx := context.WithValue(request.Context(), middlewares.CountryCodeKey, "KE")
	request = request.WithContext(ctx)
	response := httptest.NewRecorder()

	handler.GetCheckoutConfig(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d: %s", http.StatusOK, response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"currency":"KES"`) ||
		!strings.Contains(response.Body.String(), `"default_provider":"mpesa"`) {
		t.Fatalf("expected Kenyan M-Pesa checkout config, got %q", response.Body.String())
	}
}
