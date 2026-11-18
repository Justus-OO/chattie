package handlers

import (
	"strings"
	"testing"

	"chattie-backend/models"
)

func TestValidateManagedProfileDetails(t *testing.T) {
	tests := []struct {
		name    string
		payload models.UpdateManagedProfileRequest
		wantErr bool
	}{
		{
			name:    "valid profile",
			payload: models.UpdateManagedProfileRequest{Name: "Taylor", AvatarURL: "https://cdn.example.com/avatar.jpg", Bio: "Hello"},
		},
		{
			name:    "short name",
			payload: models.UpdateManagedProfileRequest{Name: "A", AvatarURL: "https://cdn.example.com/avatar.jpg"},
			wantErr: true,
		},
		{
			name:    "non-https avatar",
			payload: models.UpdateManagedProfileRequest{Name: "Taylor", AvatarURL: "http://cdn.example.com/avatar.jpg"},
			wantErr: true,
		},
		{
			name:    "avatar with credentials",
			payload: models.UpdateManagedProfileRequest{Name: "Taylor", AvatarURL: "https://user:pass@cdn.example.com/avatar.jpg"},
			wantErr: true,
		},
		{
			name:    "bio too long",
			payload: models.UpdateManagedProfileRequest{Name: "Taylor", AvatarURL: "https://cdn.example.com/avatar.jpg", Bio: strings.Repeat("a", 501)},
			wantErr: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateManagedProfileDetails(test.payload)
			if (err != nil) != test.wantErr {
				t.Fatalf("validateManagedProfileDetails() error = %v, wantErr %v", err, test.wantErr)
			}
		})
	}
}
