package services

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nicksnyder/go-i18n/v2/i18n"
	"golang.org/x/text/language"
)

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
