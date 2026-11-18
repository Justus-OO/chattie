package repository

import (
	"errors"
	"testing"
	"time"

	"chattie-backend/models"
)

func TestValidateOnboardingProfileRequiresAdultCompleteProfile(t *testing.T) {
	profile := &models.UserProfile{
		DisplayName: "Alex",
		DateOfBirth: time.Now().UTC().AddDate(-30, 0, 0).Format("2006-01-02"),
		Gender:      "male",
		Bio:         "I enjoy meeting people.",
		HeightCm:    170,
	}
	if err := validateOnboardingProfile(profile); err != nil {
		t.Fatalf("valid onboarding profile rejected: %v", err)
	}

	profile.DateOfBirth = time.Now().UTC().AddDate(-17, 0, 0).Format("2006-01-02")
	if err := validateOnboardingProfile(profile); !errors.Is(err, ErrInvalidOnboardingProfile) {
		t.Fatalf("underage profile error = %v, want ErrInvalidOnboardingProfile", err)
	}

	profile.DateOfBirth = time.Now().UTC().AddDate(-30, 0, 0).Format("2006-01-02")
	profile.Bio = "short"
	if err := validateOnboardingProfile(profile); !errors.Is(err, ErrInvalidOnboardingProfile) {
		t.Fatalf("short bio error = %v, want ErrInvalidOnboardingProfile", err)
	}
}

func TestNormalizeOnboardingTagsRequiresThreeToSevenUniqueTags(t *testing.T) {
	tags, err := NormalizeOnboardingTags([]string{" Coffee ", "coffee", "Music", "Art"})
	if err != nil {
		t.Fatalf("NormalizeOnboardingTags returned an error: %v", err)
	}
	if len(tags) != 3 || tags[0] != "Coffee" {
		t.Fatalf("normalized tags = %#v, want three unique trimmed tags", tags)
	}

	if _, err := NormalizeOnboardingTags([]string{"Coffee", "Music"}); !errors.Is(err, ErrInvalidDiscoveryPreferences) {
		t.Fatalf("two-tag error = %v, want ErrInvalidDiscoveryPreferences", err)
	}
}
