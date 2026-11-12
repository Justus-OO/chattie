package services

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMpesaSTKPushAndStatusQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth/v1/generate":
			expectedAuth := "Basic " + base64.StdEncoding.EncodeToString([]byte("consumer-key:consumer-secret"))
			if r.Header.Get("Authorization") != expectedAuth {
				t.Errorf("unexpected OAuth authorization header")
			}
			fmt.Fprint(w, `{"access_token":"test-access-token"}`)
		case "/mpesa/stkpush/v1/processrequest":
			var payload map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Errorf("decode STK request: %v", err)
			}
			if payload["BusinessShortCode"] != float64(174379) ||
				payload["Amount"] != float64(1949) ||
				payload["PartyA"] != float64(254712345678) ||
				payload["PartyB"] != float64(174379) {
				t.Errorf("unexpected STK request payload: %#v", payload)
			}
			fmt.Fprint(w, `{"ResponseCode":"0","MerchantRequestID":"merchant-1","CheckoutRequestID":"checkout-1","CustomerMessage":"Prompt sent"}`)
		case "/mpesa/stkpushquery/v1/query":
			fmt.Fprint(w, `{"ResponseCode":"0","ResultCode":0,"ResultDesc":"The service request is processed successfully."}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	gateway := &MpesaGateway{
		ConsumerKey:    "consumer-key",
		ConsumerSecret: "consumer-secret",
		Shortcode:      "174379",
		Passkey:        "test-passkey",
		CallbackURL:    "https://example.test/api/subscriptions/mpesa/callback",
		BaseURL:        server.URL,
		USDToKESRate:   130,
		HTTPClient:     server.Client(),
	}

	session, err := gateway.CreateSTKPush(context.Background(), "0712345678", "intent-1", 1949)
	if err != nil {
		t.Fatalf("CreateSTKPush returned an error: %v", err)
	}
	if session.CheckoutRequestID != "checkout-1" {
		t.Fatalf("unexpected checkout request ID: %q", session.CheckoutRequestID)
	}
	status, err := gateway.GetPaymentStatus(context.Background(), session.CheckoutRequestID)
	if err != nil {
		t.Fatalf("GetPaymentStatus returned an error: %v", err)
	}
	if status != "paid" {
		t.Fatalf("expected paid status, got %q", status)
	}
}

func TestMpesaPhoneAndCurrencyValidation(t *testing.T) {
	for _, invalidPhone := range []string{"123", "071234567", "254207123456"} {
		if _, err := normalizeMpesaPhone(invalidPhone); err == nil {
			t.Errorf("expected invalid phone %q to be rejected", invalidPhone)
		}
	}
	phone, err := normalizeMpesaPhone("+254 712-345-678")
	if err != nil {
		t.Fatalf("valid phone was rejected: %v", err)
	}
	if phone != "254712345678" {
		t.Fatalf("unexpected normalized phone: %q", phone)
	}

	gateway := &MpesaGateway{USDToKESRate: 130}
	amount, err := gateway.KESAmount(14.99)
	if err != nil {
		t.Fatalf("KESAmount returned an error: %v", err)
	}
	if amount != 1949 {
		t.Fatalf("expected KES 1949, got %d", amount)
	}
}
