package handlers

import "testing"

func TestIsKnownDisposableEmail(t *testing.T) {
	tests := []struct {
		email string
		want  bool
	}{
		{email: "person@mailinator.com", want: true},
		{email: "person@sub.mailinator.com", want: true},
		{email: "person@company.example", want: false},
		{email: "invalid-email", want: false},
	}
	for _, test := range tests {
		t.Run(test.email, func(t *testing.T) {
			if got := isKnownDisposableEmail(test.email); got != test.want {
				t.Fatalf("isKnownDisposableEmail(%q) = %v, want %v", test.email, got, test.want)
			}
		})
	}
}
