package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"

	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func decodeCreatorPayoutJSON(w http.ResponseWriter, r *http.Request, destination interface{}) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing interface{}
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("request must contain exactly one JSON value")
	}
	return nil
}

func (h *CreatorHandler) GetPayoutMethods(w http.ResponseWriter, r *http.Request) {
	creatorID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || creatorID == "" {
		sendError(w, http.StatusUnauthorized, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"))
		return
	}

	methods, err := h.Repo.GetCreatorPayoutMethods(r.Context(), creatorID)
	if err != nil {
		log.Printf("Failed to load payout methods for creator %s: %v", creatorID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedToLoadPayoutMethods", "Failed to load payout methods"))
		return
	}
	sendJSON(w, http.StatusOK, methods)
}

func (h *CreatorHandler) SavePayoutMethod(w http.ResponseWriter, r *http.Request) {
	creatorID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || creatorID == "" {
		sendError(w, http.StatusUnauthorized, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"))
		return
	}

	network := chi.URLParam(r, "asset_network")
	var payload models.CreatorPayoutMethodInput
	defer r.Body.Close()
	if err := decodeCreatorPayoutJSON(w, r, &payload); err != nil {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidPayoutWalletPayload", "Invalid payout wallet payload"))
		return
	}
	address := strings.TrimSpace(payload.WalletAddress)
	if len(address) > 255 {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrWalletAddressIsTooLong", "Wallet address is too long"))
		return
	}

	if !models.IsSupportedCreatorPayoutNetwork(network) {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrUnsupportedPayoutNetwork", "Unsupported payout network"))
		return
	}
	if !models.IsValidCreatorPayoutWallet(network, address) {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrWalletAddressDoesNotMatchTheSelectedNetwork", "Wallet address does not match the selected network"))
		return
	}

	if err := h.Repo.UpsertCreatorPayoutMethod(r.Context(), creatorID, network, address); err != nil {
		log.Printf("Failed to save payout wallet for creator %s: %v", creatorID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedToSavePayoutWallet", "Failed to save payout wallet"))
		return
	}
	sendJSON(w, http.StatusOK, map[string]string{
		"asset_network":  network,
		"wallet_address": address,
	})
}

func (h *CreatorHandler) GetPayoutRequests(w http.ResponseWriter, r *http.Request) {
	creatorID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || creatorID == "" {
		sendError(w, http.StatusUnauthorized, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"))
		return
	}

	requests, err := h.Repo.GetCreatorPayoutRequests(r.Context(), creatorID)
	if err != nil {
		log.Printf("Failed to load payout requests for creator %s: %v", creatorID, err)
		sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedToLoadPayoutRequests", "Failed to load payout requests"))
		return
	}
	sendJSON(w, http.StatusOK, requests)
}

func (h *CreatorHandler) RequestCryptoPayout(w http.ResponseWriter, r *http.Request) {
	creatorID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || creatorID == "" {
		sendError(w, http.StatusUnauthorized, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"))
		return
	}

	var payload models.CreatorPayoutSubmission
	defer r.Body.Close()
	if err := decodeCreatorPayoutJSON(w, r, &payload); err != nil {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidPayoutRequest", "Invalid payout request"))
		return
	}
	if payload.AmountCents < 5000 {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrMinimumWithdrawalIs5000", "Minimum withdrawal is $50.00"))
		return
	}
	if !models.IsSupportedCreatorPayoutNetwork(payload.AssetNetwork) {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrUnsupportedPayoutNetwork2", "Unsupported payout network"))
		return
	}
	if _, err := uuid.Parse(payload.IdempotencyKey); err != nil {
		sendError(w, http.StatusBadRequest, localized(r.Context(), "ErrAValidPayoutIdempotencyKeyIsRequired", "A valid payout idempotency key is required"))
		return
	}

	if err := h.Repo.RequestCreatorCryptoPayout(r.Context(), creatorID, payload.IdempotencyKey, payload.AmountCents, payload.AssetNetwork); err != nil {
		switch {
		case errors.Is(err, repository.ErrCreatorPayoutBalance):
			sendError(w, http.StatusConflict, localized(r.Context(), "ErrInsufficientAvailableBalance", "Insufficient available balance"))
		case errors.Is(err, repository.ErrCreatorPayoutMethod):
			sendError(w, http.StatusConflict, localized(r.Context(), "ErrSaveAPayoutWalletForThisNetworkBeforeRequestingWithdraw", "Save a payout wallet for this network before requesting withdrawal"))
		case errors.Is(err, repository.ErrCreatorPayoutKeyReuse):
			sendError(w, http.StatusConflict, localized(r.Context(), "ErrThisRequestKeyWasAlreadyUsedWithDifferentPayoutDetails", "This request key was already used with different payout details"))
		case errors.Is(err, repository.ErrCreatorPayoutDuplicate):
			sendJSON(w, http.StatusOK, map[string]interface{}{
				"duplicate": true,
				"message": localized(r.Context(), "MsgThisPayoutRequestAlreadyExistsReviewItsCurrentStatusInP", "This payout request already exists. Review its current status in payout history."),
			})
		default:
			log.Printf("Crypto payout request failed for creator %s: %v", creatorID, err)
			sendError(w, http.StatusInternalServerError, localized(r.Context(), "ErrUnableToSubmitPayoutRequest", "Unable to submit payout request"))
		}
		return
	}
	sendJSON(w, http.StatusCreated, map[string]string{"message": localized(r.Context(), "MsgPayoutRequestSubmittedForAdminReview", "Payout request submitted for admin review")})
}

func (h *AdminCreatorHandler) GetCreatorPayoutRequests(w http.ResponseWriter, r *http.Request) {
	status := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("status")))
	switch status {
	case "", "ALL", "PENDING", "APPROVED", "REJECTED", "PAID":
	default:
		sendAdminError(w, http.StatusBadRequest, localized(r.Context(), "ErrUnsupportedPayoutStatusFilter", "Unsupported payout status filter"))
		return
	}

	requests, err := h.Repo.GetAdminCreatorPayoutRequests(r.Context(), status)
	if err != nil {
		log.Printf("Failed to load creator payout requests: %v", err)
		sendAdminError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedToLoadCreatorPayoutRequests", "Failed to load creator payout requests"))
		return
	}
	sendAdminJSON(w, http.StatusOK, requests)
}

func (h *AdminCreatorHandler) ReviewCreatorPayout(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		sendAdminError(w, http.StatusUnauthorized, localized(r.Context(), "SupportErrUnauthorized", "Unauthorized"))
		return
	}
	payoutID := chi.URLParam(r, "payout_id")
	if _, err := uuid.Parse(payoutID); err != nil {
		sendAdminError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidCreatorPayoutRequestID", "Invalid creator payout request ID"))
		return
	}

	var payload models.CreatorPayoutReview
	defer r.Body.Close()
	if err := decodeCreatorPayoutJSON(w, r, &payload); err != nil {
		sendAdminError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidPayoutReviewPayload", "Invalid payout review payload"))
		return
	}
	payload.Action = strings.ToUpper(strings.TrimSpace(payload.Action))
	payload.Reason = strings.TrimSpace(payload.Reason)
	payload.TransactionHash = strings.TrimSpace(payload.TransactionHash)

	switch payload.Action {
	case "APPROVE":
	case "REJECT":
		if payload.Reason == "" || len(payload.Reason) > 1000 {
			sendAdminError(w, http.StatusBadRequest, localized(r.Context(), "ErrARejectionReasonOfAtMost1000CharactersIsRequired", "A rejection reason of at most 1000 characters is required"))
			return
		}
	case "PAID":
		if !models.IsValidCreatorCryptoAmount(payload.CryptoAmount) ||
			!models.IsValidCreatorPayoutTransactionHash(payload.TransactionHash) {
			sendAdminError(w, http.StatusBadRequest, localized(r.Context(), "ErrAValidCryptoAmountAndBlockchainTransactionHashAreRequir", "A valid crypto amount and blockchain transaction hash are required"))
			return
		}
	default:
		sendAdminError(w, http.StatusBadRequest, localized(r.Context(), "ErrActionMustBeAPPROVEREJECTOrPAID", "Action must be APPROVE, REJECT, or PAID"))
		return
	}

	err := h.Repo.ReviewCreatorPayout(
		r.Context(),
		payoutID,
		adminID,
		payload.Action,
		payload.Reason,
		payload.CryptoAmount,
		payload.TransactionHash,
	)
	switch {
	case errors.Is(err, repository.ErrCreatorPayoutNotFound):
		sendAdminError(w, http.StatusNotFound, localized(r.Context(), "ErrCreatorPayoutRequestNotFound", "Creator payout request not found"))
	case errors.Is(err, repository.ErrCreatorPayoutConflict):
		sendAdminError(w, http.StatusConflict, localized(r.Context(), "ErrCreatorPayoutRequestHasAlreadyBeenProcessed", "Creator payout request has already been processed"))
	case errors.Is(err, repository.ErrCreatorPayoutInvalidSubmission):
		sendAdminError(w, http.StatusBadRequest, localized(r.Context(), "ErrCryptoAmountOrTransactionHashIsInvalidForThePayoutNetwo", "Crypto amount or transaction hash is invalid for the payout network"))
	case err != nil:
		log.Printf("Failed to review creator payout request %s: %v", payoutID, err)
		sendAdminError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedToUpdateCreatorPayoutRequest", "Failed to update creator payout request"))
	default:
		sendAdminJSON(w, http.StatusOK, map[string]string{"message": localized(r.Context(), "MsgCreatorPayoutRequestUpdated", "Creator payout request updated")})
	}
}
