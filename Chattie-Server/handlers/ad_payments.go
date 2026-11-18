package handlers

import (
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/go-chi/chi/v5"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/webhook"
)

type ADPaymentsHandler struct {
	Finance    *repository.ADFinanceRepository
	Users      *repository.Repository
	Events     *services.EventHandler
	Stripe     *services.StripeGateway
	Paystack   *services.PaystackGateway
	Mpesa      *services.MpesaGateway
	RoomClient *lksdk.RoomServiceClient
}

func NewADPaymentsHandler(finance *repository.ADFinanceRepository, users *repository.Repository, events *services.EventHandler, stripe *services.StripeGateway, paystack *services.PaystackGateway, mpesa *services.MpesaGateway, roomClient *lksdk.RoomServiceClient) *ADPaymentsHandler {
	return &ADPaymentsHandler{
		Finance: finance, Users: users, Events: events, Stripe: stripe,
		Paystack: paystack, Mpesa: mpesa, RoomClient: roomClient,
	}
}

type adCheckoutRequest struct {
	PaymentType string `json:"payment_type"`
	TargetID    string `json:"target_id"`
	AmountCents int64  `json:"amount_cents"`
	Provider    string `json:"provider"`
	PhoneNumber string `json:"phone_number"`
	Message     string `json:"message"`
}

func (h *ADPaymentsHandler) CreateCheckout(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		writeADPaymentError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	var req adCheckoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeADPaymentError(w, http.StatusBadRequest, "Invalid checkout request")
		return
	}
	req.PaymentType = strings.ToLower(strings.TrimSpace(req.PaymentType))
	req.Provider = strings.ToLower(strings.TrimSpace(req.Provider))
	if req.PaymentType == "creator_subscription" {
		req.PaymentType = "subscription"
	}
	if req.PaymentType == "post_unlock" {
		req.PaymentType = "ppv"
	}

	countryCode := strings.ToUpper(strings.TrimSpace(middlewares.CountryCodeFromContext(r.Context())))
	if countryCode == "" {
		writeADPaymentError(w, http.StatusServiceUnavailable, "Could not determine your country for checkout. Configure trusted country detection or your account location, then retry.")
		return
	}

	currency := "USD"
	provider := "stripe"
	exchangeRate := 0.0
	if h.Mpesa != nil {
		exchangeRate = h.Mpesa.USDToKESRate
	}
	if countryCode == "KE" {
		currency = "KES"
		provider = strings.ToLower(strings.TrimSpace(req.Provider))
		if provider == "" {
			provider = "mpesa"
		}
		if provider != "mpesa" && provider != "paystack" {
			writeADPaymentError(w, http.StatusBadRequest, "Choose M-Pesa or Paystack for Kenyan checkout")
			return
		}
	}
	if currency == "USD" && exchangeRate <= 0 {
		writeADPaymentError(w, http.StatusServiceUnavailable, "USD checkout conversion is not configured correctly")
		return
	}
	if currency == "USD" {
		if h.Stripe == nil || strings.TrimSpace(h.Stripe.PublishableKey) == "" {
			writeADPaymentError(w, http.StatusServiceUnavailable, "Stripe checkout is not configured")
			return
		}
		if _, err := afterDarkStripeReturnURL("checkout-config-check"); err != nil {
			writeADPaymentError(w, http.StatusServiceUnavailable, "After Dark Stripe return URL is not configured correctly")
			return
		}
	}
	intent, err := h.Finance.CreateADPaymentIntent(
		r.Context(), userID, req.PaymentType, req.TargetID, provider,
		req.AmountCents, req.Message, currency, exchangeRate,
	)
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrADPaymentUnavailable):
			writeADPaymentError(w, http.StatusNotFound, "The selected After Dark purchase is unavailable")
		case strings.Contains(err.Error(), "unavailable"), strings.Contains(err.Error(), "yourself"), strings.Contains(err.Error(), "already unlocked"), strings.Contains(err.Error(), "payment or active subscription"):
			writeADPaymentError(w, http.StatusBadRequest, err.Error())
		case strings.Contains(err.Error(), "amount"), strings.Contains(err.Error(), "M-Pesa"), strings.Contains(err.Error(), "message"), strings.Contains(err.Error(), "provider"), strings.Contains(err.Error(), "payment type"):
			writeADPaymentError(w, http.StatusBadRequest, err.Error())
		default:
			log.Printf("[AFTER DARK PAYMENT] Failed to create checkout intent for %s: %v", userID, err)
			writeADPaymentError(w, http.StatusInternalServerError, "Could not create checkout")
		}
		return
	}

	switch intent.Provider {
	case "stripe":
		h.startStripe(w, r, intent)
	case "paystack":
		h.startPaystack(w, r, intent)
	case "mpesa":
		h.startMpesa(w, r, intent, req.PhoneNumber)
	default:
		writeADPaymentError(w, http.StatusBadRequest, "Unsupported payment provider")
	}
}

func (h *ADPaymentsHandler) GetCheckoutConfig(w http.ResponseWriter, r *http.Request) {
	countryCode := strings.ToUpper(strings.TrimSpace(middlewares.CountryCodeFromContext(r.Context())))
	if countryCode == "" {
		writeADPaymentError(w, http.StatusServiceUnavailable, "Could not determine your country for checkout. Configure trusted country detection or your account location, then retry.")
		return
	}
	if countryCode == "KE" {
		writeADCheckout(w, map[string]interface{}{
			"country_code":        countryCode,
			"currency":            "KES",
			"default_provider":    "mpesa",
			"supported_providers": []string{"mpesa", "paystack"},
		})
		return
	}
	if h.Mpesa == nil || h.Mpesa.USDToKESRate <= 0 {
		writeADPaymentError(w, http.StatusServiceUnavailable, "USD checkout conversion is not configured correctly")
		return
	}
	if h.Stripe == nil || strings.TrimSpace(h.Stripe.PublishableKey) == "" {
		writeADPaymentError(w, http.StatusServiceUnavailable, "Stripe checkout is not configured")
		return
	}
	if _, err := afterDarkStripeReturnURL("checkout-config-check"); err != nil {
		writeADPaymentError(w, http.StatusServiceUnavailable, "After Dark Stripe return URL is not configured correctly")
		return
	}
	writeADCheckout(w, map[string]interface{}{
		"country_code":        countryCode,
		"currency":            "USD",
		"default_provider":    "stripe",
		"supported_providers": []string{"stripe"},
		"kes_per_usd":         h.Mpesa.USDToKESRate,
	})
}

func (h *ADPaymentsHandler) startStripe(w http.ResponseWriter, r *http.Request, intent *repository.ADPaymentIntent) {
	if h.Stripe == nil || strings.TrimSpace(h.Stripe.PublishableKey) == "" {
		writeADPaymentError(w, http.StatusServiceUnavailable, "Stripe is not configured")
		return
	}
	user, err := h.Users.GetUserByID(r.Context(), intent.UserID)
	if err != nil {
		writeADPaymentError(w, http.StatusInternalServerError, "Could not load checkout user")
		return
	}
	returnURL, err := afterDarkStripeReturnURL(intent.ID)
	if err != nil {
		writeADPaymentError(w, http.StatusServiceUnavailable, "After Dark Stripe return URL is not configured correctly")
		return
	}
	checkout, err := h.Stripe.CreateADCheckout(
		r.Context(), user.Email, intent.UserID, intent.ID, intent.AmountCents,
		intent.PaymentType, returnURL,
	)
	if err != nil {
		log.Printf("[AFTER DARK PAYMENT] Stripe initialization failed for %s: %v", intent.UserID, err)
		newlyFailed, updateErr := h.Finance.MarkADPaymentFailed(r.Context(), intent.ID)
		if updateErr != nil {
			log.Printf("[AFTER DARK PAYMENT] Could not mark Stripe intent failed: %v", updateErr)
		} else if newlyFailed {
			h.notifyADActionRequired(r.Context(), intent, "Stripe checkout could not be started. Please try again.")
		}
		writeADPaymentError(w, http.StatusBadGateway, "Could not start Stripe checkout")
		return
	}
	if err := h.Finance.SetADPaymentProviderSession(r.Context(), intent.ID, checkout.SessionID, ""); err != nil {
		log.Printf("[AFTER DARK PAYMENT] Could not track Stripe session for %s: %v", intent.UserID, err)
		writeADPaymentError(w, http.StatusInternalServerError, "Payment was initialized but could not be tracked; contact support before retrying")
		return
	}
	writeADCheckout(w, map[string]interface{}{
		"id": intent.ID, "provider": "stripe", "session_id": checkout.SessionID,
		"client_secret": checkout.ClientSecret, "public_key": checkout.PublicKey,
		"payment_url":  checkout.PaymentURL,
		"amount_cents": intent.AmountCents, "currency": intent.Currency,
		"settlement_amount_cents": intent.SettlementAmountCents,
		"settlement_currency":     intent.SettlementCurrency,
		"exchange_rate":           intent.ExchangeRate,
		"payment_type":            intent.PaymentType, "status": "pending",
	})
}

func afterDarkStripeReturnURL(intentID string) (string, error) {
	base := strings.TrimSpace(os.Getenv("AFTERDARK_RETURN_URL"))
	parsed, err := url.Parse(base)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return "", fmt.Errorf("AFTERDARK_RETURN_URL must be an absolute HTTP(S) URL")
	}
	query := parsed.Query()
	query.Set("ad_payment_intent", intentID)
	query.Set("session_id", "{CHECKOUT_SESSION_ID}")
	parsed.RawQuery = query.Encode()
	return strings.ReplaceAll(parsed.String(), "%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}"), nil
}

func (h *ADPaymentsHandler) startPaystack(w http.ResponseWriter, r *http.Request, intent *repository.ADPaymentIntent) {
	if h.Paystack == nil {
		writeADPaymentError(w, http.StatusServiceUnavailable, "Paystack is not configured")
		return
	}
	user, err := h.Users.GetUserByID(r.Context(), intent.UserID)
	if err != nil {
		writeADPaymentError(w, http.StatusInternalServerError, "Could not load checkout user")
		return
	}
	checkout, err := h.Paystack.CreateADCheckout(r.Context(), user.Email, intent.UserID, intent.ID, intent.AmountCents, intent.PaymentType)
	if err != nil {
		log.Printf("[AFTER DARK PAYMENT] Paystack initialization failed for %s: %v", intent.UserID, err)
		newlyFailed, updateErr := h.Finance.MarkADPaymentFailed(r.Context(), intent.ID)
		if updateErr != nil {
			log.Printf("[AFTER DARK PAYMENT] Could not mark Paystack intent failed: %v", updateErr)
		} else if newlyFailed {
			h.notifyADActionRequired(r.Context(), intent, "Paystack checkout could not be started. Please try again.")
		}
		writeADPaymentError(w, http.StatusBadGateway, "Could not start Paystack checkout")
		return
	}
	if err := h.Finance.SetADPaymentProviderSession(r.Context(), intent.ID, checkout.SessionID, ""); err != nil {
		log.Printf("[AFTER DARK PAYMENT] Could not track Paystack session for %s: %v", intent.UserID, err)
		writeADPaymentError(w, http.StatusInternalServerError, "Payment was initialized but could not be tracked; contact support before retrying")
		return
	}
	writeADCheckout(w, map[string]interface{}{
		"id": intent.ID, "provider": "paystack", "session_id": checkout.SessionID,
		"client_secret": checkout.ClientSecret, "public_key": checkout.PublicKey,
		"email":        user.Email,
		"amount_cents": intent.AmountCents, "currency": intent.Currency,
		"settlement_amount_cents": intent.SettlementAmountCents,
		"settlement_currency":     intent.SettlementCurrency,
		"exchange_rate":           intent.ExchangeRate,
		"payment_type":            intent.PaymentType, "status": "pending",
	})
}

func (h *ADPaymentsHandler) startMpesa(w http.ResponseWriter, r *http.Request, intent *repository.ADPaymentIntent, phone string) {
	if h.Mpesa == nil {
		writeADPaymentError(w, http.StatusServiceUnavailable, "M-Pesa is not configured")
		return
	}
	normalizedPhone, err := services.NormalizeMpesaPhone(phone)
	if err != nil {
		writeADPaymentError(w, http.StatusBadRequest, err.Error())
		return
	}
	accountReference := "AD" + strings.ReplaceAll(intent.ID, "-", "")[:10]
	checkout, err := h.Mpesa.CreateADSTKPush(r.Context(), normalizedPhone, accountReference, intent.AmountCents/100)
	if err != nil {
		log.Printf("[AFTER DARK PAYMENT] M-Pesa initialization failed for %s: %v", intent.UserID, err)
		newlyFailed, updateErr := h.Finance.MarkADPaymentFailed(r.Context(), intent.ID)
		if updateErr != nil {
			log.Printf("[AFTER DARK PAYMENT] Could not mark M-Pesa intent failed: %v", updateErr)
		} else if newlyFailed {
			h.notifyADActionRequired(r.Context(), intent, "M-Pesa checkout could not be started. Please try again.")
		}
		writeADPaymentError(w, http.StatusBadGateway, "Could not start M-Pesa payment")
		return
	}
	if err := h.Finance.SetADPaymentProviderSession(r.Context(), intent.ID, checkout.CheckoutRequestID, checkout.MerchantRequestID); err != nil {
		log.Printf("[AFTER DARK PAYMENT] Could not track M-Pesa session for %s: %v", intent.UserID, err)
		writeADPaymentError(w, http.StatusInternalServerError, "Payment was initialized but could not be tracked; contact support before retrying")
		return
	}
	writeADCheckout(w, map[string]interface{}{
		"id": intent.ID, "provider": "mpesa", "session_id": checkout.CheckoutRequestID,
		"amount_cents": intent.AmountCents, "amount_kes": checkout.AmountKES,
		"currency": intent.Currency, "settlement_amount_cents": intent.SettlementAmountCents,
		"settlement_currency": intent.SettlementCurrency, "exchange_rate": intent.ExchangeRate,
		"payment_type": intent.PaymentType,
		"status":       "pending", "message": checkout.CustomerMessage,
	})
}

func (h *ADPaymentsHandler) GetPaymentStatus(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		writeADPaymentError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	intent, err := h.Finance.GetADPaymentIntent(r.Context(), chi.URLParam(r, "intentId"), userID)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			log.Printf("[AFTER DARK PAYMENT] Failed to load intent status for %s: %v", userID, err)
		}
		writeADPaymentError(w, http.StatusNotFound, "Payment intent not found")
		return
	}
	if intent.Status == "pending" {
		if _, err := h.reconcile(r.Context(), intent, nil); err != nil {
			log.Printf("[AFTER DARK PAYMENT] Reconciliation failed for %s: %v", userID, err)
			writeADPaymentError(w, http.StatusBadGateway, "Could not reconcile payment status")
			return
		}
		intent, err = h.Finance.GetADPaymentIntent(r.Context(), intent.ID, userID)
		if err != nil {
			writeADPaymentError(w, http.StatusInternalServerError, "Could not refresh payment status")
			return
		}
	}
	if intent.Status == "pending" {
		w.WriteHeader(http.StatusAccepted)
	}
	writeADCheckout(w, paymentStatusResponse(intent))
}

func (h *ADPaymentsHandler) MpesaCallback(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var payload struct {
		Body struct {
			Callback struct {
				CheckoutRequestID string `json:"CheckoutRequestID"`
				Metadata          struct {
					Items []struct {
						Name  string      `json:"Name"`
						Value interface{} `json:"Value"`
					} `json:"Item"`
				} `json:"CallbackMetadata"`
			} `json:"stkCallback"`
		} `json:"Body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeADPaymentError(w, http.StatusBadRequest, "Invalid M-Pesa callback")
		return
	}
	checkoutID := strings.TrimSpace(payload.Body.Callback.CheckoutRequestID)
	if checkoutID == "" {
		writeADPaymentError(w, http.StatusBadRequest, "Missing M-Pesa checkout reference")
		return
	}
	intent, err := h.Finance.GetADPaymentByProviderSession(r.Context(), "mpesa", checkoutID)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			log.Printf("[AFTER DARK PAYMENT] Failed to lookup M-Pesa callback intent: %v", err)
			writeADPaymentError(w, http.StatusInternalServerError, "Could not process callback")
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	}
	metadataAmount := int64(-1)
	receipt := ""
	for _, item := range payload.Body.Callback.Metadata.Items {
		switch item.Name {
		case "Amount":
			metadataAmount, _ = parseProviderAmount(item.Value)
		case "MpesaReceiptNumber":
			if item.Value != nil {
				receipt = fmt.Sprint(item.Value)
			}
		}
	}
	if metadataAmount != intent.AmountCents/100 {
		log.Printf("[AFTER DARK PAYMENT] M-Pesa callback amount mismatch for intent %s", intent.ID)
		w.WriteHeader(http.StatusOK)
		return
	}
	if _, err := h.reconcile(r.Context(), intent, &providerPayment{AmountMinor: intent.AmountCents, Currency: "KES", Receipt: receipt}); err != nil {
		log.Printf("[AFTER DARK PAYMENT] M-Pesa callback reconciliation failed for %s: %v", intent.ID, err)
	}
	w.WriteHeader(http.StatusOK)
}

func (h *ADPaymentsHandler) PaystackWebhook(w http.ResponseWriter, r *http.Request) {
	if h.Paystack == nil || h.Paystack.SecretKey == "" {
		http.Error(w, "Paystack webhook is not configured", http.StatusServiceUnavailable)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Invalid webhook body", http.StatusBadRequest)
		return
	}
	signature := r.Header.Get("X-Paystack-Signature")
	mac := hmac.New(sha512.New, []byte(h.Paystack.SecretKey))
	_, _ = mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	provided, err := hex.DecodeString(signature)
	expectedBytes, _ := hex.DecodeString(expected)
	if err != nil || !hmac.Equal(provided, expectedBytes) {
		http.Error(w, "Invalid webhook signature", http.StatusUnauthorized)
		return
	}
	var event struct {
		Event string `json:"event"`
		Data  struct {
			Reference string `json:"reference"`
			Status    string `json:"status"`
			Reason    string `json:"reason"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		http.Error(w, "Invalid webhook payload", http.StatusBadRequest)
		return
	}
	switch event.Event {
	case "transfer.success", "transfer.failed", "transfer.reversed":
		if event.Data.Reference == "" {
			http.Error(w, "Missing transfer reference", http.StatusBadRequest)
			return
		}
		paid := event.Event == "transfer.success" && event.Data.Status == "success"
		reason := event.Data.Reason
		if !paid && reason == "" {
			reason = event.Event
		}
		if err := h.Finance.CompleteWithdrawal(r.Context(), "paystack", event.Data.Reference, "", paid, reason); err != nil {
			log.Printf("[AFTER DARK PAYOUT] Could not process Paystack transfer webhook: %v", err)
			http.Error(w, "Could not process payout webhook", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	}
	if event.Event != "charge.success" || event.Data.Status != "success" || event.Data.Reference == "" {
		w.WriteHeader(http.StatusOK)
		return
	}
	intent, err := h.Finance.GetADPaymentByProviderSession(r.Context(), "paystack", event.Data.Reference)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			log.Printf("[AFTER DARK PAYMENT] Failed to lookup Paystack webhook intent: %v", err)
			http.Error(w, "Could not process webhook", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	}
	if _, err := h.reconcile(r.Context(), intent, nil); err != nil {
		log.Printf("[AFTER DARK PAYMENT] Paystack webhook reconciliation failed for %s: %v", intent.ID, err)
		http.Error(w, "Could not reconcile payment", http.StatusBadGateway)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (h *ADPaymentsHandler) StripeWebhook(w http.ResponseWriter, r *http.Request) {
	secret := strings.TrimSpace(os.Getenv("STRIPE_AFTERDARK_WEBHOOK_SECRET"))
	if secret == "" {
		http.Error(w, "Stripe After Dark webhook is not configured", http.StatusServiceUnavailable)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Invalid webhook body", http.StatusBadRequest)
		return
	}
	event, err := webhook.ConstructEvent(body, r.Header.Get("Stripe-Signature"), secret)
	if err != nil {
		http.Error(w, "Invalid Stripe webhook signature", http.StatusUnauthorized)
		return
	}
	if event.Type != stripe.EventTypeCheckoutSessionCompleted &&
		event.Type != stripe.EventTypeCheckoutSessionAsyncPaymentSucceeded &&
		event.Type != stripe.EventTypeCheckoutSessionAsyncPaymentFailed &&
		event.Type != stripe.EventTypeCheckoutSessionExpired {
		w.WriteHeader(http.StatusOK)
		return
	}

	var checkout stripe.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &checkout); err != nil || checkout.ID == "" {
		http.Error(w, "Invalid Stripe checkout event", http.StatusBadRequest)
		return
	}
	intent, err := h.Finance.GetADPaymentByProviderSession(r.Context(), "stripe", checkout.ID)
	if errors.Is(err, sql.ErrNoRows) {
		w.WriteHeader(http.StatusOK)
		return
	}
	if err != nil {
		log.Printf("[AFTER DARK PAYMENT] Failed to load Stripe webhook intent: %v", err)
		http.Error(w, "Could not process Stripe webhook", http.StatusInternalServerError)
		return
	}
	if event.Type == stripe.EventTypeCheckoutSessionExpired || event.Type == stripe.EventTypeCheckoutSessionAsyncPaymentFailed {
		if _, err := h.Finance.MarkADPaymentFailed(r.Context(), intent.ID); err != nil {
			log.Printf("[AFTER DARK PAYMENT] Could not mark expired Stripe intent failed: %v", err)
			http.Error(w, "Could not update Stripe checkout status", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	}
	if _, err := h.reconcile(r.Context(), intent, nil); err != nil {
		log.Printf("[AFTER DARK PAYMENT] Stripe webhook reconciliation failed for %s: %v", intent.ID, err)
		http.Error(w, "Could not reconcile Stripe payment", http.StatusBadGateway)
		return
	}
	w.WriteHeader(http.StatusOK)
}

type providerPayment struct {
	AmountMinor   int64
	Currency      string
	Receipt       string
	PaymentMethod *services.PaymentMethodInfo
}

func (h *ADPaymentsHandler) reconcile(ctx context.Context, intent *repository.ADPaymentIntent, callbackPayment *providerPayment) (*repository.ADPaymentIntent, error) {
	if intent.Status == "completed" || intent.Status == "failed" {
		return intent, nil
	}
	var payment providerPayment
	switch intent.Provider {
	case "stripe":
		if h.Stripe == nil {
			return nil, fmt.Errorf("Stripe is not configured")
		}
		verified, err := h.Stripe.VerifyPaymentDetails(ctx, intent.ProviderSessionID)
		if err != nil {
			return nil, err
		}
		if !verified.Paid {
			return intent, nil
		}
		payment = providerPayment{
			AmountMinor:   verified.AmountMinor,
			Currency:      verified.Currency,
			PaymentMethod: verified.PaymentMethod,
		}
		if verified.UserID != "" && verified.UserID != intent.UserID {
			return nil, fmt.Errorf("Stripe payer did not match intent")
		}
	case "paystack":
		if h.Paystack == nil {
			return nil, fmt.Errorf("Paystack is not configured")
		}
		verified, err := h.Paystack.VerifyPaymentDetails(ctx, intent.ProviderSessionID)
		if err != nil {
			return nil, err
		}
		if !verified.Paid {
			return intent, nil
		}
		payment = providerPayment{
			AmountMinor:   verified.AmountMinor,
			Currency:      verified.Currency,
			PaymentMethod: verified.PaymentMethod,
		}
		if verified.UserID != "" && verified.UserID != intent.UserID {
			return nil, fmt.Errorf("Paystack payer did not match intent")
		}
	case "mpesa":
		if h.Mpesa == nil {
			return nil, fmt.Errorf("M-Pesa is not configured")
		}
		status, err := h.Mpesa.GetPaymentStatus(ctx, intent.ProviderSessionID)
		if err != nil {
			return nil, err
		}
		if status == "pending" {
			return intent, nil
		}
		if status == "failed" {
			newlyFailed, err := h.Finance.MarkADPaymentFailed(ctx, intent.ID)
			if err != nil {
				return nil, err
			}
			intent.Status = "failed"
			if newlyFailed {
				h.notifyADActionRequired(ctx, intent, "Your payment was declined or cancelled. Please try again.")
			}
			return intent, nil
		}
		payment = providerPayment{AmountMinor: intent.AmountCents, Currency: "KES"}
		if callbackPayment != nil {
			payment.Receipt = callbackPayment.Receipt
			if callbackPayment.AmountMinor != intent.AmountCents || !strings.EqualFold(callbackPayment.Currency, intent.Currency) {
				return nil, fmt.Errorf("M-Pesa callback does not match intent")
			}
		}
	default:
		return nil, fmt.Errorf("unsupported payment provider")
	}
	if payment.AmountMinor != intent.AmountCents || !strings.EqualFold(payment.Currency, intent.Currency) {
		return nil, fmt.Errorf("provider payment does not match intent")
	}
	completed, newlyCompleted, err := h.Finance.CompleteADPayment(ctx, intent.ID, payment.AmountMinor, payment.Currency, payment.Receipt)
	if err != nil {
		return nil, err
	}
	if newlyCompleted && completed.Provider == "paystack" && payment.PaymentMethod != nil {
		method := payment.PaymentMethod
		if method.ProviderMethodID == "" || len(method.Last4) != 4 {
			log.Printf("[AFTER DARK PAYMENT METHOD] Paystack returned incomplete card details for %s", completed.ID)
		} else {
			encryptedAuthorization, encryptErr := services.EncryptPaymentMethodToken(method.Authorization)
			if encryptErr != nil {
				log.Printf("[AFTER DARK PAYMENT METHOD] Could not encrypt reusable authorization for %s: %v", completed.ID, encryptErr)
			} else if saveErr := h.Users.SaveBillingPaymentMethod(
				ctx, completed.UserID, "paystack", method.ProviderMethodID, method.CustomerID,
				encryptedAuthorization, method.Brand, method.Last4, method.ExpMonth,
				method.ExpYear, method.Bank,
			); saveErr != nil {
				log.Printf("[AFTER DARK PAYMENT METHOD] Could not save reusable Paystack card for %s: %v", completed.UserID, saveErr)
			}
		}
	}
	if newlyCompleted && completed.PaymentType == "live_tip" {
		h.publishLiveTip(ctx, completed)
	}
	if newlyCompleted {
		h.notifyADPaymentCompleted(ctx, completed)
	}
	return completed, nil
}

func (h *ADPaymentsHandler) notifyADPaymentCompleted(ctx context.Context, intent *repository.ADPaymentIntent) {
	if h.Events == nil {
		return
	}
	receiptData := map[string]interface{}{
		"Amount":             fmt.Sprintf("%.2f", float64(intent.AmountCents)/100),
		"Currency":           intent.Currency,
		"SettlementAmount":   fmt.Sprintf("%.2f", float64(intent.SettlementAmountCents)/100),
		"SettlementCurrency": intent.SettlementCurrency,
		"ExchangeRate":       intent.ExchangeRate,
		"PaymentType":        strings.ReplaceAll(intent.PaymentType, "_", " "),
		"Reference":          intent.ID,
		"ReceiptNumber":      intent.ReceiptNumber,
		"PaidAt":             time.Now().Format("January 2, 2006 15:04 MST"),
	}
	detachedCtx := context.WithoutCancel(ctx)
	go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
		RecipientID: intent.UserID, EmailTemplate: "ad_payment_receipt", EmailData: receiptData,
	})

	if intent.CreatorID == "" {
		return
	}
	customerName := "A customer"
	buyer, err := h.Users.GetUserByID(detachedCtx, intent.UserID)
	if err != nil {
		log.Printf("[AFTER DARK PAYMENT] Could not resolve buyer for creator notification %s: %v", intent.ID, err)
	} else if buyer.Username != "" {
		customerName = buyer.Username
	}
	creatorData := make(map[string]interface{}, len(receiptData)+1)
	for key, value := range receiptData {
		creatorData[key] = value
	}
	creatorData["CustomerName"] = customerName
	templateName, category := "", ""
	switch intent.PaymentType {
	case "subscription":
		templateName, category = "ad_creator_subscription", "subs"
	case "tip", "live_tip":
		templateName, category = "ad_creator_tip", "tips"
	case "ppv", "live_pass":
		templateName, category = "ad_creator_sale", "sales"
	}
	if templateName == "" {
		return
	}
	go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
		RecipientID: intent.CreatorID,
		WSEventType: "AFTER_DARK_PAYMENT",
		WSPayload: map[string]interface{}{
			"title":     "After Dark payment received",
			"message":   "A customer completed a " + strings.ReplaceAll(intent.PaymentType, "_", " ") + " purchase.",
			"reference": intent.ID,
		},
		EmailTemplate: templateName, EmailData: creatorData, AfterDarkEmailCategory: category,
	})
}

func (h *ADPaymentsHandler) notifyADActionRequired(ctx context.Context, intent *repository.ADPaymentIntent, message string) {
	if h.Events == nil {
		return
	}
	detachedCtx := context.WithoutCancel(ctx)
	go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
		RecipientID:   intent.UserID,
		EmailTemplate: "ad_action_required",
		EmailData:     map[string]interface{}{"Reference": intent.ID, "ActionMessage": message},
	})
}

func (h *ADPaymentsHandler) publishLiveTip(ctx context.Context, intent *repository.ADPaymentIntent) {
	if h.RoomClient == nil {
		return
	}
	senderName, err := h.Finance.GetTipSenderName(ctx, intent.UserID)
	if err != nil {
		log.Printf("[AFTER DARK TIP] Could not resolve sender name for live tip %s: %v", intent.ID, err)
		return
	}
	payload, err := json.Marshal(models.ADLiveTipNotification{
		Type: "tip", ID: intent.ID, SenderID: intent.UserID,
		SenderName: senderName, AmountCents: intent.SettlementAmountCents, Message: intent.Message,
	})
	if err != nil {
		log.Printf("[AFTER DARK TIP] Could not encode live tip %s: %v", intent.ID, err)
		return
	}
	topic := "live-tip"
	if _, err := h.RoomClient.SendData(ctx, &livekit.SendDataRequest{
		Room: intent.TargetID, Data: payload, Kind: livekit.DataPacket_RELIABLE, Topic: &topic,
	}); err != nil {
		log.Printf("[AFTER DARK TIP] Payment %s completed but live alert publish failed: %v", intent.ID, err)
	}
}

func paymentStatusResponse(intent *repository.ADPaymentIntent) map[string]interface{} {
	return map[string]interface{}{
		"id": intent.ID, "status": intent.Status, "payment_type": intent.PaymentType,
		"amount_cents": intent.AmountCents, "currency": intent.Currency,
		"settlement_amount_cents": intent.SettlementAmountCents,
		"settlement_currency":     intent.SettlementCurrency,
		"exchange_rate":           intent.ExchangeRate,
		"tip_id":                  intent.ID, "target_id": intent.TargetID, "creator_id": intent.CreatorID,
		"receipt_number": intent.ReceiptNumber,
	}
}

func parseProviderAmount(value interface{}) (int64, error) {
	switch amount := value.(type) {
	case float64:
		if amount != float64(int64(amount)) {
			return 0, fmt.Errorf("provider amount is not a whole number")
		}
		return int64(amount), nil
	case string:
		return strconv.ParseInt(amount, 10, 64)
	default:
		return 0, fmt.Errorf("unsupported provider amount")
	}
}

func writeADCheckout(w http.ResponseWriter, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func writeADPaymentError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
