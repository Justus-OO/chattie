package services

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"chattie-backend/models"
)

func FormatChatContext(messages []models.Message, userID string, maxMessages, maxRunesPerMessage int) string {
	start := len(messages) - maxMessages
	if start < 0 {
		start = 0
	}

	type contextMessage struct {
		Speaker string `json:"speaker"`
		Text    string `json:"text"`
	}
	contextMessages := make([]contextMessage, 0, len(messages)-start)
	for _, message := range messages[start:] {
		text := strings.TrimSpace(message.Content)
		if text == "" {
			continue
		}
		if maxRunesPerMessage > 0 && utf8.RuneCountInString(text) > maxRunesPerMessage {
			text = string([]rune(text)[:maxRunesPerMessage])
		}
		speaker := "partner"
		if message.SenderID == userID {
			speaker = "you"
		}
		contextMessages = append(contextMessages, contextMessage{Speaker: speaker, Text: text})
	}
	encodedContext, _ := json.Marshal(contextMessages)
	return string(encodedContext)
}
