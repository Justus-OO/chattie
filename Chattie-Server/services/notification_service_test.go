package services

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nicksnyder/go-i18n/v2/i18n"
	"golang.org/x/text/language"
)

func TestAbsolutizeEmailActionURLUsesConfiguredFrontendURL(t *testing.T) {
	t.Setenv("FRONTEND_URL", "https://app.example")
	templateData := map[string]interface{}{
		"ActionURL": "/support?ticket=123&source=email",
		"Username":  "Alex",
	}

	normalized, err := absolutizeEmailActionURL(templateData)
	if err != nil {
		t.Fatalf("absolutize email action URL: %v", err)
	}
	normalizedData := normalized.(map[string]interface{})
	if got, want := normalizedData["ActionURL"], "https://app.example/support?ticket=123&source=email"; got != want {
		t.Errorf("ActionURL = %q, want %q", got, want)
	}
	if templateData["ActionURL"] != "/support?ticket=123&source=email" {
		t.Errorf("input template data was mutated: %q", templateData["ActionURL"])
	}
	if normalizedData["Username"] != templateData["Username"] {
		t.Errorf("unrelated template data changed: %q", normalizedData["Username"])
	}
}

func TestResolveEmailActionURLUsesChattieDefault(t *testing.T) {
	t.Setenv("FRONTEND_URL", "")

	got, err := resolveEmailActionURL("/notifications")
	if err != nil {
		t.Fatalf("resolve email action URL: %v", err)
	}
	if want := "https://chattie.app/notifications"; got != want {
		t.Errorf("resolved URL = %q, want %q", got, want)
	}
}

func TestResolveEmailActionURLRejectsUnsafeOrUnrelatedURLs(t *testing.T) {
	t.Setenv("FRONTEND_URL", "https://app.example")
	tests := []struct {
		name string
		url  string
	}{
		{name: "empty", url: ""},
		{name: "relative path", url: "relative/path"},
		{name: "protocol-relative URL", url: "//app.example/support"},
		{name: "javascript URL", url: "javascript:alert(1)"},
		{name: "different origin", url: "https://other.example/support"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := resolveEmailActionURL(test.url); err == nil {
				t.Errorf("expected %q to be rejected", test.url)
			}
		})
	}
}

func TestLocalizeSupportTicketEmailKeepsAdminLabelForAbsoluteActionURL(t *testing.T) {
	testBundle := loadTestLocaleBundle(t)
	ctx := context.WithValue(
		context.Background(),
		localizerKey,
		i18n.NewLocalizer(testBundle, "en"),
	)
	_, body, err := localizeSupportTicketEmail(ctx, map[string]interface{}{
		"TicketSubject": "Question",
		"TicketStatus":  "open",
		"ActionURL":     "https://chattie.app/admin/support",
	})
	if err != nil {
		t.Fatalf("localize admin support email: %v", err)
	}
	if !strings.Contains(body, "Open support inbox") {
		t.Errorf("admin support email has incorrect action label: %s", body)
	}
}

func TestLocalizeSupportTicketEmailUsesLocaleAndEscapesValues(t *testing.T) {
	testBundle := loadTestLocaleBundle(t)
	ctx := context.WithValue(
		context.Background(),
		localizerKey,
		i18n.NewLocalizer(testBundle, "sw", "en"),
	)
	subject, body, err := localizeSupportTicketEmail(ctx, map[string]interface{}{
		"TicketSubject": "<img src=x onerror=alert(1)>",
		"TicketStatus":  "waiting_human",
		"ActionURL":     "/support?next=home&admin=1",
	})
	if err != nil {
		t.Fatalf("localize support ticket email: %v", err)
	}
	if subject != "Taarifa kuhusu ombi lako la usaidizi la Chattie" {
		t.Fatalf("unexpected localized subject: %q", subject)
	}
	for _, expected := range []string{
		"&lt;img src=x onerror=alert(1)&gt;",
		"Linasubiri msaidizi",
		"/support?next=home&amp;admin=1",
		"Fungua usaidizi",
	} {
		if !strings.Contains(body, expected) {
			t.Errorf("email body does not contain %q: %s", expected, body)
		}
	}
	if strings.Contains(body, "[[") {
		t.Errorf("email body contains an unresolved placeholder: %s", body)
	}

	for _, locale := range supportedTestLocales() {
		if locale == "en" {
			continue
		}
		translatedSubject, translatedBody, err := localizeSupportTicketEmail(context.WithValue(
			context.Background(),
			localizerKey,
			i18n.NewLocalizer(testBundle, locale, "en"),
		), map[string]interface{}{
			"TicketSubject": "Question",
			"TicketStatus":  "open",
			"ActionURL":     "/support",
		})
		if err != nil {
			t.Errorf("localize support ticket email for %s: %v", locale, err)
			continue
		}
		if translatedSubject == "Update to your Chattie support ticket" {
			t.Errorf("support email subject for %s fell back to English", locale)
		}
		if strings.Contains(translatedBody, "[[") {
			t.Errorf("support email body for %s contains unresolved placeholders", locale)
		}
	}
}

func TestSupportMessagesAreTranslatedInEveryLocale(t *testing.T) {
	testBundle := loadTestLocaleBundle(t)
	messageIDs := []string{
		"SupportTicketEmailSubject",
		"SupportTicketEmailBody",
		"SupportStatusOpen",
		"SupportStatusWaitingHuman",
		"SupportStatusInProgress",
		"SupportStatusResolved",
		"SupportEmailOpen",
		"SupportEmailOpenAdmin",
		"SupportNotificationAdminTitle",
		"SupportNotificationOwnerTitle",
		"SupportNotificationNewTicket",
		"SupportNotificationUserReply",
		"SupportNotificationHumanRequest",
		"SupportNotificationAgentReply",
		"SupportNotificationStatusChanged",
		"SupportNotificationUserClosed",
		"SupportNotificationUserReopened",
		"SupportErrLoadTickets",
		"SupportErrInvalidTicketRequest",
		"SupportErrSubjectMessageRequired",
		"SupportErrCreateTicket",
		"SupportErrReloadMessages",
		"SupportErrInvalidTicket",
		"SupportErrLoadConversation",
		"SupportErrInvalidMessage",
		"SupportErrMessageRequired",
		"SupportErrReloadTicket",
		"SupportErrAIContext",
		"SupportErrReloadConversation",
		"SupportErrHandoffReloadTicket",
		"SupportErrHandoffReloadConversation",
		"SupportErrLoadQueue",
		"SupportErrUnauthorized",
		"SupportErrReplyReloadTicket",
		"SupportErrInvalidStatus",
		"SupportErrUserStatusRestricted",
		"SupportErrStatusReloadTicket",
		"SupportErrTicketNotFound",
		"SupportErrTicketResolved",
		"SupportErrRequestFailed",
		"SupportAIUnavailable",
		"SupportAIPrepareError",
		"SupportAIRespondError",
		"SupportAIClassifyError",
		"SupportAIInvalidCategory",
		"SupportAIInvalidResponse",
		"SupportAISortSaveFailed",
		"SupportAISaveResponseFailed",
		"SupportAIStatusUpdateFailed",
	}

	localize := func(locale, messageID string) (string, error) {
		return i18n.NewLocalizer(testBundle, locale).Localize(&i18n.LocalizeConfig{
			MessageID:    messageID,
			TemplateData: map[string]interface{}{"Status": "resolved"},
		})
	}
	for _, messageID := range messageIDs {
		english, err := localize("en", messageID)
		if err != nil {
			t.Fatalf("localize English message %s: %v", messageID, err)
		}
		for _, locale := range supportedTestLocales() {
			if locale == "en" {
				continue
			}
			translated, err := localize(locale, messageID)
			if err != nil {
				t.Errorf("localize %s message %s: %v", locale, messageID, err)
				continue
			}
			if translated == "" || translated == english || strings.Contains(translated, "{{.") {
				t.Errorf("message %s is untranslated or has an unresolved template in %s: %q", messageID, locale, translated)
			}
		}
	}
}

func TestLocaleCatalogsCoverEveryEnglishMessage(t *testing.T) {
	readCatalog := func(locale string) map[string]string {
		t.Helper()
		data, err := os.ReadFile(filepath.Join("..", "locales", locale+".json"))
		if err != nil {
			t.Fatalf("read %s locale: %v", locale, err)
		}
		var catalog map[string]string
		if err := json.Unmarshal(data, &catalog); err != nil {
			t.Fatalf("decode %s locale: %v", locale, err)
		}
		return catalog
	}

	english := readCatalog("en")
	for _, locale := range supportedTestLocales() {
		if locale == "en" {
			continue
		}
		translated := readCatalog(locale)
		for messageID := range english {
			if strings.TrimSpace(translated[messageID]) == "" {
				t.Errorf("%s locale is missing translation for %s", locale, messageID)
			}
		}
		for messageID := range translated {
			if _, exists := english[messageID]; !exists {
				t.Errorf("%s locale contains message %s without an English source", locale, messageID)
			}
		}
	}
}

func loadTestLocaleBundle(t *testing.T) *i18n.Bundle {
	t.Helper()
	testBundle := i18n.NewBundle(language.English)
	testBundle.RegisterUnmarshalFunc("json", json.Unmarshal)
	for _, locale := range supportedTestLocales() {
		if _, err := testBundle.LoadMessageFile(filepath.Join("..", "locales", locale+".json")); err != nil {
			t.Fatalf("load %s locale: %v", locale, err)
		}
	}
	return testBundle
}

func supportedTestLocales() []string {
	return []string{"en", "es", "fr", "de", "pt", "ja", "sw", "hi", "zh-CN"}
}
