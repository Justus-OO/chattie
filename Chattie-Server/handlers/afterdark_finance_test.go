package handlers

import (
	"errors"
	"testing"

	"chattie-backend/services"
)

func TestWithdrawalAmounts(t *testing.T) {
	tests := []struct {
		name        string
		provider    string
		amountCents int64
		wantPayout  int64
		wantFee     int64
		wantError   bool
	}{
		{name: "mpesa deducts fee", provider: "mpesa", amountCents: 150000, wantPayout: 145000, wantFee: 5000},
		{name: "paystack has no fixed fee", provider: "paystack_bank", amountCents: 150050, wantPayout: 150050},
		{name: "mpesa requires whole shillings", provider: "mpesa", amountCents: 150050, wantError: true},
		{name: "unsupported provider rejected", provider: "other", amountCents: 150000, wantError: true},
		{name: "non-positive amount rejected", provider: "mpesa", amountCents: 0, wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gotPayout, gotFee, err := withdrawalAmounts(test.provider, test.amountCents)
			if (err != nil) != test.wantError {
				t.Fatalf("withdrawalAmounts() error = %v, wantError %v", err, test.wantError)
			}
			if err != nil {
				return
			}
			if gotPayout != test.wantPayout || gotFee != test.wantFee {
				t.Fatalf("withdrawalAmounts() = (%d, %d), want (%d, %d)", gotPayout, gotFee, test.wantPayout, test.wantFee)
			}
		})
	}
}

func TestIsWithdrawalValidationError(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want bool
	}{
		{name: "invalid phone", err: errors.New("enter a valid Kenyan M-Pesa phone number"), want: true},
		{name: "unsupported provider", err: errors.New("unsupported payout provider"), want: true},
		{name: "network issue", err: errors.New("dial tcp: i/o timeout"), want: false},
		{name: "nil error", err: nil, want: false},
	} {
		if got := isWithdrawalValidationError(tc.err); got != tc.want {
			t.Fatalf("isWithdrawalValidationError(%v) = %v, want %v", tc.err, got, tc.want)
		}
	}
}

func TestPayoutFailureIsDefinitive(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "pre-submit failure", err: &services.PayoutNotSubmittedError{Err: errors.New("recipient creation failed")}, want: true},
		{name: "provider rejection", err: &services.PayoutRejectedError{Message: "payout rejected"}, want: true},
		{name: "ambiguous network error", err: errors.New("request timed out"), want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := services.PayoutFailureIsDefinitive(test.err); got != test.want {
				t.Fatalf("PayoutFailureIsDefinitive() = %v, want %v", got, test.want)
			}
		})
	}
}
