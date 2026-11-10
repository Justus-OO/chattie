package services

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/checkout/session"
)

type StripeGateway struct {
	PublishableKey string
	ReturnURL      string
	// REMOVED: PremiumPriceID and VIPPriceID
}

func NewStripeGateway() *StripeGateway {
	// 1. Set the global secret key for the Stripe backend SDK
	stripe.Key = os.Getenv("STRIPE_SECRET_KEY")

	// 2. Fallback to a default return URL if not explicitly set in the environment
	returnURL := os.Getenv("STRIPE_RETURN_URL")
	if returnURL == "" {
		returnURL = "https://chattie.app/payment/return?session_id={CHECKOUT_SESSION_ID}"
	}

	return &StripeGateway{
		PublishableKey: os.Getenv("STRIPE_PUBLISHABLE_KEY"), // Needed for React to mount the modal
		ReturnURL:      returnURL,
	}
}

// CreateSubscription uses dynamic PriceData passed from the DB instead of resolving pre-made Stripe IDs
func (s *StripeGateway) CreateSubscription(ctx context.Context, email, userID string, price float64, months int) (*CheckoutSession, error) {
	// Stripe expects amounts in the smallest currency unit (e.g., cents for USD)
	amountInCents := int64(price * 100)

	planName := fmt.Sprintf("%d Month Premium Upgrade", months)
	if months == 1 {
		planName = "1 Month Premium Upgrade"
	}

	// Safely append the 'months' parameter to the ReturnURL so your frontend can use it during VerifyPayment
	separator := "?"
	if strings.Contains(s.ReturnURL, "?") {
		separator = "&"
	}
	finalReturnURL := fmt.Sprintf("%s%smonths=%d", s.ReturnURL, separator, months)

	params := &stripe.CheckoutSessionParams{
		CustomerEmail:     stripe.String(email),
		ClientReferenceID: stripe.String(userID),

		// UPGRADE: Changed to Payment (one-time charge) instead of Subscription mode
		Mode: stripe.String(string(stripe.CheckoutSessionModePayment)),

		// UPGRADE: Force embedded modal mode (Zero-Redirect Checkout)
		UIMode: stripe.String("embedded"),

		// UPGRADE: Embedded mode strictly requires ReturnURL and forbids Success/Cancel URLs
		ReturnURL: stripe.String(finalReturnURL),

		// UPGRADE: Build the price dynamically on the fly based on the DB price
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
					Currency: stripe.String("usd"), // Change this if using a different currency
					ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
						Name: stripe.String(planName),
					},
					UnitAmount: stripe.Int64(amountInCents),
				},
				Quantity: stripe.Int64(1),
			},
		},

		// UPGRADE: Attach database identifiers so webhooks can easily process offline payments
		Metadata: map[string]string{
			"user_id": userID,
			"months":  fmt.Sprintf("%d", months),
		},
	}

	// Propagate the HTTP context to cancel the request if the user drops connection early
	params.Context = ctx

	sess, err := session.New(params)
	if err != nil {
		return nil, fmt.Errorf("stripe checkout session creation failed: %w", err)
	}

	return &CheckoutSession{
		Provider:     "stripe",
		SessionID:    sess.ID,
		ClientSecret: sess.ClientSecret, // CRITICAL: The token React needs to launch the modal
		PublicKey:    s.PublishableKey,
		PaymentURL:   sess.URL, // Fallback URL just in case
	}, nil
}

func (s *StripeGateway) VerifyPayment(ctx context.Context, sessionID string) (bool, error) {
	params := &stripe.CheckoutSessionParams{}
	params.Context = ctx

	sess, err := session.Get(sessionID, params)
	if err != nil {
		return false, fmt.Errorf("stripe session retrieval failed: %w", err)
	}

	// UPGRADE: Account for both immediate payment success and general subscription completion states
	isPaid := sess.PaymentStatus == stripe.CheckoutSessionPaymentStatusPaid ||
		(sess.Status == stripe.CheckoutSessionStatusComplete)

	return isPaid, nil
}
