package middlewares

import (
	"net/http/httptest"
	"testing"
)

func TestTrustedCountryCodeRequiresTrustedProxy(t *testing.T) {
	proxies, err := parseTrustedProxyCIDRs("10.0.0.0/8")
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest("GET", "/", nil)
	request.RemoteAddr = "198.51.100.10:443"
	request.Header.Set("CF-IPCountry", "KE")
	if got := trustedCountryCode(request, proxies); got != "" {
		t.Fatalf("untrusted proxy country header accepted: %q", got)
	}
}

func TestTrustedCountryCodeAcceptsValidEdgeHeader(t *testing.T) {
	proxies, err := parseTrustedProxyCIDRs("10.0.0.0/8")
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest("GET", "/", nil)
	request.RemoteAddr = "10.1.2.3:443"
	request.Header.Set("CF-IPCountry", "ke")
	if got := trustedCountryCode(request, proxies); got != "KE" {
		t.Fatalf("trusted country code = %q, want KE", got)
	}
}
