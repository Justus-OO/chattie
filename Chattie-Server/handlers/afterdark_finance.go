package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type ADFinanceHandler struct {
	Repo *repository.ADFinanceRepository
}

func NewADFinanceHandler(repo *repository.ADFinanceRepository) *ADFinanceHandler {
	return &ADFinanceHandler{Repo: repo}
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
		PayoutMethodID string `json:"payout_method_id"` // Configured in their settings
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.AmountCents < 100000 { // Enforce min KES 1,000 withdrawal (1000 * 100 cents)
		http.Error(w, "Invalid amount or below minimum threshold", http.StatusBadRequest)
		return
	}

	withdrawal := &models.ADWithdrawal{
		ID:             uuid.New().String(),
		UserID:         userID,
		AmountCents:    req.AmountCents,
		PayoutMethodID: req.PayoutMethodID,
		Status:         "requested",
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	if err := h.Repo.RequestWithdrawal(r.Context(), withdrawal); err != nil {
		if err.Error() == "insufficient cleared funds for payout" {
			http.Error(w, err.Error(), http.StatusPaymentRequired)
			return
		}
		http.Error(w, "Failed to process withdrawal request", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "success",
		"message": "Withdrawal requested successfully",
	})
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
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	methodID := uuid.New().String()

	// Call the Repository instead of raw SQL
	if err := h.Repo.AddPayoutMethod(r.Context(), methodID, userID, req.Provider, req.AccountNumber, req.AccountName); err != nil {
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
		if errors.Is(err, sql.ErrNoRows) || err.Error() == "creator not found or unavailable" {
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
