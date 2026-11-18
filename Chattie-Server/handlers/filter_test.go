package handlers

import (
	"strings"
	"testing"
)

func TestMaskSocialInfo(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantFlagged bool
		wantParts   []string
	}{
		{
			name:        "social platform and handle",
			input:       "Find me on Instagram at @sample.person",
			wantFlagged: true,
			wantParts:   []string{"***", "[REDACTED SOCIAL HANDLE]"},
		},
		{
			name:        "social link",
			input:       "https://t.me/sampleuser",
			wantFlagged: true,
			wantParts:   []string{"[REDACTED SOCIAL LINK]"},
		},
		{
			name:        "Kenyan international phone number",
			input:       "Call me at +254 712 345 678",
			wantFlagged: true,
			wantParts:   []string{"[REDACTED NUMBER]"},
		},
		{
			name:        "ordinary conversation",
			input:       "I like reading and hiking",
			wantFlagged: false,
			wantParts:   []string{"I like reading and hiking"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, flagged := MaskSocialInfo(test.input)
			if flagged != test.wantFlagged {
				t.Fatalf("MaskSocialInfo flagged = %v, want %v", flagged, test.wantFlagged)
			}
			for _, part := range test.wantParts {
				if !strings.Contains(got, part) {
					t.Fatalf("MaskSocialInfo() = %q, want it to contain %q", got, part)
				}
			}
		})
	}
}
