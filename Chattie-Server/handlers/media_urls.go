package handlers

import (
	"context"
	"fmt"
	"strings"
	"time"

	"chattie-backend/models"
	"chattie-backend/services"
)

func presignMediaURL(ctx context.Context, storage *services.UploadService, mediaURL string) (string, error) {
	if mediaURL == "" {
		return "", nil
	}
	if storage == nil || storage.PublicURL == "" {
		return "", fmt.Errorf("media storage is unavailable")
	}

	if strings.HasPrefix(mediaURL, strings.TrimRight(storage.PublicURL, "/")+"/") {
		return storage.ReadURL(ctx, mediaURL, 10*time.Minute)
	}
	return mediaURL, nil
}

func presignPerformerProfileMedia(ctx context.Context, storage *services.UploadService, profile *models.PerformerProfile) error {
	var err error
	if profile.AvatarURL, err = presignMediaURL(ctx, storage, profile.AvatarURL); err != nil {
		return fmt.Errorf("sign creator avatar: %w", err)
	}
	if profile.CoverURL, err = presignMediaURL(ctx, storage, profile.CoverURL); err != nil {
		return fmt.Errorf("sign creator cover: %w", err)
	}
	return nil
}
