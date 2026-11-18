package repository

import (
	"errors"
	"strings"
	"testing"
)

func TestNormalizeShowMePreference(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{input: "", want: "Everyone"},
		{input: "all", want: "Everyone"},
		{input: " male ", want: "Men"},
		{input: "WOMEN", want: "Women"},
		{input: "non-binary", want: "Other"},
	}

	for _, test := range tests {
		got, err := normalizeShowMePreference(test.input)
		if err != nil {
			t.Errorf("normalizeShowMePreference(%q) returned an error: %v", test.input, err)
			continue
		}
		if got != test.want {
			t.Errorf("normalizeShowMePreference(%q) = %q, want %q", test.input, got, test.want)
		}
	}

	if _, err := normalizeShowMePreference("unknown"); !errors.Is(err, ErrInvalidDiscoveryPreferences) {
		t.Fatalf("unsupported preference error = %v, want ErrInvalidDiscoveryPreferences", err)
	}
}

func TestNormalizeMatchingIntent(t *testing.T) {
	got, err := normalizeMatchingIntent("  DATING ")
	if err != nil {
		t.Fatalf("normalizeMatchingIntent returned an error: %v", err)
	}
	if got != "dating" {
		t.Fatalf("normalizeMatchingIntent = %q, want dating", got)
	}

	if _, err := normalizeMatchingIntent("men"); !errors.Is(err, ErrInvalidDiscoveryPreferences) {
		t.Fatalf("unsupported intent error = %v, want ErrInvalidDiscoveryPreferences", err)
	}
}

func TestNormalizeProfileGender(t *testing.T) {
	got, err := normalizeProfileGender("everyone")
	if err != nil {
		t.Fatalf("normalizeProfileGender returned an error: %v", err)
	}
	if got != "other" {
		t.Fatalf("normalizeProfileGender = %q, want other", got)
	}

	if _, err := normalizeProfileGender("unknown"); !errors.Is(err, ErrInvalidDiscoveryPreferences) {
		t.Fatalf("unsupported gender error = %v, want ErrInvalidDiscoveryPreferences", err)
	}
}

func TestTagCompatibilityScoreSQLUsesSymmetricTagSets(t *testing.T) {
	scoreSQL := tagCompatibilityScoreSQL("viewer_tags", "target_tags")
	for _, expected := range []string{
		"viewer_tags",
		"target_tags",
		"COUNT(DISTINCT LOWER(BTRIM(left_tag)))",
		"COUNT(DISTINCT LOWER(BTRIM(tag)))",
		"NULLIF((",
	} {
		if !strings.Contains(scoreSQL, expected) {
			t.Errorf("score SQL does not contain %q", expected)
		}
	}
}
