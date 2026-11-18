package services

import (
	"context"
	"fmt"
	"math"
	"os"
	"strings"

	"github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/checkout/session"
	"github.com/stripe/stripe-go/v76/paymentmethod"
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
	return s.CreateSubscriptionForCustomer(ctx, email, userID, "", price, months)
}

func (s *StripeGateway) CreateSubscriptionForCustomer(ctx context.Context, email, userID, customerID string, price float64, months int) (*CheckoutSession, error) {
	// Stripe expects amounts in the smallest currency unit (e.g., cents for USD)
	amountInCents := int64(math.Round(price * 100))

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
		ClientReferenceID: stripe.String(userID),

		// UPGRADE: Changed to Payment (one-time charge) instead of Subscription mode
		Mode: stripe.String(string(stripe.CheckoutSessionModePayment)),
		PaymentIntentData: &stripe.CheckoutSessionPaymentIntentDataParams{
			SetupFutureUsage: stripe.String(string(stripe.PaymentIntentSetupFutureUsageOffSession)),
		},

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
	if customerID != "" {
		params.Customer = stripe.String(customerID)
	} else {
		params.CustomerEmail = stripe.String(email)
		params.CustomerCreation = stripe.String(string(stripe.CheckoutSessionCustomerCreationAlways))
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

func (s *StripeGateway) CreateADCheckout(ctx context.Context, email, userID, intentID string, amountMinor int64, paymentType, returnURL string) (*CheckoutSession, error) {
	if s == nil || strings.TrimSpace(s.PublishableKey) == "" {
		return nil, fmt.Errorf("Stripe publishable key is not configured")
	}
	if amountMinor < 1 || userID == "" || intentID == "" || strings.TrimSpace(returnURL) == "" {
		return nil, fmt.Errorf("invalid After Dark Stripe checkout details")
	}

	productName := "After Dark purchase"
	if paymentType != "" {
		productName = fmt.Sprintf("After Dark %s", strings.ReplaceAll(paymentType, "_", " "))
	}
	params := &stripe.CheckoutSessionParams{
		ClientReferenceID: stripe.String(userID),
		Mode:              stripe.String(string(stripe.CheckoutSessionModePayment)),
		UIMode:            stripe.String("embedded"),
		ReturnURL:         stripe.String(returnURL),
		CustomerEmail:     stripe.String(email),
		CustomerCreation:  stripe.String(string(stripe.CheckoutSessionCustomerCreationAlways)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{{
			PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
				Currency: stripe.String("usd"),
				ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
					Name: stripe.String(productName),
				},
				UnitAmount: stripe.Int64(amountMinor),
			},
			Quantity: stripe.Int64(1),
		}},
		Metadata: map[string]string{
			"user_id":      userID,
			"intent_id":    intentID,
			"payment_type": paymentType,
		},
	}
	params.Context = ctx

	checkout, err := session.New(params)
	if err != nil {
		return nil, fmt.Errorf("Stripe After Dark checkout creation failed: %w", err)
	}
	return &CheckoutSession{
		Provider:     "stripe",
		SessionID:    checkout.ID,
		ClientSecret: checkout.ClientSecret,
		PublicKey:    s.PublishableKey,
		PaymentURL:   checkout.URL,
	}, nil
}

func (s *StripeGateway) VerifyPayment(ctx context.Context, sessionID string) (bool, error) {
	verification, err := s.VerifyPaymentDetails(ctx, sessionID)
	if err != nil {
		return false, err
	}
	return verification.Paid, nil
}

func (s *StripeGateway) VerifyPaymentDetails(ctx context.Context, sessionID string) (*PaymentVerification, error) {
	params := &stripe.CheckoutSessionParams{}
	params.Context = ctx
	params.AddExpand("customer")
	params.AddExpand("payment_intent.payment_method")

	sess, err := session.Get(sessionID, params)
	if err != nil {
		return nil, fmt.Errorf("stripe session retrieval failed: %w", err)
	}

	verification := &PaymentVerification{
		Paid:        sess.PaymentStatus == stripe.CheckoutSessionPaymentStatusPaid,
		AmountMinor: sess.AmountTotal,
		Currency:    strings.ToUpper(string(sess.Currency)),
		UserID:      sess.ClientReferenceID,
	}
	if sess.PaymentIntent != nil && sess.PaymentIntent.PaymentMethod != nil && sess.PaymentIntent.PaymentMethod.Card != nil {
		method := sess.PaymentIntent.PaymentMethod
		customerID := ""
		if sess.Customer != nil {
			customerID = sess.Customer.ID
		}
		if customerID == "" && sess.PaymentIntent.Customer != nil {
			customerID = sess.PaymentIntent.Customer.ID
		}
		if customerID != "" {
			verification.PaymentMethod = &PaymentMethodInfo{
				ProviderMethodID: method.ID,
				CustomerID:       customerID,
				Brand:            string(method.Card.Brand),
				Last4:            method.Card.Last4,
				ExpMonth:         int(method.Card.ExpMonth),
				ExpYear:          int(method.Card.ExpYear),
			}
		}
	}
	return verification, nil
}

func (s *StripeGateway) DetachPaymentMethod(ctx context.Context, methodID string) error {
	params := &stripe.PaymentMethodDetachParams{}
	params.Context = ctx
	if _, err := paymentmethod.Detach(methodID, params); err != nil {
		return fmt.Errorf("detach Stripe payment method: %w", err)
	}
	return nil
}
