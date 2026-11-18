package handlers

import (
	"testing"

	"chattie-backend/models"
)

func TestValidatePersonaRequestRequiresDiscoveryReadyData(t *testing.T) {
	latitude := -1.286389
	longitude := 36.817223
	payload := models.CreatePersonaRequest{
		Name:        "Nia",
		Archetype:   "Companion",
		AvatarURL:   "https://example.test/avatar.jpg",
		Bio:         "I enjoy music and weekend hikes.",
		Gender:      "Female",
		DateOfBirth: "1998-04-12",
		Height:      165,
		City:        "Nairobi",
		Country:     "Kenya",
		CountryCode: "ke",
		Latitude:    &latitude,
		Longitude:   &longitude,
		Interests:   []string{"Music", "Hiking", "Cooking"},
	}

	if err := validatePersonaRequest(&payload); err != nil {
		t.Fatalf("valid persona payload was rejected: %v", err)
	}
	if payload.Gender != "female" || payload.CountryCode != "KE" {
		t.Fatalf("persona payload was not normalized: gender=%q countryCode=%q", payload.Gender, payload.CountryCode)
	}
}

func TestValidatePersonaRequestRejectsDefaultZeroLocation(t *testing.T) {
	latitude := 0.0
	longitude := 0.0
	payload := models.CreatePersonaRequest{
		Name:        "Nia",
		Archetype:   "Companion",
		AvatarURL:   "https://example.test/avatar.jpg",
		Bio:         "I enjoy music and weekend hikes.",
		Gender:      "Female",
		DateOfBirth: "1998-04-12",
		Height:      165,
		City:        "Nairobi",
		Country:     "Kenya",
		CountryCode: "KE",
		Latitude:    &latitude,
		Longitude:   &longitude,
		Interests:   []string{"Music", "Hiking", "Cooking"},
	}

	if err := validatePersonaRequest(&payload); err == nil {
		t.Fatal("persona payload with the default 0,0 location was accepted")
	}
}
