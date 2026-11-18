package handlers

import (
	"testing"
	"time"
)

func TestAdminFinancePeriodStart(t *testing.T) {
	now := time.Date(2026, time.November, 13, 14, 30, 0, 0, time.FixedZone("test", 3*60*60))
	tests := []struct {
		period string
		want   time.Time
		valid  bool
	}{
		{period: "7D", want: time.Date(2026, time.November, 7, 0, 0, 0, 0, now.Location()), valid: true},
		{period: "30D", want: time.Date(2026, time.October, 15, 0, 0, 0, 0, now.Location()), valid: true},
		{period: "90D", want: time.Date(2026, time.August, 16, 0, 0, 0, 0, now.Location()), valid: true},
		{period: "YTD", want: time.Date(2026, time.January, 1, 0, 0, 0, 0, now.Location()), valid: true},
		{period: "ALL", valid: false},
	}

	for _, test := range tests {
		t.Run(test.period, func(t *testing.T) {
			got, valid := adminFinancePeriodStart(test.period, now)
			if valid != test.valid {
				t.Fatalf("adminFinancePeriodStart() valid = %v, want %v", valid, test.valid)
			}
			if valid && !got.Equal(test.want) {
				t.Fatalf("adminFinancePeriodStart() = %v, want %v", got, test.want)
			}
		})
	}
}
