package handlers

import (
	"context"

	"chattie-backend/services"
	"github.com/nicksnyder/go-i18n/v2/i18n"
)

func localizedMessage(ctx context.Context, messageID string, fallback string, templateData map[string]interface{}) string {
	message, err := services.GetLocalizer(ctx).Localize(&i18n.LocalizeConfig{
		MessageID: messageID,
		DefaultMessage: &i18n.Message{
			ID:    messageID,
			Other: fallback,
		},
		TemplateData: templateData,
	})
	if err != nil {
		return fallback
	}
	return message
}

func localized(ctx context.Context, messageID string, fallback string) string {
	return localizedMessage(ctx, messageID, fallback, nil)
}