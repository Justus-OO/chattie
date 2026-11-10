package middlewares

import (
	"database/sql"
	"net/http"
)

// IPBanMiddleware blocks any requests originating from a blacklisted IP address.
func IPBanMiddleware(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Extract IP (handling reverse proxies if necessary)
			ip := r.RemoteAddr
			if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
				ip = forwarded
			}

			// Clean port from IP if present (e.g., "192.168.1.1:54321" -> "192.168.1.1")
			if colonIndex := len(ip) - 1; colonIndex > 0 {
				for i := len(ip) - 1; i >= 0; i-- {
					if ip[i] == ':' {
						ip = ip[:i]
						break
					}
				}
			}

			// Check if IP is in the banned table
			var exists bool
			err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM banned_ips WHERE ip_address = $1)", ip).Scan(&exists)
			if err == nil && exists {
				http.Error(w, "Access Denied: Your IP address has been permanently banned.", http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
