package handlers

import "testing"

func TestParseDirectoryPrice(t *testing.T) {
	tests := []struct {
		name      string
		value     string
		wantPrice *int64
		wantError bool
	}{
		{name: "empty price is omitted"},
		{name: "zero is a valid bound", value: "0", wantPrice: int64Pointer(0)},
		{name: "positive price", value: "12500", wantPrice: int64Pointer(12500)},
		{name: "non-numeric price", value: "abc", wantError: true},
		{name: "negative price", value: "-1", wantError: true},
		{name: "fractional cents", value: "1.5", wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gotPrice, err := parseDirectoryPrice(test.value)
			if (err != nil) != test.wantError {
				t.Fatalf("parseDirectoryPrice(%q) error = %v, wantError %v", test.value, err, test.wantError)
			}
			if test.wantPrice == nil {
				if gotPrice != nil {
					t.Fatalf("parseDirectoryPrice(%q) = %d, want nil", test.value, *gotPrice)
				}
				return
			}
			if gotPrice == nil || *gotPrice != *test.wantPrice {
				t.Fatalf("parseDirectoryPrice(%q) = %v, want %d", test.value, gotPrice, *test.wantPrice)
			}
		})
	}
}

func TestParseFeedCreatorID(t *testing.T) {
	tests := []struct {
		name      string
		value     string
		want      string
		wantError bool
	}{
		{name: "empty creator filter"},
		{
			name:  "valid creator UUID",
			value: "550E8400-E29B-41D4-A716-446655440000",
			want:  "550e8400-e29b-41d4-a716-446655440000",
		},
		{name: "invalid creator ID", value: "not-a-uuid", wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseFeedCreatorID(test.value)
			if (err != nil) != test.wantError {
				t.Fatalf("parseFeedCreatorID(%q) error = %v, wantError %v", test.value, err, test.wantError)
			}
			if got != test.want {
				t.Fatalf("parseFeedCreatorID(%q) = %q, want %q", test.value, got, test.want)
			}
		})
	}
}

func int64Pointer(value int64) *int64 {
	return &value
}
