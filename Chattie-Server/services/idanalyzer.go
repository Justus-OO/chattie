package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var ErrIDAnalyzerNotConfigured = errors.New("ID Analyzer is not configured")

type IDAnalyzerUpstreamError struct {
	StatusCode int
}

func (e *IDAnalyzerUpstreamError) Error() string {
	return fmt.Sprintf("ID Analyzer returned HTTP %d", e.StatusCode)
}

type IDAnalyzerResult struct {
	TransactionID string
	Decision      string
	WarningCodes  []string
	FaceCompare   *float64
}

type IDAnalyzerDocuPassSession struct {
	Reference string
	URL       string
	QRCode    string
}

type IDAnalyzerService struct {
	apiKey    string
	profileID string
	endpoint  string
	client    *http.Client
}

func NewIDAnalyzerService(apiKey, profileID, region string) *IDAnalyzerService {
	endpoint := ""
	switch strings.ToLower(strings.TrimSpace(region)) {
	case "us":
		endpoint = "https://api2.idanalyzer.com/scan"
	case "eu":
		endpoint = "https://api2-eu.idanalyzer.com/scan"
	}

	return &IDAnalyzerService{
		apiKey:    strings.TrimSpace(apiKey),
		profileID: strings.TrimSpace(profileID),
		endpoint:  endpoint,
		client:    &http.Client{Timeout: 30 * time.Second},
	}
}

func (s *IDAnalyzerService) Available() bool {
	return s != nil && s.apiKey != "" && s.profileID != "" && s.endpoint != "" && s.client != nil
}

func (s *IDAnalyzerService) ProfileID() string {
	if s == nil {
		return ""
	}
	return s.profileID
}

func (s *IDAnalyzerService) CreateDocuPassSession(ctx context.Context, customData string) (*IDAnalyzerDocuPassSession, error) {
	if !s.Available() {
		return nil, ErrIDAnalyzerNotConfigured
	}
	if strings.TrimSpace(customData) == "" {
		return nil, errors.New("DocuPass session requires a correlation value")
	}

	payload, err := json.Marshal(struct {
		Version    int    `json:"version"`
		CustomData string `json:"customData"`
		Mode       int    `json:"mode"`
		Profile    string `json:"profile"`
	}{
		Version:    3,
		CustomData: customData,
		Mode:       0,
		Profile:    s.profileID,
	})
	if err != nil {
		return nil, fmt.Errorf("encode ID Analyzer DocuPass request: %w", err)
	}

	endpoint := strings.TrimSuffix(s.endpoint, "/scan") + "/docupass"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create ID Analyzer DocuPass request: %w", err)
	}
	req.Header.Set("X-API-KEY", s.apiKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("send ID Analyzer DocuPass request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, &IDAnalyzerUpstreamError{StatusCode: resp.StatusCode}
	}

	const maxResponseBytes = 1 << 20
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read ID Analyzer DocuPass response: %w", err)
	}
	if len(responseBody) > maxResponseBytes {
		return nil, errors.New("ID Analyzer DocuPass response exceeded the size limit")
	}

	var response struct {
		Reference string `json:"reference"`
		URL       string `json:"url"`
		QRCode    string `json:"qrCode"`
	}
	if err := json.Unmarshal(responseBody, &response); err != nil {
		return nil, errors.New("ID Analyzer returned an invalid DocuPass response")
	}
	if response.Reference == "" {
		return nil, errors.New("ID Analyzer DocuPass response did not include a reference")
	}
	parsedURL, err := url.Parse(response.URL)
	if err != nil || parsedURL.Scheme != "https" || parsedURL.User != nil ||
		!strings.HasSuffix(strings.ToLower(parsedURL.Hostname()), ".idanalyzer.com") {
		return nil, errors.New("ID Analyzer DocuPass response contained an invalid URL")
	}

	return &IDAnalyzerDocuPassSession{
		Reference: response.Reference,
		URL:       parsedURL.String(),
		QRCode:    response.QRCode,
	}, nil
}

func (s *IDAnalyzerService) Verify(ctx context.Context, document, documentBack []byte, faceFrames [][]byte) (*IDAnalyzerResult, error) {
	if !s.Available() {
		return nil, ErrIDAnalyzerNotConfigured
	}
	if len(document) == 0 || len(faceFrames) < 2 || len(faceFrames) > 5 {
		return nil, errors.New("ID verification requires a front document image and two to five selfie frames")
	}

	totalBytes := len(document) + len(documentBack)
	for _, frame := range faceFrames {
		if len(frame) == 0 {
			return nil, errors.New("ID verification received an empty selfie frame")
		}
		totalBytes += len(frame)
	}
	if totalBytes > 15<<20 {
		return nil, errors.New("ID verification images exceed the supported size")
	}

	encodedFaces := make([]string, len(faceFrames))
	for i, frame := range faceFrames {
		encodedFaces[i] = base64.StdEncoding.EncodeToString(frame)
	}

	payload := struct {
		Profile      string `json:"profile"`
		Document     string `json:"document"`
		DocumentBack string `json:"documentBack,omitempty"`
		Face         string `json:"face"`
		VerifyAge    string `json:"verifyAge"`
	}{
		Profile:      s.profileID,
		Document:     base64.StdEncoding.EncodeToString(document),
		DocumentBack: "",
		Face:         strings.Join(encodedFaces, ","),
		VerifyAge:    "18-120",
	}
	if len(documentBack) > 0 {
		payload.DocumentBack = base64.StdEncoding.EncodeToString(documentBack)
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode ID Analyzer request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create ID Analyzer request: %w", err)
	}
	req.Header.Set("X-API-KEY", s.apiKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("send ID Analyzer request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, &IDAnalyzerUpstreamError{StatusCode: resp.StatusCode}
	}

	const maxResponseBytes = 1 << 20
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read ID Analyzer response: %w", err)
	}
	if len(responseBody) > maxResponseBytes {
		return nil, errors.New("ID Analyzer response exceeded the size limit")
	}

	var response struct {
		Success       bool   `json:"success"`
		TransactionID string `json:"transactionId"`
		Decision      string `json:"decision"`
		Warning       []struct {
			Code string `json:"code"`
		} `json:"warning"`
		Scores struct {
			FaceCompare *float64 `json:"faceCompare"`
		} `json:"scores"`
	}
	if err := json.Unmarshal(responseBody, &response); err != nil {
		return nil, errors.New("ID Analyzer returned an invalid response")
	}
	if !response.Success {
		return nil, errors.New("ID Analyzer could not process the verification")
	}

	decision := strings.ToLower(strings.TrimSpace(response.Decision))
	switch decision {
	case "accept", "review", "reject":
	default:
		return nil, errors.New("ID Analyzer returned an unknown decision")
	}
	if strings.TrimSpace(response.TransactionID) == "" {
		return nil, errors.New("ID Analyzer response did not include a transaction ID")
	}

	warningCodes := make([]string, 0, len(response.Warning))
	requiresRejection := false
	requiresReview := response.Scores.FaceCompare == nil
	for _, warning := range response.Warning {
		code := strings.TrimSpace(warning.Code)
		if code != "" {
			warningCodes = append(warningCodes, code)
			switch code {
			case "UNDER_18", "AGE_VERIFICATION_FAILED":
				requiresRejection = true
			case "FACE_MISMATCH", "FACE_LIVENESS_ERR", "RECAPTURED_FACE", "FACE_IDENTICAL", "MISSING_BIRTH_DATE":
				requiresReview = true
			}
		}
	}
	if requiresRejection {
		decision = "reject"
	} else if decision == "accept" && requiresReview {
		decision = "review"
	}

	return &IDAnalyzerResult{
		TransactionID: response.TransactionID,
		Decision:      decision,
		WarningCodes:  warningCodes,
		FaceCompare:   response.Scores.FaceCompare,
	}, nil
}
