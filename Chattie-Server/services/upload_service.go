package services

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type UploadService struct {
	Client       *s3.Client
	Bucket       string
	PublicURL    string
	PublicBucket bool
}

// NewUploadService initializes the Backblaze B2 (S3-Compatible) engine
func NewUploadService() *UploadService {
	endpoint := os.Getenv("B2_ENDPOINT")
	region := os.Getenv("B2_REGION")
	bucket := os.Getenv("B2_BUCKET_NAME")
	keyID := os.Getenv("B2_KEY_ID")
	appKey := os.Getenv("B2_APPLICATION_KEY")
	publicURL := os.Getenv("B2_PUBLIC_URL")
	publicBucket := strings.EqualFold(strings.TrimSpace(os.Getenv("B2_BUCKET_PUBLIC")), "true")

	// 1. Configure AWS SDK to point at Backblaze B2
	cfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(keyID, appKey, "")),
		config.WithRegion(region),
	)
	if err != nil {
		log.Fatalf("CRITICAL: Failed to load Backblaze config: %v", err)
	}

	// 2. Create the S3 Client with the custom Backblaze endpoint
	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		o.UsePathStyle = true // Required for B2 compatibility
	})

	return &UploadService{
		Client:       client,
		Bucket:       bucket,
		PublicURL:    strings.TrimRight(publicURL, "/"), // Clean trailing slashes
		PublicBucket: publicBucket,
	}
}

// SaveFile streams a multipart file directly to Backblaze B2 securely
func (s *UploadService) SaveFile(file multipart.File, header *multipart.FileHeader, folder string) (string, int64, error) {
	// 1. Strict Timeout to prevent Goroutine memory leaks
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 2. Security: Sniff the first 512 bytes to find the TRUE MIME type
	buffer := make([]byte, 512)
	_, err := file.Read(buffer)
	if err != nil && err != io.EOF {
		return "", 0, fmt.Errorf("failed to read file header for mime sniffing: %w", err)
	}

	// Reset the file pointer back to the beginning after reading the header
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", 0, fmt.Errorf("failed to reset file pointer: %w", err)
	}

	contentType := http.DetectContentType(buffer)

	// Optional: Block non-image uploads if needed
	// if !strings.HasPrefix(contentType, "image/") && !strings.HasPrefix(contentType, "video/") {
	// 	return "", 0, fmt.Errorf("unsupported file type: %s", contentType)
	// }

	// 3. Generate a cryptographically secure, random filename
	ext := strings.ToLower(filepath.Ext(header.Filename))
	randomBytes := make([]byte, 8)
	rand.Read(randomBytes)
	secureName := fmt.Sprintf("%d_%x%s", time.Now().UnixNano(), randomBytes, ext)

	// 4. Construct the B2 Object Key (e.g., "vault/1723456_abc123.jpg")
	objectKey := fmt.Sprintf("%s/%s", folder, secureName)

	// 5. Stream directly to Backblaze B2
	_, err = s.Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.Bucket),
		Key:         aws.String(objectKey),
		Body:        file,
		ContentType: aws.String(contentType),
	})

	if err != nil {
		return "", 0, fmt.Errorf("failed to upload to Backblaze: %w", err)
	}

	// 6. Construct the final public URL
	finalURL := fmt.Sprintf("%s/%s", s.PublicURL, objectKey)

	return finalURL, header.Size, nil
}

// DeleteFile physically removes an asset from Backblaze B2 to prevent storage bloat and save costs
func (s *UploadService) DeleteFile(fileURL string) error {
	// Don't attempt to delete empty URLs or default avatars
	if fileURL == "" || !strings.HasPrefix(fileURL, s.PublicURL) {
		return nil
	}

	// Extract the pure Object Key by stripping the Public URL prefix
	// Example: https://f003.backblazeb2.com/file/chattie-bucket/vault/123.jpg -> vault/123.jpg
	objectKey := strings.TrimPrefix(fileURL, s.PublicURL+"/")

	// Enforce strict timeout
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	_, err := s.Client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.Bucket),
		Key:    aws.String(objectKey),
	})

	if err != nil {
		return fmt.Errorf("failed to delete file %s from B2: %w", objectKey, err)
	}

	log.Printf("[STORAGE] Successfully deleted %s from B2 bucket", objectKey)
	return nil
}

// GetFileBytes securely downloads an asset from Backblaze B2 into memory
// This is critical for internal processing like AI Image Verification
func (s *UploadService) GetFileBytes(ctx context.Context, fileURL string) ([]byte, error) {
	if fileURL == "" || !strings.HasPrefix(fileURL, s.PublicURL) {
		return nil, fmt.Errorf("invalid file URL or external URL provided")
	}

	// Extract the object key (e.g., "vault/1723456_abc123.jpg")
	objectKey := strings.TrimPrefix(fileURL, s.PublicURL+"/")

	output, err := s.Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.Bucket),
		Key:    aws.String(objectKey),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch object from B2: %w", err)
	}
	defer output.Body.Close()

	// Read the image stream into a byte slice
	return io.ReadAll(output.Body)
}

func (s *UploadService) PresignGetFile(ctx context.Context, fileURL string, expires time.Duration) (string, error) {
	if s.Client == nil || s.Bucket == "" || s.PublicURL == "" {
		return "", fmt.Errorf("media storage is unavailable")
	}
	prefix := s.PublicURL + "/"
	if !strings.HasPrefix(fileURL, prefix) {
		return "", fmt.Errorf("invalid stored media URL")
	}
	objectKey := strings.TrimPrefix(fileURL, prefix)
	if objectKey == "" || strings.Contains(objectKey, "..") {
		return "", fmt.Errorf("invalid stored media key")
	}

	presigner := s3.NewPresignClient(s.Client)
	request, err := presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.Bucket),
		Key:    aws.String(objectKey),
	}, func(options *s3.PresignOptions) {
		options.Expires = expires
	})
	if err != nil {
		return "", fmt.Errorf("failed to sign media URL: %w", err)
	}
	return request.URL, nil
}

func (s *UploadService) ReadURL(ctx context.Context, fileURL string, expires time.Duration) (string, error) {
	if s == nil {
		return "", fmt.Errorf("media storage is unavailable")
	}
	if s.PublicBucket {
		return fileURL, nil
	}
	return s.PresignGetFile(ctx, fileURL, expires)
}
