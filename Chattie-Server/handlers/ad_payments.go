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
)

type ADPaymentsHandler struct {
	Finance    *repository.ADFinanceRepository
	Users      *repository.Repository
	Events     *services.EventHandler
	Paystack   *services.PaystackGateway
	Mpesa      *services.MpesaGateway
	RoomClient *lksdk.RoomServiceClient
}

func NewADPaymentsHandler(finance *repository.ADFinanceRepository, users *repository.Repository, events *services.EventHandler, paystack *services.PaystackGateway, mpesa *services.MpesaGateway, roomClient *lksdk.RoomServiceClient) *ADPaymentsHandler {
	return &ADPaymentsHandler{
		Finance: finance, Users: users, Events: events, Paystack: paystack, Mpesa: mpesa, RoomClient: roomClient,
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

	intent, err := h.Finance.CreateADPaymentIntent(
		r.Context(), userID, req.PaymentType, req.TargetID, req.Provider, req.AmountCents, req.Message,
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
	case "paystack":
		h.startPaystack(w, r, intent)
	case "mpesa":
		h.startMpesa(w, r, intent, req.PhoneNumber)
	default:
		writeADPaymentError(w, http.StatusBadRequest, "Unsupported payment provider")
	}
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
		"payment_type": intent.PaymentType, "status": "pending",
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
		"currency": intent.Currency, "payment_type": intent.PaymentType,
		"status": "pending", "message": checkout.CustomerMessage,
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

type providerPayment struct {
	AmountMinor  int64
	Currency     string
	Receipt      string
	PaymentMethod *services.PaymentMethodInfo
}

func (h *ADPaymentsHandler) reconcile(ctx context.Context, intent *repository.ADPaymentIntent, callbackPayment *providerPayment) (*repository.ADPaymentIntent, error) {
	if intent.Status == "completed" || intent.Status == "failed" {
		return intent, nil
	}
	var payment providerPayment
	switch intent.Provider {
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
			AmountMinor: verified.AmountMinor,
			Currency:    verified.Currency,
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
		"Amount":        fmt.Sprintf("%.2f", float64(intent.AmountCents)/100),
		"Currency":      intent.Currency,
		"PaymentType":   strings.ReplaceAll(intent.PaymentType, "_", " "),
		"Reference":     intent.ID,
		"ReceiptNumber": intent.ReceiptNumber,
		"PaidAt":        time.Now().Format("January 2, 2006 15:04 MST"),
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
		SenderName: senderName, AmountCents: intent.AmountCents, Message: intent.Message,
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
		"tip_id": intent.ID, "target_id": intent.TargetID, "creator_id": intent.CreatorID,
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
