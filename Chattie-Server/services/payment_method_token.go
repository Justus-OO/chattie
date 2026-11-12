package services

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"strings"
)

func EncryptPaymentMethodToken(token string) ([]byte, error) {
	if strings.TrimSpace(token) == "" {
		return nil, fmt.Errorf("payment authorization token is empty")
	}
	key, err := paymentMethodEncryptionKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create payment token cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create payment token encryptor: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generate payment token nonce: %w", err)
	}
	return gcm.Seal(nonce, nonce, []byte(token), nil), nil
}

func DecryptPaymentMethodToken(ciphertext []byte) (string, error) {
	key, err := paymentMethodEncryptionKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create payment token cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create payment token decryptor: %w", err)
	}
	if len(ciphertext) < gcm.NonceSize() {
		return "", fmt.Errorf("encrypted payment token is invalid")
	}
	nonce, encrypted := ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, encrypted, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt payment token: %w", err)
	}
	return string(plaintext), nil
}

func paymentMethodEncryptionKey() ([]byte, error) {
	// Configure a stable, secret-manager-backed base64 encoding of 32 random bytes.
	encoded := strings.TrimSpace(os.Getenv("PAYMENT_METHOD_ENCRYPTION_KEY"))
	if encoded == "" {
		return nil, fmt.Errorf("PAYMENT_METHOD_ENCRYPTION_KEY is not configured")
	}
	key, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("PAYMENT_METHOD_ENCRYPTION_KEY must be base64 encoded")
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("PAYMENT_METHOD_ENCRYPTION_KEY must decode to 32 bytes")
	}
	return key, nil
}
