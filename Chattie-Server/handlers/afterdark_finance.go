package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type ADFinanceHandler struct {
	Repo     *repository.ADFinanceRepository
	Mpesa    *services.MpesaGateway
	Paystack *services.PaystackGateway
}

func NewADFinanceHandler(repo *repository.ADFinanceRepository, mpesa *services.MpesaGateway, paystack *services.PaystackGateway) *ADFinanceHandler {
	return &ADFinanceHandler{Repo: repo, Mpesa: mpesa, Paystack: paystack}
}

// POST /api/afterdark/wallet/deposits
func (h *ADFinanceHandler) InitiateDeposit(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		AmountCents int64  `json:"amount_cents"`
		Provider    string `json:"provider"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.AmountCents <= 0 {
		http.Error(w, "Invalid amount", http.StatusBadRequest)
		return
	}

	intent := &models.ADDepositIntent{
		ID:          uuid.New().String(),
		UserID:      userID,
		AmountCents: req.AmountCents,
		Provider:    req.Provider,
		Status:      "pending",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := h.Repo.CreateDepositIntent(r.Context(), intent); err != nil {
		http.Error(w, "Failed to initiate deposit", http.StatusInternalServerError)
		return
	}

	// *Note: In a full integration, you would call M-Pesa STK Push or Paystack API here using the intent.ID as the reference*

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(intent)
}

// POST /api/afterdark/wallet/withdrawals
func (h *ADFinanceHandler) RequestWithdrawal(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		AmountCents    int64  `json:"amount_cents"`
		PayoutMethodID string `json:"payout_method_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.AmountCents < 100000 || req.PayoutMethodID == "" {
		http.Error(w, "Invalid amount or below minimum threshold", http.StatusBadRequest)
		return
	}

	method, err := h.Repo.GetPayoutMethod(r.Context(), userID, req.PayoutMethodID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "Payout method not found", http.StatusBadRequest)
			return
		}
		http.Error(w, "Could not load payout method", http.StatusInternalServerError)
		return
	}
	switch method.Provider {
	case "mpesa", "paystack_mobile_money":
		phone, err := services.NormalizeMpesaPhone(method.AccountNumber)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		method.AccountNumber = phone
	}
	if err := h.validateWithdrawalProvider(method.Provider); err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	payoutAmountCents, feeCents, err := withdrawalAmounts(method.Provider, req.AmountCents)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	withdrawal := &models.ADWithdrawal{
		ID:                uuid.New().String(),
		UserID:            userID,
		AmountCents:       req.AmountCents,
		PayoutAmountCents: payoutAmountCents,
		FeeCents:          feeCents,
		PayoutMethodID:    req.PayoutMethodID,
		Provider:          method.Provider,
		Status:            "requested",
		CreatedAt:         time.Now(),
		UpdatedAt:         time.Now(),
	}

	if err := h.Repo.RequestWithdrawal(r.Context(), withdrawal); err != nil {
		if errors.Is(err, repository.ErrInsufficientClearedFunds) {
			http.Error(w, err.Error(), http.StatusPaymentRequired)
			return
		}
		if errors.Is(err, repository.ErrPayoutMethodNotFound) {
			http.Error(w, "Payout method not found", http.StatusBadRequest)
			return
		}
		if errors.Is(err, repository.ErrWithdrawalInProgress) {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		if errors.Is(err, repository.ErrInvalidWithdrawal) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		http.Error(w, "Failed to process withdrawal request", http.StatusInternalServerError)
		return
	}

	preassignedProviderReference := ""
	if method.Provider == "paystack_bank" || method.Provider == "paystack_mobile_money" {
		preassignedProviderReference = withdrawal.ID
	}
	if err := h.Repo.BeginWithdrawalSubmission(r.Context(), withdrawal.ID, preassignedProviderReference); err != nil {
		log.Printf("[AFTER DARK PAYOUT] Could not mark withdrawal %s as submitting: %v", withdrawal.ID, err)
		http.Error(w, "Could not safely start payout submission. Funds remain reserved for retry.", http.StatusInternalServerError)
		return
	}

	providerReference, conversationID, err := h.dispatchWithdrawal(r, withdrawal, method)
	if err != nil {
		if services.PayoutFailureIsDefinitive(err) {
			revertReason := "Provider definitively rejected payout: " + err.Error()
			if revertErr := h.Repo.FailWithdrawalBeforeSubmission(r.Context(), withdrawal.ID, revertReason); revertErr != nil {
				log.Printf("[AFTER DARK PAYOUT] Could not reverse rejected withdrawal %s: %v (submission error: %v)", withdrawal.ID, revertErr, err)
			}
		} else {
			log.Printf("[AFTER DARK PAYOUT] Submission outcome is unknown for withdrawal %s; funds remain reserved for reconciliation: %v", withdrawal.ID, err)
		}
		status := http.StatusBadGateway
		if isWithdrawalValidationError(err) {
			status = http.StatusBadRequest
		}
		http.Error(w, err.Error(), status)
		return
	}
	if err := h.Repo.SetWithdrawalProvider(r.Context(), withdrawal.ID, method.Provider, providerReference, conversationID); err != nil {
		log.Printf("[AFTER DARK PAYOUT] Provider accepted withdrawal %s but reference tracking failed: %v", withdrawal.ID, err)
		http.Error(w, "Payout was submitted but its status could not be recorded; contact support", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{
		"id": withdrawal.ID, "status": "processing",
		"provider": method.Provider, "message": "Payout submitted. Its status will update when the provider confirms delivery.",
	})
}

func (h *ADFinanceHandler) validateWithdrawalProvider(provider string) error {
	switch provider {
	case "mpesa":
		if h.Mpesa == nil {
			return errors.New("M-Pesa payouts are not configured")
		}
		return h.Mpesa.ValidateB2CConfig()
	case "paystack_bank", "paystack_mobile_money":
		if h.Paystack == nil || h.Paystack.SecretKey == "" {
			return errors.New("Paystack payouts are not configured")
		}
		return nil
	default:
		return errors.New("unsupported payout provider")
	}
}

func (h *ADFinanceHandler) dispatchWithdrawal(r *http.Request, withdrawal *models.ADWithdrawal, method *repository.ADPayoutMethod) (string, string, error) {
	switch method.Provider {
	case "mpesa":
		if h.Mpesa == nil {
			return "", "", errors.New("M-Pesa payouts are not configured")
		}
		transfer, err := h.Mpesa.SendB2C(r.Context(), method.AccountNumber, withdrawal.ID, withdrawal.PayoutAmountCents/100)
		if err != nil {
			return "", "", err
		}
		return transfer.OriginatorConversationID, transfer.ConversationID, nil
	case "paystack_bank", "paystack_mobile_money":
		if h.Paystack == nil {
			return "", "", errors.New("Paystack payouts are not configured")
		}
		recipientType := "bank"
		if method.Provider == "paystack_mobile_money" {
			recipientType = "mobile_money"
		}
		recipientCode, err := h.Paystack.CreateTransferRecipient(r.Context(), recipientType, method.AccountName, method.AccountNumber, method.BankCode)
		if err != nil {
			return "", "", &services.PayoutNotSubmittedError{Err: err}
		}
		transfer, err := h.Paystack.InitiateTransfer(r.Context(), withdrawal.PayoutAmountCents, recipientCode, withdrawal.ID, "After Dark creator earnings payout")
		if err != nil {
			return "", "", err
		}
		return transfer.Reference, "", nil
	default:
		return "", "", errors.New("unsupported payout provider")
	}
}

func withdrawalAmounts(provider string, amountCents int64) (int64, int64, error) {
	if amountCents <= 0 {
		return 0, 0, errors.New("Withdrawal amount must be positive")
	}
	var feeCents int64
	switch provider {
	case "mpesa":
		if amountCents%100 != 0 {
			return 0, 0, errors.New("M-Pesa payouts must be a whole number of Kenyan shillings")
		}
		feeCents = 5000
	case "paystack_bank", "paystack_mobile_money":
	default:
		return 0, 0, errors.New("Unsupported payout provider")
	}
	if amountCents <= feeCents {
		return 0, 0, errors.New("Withdrawal amount must exceed the payout fee")
	}
	return amountCents - feeCents, feeCents, nil
}

func isWithdrawalValidationError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "invalid") ||
		strings.Contains(msg, "required") ||
		strings.Contains(msg, "must be") ||
		strings.Contains(msg, "phone number") ||
		strings.Contains(msg, "account") ||
		strings.Contains(msg, "validation") ||
		strings.Contains(msg, "unsupported payout provider")
}

// POST /api/afterdark/me/payout-methods
func (h *ADFinanceHandler) AddPayoutMethod(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Provider      string `json:"provider"`
		AccountNumber string `json:"account_number"`
		AccountName   string `json:"account_name"`
		BankCode      string `json:"bank_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	req.Provider = strings.ToLower(strings.TrimSpace(req.Provider))
	req.AccountNumber = strings.TrimSpace(req.AccountNumber)
	req.AccountName = strings.TrimSpace(req.AccountName)
	req.BankCode = strings.TrimSpace(req.BankCode)
	if req.AccountNumber == "" || req.AccountName == "" {
		http.Error(w, "Account name and number are required", http.StatusBadRequest)
		return
	}
	switch req.Provider {
	case "mpesa", "paystack_mobile_money":
		phone, err := services.NormalizeMpesaPhone(req.AccountNumber)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		req.AccountNumber = phone
	case "paystack_bank":
		if req.BankCode == "" {
			http.Error(w, "Select a Paystack bank", http.StatusBadRequest)
			return
		}
	default:
		http.Error(w, "Unsupported payout provider", http.StatusBadRequest)
		return
	}
	if req.Provider == "paystack_mobile_money" && req.BankCode == "" {
		http.Error(w, "Select a Paystack mobile money provider", http.StatusBadRequest)
		return
	}
	methodID := uuid.New().String()
	if err := h.Repo.AddPayoutMethodWithBank(r.Context(), methodID, userID, req.Provider, req.AccountNumber, req.AccountName, req.BankCode); err != nil {
		http.Error(w, "Failed to add payout method", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"id":     methodID,
		"status": "added",
	})
}

func (h *ADFinanceHandler) GetPaystackBanks(w http.ResponseWriter, r *http.Request) {
	if h.Paystack == nil {
		http.Error(w, "Paystack payouts are not configured", http.StatusServiceUnavailable)
		return
	}
	banks, err := h.Paystack.ListPayoutBanks(r.Context(), r.URL.Query().Get("type"))
	if err != nil {
		http.Error(w, "Could not load Paystack payout destinations", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(banks)
}

func (h *ADFinanceHandler) MpesaB2CResult(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Result struct {
			ConversationID           string `json:"ConversationID"`
			OriginatorConversationID string `json:"OriginatorConversationID"`
			ResultCode               *int   `json:"ResultCode"`
			ResultDesc               string `json:"ResultDesc"`
		} `json:"Result"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil {
		http.Error(w, "Invalid M-Pesa payout result", http.StatusBadRequest)
		return
	}
	if payload.Result.ConversationID == "" || payload.Result.OriginatorConversationID == "" || payload.Result.ResultCode == nil {
		http.Error(w, "Missing M-Pesa payout result fields", http.StatusBadRequest)
		return
	}
	reason := ""
	if *payload.Result.ResultCode != 0 {
		reason = payload.Result.ResultDesc
	}
	if err := h.Repo.CompleteWithdrawal(
		r.Context(), "mpesa", payload.Result.OriginatorConversationID,
		payload.Result.ConversationID, *payload.Result.ResultCode == 0, reason,
	); err != nil {
		log.Printf("[AFTER DARK PAYOUT] Could not process M-Pesa B2C result: %v", err)
		http.Error(w, "Could not process payout result", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"ResultCode": "0", "ResultDesc": "Accepted"})
}

func (h *ADFinanceHandler) MpesaB2CTimeout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"ResultCode": "0", "ResultDesc": "Accepted"})
}

func (h *ADFinanceHandler) GetPendingEarningsClearance(w http.ResponseWriter, r *http.Request) {
	earnings, err := h.Repo.GetPendingEarningsClearance(r.Context())
	if err != nil {
		http.Error(w, "Could not load creator earnings awaiting clearance", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(earnings)
}

func (h *ADFinanceHandler) ClearCreatorEarnings(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	creatorID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		http.Error(w, "Invalid creator ID", http.StatusBadRequest)
		return
	}
	var req struct {
		AmountCents int64  `json:"amount_cents"`
		Reason      string `json:"reason"`
		Source      string `json:"source"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.AmountCents <= 0 || strings.TrimSpace(req.Reason) == "" || len(strings.TrimSpace(req.Reason)) > 500 {
		http.Error(w, "A positive amount, source, and an audit reason of 500 characters or fewer are required", http.StatusBadRequest)
		return
	}
	if err := h.Repo.ClearCreatorEarnings(r.Context(), creatorID.String(), adminID, req.Reason, req.Source, req.AmountCents); err != nil {
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, repository.ErrEarningsOnHold) || strings.Contains(err.Error(), "exceeds pending") || strings.Contains(err.Error(), "only available") {
			status := http.StatusBadRequest
			if errors.Is(err, repository.ErrEarningsOnHold) {
				status = http.StatusConflict
			}
			http.Error(w, err.Error(), status)
			return
		}
		http.Error(w, "Could not clear creator earnings", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "cleared"})
}

func (h *ADFinanceHandler) AutoClearPPEarnings(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	creatorID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		http.Error(w, "Invalid creator ID", http.StatusBadRequest)
		return
	}
	amount, err := h.Repo.AutoClearPPEarnings(r.Context(), creatorID.String(), adminID)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, repository.ErrEarningsOnHold) {
			status = http.StatusConflict
		} else if errors.Is(err, sql.ErrNoRows) || strings.Contains(err.Error(), "eligible") {
			status = http.StatusBadRequest
		}
		http.Error(w, err.Error(), status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "cleared", "source": "ppv", "amount_cents": amount})
}

// GET /api/afterdark/wallet/history
func (h *ADFinanceHandler) GetTransactionHistory(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	history, err := h.Repo.GetTransactionHistory(r.Context(), userID)
	if err != nil {
		http.Error(w, "Failed to fetch history", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
}

// GET /api/afterdark/checkout-intents/{intentId}
func (h *ADFinanceHandler) GetCheckoutIntent(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	intent, err := h.Repo.GetDepositIntent(r.Context(), chi.URLParam(r, "intentId"), userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "Checkout intent not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Failed to fetch checkout intent", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(intent)
}

// GET /api/afterdark/me/payout-methods
func (h *ADFinanceHandler) GetPayoutMethods(w http.ResponseWriter, r *http.Request) {
	userID, _ := r.Context().Value(middlewares.UserIDKey).(string)

	methods, err := h.Repo.GetPayoutMethods(r.Context(), userID)
	if err != nil {
		http.Error(w, "Failed to fetch payout methods", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(methods)
}

// GET /api/afterdark/me/earnings
func (h *ADFinanceHandler) GetEarnings(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	earnings, err := h.Repo.GetEarnings(r.Context(), userID)
	if err != nil {
		http.Error(w, "Failed to fetch earnings", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(earnings)
}

// GET /api/afterdark/wallet/withdrawals
func (h *ADFinanceHandler) GetWithdrawals(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	withdrawals, err := h.Repo.GetWithdrawals(r.Context(), userID)
	if err != nil {
		http.Error(w, "Failed to fetch withdrawals", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(withdrawals)
}

// POST /api/afterdark/creators/{creatorId}/tips
func (h *ADFinanceHandler) SendTip(w http.ResponseWriter, r *http.Request) {
	senderID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || senderID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		AmountCents int64  `json:"amount_cents"`
		Message     string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.AmountCents <= 0 {
		http.Error(w, "A valid tip amount is required", http.StatusBadRequest)
		return
	}
	if len(req.Message) > 500 {
		http.Error(w, "Tip message is too long", http.StatusBadRequest)
		return
	}
	tipID, err := h.Repo.SendTip(r.Context(), senderID, chi.URLParam(r, "creatorId"), req.AmountCents, req.Message)
	if err != nil {
		if errors.Is(err, repository.ErrTippingLockedOut) {
			http.Error(w, err.Error(), http.StatusLocked)
		} else if errors.Is(err, sql.ErrNoRows) || err.Error() == "creator not found or unavailable" {
			http.Error(w, "Creator not found or unavailable", http.StatusNotFound)
		} else if err.Error() == "insufficient funds" {
			http.Error(w, "Insufficient wallet funds", http.StatusPaymentRequired)
		} else if err.Error() == "you cannot tip yourself" {
			http.Error(w, err.Error(), http.StatusBadRequest)
		} else {
			http.Error(w, "Failed to send tip", http.StatusInternalServerError)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id": tipID, "status": "completed", "amount_cents": req.AmountCents,
	})
}
