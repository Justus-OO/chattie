package middlewares

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// 1. Define a custom type for context keys to prevent collisions
type ContextKey string

// 2. Export context keys so your handlers and middlewares can use them
const (
	UserIDKey    ContextKey = "user_id"
	RoleKey      ContextKey = "role"
	SessionIDKey ContextKey = "session_id"
)

// AuthMiddleware validates the JWT token and injects user_id and role into context
func AuthMiddleware(next http.Handler) http.Handler {
	return authMiddleware(next, nil)
}

func AuthMiddlewareWithDB(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return authMiddleware(next, db)
	}
}

func authMiddleware(next http.Handler, db *sql.DB) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 1. Get the Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			println("AUTH ERROR: Missing Authorization header")
			http.Error(w, "Unauthorized: Missing Token", http.StatusUnauthorized)
			return
		}

		// 2. Extract the token from "Bearer <token>"
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			println("AUTH ERROR: Invalid token format")
			http.Error(w, "Unauthorized: Invalid Token Format", http.StatusUnauthorized)
			return
		}
		tokenString := parts[1]

		jwtSecret, err := configuredJWTSecret()
		if err != nil {
			http.Error(w, "Authentication is unavailable", http.StatusServiceUnavailable)
			return
		}

		// 3. Parse and validate the token
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, errors.New("unexpected signing method")
			}
			return jwtSecret, nil
		}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))

		if err != nil || !token.Valid {
			println("AUTH ERROR Failed to parse token:", err)
			http.Error(w, "Unauthorized: Invalid or Expired Token", http.StatusUnauthorized)
			return
		}

		// 4. Extract claims and inject user_id and role into the request context
		if claims, ok := token.Claims.(jwt.MapClaims); ok {
			userID, ok := claims["user_id"].(string)
			if !ok {
				println("AUTH ERROR: user_id claim is not a string")
				http.Error(w, "Unauthorized: Invalid Claims", http.StatusUnauthorized)
				return
			}
			if db != nil {
				tokenVersion, ok := claims["token_version"].(float64)
				if !ok {
					http.Error(w, "Unauthorized: Invalid Session", http.StatusUnauthorized)
					return
				}
				var currentVersion int64
				var accountStatus string
				if err := db.QueryRowContext(r.Context(), `SELECT token_version, status FROM users WHERE id = $1`, userID).Scan(&currentVersion, &accountStatus); err != nil || int64(tokenVersion) != currentVersion {
					http.Error(w, "Unauthorized: Session expired", http.StatusUnauthorized)
					return
				}
				if accountStatus == "banned" && r.URL.Path != "/api/account-review" {
					http.Error(w, "Account restricted: review required", http.StatusForbidden)
					return
				}
				if sessionID, ok := claims["session_id"].(string); ok && sessionID != "" {
					var active bool
					if err := db.QueryRowContext(r.Context(), `
						SELECT EXISTS (
							SELECT 1 FROM auth_sessions
							WHERE id = $1 AND user_id = $2 AND token_version = $3
							  AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
						)
					`, sessionID, userID, int64(tokenVersion)).Scan(&active); err != nil || !active {
						http.Error(w, "Unauthorized: Session revoked or expired", http.StatusUnauthorized)
						return
					}
					_, _ = db.ExecContext(r.Context(), `
						UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP
						WHERE id = $1 AND user_id = $2
						  AND last_seen_at < CURRENT_TIMESTAMP - INTERVAL '2 minutes'
					`, sessionID, userID)
				}
			}

			// Extract role claim (defaulting to 'client' if missing)
			role, _ := claims["role"].(string)
			if role == "" {
				role = "client"
			}

			// 5. Inject both keys into context
			ctx := context.WithValue(r.Context(), UserIDKey, userID)
			ctx = context.WithValue(ctx, RoleKey, role)
			if sessionID, ok := claims["session_id"].(string); ok && sessionID != "" {
				ctx = context.WithValue(ctx, SessionIDKey, sessionID)
			}

			next.ServeHTTP(w, r.WithContext(ctx))
		} else {
			println("AUTH ERROR: Failed to map claims")
			http.Error(w, "Unauthorized: Invalid Claims", http.StatusUnauthorized)
		}
	})
}

func GenerateAuthToken(userID, role string, tokenVersion int64) (string, error) {
	return GenerateAuthTokenWithSession(userID, role, tokenVersion, "")
}

func GenerateAuthTokenWithSession(userID, role string, tokenVersion int64, sessionID string) (string, error) {
	jwtSecret, err := configuredJWTSecret()
	if err != nil {
		return "", err
	}
	claims := jwt.MapClaims{
		"user_id":       userID,
		"role":          role,
		"token_version": tokenVersion,
		"exp":           time.Now().Add(72 * time.Hour).Unix(),
	}
	if sessionID != "" {
		claims["session_id"] = sessionID
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func ParseAuthToken(tokenString string) (string, string, error) {
	jwtSecret, err := configuredJWTSecret()
	if err != nil {
		return "", "", err
	}
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return jwtSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil || token == nil || !token.Valid {
		if err == nil {
			err = errors.New("invalid token")
		}
		return "", "", err
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", "", errors.New("invalid token claims")
	}
	userID, ok := claims["user_id"].(string)
	if !ok || userID == "" {
		return "", "", errors.New("token is missing user_id")
	}
	role, _ := claims["role"].(string)
	return userID, role, nil
}

func ParseAuthTokenWithDB(ctx context.Context, tokenString string, db *sql.DB) (string, string, error) {
	userID, role, err := ParseAuthToken(tokenString)
	if err != nil {
		return "", "", err
	}

	jwtSecret, err := configuredJWTSecret()
	if err != nil {
		return "", "", err
	}
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil || token == nil || !token.Valid {
		return "", "", errors.New("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", "", errors.New("invalid token claims")
	}
	tokenVersion, ok := claims["token_version"].(float64)
	if !ok {
		return "", "", errors.New("token is missing token_version")
	}

	var currentVersion int64
	var accountStatus string
	if err := db.QueryRowContext(ctx, `SELECT token_version, status FROM users WHERE id = $1`, userID).Scan(&currentVersion, &accountStatus); err != nil {
		return "", "", err
	}
	if int64(tokenVersion) != currentVersion {
		return "", "", errors.New("session expired")
	}
	if accountStatus == "banned" {
		return "", "", errors.New("account restricted")
	}

	if sessionID, ok := claims["session_id"].(string); ok && sessionID != "" {
		var active bool
		if err := db.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM auth_sessions
				WHERE id = $1 AND user_id = $2 AND token_version = $3
				  AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
			)
		`, sessionID, userID, int64(tokenVersion)).Scan(&active); err != nil {
			return "", "", err
		}
		if !active {
			return "", "", errors.New("session revoked or expired")
		}
	}
	return userID, role, nil
}

func configuredJWTSecret() ([]byte, error) {
	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if len([]byte(secret)) < 32 {
		return nil, errors.New("JWT_SECRET must contain at least 32 bytes")
	}
	return []byte(secret), nil
}

// RequireRole ensures the authenticated user has the specified role (e.g., 'model')
func RequireRole(requiredRole string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role, ok := r.Context().Value(RoleKey).(string)
			if !ok || role != requiredRole {
				http.Error(w, "Forbidden: Access restricted to creators", http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
