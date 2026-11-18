package repository

import "testing"

func TestUSDMinorFromKESMinor(t *testing.T) {
	tests := []struct {
		name     string
		kesMinor int64
		rate     float64
		want     int64
		wantErr  bool
	}{
		{name: "exact conversion", kesMinor: 13000, rate: 130, want: 100},
		{name: "rounds to nearest cent", kesMinor: 10000, rate: 130, want: 77},
		{name: "half cent rounds up", kesMinor: 65, rate: 130, want: 1},
		{name: "rejects zero KES amount", kesMinor: 0, rate: 130, wantErr: true},
		{name: "rejects invalid rate", kesMinor: 13000, rate: 0, wantErr: true},
		{name: "rejects result below one cent", kesMinor: 1, rate: 130, wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := usdMinorFromKESMinor(test.kesMinor, test.rate)
			if (err != nil) != test.wantErr {
				t.Fatalf("usdMinorFromKESMinor() error = %v, wantErr %v", err, test.wantErr)
			}
			if err == nil && got != test.want {
				t.Fatalf("usdMinorFromKESMinor() = %d, want %d", got, test.want)
			}
		})
	}
}
