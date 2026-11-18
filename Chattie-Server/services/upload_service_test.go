package services

import (
	"context"
	"testing"
	"time"
)

func TestReadURLReturnsCanonicalURLForPublicBucket(t *testing.T) {
	storage := &UploadService{PublicBucket: true}
	rawURL := "https://cdn.example.test/bucket/photo.jpg"

	got, err := storage.ReadURL(context.Background(), rawURL, time.Minute)
	if err != nil {
		t.Fatalf("ReadURL returned an error: %v", err)
	}
	if got != rawURL {
		t.Fatalf("expected public URL %q, got %q", rawURL, got)
	}
}

func TestReadURLDoesNotExposePrivateURLWithoutPresigning(t *testing.T) {
	storage := &UploadService{
		Bucket:    "private-bucket",
		PublicURL: "https://download.example.test/private-bucket",
	}
	rawURL := storage.PublicURL + "/photo.jpg"

	got, err := storage.ReadURL(context.Background(), rawURL, time.Minute)
	if err == nil {
		t.Fatal("expected private media URL signing to fail without a configured client")
	}
	if got == rawURL {
		t.Fatal("private bucket returned the canonical URL without signing")
	}
}
