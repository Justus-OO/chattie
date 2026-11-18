package handlers

import (
	"testing"

	"chattie-backend/models"
)

func TestRedactSecretAdmirersRemovesIdentityAndProfileData(t *testing.T) {
	profiles := []models.DiscoverProfile{{
		ID:          "user-id",
		DisplayName: "Example User",
		Bio:         "private bio",
		Age:         29,
		City:        "Nairobi",
		Distance:    1.2,
		MatchPct:    88,
		Tags:        []string{"music"},
		Images:      []string{"https://example.test/photo.jpg"},
		Intent:      "Dating",
		IsNew:       true,
	}}

	redactSecretAdmirers(profiles)

	if len(profiles) != 1 {
		t.Fatalf("expected count to be preserved, got %d", len(profiles))
	}
	profile := profiles[0]
	if profile.ID != "" || profile.DisplayName != "Hidden Identity" || profile.Bio != "" || profile.Age != 0 {
		t.Fatalf("identity data was not redacted: %+v", profile)
	}
	if profile.City != "Nearby" || profile.Distance != 9999 || profile.MatchPct != 0 || profile.Intent != "" || profile.IsNew {
		t.Fatalf("profile metadata was not redacted: %+v", profile)
	}
	if len(profile.Tags) != 0 || len(profile.Images) != 0 {
		t.Fatalf("profile media or tags were not redacted: %+v", profile)
	}
}
