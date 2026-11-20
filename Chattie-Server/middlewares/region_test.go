package middlewares

import (
	"net"
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

func TestClientIPFromRequestTrustsForwardingOnlyBehindTrustedProxy(t *testing.T) {
	proxies, err := parseTrustedProxyCIDRs("10.0.0.0/8")
	if err != nil {
		t.Fatal(err)
	}

	untrusted := httptest.NewRequest("GET", "/", nil)
	untrusted.RemoteAddr = "198.51.100.10:443"
	untrusted.Header.Set("X-Forwarded-For", "203.0.113.8")
	if got := clientIPFromRequest(untrusted, proxies); !got.Equal(net.ParseIP("198.51.100.10")) {
		t.Fatalf("untrusted forwarding header changed client IP: %v", got)
	}

	trusted := httptest.NewRequest("GET", "/", nil)
	trusted.RemoteAddr = "10.1.2.3:443"
	trusted.Header.Set("X-Forwarded-For", "198.51.100.10, 10.2.3.4")
	if got := clientIPFromRequest(trusted, proxies); !got.Equal(net.ParseIP("198.51.100.10")) {
		t.Fatalf("trusted proxy client IP = %v, want 198.51.100.10", got)
	}
}
