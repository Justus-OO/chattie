package models

import "testing"

func TestIsValidCreatorPayoutWallet(t *testing.T) {
	tests := []struct {
		name    string
		network string
		address string
		valid   bool
	}{
		{
			name:    "checksummed TRON address",
			network: CreatorPayoutUSDTTRC20,
			address: "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj",
			valid:   true,
		},
		{
			name:    "invalid TRON checksum",
			network: CreatorPayoutUSDTTRC20,
			address: "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdk",
			valid:   false,
		},
		{
			name:    "Ethereum address",
			network: CreatorPayoutUSDTERC20,
			address: "0x0000000000000000000000000000000000000001",
			valid:   true,
		},
		{
			name:    "rejects address on wrong network",
			network: CreatorPayoutUSDTTRC20,
			address: "0x0000000000000000000000000000000000000001",
			valid:   false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := IsValidCreatorPayoutWallet(test.network, test.address); got != test.valid {
				t.Fatalf("IsValidCreatorPayoutWallet() = %v, want %v", got, test.valid)
			}
		})
	}
}

func TestIsValidCreatorCryptoAmount(t *testing.T) {
	tests := []struct {
		value string
		valid bool
	}{
		{value: "50", valid: true},
		{value: "0.000000000001", valid: true},
		{value: "0", valid: false},
		{value: "50.1234567890123", valid: false},
		{value: "1000000000000000000", valid: false},
		{value: "1e2", valid: false},
		{value: "-1", valid: false},
	}

	for _, test := range tests {
		t.Run(test.value, func(t *testing.T) {
			if got := IsValidCreatorCryptoAmount(test.value); got != test.valid {
				t.Fatalf("IsValidCreatorCryptoAmount(%q) = %v, want %v", test.value, got, test.valid)
			}
		})
	}
}

func TestIsValidCreatorPayoutTransactionHash(t *testing.T) {
	ethereumHash := "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	tronHash := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	if !IsValidCreatorPayoutTransactionHash(ethereumHash) {
		t.Fatal("expected a 0x-prefixed 32-byte hash to be valid")
	}
	if IsValidCreatorPayoutTransactionHash("not-a-transaction-hash") {
		t.Fatal("expected malformed transaction hash to be rejected")
	}
	if !IsValidCreatorPayoutTransactionHashForNetwork(CreatorPayoutUSDTERC20, ethereumHash) ||
		!IsValidCreatorPayoutTransactionHashForNetwork(CreatorPayoutUSDTTRC20, tronHash) ||
		IsValidCreatorPayoutTransactionHashForNetwork(CreatorPayoutUSDTERC20, tronHash) {
		t.Fatal("transaction hashes must match the payout network format")
	}
}
