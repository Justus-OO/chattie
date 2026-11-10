package services

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/nicksnyder/go-i18n/v2/i18n"
	"golang.org/x/text/language"
)

type contextKey string

const localizerKey contextKey = "localizer"

var bundle *i18n.Bundle

// InitI18n loads the translation files into RAM on startup
func InitI18n() error {
	// Default language is English
	bundle = i18n.NewBundle(language.English)
	bundle.RegisterUnmarshalFunc("json", json.Unmarshal)

	// Load every locale file present in the configured locales directory.
	files, err := filepath.Glob(filepath.Join("locales", "*.json"))
	if err != nil {
		return err
	}
	for _, path := range files {
		if _, err := os.Stat(path); err == nil {
			bundle.MustLoadMessageFile(path)
		}
	}
	return nil
}

// I18nMiddleware intercepts HTTP requests to set up the localizer
func I18nMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lang := r.Header.Get("Accept-Language")

		// Create a localizer specifically for this request's language
		localizer := i18n.NewLocalizer(bundle, lang, language.English.String())

		// Inject it into the context
		ctx := context.WithValue(r.Context(), localizerKey, localizer)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetLocalizer retrieves the localizer from the context inside your handlers
func GetLocalizer(ctx context.Context) *i18n.Localizer {
	loc, ok := ctx.Value(localizerKey).(*i18n.Localizer)
	if !ok {
		// Fallback to English if something goes wrong
		return i18n.NewLocalizer(bundle, language.English.String())
	}
	return loc
}

// GetOfflineLocalizer is used by background workers (Cron/Email) using DB user settings
func GetOfflineLocalizer(langCode string) *i18n.Localizer {
	return i18n.NewLocalizer(bundle, langCode, language.English.String())
}
