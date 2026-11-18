package services

import "testing"

func TestRouteCountryUsesKenyanProviderOnlyForKenya(t *testing.T) {
	stripe := &StripeGateway{}
	paystack := &PaystackGateway{}
	router := NewBillingRouter(stripe, paystack)

	if got := router.RouteCountry("KE"); got != paystack {
		t.Fatal("Kenya should use Paystack")
	}
	for _, code := range []string{"US", "UG", ""} {
		if got := router.RouteCountry(code); got != stripe {
			t.Errorf("country %q should use Stripe", code)
		}
	}
	if got := router.RouteCountry("ke "); got != paystack {
		t.Fatal("country codes should be normalized before routing")
	}
}
