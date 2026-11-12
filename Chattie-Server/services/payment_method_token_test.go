package services

import (
	"encoding/base64"
	"testing"
)

func TestPaymentMethodTokenEncryption(t *testing.T) {
	t.Setenv("PAYMENT_METHOD_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))

	ciphertext, err := EncryptPaymentMethodToken("provider-authorization")
	if err != nil {
		t.Fatalf("EncryptPaymentMethodToken() error = %v", err)
	}
	if string(ciphertext) == "provider-authorization" {
		t.Fatal("encrypted token matches plaintext")
	}

	plaintext, err := DecryptPaymentMethodToken(ciphertext)
	if err != nil {
		t.Fatalf("DecryptPaymentMethodToken() error = %v", err)
	}
	if plaintext != "provider-authorization" {
		t.Fatalf("decrypted token = %q, want %q", plaintext, "provider-authorization")
	}
}

func TestPaymentMethodTokenRequiresEncryptionKey(t *testing.T) {
	t.Setenv("PAYMENT_METHOD_ENCRYPTION_KEY", "")
	if _, err := EncryptPaymentMethodToken("provider-authorization"); err == nil {
		t.Fatal("EncryptPaymentMethodToken() error = nil, want missing key error")
	}
}
