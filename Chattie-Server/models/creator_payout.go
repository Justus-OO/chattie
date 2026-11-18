package models

import (
	"bytes"
	"crypto/sha256"
	"math/big"
	"regexp"
	"strings"
	"time"
)

const (
	CreatorPayoutUSDTTRC20 = "USDT-TRC20"
	CreatorPayoutUSDTERC20 = "USDT-ERC20"
)

var (
	creatorTRC20WalletPattern     = regexp.MustCompile(`^T[1-9A-HJ-NP-Za-km-z]{33}$`)
	creatorERC20WalletPattern     = regexp.MustCompile(`^0x[a-fA-F0-9]{40}$`)
	creatorCryptoAmountPattern    = regexp.MustCompile(`^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,12})?$`)
	creatorTransactionHashPattern = regexp.MustCompile(`^(0x)?[a-fA-F0-9]{64}$`)
)

func IsSupportedCreatorPayoutNetwork(network string) bool {
	return network == CreatorPayoutUSDTTRC20 || network == CreatorPayoutUSDTERC20
}

func IsValidCreatorPayoutWallet(network, address string) bool {
	switch network {
	case CreatorPayoutUSDTTRC20:
		return isValidTRC20Address(address)
	case CreatorPayoutUSDTERC20:
		return creatorERC20WalletPattern.MatchString(address)
	default:
		return false
	}
}

func IsValidCreatorCryptoAmount(value string) bool {
	if !creatorCryptoAmountPattern.MatchString(value) {
		return false
	}
	amount, ok := new(big.Rat).SetString(value)
	return ok && amount.Sign() > 0
}

func IsValidCreatorPayoutTransactionHash(value string) bool {
	return creatorTransactionHashPattern.MatchString(value)
}

func IsValidCreatorPayoutTransactionHashForNetwork(network, value string) bool {
	if !IsValidCreatorPayoutTransactionHash(value) {
		return false
	}
	switch network {
	case CreatorPayoutUSDTTRC20:
		return !strings.HasPrefix(value, "0x")
	case CreatorPayoutUSDTERC20:
		return strings.HasPrefix(value, "0x")
	default:
		return false
	}
}

func isValidTRC20Address(address string) bool {
	if !creatorTRC20WalletPattern.MatchString(address) {
		return false
	}

	const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
	decodedValue := new(big.Int)
	base := big.NewInt(58)
	for _, character := range address {
		digit := strings.IndexRune(alphabet, character)
		if digit < 0 {
			return false
		}
		decodedValue.Mul(decodedValue, base)
		decodedValue.Add(decodedValue, big.NewInt(int64(digit)))
	}

	decoded := decodedValue.Bytes()
	leadingZeroes := 0
	for leadingZeroes < len(address) && address[leadingZeroes] == '1' {
		leadingZeroes++
	}
	payload := make([]byte, leadingZeroes+len(decoded))
	copy(payload[leadingZeroes:], decoded)
	if len(payload) != 25 || payload[0] != 0x41 {
		return false
	}

	firstHash := sha256.Sum256(payload[:21])
	checksum := sha256.Sum256(firstHash[:])
	return bytes.Equal(payload[21:], checksum[:4])
}

type CreatorPayoutMethod struct {
	AssetNetwork  string    `json:"asset_network"`
	WalletAddress string    `json:"wallet_address"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type CreatorPayoutMethodInput struct {
	WalletAddress string `json:"wallet_address"`
}

type CreatorPayoutSubmission struct {
	AmountCents    int64  `json:"amount_cents"`
	AssetNetwork   string `json:"asset_network"`
	IdempotencyKey string `json:"idempotency_key"`
}

type CreatorPayoutReview struct {
	Action          string `json:"action"`
	Reason          string `json:"reason"`
	CryptoAmount    string `json:"crypto_amount"`
	TransactionHash string `json:"transaction_hash"`
}

type CreatorPayoutRequest struct {
	ID              string     `json:"id"`
	CreatorID       string     `json:"creator_id,omitempty"`
	CreatorName     string     `json:"creator_name,omitempty"`
	CreatorEmail    string     `json:"creator_email,omitempty"`
	AmountCents     int64      `json:"amount_cents"`
	AssetNetwork    string     `json:"asset_network"`
	WalletAddress   string     `json:"wallet_address"`
	Status          string     `json:"status"`
	CryptoAmount    string     `json:"crypto_amount,omitempty"`
	TransactionHash string     `json:"transaction_hash,omitempty"`
	RejectionReason string     `json:"rejection_reason,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	PaidAt          *time.Time `json:"paid_at,omitempty"`
}
