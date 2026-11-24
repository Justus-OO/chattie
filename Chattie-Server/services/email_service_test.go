package services

import "testing"

func TestBuildMessageUsesChattieSenderName(t *testing.T) {
	client := &EmailClient{From: "sender@example.com"}

	message, err := client.buildMessage("recipient@example.com", "Subject", "<p>Body</p>", nil)
	if err != nil {
		t.Fatalf("build email message: %v", err)
	}

	from := message.GetFrom()
	if len(from) != 1 {
		t.Fatalf("expected one From address, got %d", len(from))
	}
	if from[0].Name != "Chattie" {
		t.Errorf("expected sender name Chattie, got %q", from[0].Name)
	}
	if from[0].Address != client.From {
		t.Errorf("expected sender address %q, got %q", client.From, from[0].Address)
	}
}
