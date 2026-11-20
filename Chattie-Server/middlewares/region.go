package middlewares

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
)

const CountryCodeKey ContextKey = "country_code"

func CountryCodeFromContext(ctx context.Context) string {
	code, _ := ctx.Value(CountryCodeKey).(string)
	return code
}

func RegionalAccessMiddleware(db *sql.DB) func(http.Handler) http.Handler {
	trustedProxies, err := parseTrustedProxyCIDRs(os.Getenv("TRUSTED_PROXY_CIDRS"))
	if err != nil {
		log.Printf("Invalid TRUSTED_PROXY_CIDRS configuration; country headers will not be trusted: %v", err)
		trustedProxies = nil
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			countryCode := trustedCountryCode(r, trustedProxies)
			if countryCode != "" {
				r = r.WithContext(context.WithValue(r.Context(), CountryCodeKey, countryCode))
			}
			if countryCode != "" && !strings.HasPrefix(r.URL.Path, "/api/admin") {
				blocked, err := isCountryBlocked(r.Context(), db, countryCode)
				if err != nil {
					log.Printf("Could not check country access for %s: %v", countryCode, err)
					writeRegionError(w, http.StatusInternalServerError, "Could not verify regional access")
					return
				}
				if blocked {
					writeRegionError(w, http.StatusUnavailableForLegalReasons, "This service is not available in your country")
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func RegionalUserMiddleware(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, _ := r.Context().Value(UserIDKey).(string)
			role, _ := r.Context().Value(RoleKey).(string)
			if userID == "" || role == "admin" {
				next.ServeHTTP(w, r)
				return
			}

			countryCode := CountryCodeFromContext(r.Context())
			if countryCode != "" {
				_, err := db.ExecContext(r.Context(), `
					INSERT INTO user_locations (user_id, country_code)
					VALUES ($1, $2)
					ON CONFLICT (user_id) DO UPDATE SET
						country_code = EXCLUDED.country_code,
						last_updated = CURRENT_TIMESTAMP
					WHERE user_locations.country_code IS DISTINCT FROM EXCLUDED.country_code
				`, userID, countryCode)
				if err != nil {
					log.Printf("Could not save country for user %s: %v", userID, err)
					writeRegionError(w, http.StatusInternalServerError, "Could not save regional settings")
					return
				}
			} else if err := db.QueryRowContext(r.Context(), `
				SELECT COALESCE(country_code, '')
				FROM user_locations
				WHERE user_id = $1
			`, userID).Scan(&countryCode); err != nil && err != sql.ErrNoRows {
				log.Printf("Could not load country for user %s: %v", userID, err)
				writeRegionError(w, http.StatusInternalServerError, "Could not load regional settings")
				return
			}

			if countryCode != "" {
				blocked, err := isCountryBlocked(r.Context(), db, countryCode)
				if err != nil {
					log.Printf("Could not check stored country for user %s: %v", userID, err)
					writeRegionError(w, http.StatusInternalServerError, "Could not verify regional access")
					return
				}
				if blocked {
					writeRegionError(w, http.StatusUnavailableForLegalReasons, "This service is not available in your country")
					return
				}
				r = r.WithContext(context.WithValue(r.Context(), CountryCodeKey, countryCode))
			}
			next.ServeHTTP(w, r)
		})
	}
}

func isCountryBlocked(ctx context.Context, db *sql.DB, countryCode string) (bool, error) {
	var blocked bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM regional_country_blocks WHERE country_code = $1
		)
	`, countryCode).Scan(&blocked)
	return blocked, err
}

func writeRegionError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func parseTrustedProxyCIDRs(value string) ([]*net.IPNet, error) {
	var ranges []*net.IPNet
	for _, entry := range strings.Split(value, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		_, network, err := net.ParseCIDR(entry)
		if err != nil {
			return nil, err
		}
		ranges = append(ranges, network)
	}
	return ranges, nil
}

func trustedCountryCode(r *http.Request, trustedProxies []*net.IPNet) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return ""
	}
	trusted := false
	for _, network := range trustedProxies {
		if network.Contains(ip) {
			trusted = true
			break
		}
	}
	if !trusted {
		return ""
	}

	code := strings.ToUpper(strings.TrimSpace(r.Header.Get("CF-IPCountry")))
	if !validCountryCode(code) {
		code = strings.ToUpper(strings.TrimSpace(r.Header.Get("X-Country-Code")))
	}
	if !validCountryCode(code) {
		return ""
	}
	return code
}

func clientIPFromRequest(r *http.Request, trustedProxies []*net.IPNet) net.IP {
	remoteHost, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remoteHost = r.RemoteAddr
	}
	remoteIP := net.ParseIP(remoteHost)
	if remoteIP == nil || !isTrustedProxy(remoteIP, trustedProxies) {
		return remoteIP
	}

	chain := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(chain) - 1; i >= 0; i-- {
		candidate := net.ParseIP(strings.TrimSpace(chain[i]))
		if candidate == nil {
			return remoteIP
		}
		if !isTrustedProxy(candidate, trustedProxies) {
			return candidate
		}
	}
	if len(chain) > 0 {
		return net.ParseIP(strings.TrimSpace(chain[0]))
	}
	return remoteIP
}

func isTrustedProxy(ip net.IP, trustedProxies []*net.IPNet) bool {
	for _, network := range trustedProxies {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func validCountryCode(code string) bool {
	if len(code) != 2 || code == "XX" || code == "T1" {
		return false
	}
	return code[0] >= 'A' && code[0] <= 'Z' &&
		code[1] >= 'A' && code[1] <= 'Z'
}
