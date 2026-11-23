package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"
)

type BillingHandler struct {
	Repo   *repository.Repository
	Router *services.BillingRouter
	Events *services.EventHandler
}

func NewBillingHandler(repo *repository.Repository, router *services.BillingRouter, events *services.EventHandler) *BillingHandler {
	return &BillingHandler{
		Repo:   repo,
		Router: router,
		Events: events,
	}
}

// UpgradeTier initializes the payment provider and currency selected for the user's region.
func (h *BillingHandler) UpgradeTier(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req models.UpgradeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrInvalidRequestPayload", "Invalid request payload")})
		return
	}

	months := req.PlanID
	if months <= 0 {
		months = 1
	}

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	user, err := h.Repo.GetUserByID(r.Context(), userID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	// 1. Fetch the exact price for this plan duration from the database
	price, err := h.Repo.GetPlanPrice(r.Context(), months)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrInvalidOrInactiveBillingPlan", "Invalid or inactive billing plan")})
		return
	}

	countryCode := middlewares.CountryCodeFromContext(r.Context())
	gateway := h.Router.RouteCountry(countryCode)
	if gateway == nil {
		writeBillingError(w, http.StatusServiceUnavailable, "Selected payment provider is unavailable")
		return
	}
	currency := "USD"
	priceForGateway := price
	amountMinor := int64(math.Round(price * 100))
	if countryCode == "KE" {
		if h.Router.Mpesa == nil {
			writeBillingError(w, http.StatusServiceUnavailable, "Kenyan currency conversion is not configured")
			return
		}
		amountKES, conversionErr := h.Router.Mpesa.KESAmount(price)
		if conversionErr != nil {
			writeBillingError(w, http.StatusServiceUnavailable, "Kenyan currency conversion is not configured correctly")
			return
		}
		currency = "KES"
		priceForGateway = float64(amountKES)
		amountMinor = amountKES * 100
	}
	providerName := gatewayName(gateway)
	reference, err := h.Repo.CreateBillingPaymentIntent(r.Context(), userID, providerName, months, amountMinor, currency)
	if err != nil {
		log.Printf("[BILLING DB ERROR] Failed to create payment intent for %s: %v", userID, err)
		writeBillingError(w, http.StatusInternalServerError, "Could not create payment record")
		return
	}

	var checkout *services.CheckoutSession
	if stripeGateway, ok := gateway.(*services.StripeGateway); ok {
		customerID, customerErr := h.Repo.GetBillingStripeCustomerID(r.Context(), userID)
		if customerErr != nil && !errors.Is(customerErr, sql.ErrNoRows) {
			log.Printf("[BILLING DB ERROR] Failed to load Stripe customer for %s: %v", userID, customerErr)
			writeBillingError(w, http.StatusInternalServerError, "Could not load saved payment details")
			return
		}
		checkout, err = stripeGateway.CreateSubscriptionForCustomer(r.Context(), user.Email, userID, customerID, price, months)
	} else if paystackGateway, ok := gateway.(*services.PaystackGateway); ok {
		checkout, err = paystackGateway.CreateSubscriptionWithCurrency(r.Context(), user.Email, userID, priceForGateway, months, currency)
	} else {
		writeBillingError(w, http.StatusServiceUnavailable, "Selected payment provider is unavailable")
		return
	}
	if err != nil {
		log.Printf("[BILLING ERROR] Failed to create checkout for %s: %v", userID, err)
		if _, updateErr := h.Repo.MarkBillingPaymentFailed(r.Context(), reference); updateErr != nil {
			log.Printf("[BILLING DB ERROR] Failed to mark provider initialization failure for %s: %v", userID, updateErr)
		} else {
			h.notifyPremiumActionRequired(r.Context(), userID, reference, "Checkout could not be started. Please try again.")
		}
		writeBillingError(w, http.StatusInternalServerError, "Failed to initialize payment gateway")
		return
	}
	if err := h.Repo.SetBillingProviderSession(r.Context(), reference, checkout.SessionID, ""); err != nil {
		log.Printf("[BILLING DB ERROR] Failed to attach provider session for %s: %v", userID, err)
		writeBillingError(w, http.StatusInternalServerError, "Payment was started but could not be tracked. Contact support before retrying.")
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"provider":          checkout.Provider,
		"client_secret":     checkout.ClientSecret,
		"public_key":        checkout.PublicKey,
		"session_id":        checkout.SessionID,
		"payment_url":       checkout.PaymentURL,
		"billing_reference": reference,
		"months":            months,
		"email":             user.Email,
		"currency":          currency,
	})
}

func (h *BillingHandler) startMpesaPayment(w http.ResponseWriter, r *http.Request, req models.UpgradeRequest, userID string, months int, price float64) {
	if h.Router.Mpesa == nil {
		writeBillingError(w, http.StatusServiceUnavailable, "M-Pesa is not configured")
		return
	}
	amountKES, err := h.Router.Mpesa.KESAmount(price)
	if err != nil {
		writeBillingError(w, http.StatusServiceUnavailable, "M-Pesa conversion rate is not configured correctly")
		return
	}
	if _, err := services.NormalizeMpesaPhone(req.PhoneNumber); err != nil {
		writeBillingError(w, http.StatusBadRequest, "Enter a valid Kenyan M-Pesa phone number")
		return
	}
	reference, err := h.Repo.CreateBillingPaymentIntent(r.Context(), userID, "mpesa", months, amountKES*100, "KES")
	if err != nil {
		log.Printf("[BILLING DB ERROR] Failed to create M-Pesa intent for %s: %v", userID, err)
		writeBillingError(w, http.StatusInternalServerError, "Could not create payment record")
		return
	}
	accountReference := "CH" + strings.ReplaceAll(reference, "-", "")[:10]
	checkout, err := h.Router.Mpesa.CreateSTKPush(r.Context(), req.PhoneNumber, accountReference, amountKES)
	if err != nil {
		log.Printf("[BILLING ERROR] Failed to start M-Pesa request for %s: %v", userID, err)
		if _, updateErr := h.Repo.MarkBillingPaymentFailed(r.Context(), reference); updateErr != nil {
			log.Printf("[BILLING DB ERROR] Failed to mark M-Pesa initialization failure for %s: %v", userID, updateErr)
		} else {
			h.notifyPremiumActionRequired(r.Context(), userID, reference, "M-Pesa checkout could not be started. Please try again.")
		}
		writeBillingError(w, http.StatusBadGateway, "Could not start M-Pesa payment. Please try again.")
		return
	}
	if err := h.Repo.SetBillingProviderSession(r.Context(), reference, checkout.CheckoutRequestID, checkout.MerchantRequestID); err != nil {
		log.Printf("[BILLING DB ERROR] Failed to track M-Pesa session for %s: %v", userID, err)
		writeBillingError(w, http.StatusInternalServerError, "M-Pesa request was sent but could not be tracked. Contact support before retrying.")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"provider":          "mpesa",
		"billing_reference": reference,
		"session_id":        checkout.CheckoutRequestID,
		"amount_kes":        checkout.AmountKES,
		"currency":          "KES",
		"message":           checkout.CustomerMessage,
		"status":            "pending",
	})
}

func gatewayName(gateway services.PaymentGateway) string {
	switch gateway.(type) {
	case *services.StripeGateway:
		return "stripe"
	case *services.PaystackGateway:
		return "paystack"
	default:
		return "unknown"
	}
}

// VerifyPayment reconciles a Stripe or Paystack transaction against its stored intent.
func (h *BillingHandler) VerifyPayment(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	sessionID := r.URL.Query().Get("session_id")
	reference := r.URL.Query().Get("reference")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	provider, providerID := "paystack", reference
	if sessionID != "" {
		provider, providerID = "stripe", sessionID
	}
	if providerID == "" {
		writeBillingError(w, http.StatusBadRequest, "Missing payment reference")
		return
	}
	payment, err := h.Repo.GetBillingPaymentByProviderSession(r.Context(), provider, providerID)
	if err != nil {
		status := http.StatusNotFound
		if !errors.Is(err, sql.ErrNoRows) {
			status = http.StatusInternalServerError
			log.Printf("[BILLING DB ERROR] Failed to load payment intent for %s: %v", userID, err)
		}
		writeBillingError(w, status, "Payment record was not found")
		return
	}
	if payment.UserID != userID {
		writeBillingError(w, http.StatusNotFound, "Payment record was not found")
		return
	}
	gateway := h.Router.Stripe
	if provider == "paystack" {
		gateway = h.Router.Paystack
	}
	verifier, ok := gateway.(services.PaymentDetailsVerifier)
	if !ok {
		writeBillingError(w, http.StatusServiceUnavailable, "Payment verification is unavailable")
		return
	}
	verification, err := verifier.VerifyPaymentDetails(r.Context(), providerID)
	if err != nil {
		log.Printf("[BILLING ERROR] Provider verification failed for %s: %v", userID, err)
		writeBillingError(w, http.StatusPaymentRequired, "Payment could not be verified. If you were charged, contact support.")
		return
	}
	if !verification.Paid {
		writeBillingError(w, http.StatusPaymentRequired, "Payment has not completed")
		return
	}
	if verification.AmountMinor != payment.AmountMinor ||
		(payment.Currency != "" && verification.Currency != "" && strings.ToUpper(verification.Currency) != payment.Currency) ||
		(verification.UserID != "" && verification.UserID != userID) {
		log.Printf("[BILLING ERROR] Payment details did not match intent for %s", userID)
		writeBillingError(w, http.StatusPaymentRequired, "Payment details did not match the order")
		return
	}

	months, upgraded, err := h.Repo.CompleteBillingPayment(r.Context(), payment.Reference, userID)
	if err != nil {
		log.Printf("[BILLING DB ERROR] Failed to reconcile paid intent for %s: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrPaymentVerifiedButDatabaseUpgradeFailedContactSupport", "Payment verified but database upgrade failed. Contact support.")})
		return
	}
	if upgraded {
		h.notifyPremiumUpgrade(r.Context(), userID, months, payment)
	}
	response := map[string]interface{}{
		"message": localized(r.Context(), "MsgPaymentVerifiedPremiumStatusActivatedSuccessfully", "Payment verified! Premium status activated successfully."),
	}
	if verification.PaymentMethod != nil {
		saved, saveErr := h.saveVerifiedPaymentMethod(r.Context(), userID, provider, verification.PaymentMethod)
		if saveErr != nil {
			log.Printf("[BILLING PAYMENT METHOD ERROR] Could not save card for user %s via %s: %v", userID, provider, saveErr)
		}
		response["payment_method_saved"] = saved
	}
	json.NewEncoder(w).Encode(response)
}

func (h *BillingHandler) saveVerifiedPaymentMethod(ctx context.Context, userID, provider string, method *services.PaymentMethodInfo) (bool, error) {
	if method == nil || method.ProviderMethodID == "" || len(method.Last4) != 4 {
		return false, fmt.Errorf("provider returned incomplete card details")
	}
	var encryptedAuthorization []byte
	if provider == "paystack" {
		var err error
		encryptedAuthorization, err = services.EncryptPaymentMethodToken(method.Authorization)
		if err != nil {
			return false, err
		}
	}
	if err := h.Repo.SaveBillingPaymentMethod(
		ctx, userID, provider, method.ProviderMethodID, method.CustomerID,
		encryptedAuthorization, method.Brand, method.Last4, method.ExpMonth,
		method.ExpYear, method.Bank,
	); err != nil {
		return false, err
	}
	return true, nil
}

func (h *BillingHandler) GetPaymentMethods(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		writeBillingError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	methods, err := h.Repo.ListBillingPaymentMethods(r.Context(), userID)
	if err != nil {
		log.Printf("[BILLING DB ERROR] Failed to load saved cards for %s: %v", userID, err)
		writeBillingError(w, http.StatusInternalServerError, "Could not load payment methods")
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"methods": methods})
}

func (h *BillingHandler) DeletePaymentMethod(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		writeBillingError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	method, err := h.Repo.GetBillingPaymentMethod(r.Context(), chi.URLParam(r, "id"), userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeBillingError(w, http.StatusNotFound, "Payment method was not found")
			return
		}
		log.Printf("[BILLING DB ERROR] Failed to load saved card for %s: %v", userID, err)
		writeBillingError(w, http.StatusInternalServerError, "Could not load payment method")
		return
	}

	switch method.Provider {
	case "stripe":
		gateway, ok := h.Router.Stripe.(interface {
			DetachPaymentMethod(context.Context, string) error
		})
		if !ok {
			writeBillingError(w, http.StatusServiceUnavailable, "Stripe payment-method management is unavailable")
			return
		}
		err = gateway.DetachPaymentMethod(r.Context(), method.ProviderMethodID)
	case "paystack":
		gateway, ok := h.Router.Paystack.(interface {
			DeactivateAuthorization(context.Context, string) error
		})
		if !ok {
			writeBillingError(w, http.StatusServiceUnavailable, "Paystack payment-method management is unavailable")
			return
		}
		authorization, decryptErr := services.DecryptPaymentMethodToken(method.AuthorizationCiphertext)
		if decryptErr != nil {
			log.Printf("[BILLING PAYMENT METHOD ERROR] Could not decrypt saved authorization for %s: %v", userID, decryptErr)
			writeBillingError(w, http.StatusInternalServerError, "Could not safely remove payment method")
			return
		}
		err = gateway.DeactivateAuthorization(r.Context(), authorization)
	default:
		writeBillingError(w, http.StatusInternalServerError, "Saved payment method has an unsupported provider")
		return
	}
	if err != nil {
		log.Printf("[BILLING PAYMENT METHOD ERROR] Provider removal failed for user %s: %v", userID, err)
		writeBillingError(w, http.StatusBadGateway, "The payment provider could not remove this payment method")
		return
	}
	if err := h.Repo.DeleteBillingPaymentMethod(r.Context(), method.ID, userID); err != nil {
		log.Printf("[BILLING DB ERROR] Provider removed payment method, but database cleanup failed for %s: %v", userID, err)
		writeBillingError(w, http.StatusInternalServerError, "The provider removed this payment method, but the local record could not be cleared")
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "removed"})
}

func (h *BillingHandler) MpesaPaymentStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		writeBillingError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	if h.Router.Mpesa == nil {
		writeBillingError(w, http.StatusServiceUnavailable, "M-Pesa is not configured")
		return
	}
	reference := strings.TrimSpace(r.URL.Query().Get("billing_reference"))
	payment, err := h.Repo.GetBillingPaymentByReference(r.Context(), reference, userID)
	if err != nil {
		writeBillingError(w, http.StatusNotFound, "Payment record was not found")
		return
	}
	status := payment.Status
	if status != "paid" && status != "failed" {
		status, _, err = h.reconcileMpesaPayment(r.Context(), payment)
		if err != nil {
			log.Printf("[BILLING ERROR] M-Pesa reconciliation failed for %s: %v", userID, err)
			writeBillingError(w, http.StatusBadGateway, "Could not check M-Pesa payment status")
			return
		}
	}
	if status == "pending" {
		w.WriteHeader(http.StatusAccepted)
	}
	json.NewEncoder(w).Encode(map[string]string{"status": status})
}

func (h *BillingHandler) MpesaCallback(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var callback struct {
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
	if err := json.NewDecoder(r.Body).Decode(&callback); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidCallback", "invalid callback"), http.StatusBadRequest)
		return
	}
	checkoutID := strings.TrimSpace(callback.Body.Callback.CheckoutRequestID)
	if checkoutID == "" {
		http.Error(w, localized(r.Context(), "ErrMissingCheckoutRequestID", "missing checkout request ID"), http.StatusBadRequest)
		return
	}
	payment, err := h.Repo.GetBillingPaymentByProviderSession(r.Context(), "mpesa", checkoutID)
	if err != nil {
		log.Printf("[BILLING CALLBACK] No M-Pesa intent found for callback")
		w.WriteHeader(http.StatusOK)
		return
	}
	receipt := ""
	for _, item := range callback.Body.Callback.Metadata.Items {
		if item.Name == "MpesaReceiptNumber" && item.Value != nil {
			receipt = fmt.Sprint(item.Value)
			break
		}
	}
	if _, _, err := h.reconcileMpesaPayment(r.Context(), payment, receipt); err != nil {
		log.Printf("[BILLING CALLBACK] M-Pesa provider confirmation failed: %v", err)
	}
	w.WriteHeader(http.StatusOK)
}

func (h *BillingHandler) reconcileMpesaPayment(ctx context.Context, payment *repository.BillingPayment, callbackReceipt ...string) (string, bool, error) {
	if payment.Status == "paid" || payment.Status == "failed" {
		return payment.Status, false, nil
	}
	status, err := h.Router.Mpesa.GetPaymentStatus(ctx, payment.ProviderSessionID)
	if err != nil {
		return "", false, err
	}
	if status == "failed" {
		newlyFailed, err := h.Repo.MarkBillingPaymentFailed(ctx, payment.Reference)
		if err != nil {
			return "", false, err
		}
		if newlyFailed {
			h.notifyPremiumActionRequired(ctx, payment.UserID, payment.Reference, "Your payment was declined or cancelled. Please try again.")
		}
		return status, false, nil
	}
	if status != "paid" {
		if err := h.Repo.UpdateBillingPaymentStatus(ctx, payment.Reference, status, ""); err != nil {
			return "", false, err
		}
		return status, false, nil
	}
	if len(callbackReceipt) > 0 && callbackReceipt[0] != "" {
		if err := h.Repo.SetBillingPaymentReceipt(ctx, payment.Reference, callbackReceipt[0]); err != nil {
			return "", false, err
		}
		payment.ReceiptNumber = callbackReceipt[0]
	}
	months, upgraded, err := h.Repo.CompleteBillingPayment(ctx, payment.Reference, payment.UserID)
	if err != nil {
		return "", false, err
	}
	if upgraded {
		h.notifyPremiumUpgrade(ctx, payment.UserID, months, payment)
	}
	return "paid", upgraded, nil
}

func (h *BillingHandler) notifyPremiumUpgrade(ctx context.Context, userID string, months int, payment *repository.BillingPayment) {
	if h.Events == nil {
		return
	}
	detachedCtx := context.WithoutCancel(ctx)
	go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
		RecipientID:   userID,
		WSEventType:   "VIP_UPGRADE_SUCCESS",
		WSPayload:     map[string]interface{}{"months": months, "message": localized(detachedCtx, "MsgWelcomePremium", "Welcome to Premium!")},
		EmailTemplate: "premium_welcome",
		EmailData:     map[string]interface{}{"Months": months},
	})
	if payment != nil {
		go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
			RecipientID:   userID,
			EmailTemplate: "premium_payment_receipt",
			EmailData: map[string]interface{}{
				"Amount":        fmt.Sprintf("%.2f", float64(payment.AmountMinor)/100),
				"Currency":      payment.Currency,
				"Months":        months,
				"Reference":     payment.Reference,
				"ReceiptNumber": payment.ReceiptNumber,
				"PaidAt":        time.Now().Format("January 2, 2006 15:04 MST"),
			},
		})
	}
}

func (h *BillingHandler) notifyPremiumActionRequired(ctx context.Context, userID, reference, message string) {
	if h.Events == nil {
		return
	}
	detachedCtx := context.WithoutCancel(ctx)
	go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
		RecipientID:   userID,
		EmailTemplate: "premium_action_required",
		EmailData:     map[string]interface{}{"Reference": reference, "ActionMessage": message},
	})
}

func writeBillingError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// GetPlans returns the available subscription durations and prices from the DB
func (h *BillingHandler) GetPlans(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	plans, err := h.Repo.GetActiveBillingPlans(r.Context())
	if err != nil {
		log.Printf("[BILLING DB ERROR] Failed to fetch billing plans: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": localized(r.Context(), "ErrFailedToLoadPricingPlans", "Failed to load pricing plans")})
		return
	}
	// TODO: Add retry backoff for M-Pesa callback webhook timeout
	// Safaricom Daraja QP
	if len(plans) == 0 {
		plans = []models.BillingPlan{
			{ID: 1, Duration: "1 Month", Price: 14.99, Monthly: 14.99, Save: 0, IsPopular: false},
			{ID: 6, Duration: "6 Months", Price: 53.94, Monthly: 8.99, Save: 40, IsPopular: true},
		}
	}

	currency := "USD"
	if middlewares.CountryCodeFromContext(r.Context()) == "KE" {
		if h.Router.Mpesa == nil {
			writeBillingError(w, http.StatusServiceUnavailable, "Kenyan currency conversion is not configured")
			return
		}
		currency = "KES"
		for i := range plans {
			priceKES, conversionErr := h.Router.Mpesa.KESAmount(plans[i].Price)
			if conversionErr != nil {
				writeBillingError(w, http.StatusServiceUnavailable, "Kenyan currency conversion is not configured correctly")
				return
			}
			monthlyKES, conversionErr := h.Router.Mpesa.KESAmount(plans[i].Monthly)
			if conversionErr != nil {
				writeBillingError(w, http.StatusServiceUnavailable, "Kenyan currency conversion is not configured correctly")
				return
			}
			plans[i].Price = float64(priceKES)
			plans[i].Monthly = float64(monthlyKES)
		}
	}
	for i := range plans {
		plans[i].Currency = currency
	}

	json.NewEncoder(w).Encode(plans)
}
