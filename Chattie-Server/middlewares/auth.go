package middlewares

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// 1. Define a custom type for context keys to prevent collisions
type ContextKey string

// 2. Export context keys so your handlers and middlewares can use them
const (
	UserIDKey ContextKey = "user_id"
	RoleKey   ContextKey = "role"
)

var jwtSecret = []byte("super_secret_chattie_key_do_not_leak")

// AuthMiddleware validates the JWT token and injects user_id and role into context
func AuthMiddleware(next http.Handler) http.Handler {
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

		// 3. Parse and validate the token
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, http.ErrAbortHandler
			}
			return jwtSecret, nil
		})

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

			// Extract role claim (defaulting to 'client' if missing)
			role, _ := claims["role"].(string)
			if role == "" {
				role = "client"
			}

			// 5. Inject both keys into context
			ctx := context.WithValue(r.Context(), UserIDKey, userID)
			ctx = context.WithValue(ctx, RoleKey, role)

			next.ServeHTTP(w, r.WithContext(ctx))
		} else {
			println("AUTH ERROR: Failed to map claims")
			http.Error(w, "Unauthorized: Invalid Claims", http.StatusUnauthorized)
		}
	})
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
