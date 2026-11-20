package middlewares

import (
	"database/sql"
	"log"
	"net/http"
	"os"
)

// IPBanMiddleware blocks any requests originating from a blacklisted IP address.
func IPBanMiddleware(db *sql.DB) func(http.Handler) http.Handler {
	trustedProxies, err := parseTrustedProxyCIDRs(os.Getenv("TRUSTED_PROXY_CIDRS"))
	if err != nil {
		log.Printf("Invalid TRUSTED_PROXY_CIDRS configuration; IP forwarding headers will not be trusted: %v", err)
		trustedProxies = nil
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var ruleActive bool
			if err := db.QueryRowContext(r.Context(), `
				SELECT is_active FROM firewall_rules WHERE id = 'RUL_1'
			`).Scan(&ruleActive); err != nil && err != sql.ErrNoRows {
				log.Printf("Could not load banned-IP firewall rule: %v", err)
				http.Error(w, "Firewall policy is unavailable", http.StatusServiceUnavailable)
				return
			}
			if !ruleActive {
				next.ServeHTTP(w, r)
				return
			}
			ip := clientIPFromRequest(r, trustedProxies)
			if ip == nil {
				next.ServeHTTP(w, r)
				return
			}
			var exists bool
			if err := db.QueryRowContext(r.Context(), `
				SELECT EXISTS (SELECT 1 FROM banned_ips WHERE ip_address = $1)
			`, ip.String()).Scan(&exists); err != nil {
				log.Printf("Could not check banned IP address: %v", err)
				http.Error(w, "Firewall policy is unavailable", http.StatusServiceUnavailable)
				return
			}
			if exists {
				http.Error(w, "Access Denied: Your IP address has been permanently banned.", http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
