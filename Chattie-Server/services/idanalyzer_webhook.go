package services

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"time"
)

func VerifyIDAnalyzerWebhookSignature(secret, timestamp, signature string, body []byte, now time.Time) bool {
	if secret == "" || timestamp == "" || signature == "" {
		return false
	}

	unixTime, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	sentAt := time.Unix(unixTime, 0)
	if sentAt.Before(now.Add(-5*time.Minute)) || sentAt.After(now.Add(5*time.Minute)) {
		return false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + "."))
	_, _ = mac.Write(body)
	expected := "v1=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(signature), []byte(expected))
}
