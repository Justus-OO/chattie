package services

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"testing"
	"time"
)

func TestVerifyIDAnalyzerWebhookSignature(t *testing.T) {
	secret := "webhook-secret"
	body := []byte(`{"event":"docupass_conclusive"}`)
	now := time.Unix(1_800_000_000, 0)
	timestamp := strconv.FormatInt(now.Unix(), 10)

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + "."))
	_, _ = mac.Write(body)
	signature := "v1=" + hex.EncodeToString(mac.Sum(nil))

	if !VerifyIDAnalyzerWebhookSignature(secret, timestamp, signature, body, now) {
		t.Fatal("valid signature was rejected")
	}
	if VerifyIDAnalyzerWebhookSignature(secret, timestamp, signature, []byte(`{"event":"tampered"}`), now) {
		t.Fatal("signature accepted a modified body")
	}
	staleTimestamp := strconv.FormatInt(now.Add(-6*time.Minute).Unix(), 10)
	staleMAC := hmac.New(sha256.New, []byte(secret))
	_, _ = staleMAC.Write([]byte(staleTimestamp + "."))
	_, _ = staleMAC.Write(body)
	staleSignature := "v1=" + hex.EncodeToString(staleMAC.Sum(nil))
	if VerifyIDAnalyzerWebhookSignature(secret, staleTimestamp, staleSignature, body, now) {
		t.Fatal("signature accepted an expired timestamp")
	}
}
