package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"

	"chattie-backend/middlewares"
	"chattie-backend/repository"
)

type ADBillingHandler struct {
	Repo *repository.ADBillingRepository
}

func NewADBillingHandler(repo *repository.ADBillingRepository) *ADBillingHandler {
	return &ADBillingHandler{Repo: repo}
}

// GET /api/afterdark/wallet
func (h *ADBillingHandler) GetWallet(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	wallet, err := h.Repo.GetWallet(r.Context(), userID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedToFetchWallet", "Failed to fetch wallet"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(wallet)
}

// POST /api/afterdark/checkout-intents
func (h *ADBillingHandler) UnlockPostWithWallet(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	var req struct {
		PostID     string `json:"post_id"`
		CreatorID  string `json:"creator_id"`
		PriceCents int64  `json:"price_cents"` // Ideally fetched from DB securely, not trusted from client, but keeping simple here
		ItemType   string `json:"item_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, localized(r.Context(), "ErrInvalidRequestBody", "Invalid request body"), http.StatusBadRequest)
		return
	}
	if req.ItemType != "" {
		http.Error(w, localized(r.Context(), "ErrProviderCheckoutForAfterDarkPurchasesIsNotConfigured", "Provider checkout for After Dark purchases is not configured"), http.StatusNotImplemented)
		return
	}
	if req.PostID == "" {
		http.Error(w, localized(r.Context(), "ErrPostIdIsRequiredForWalletPurchases", "post_id is required for wallet purchases"), http.StatusBadRequest)
		return
	}

	err := h.Repo.PurchasePPV(r.Context(), userID, req.CreatorID, req.PostID, req.PriceCents)
	if err != nil {
		if err.Error() == "insufficient funds" {
			http.Error(w, localized(r.Context(), "ErrInsufficientWalletBalance", "Insufficient wallet balance"), http.StatusPaymentRequired)
			return
		}
		if errors.Is(err, sql.ErrNoRows) || err.Error() == "post is not available for PPV purchase" {
			http.Error(w, localized(r.Context(), "ErrPostNotFoundOrUnavailableForPurchase", "Post not found or unavailable for purchase"), http.StatusNotFound)
			return
		}
		if err.Error() == "post is already unlocked" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"status": "success", "message": localized(r.Context(), "MsgPostAlreadyUnlocked", "Post already unlocked")})
			return
		}
		if err.Error() == "creators cannot purchase their own post" {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err.Error() == "a PPV checkout for this post is already pending" {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		http.Error(w, localized(r.Context(), "ErrTransactionFailed", "Transaction failed"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "success",
		"message": localized(r.Context(), "MsgPostUnlockedSuccessfully", "Post unlocked successfully"),
	})
}
