package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"

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

// UpgradeTier Step 1: Generates the checkout link for Stripe or Paystack using dynamic database pricing
func (h *BillingHandler) UpgradeTier(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req models.UpgradeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request payload"})
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
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid or inactive billing plan"})
		return
	}

	// 2. Detect region and select gateway automatically base
	//d on IP (or frontend override)
	gateway := h.Router.Route(r)

	// 3. Generate the checkout session URL dynamically based on the DB price and duration
	checkout, err := gateway.CreateSubscription(r.Context(), user.Email, userID, price, months)
	if err != nil {
		log.Printf("[BILLING ERROR] Failed to create checkout for %s: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to initialize payment gateway"})
		return
	}

	// 4. Return ALL gateway metadata so React can mount the inline modals without redirecting
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"provider":      checkout.Provider,     // CRITICAL: Tells React which modal to open
		"client_secret": checkout.ClientSecret, // CRITICAL: The token for the popup
		"public_key":    checkout.PublicKey,    // CRITICAL: The key to mount the SDK
		"checkout_url":  checkout.PaymentURL,   // Fallback URL if modals fail
		"session_id":    checkout.SessionID,
		"months":        months,
		"email":         user.Email,
	})
}

// VerifyPayment Step 2: The frontend calls this after returning from Stripe/Paystack
func (h *BillingHandler) VerifyPayment(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Get the session/reference ID and months from the URL query params
	sessionID := r.URL.Query().Get("session_id")
	reference := r.URL.Query().Get("reference")
	monthsStr := r.URL.Query().Get("months")

	var paymentID string
	var gateway services.PaymentGateway

	// Auto-detect which gateway the ID belongs to
	if sessionID != "" {
		paymentID = sessionID
		gateway = h.Router.Stripe
	} else if reference != "" {
		paymentID = reference
		gateway = h.Router.Paystack
	} else {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Missing payment reference"})
		return
	}

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	// 1. Verify with the actual payment provider API
	isPaid, err := gateway.VerifyPayment(r.Context(), paymentID)
	if err != nil || !isPaid {
		log.Printf("[BILLING ERROR] Payment verification failed for %s: %v", userID, err)
		w.WriteHeader(http.StatusPaymentRequired)
		json.NewEncoder(w).Encode(map[string]string{"error": "Payment could not be verified. If you were charged, contact support."})
		return
	}

	// 2. Determine plan length
	months, err := strconv.Atoi(monthsStr)
	if err != nil || months <= 0 {
		months = 1
	}

	// 3. Upgrade the user in the Database (Resets usage limits & logs action)
	if err := h.Repo.UpgradeToPremium(r.Context(), userID, months); err != nil {
		log.Printf("[BILLING DB ERROR] Failed to upgrade user %s after payment: %v", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Payment verified but database upgrade failed. Contact support."})
		return
	}

	// 4. Send the WebSocket & Email Notifications
	detachedCtx := context.WithoutCancel(r.Context())
	go h.Events.ProcessEvent(detachedCtx, services.AppEvent{
		RecipientID:   userID,
		WSEventType:   "VIP_UPGRADE_SUCCESS",
		WSPayload:     map[string]interface{}{"months": months, "message": "Welcome to Premium!"},
		EmailTemplate: "premium_welcome",
	})

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Payment verified! Premium status activated successfully.",
	})
}

// GetPlans returns the available subscription durations and prices from the DB
func (h *BillingHandler) GetPlans(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	plans, err := h.Repo.GetActiveBillingPlans(r.Context())
	if err != nil {
		log.Printf("[BILLING DB ERROR] Failed to fetch billing plans: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to load pricing plans"})
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

	json.NewEncoder(w).Encode(plans)
}
