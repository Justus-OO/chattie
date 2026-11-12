package services

import (
	"context"
	"net"
	"net/http"
	"strings"
)

// CheckoutSession contains all metadata needed to render an inline popup modal or redirect
type CheckoutSession struct {
	Provider     string `json:"provider"`      // "stripe" or "paystack"
	SessionID    string `json:"session_id"`    // Stripe cs_... or Paystack reference
	ClientSecret string `json:"client_secret"` // Stripe ClientSecret or Paystack AccessCode
	PublicKey    string `json:"public_key"`    // Provider public key for frontend SDK mount
	PaymentURL   string `json:"payment_url"`   // Fallback redirect URL if popup is blocked
}

// PaymentGateway defines the contract for any billing provider.
// UPGRADE: Uses dynamic DB pricing (amount + duration) instead of relying on provider Plan IDs.
type PaymentGateway interface {
	CreateSubscription(ctx context.Context, email, userID string, price float64, months int) (*CheckoutSession, error)
	VerifyPayment(ctx context.Context, sessionID string) (bool, error)
}

type PaymentVerification struct {
	Paid          bool
	AmountMinor   int64
	Currency      string
	UserID        string
	PaymentMethod *PaymentMethodInfo
}

type PaymentMethodInfo struct {
	ProviderMethodID string
	CustomerID       string
	Authorization    string
	Brand            string
	Last4            string
	ExpMonth         int
	ExpYear          int
	Bank             string
}

type PaymentDetailsVerifier interface {
	VerifyPaymentDetails(ctx context.Context, sessionID string) (*PaymentVerification, error)
}

// BillingRouter routes incoming checkout requests to the optimal gateway by geography
type BillingRouter struct {
	Stripe   PaymentGateway
	Paystack PaymentGateway
	Mpesa    *MpesaGateway
}

func NewBillingRouter(stripe PaymentGateway, paystack PaymentGateway, mpesa ...*MpesaGateway) *BillingRouter {
	return &BillingRouter{
		Stripe:   stripe,
		Paystack: paystack,
		Mpesa:    firstMpesaGateway(mpesa),
	}
}

func firstMpesaGateway(gateways []*MpesaGateway) *MpesaGateway {
	if len(gateways) == 0 {
		return nil
	}
	return gateways[0]
}

// Route determines gateway choice using Cloudflare/proxy headers or IP geolocation
func (r *BillingRouter) Route(req *http.Request) PaymentGateway {
	if forced := strings.ToLower(strings.TrimSpace(req.URL.Query().Get("gateway"))); forced != "" {
		switch forced {
		case "stripe":
			return r.Stripe
		case "paystack":
			return r.Paystack
		case "mpesa":
			if r.Mpesa != nil {
				return r.Mpesa
			}
		}
	}

	// 1. Direct Edge Header (Cloudflare delivers ISO 3166-1 alpha-2)
	countryCode := strings.ToUpper(strings.TrimSpace(req.Header.Get("CF-IPCountry")))

	// 2. Generic Reverse Proxy Header Fallback
	if countryCode == "" {
		countryCode = strings.ToUpper(strings.TrimSpace(req.Header.Get("X-Country-Code")))
	}

	// African regions natively served by Paystack (Card, M-Pesa, Mobile Money, EFT)
	paystackRegions := map[string]bool{
		"KE": true, // Kenya (M-Pesa / Cards)
		"NG": true, // Nigeria
		"ZA": true, // South Africa
		"GH": true, // Ghana
		"UG": true, // Uganda
		"RW": true, // Rwanda
		"CI": true, // Côte d'Ivoire
		"EG": true, // Egypt
	}

	if paystackRegions[countryCode] {
		return r.Paystack
	}

	// Global fallback (US, EU, UK, CA, AU, LATAM, Asia) -> Stripe
	return r.Stripe
}

// ExtractClientIP parses the client IP respecting reverse proxies
func ExtractClientIP(req *http.Request) string {
	if xff := req.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xrip := req.Header.Get("X-Real-IP"); xrip != "" {
		return strings.TrimSpace(xrip)
	}
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err != nil {
		return req.RemoteAddr
	}
	return host
}
