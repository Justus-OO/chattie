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

func TestParseFeedPagination(t *testing.T) {
	tests := []struct {
		name       string
		limit      string
		page       string
		offset     string
		wantLimit  int
		wantOffset int
		wantError  bool
	}{
		{name: "default pagination", wantLimit: 20},
		{name: "zero based page", limit: "8", page: "2", wantLimit: 8, wantOffset: 16},
		{name: "explicit offset", limit: "10", page: "2", offset: "7", wantLimit: 10, wantOffset: 7},
		{name: "zero limit", limit: "0", wantError: true},
		{name: "limit above maximum", limit: "51", wantError: true},
		{name: "malformed limit", limit: "many", wantError: true},
		{name: "negative page", page: "-1", wantError: true},
		{name: "page exceeds maximum offset", limit: "50", page: "20001", wantError: true},
		{name: "negative offset", offset: "-1", wantError: true},
		{name: "malformed offset", offset: "next", wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gotLimit, gotOffset, err := parseFeedPagination(test.limit, test.page, test.offset)
			if (err != nil) != test.wantError {
				t.Fatalf("parseFeedPagination() error = %v, wantError %v", err, test.wantError)
			}
			if err == nil && (gotLimit != test.wantLimit || gotOffset != test.wantOffset) {
				t.Fatalf("parseFeedPagination() = (%d, %d), want (%d, %d)", gotLimit, gotOffset, test.wantLimit, test.wantOffset)
			}
		})
	}
}

func int64Pointer(value int64) *int64 {
	return &value
}
