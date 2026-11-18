package services

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIDAnalyzerVerifySendsDocumentBackAndFaceFrames(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %q, want POST", r.Method)
		}
		if got := r.Header.Get("X-API-KEY"); got != "test-api-key" {
			t.Fatalf("X-API-KEY = %q, want test-api-key", got)
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read request: %v", err)
		}
		var request struct {
			Profile      string `json:"profile"`
			Document     string `json:"document"`
			DocumentBack string `json:"documentBack"`
			Face         string `json:"face"`
			VerifyAge    string `json:"verifyAge"`
		}
		if err := json.Unmarshal(body, &request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if request.Profile != "profile-123" || request.VerifyAge != "18-120" {
			t.Fatalf("unexpected profile or age range: %+v", request)
		}
		if decoded, err := base64.StdEncoding.DecodeString(request.Document); err != nil || string(decoded) != "front" {
			t.Fatalf("document = %q, err = %v", decoded, err)
		}
		if decoded, err := base64.StdEncoding.DecodeString(request.DocumentBack); err != nil || string(decoded) != "back" {
			t.Fatalf("documentBack = %q, err = %v", decoded, err)
		}
		faces := strings.Split(request.Face, ",")
		if len(faces) != 2 {
			t.Fatalf("got %d face frames, want 2", len(faces))
		}
		for i, expected := range []string{"selfie-1", "selfie-2"} {
			decoded, err := base64.StdEncoding.DecodeString(faces[i])
			if err != nil || string(decoded) != expected {
				t.Fatalf("face frame %d = %q, err = %v", i, decoded, err)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"success":true,"transactionId":"txn-123","decision":"accept","scores":{"faceCompare":0.97}}`)
	}))
	defer server.Close()

	service := NewIDAnalyzerService("test-api-key", "profile-123", "us")
	service.endpoint = server.URL
	service.client = server.Client()

	result, err := service.Verify(context.Background(), []byte("front"), []byte("back"), [][]byte{
		[]byte("selfie-1"),
		[]byte("selfie-2"),
	})
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if result.Decision != "accept" || result.TransactionID != "txn-123" || result.FaceCompare == nil || *result.FaceCompare != 0.97 {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestIDAnalyzerVerifyRoutesAgeAndBiometricWarningsSafely(t *testing.T) {
	tests := []struct {
		name         string
		response     string
		wantDecision string
	}{
		{
			name:         "provider review is preserved",
			response:     `{"success":true,"transactionId":"txn-review","decision":"review","scores":{"faceCompare":0.97}}`,
			wantDecision: "review",
		},
		{
			name:         "provider rejection is preserved",
			response:     `{"success":true,"transactionId":"txn-reject","decision":"reject","scores":{"faceCompare":0.97}}`,
			wantDecision: "reject",
		},
		{
			name:         "underage warning forces rejection",
			response:     `{"success":true,"transactionId":"txn-age","decision":"accept","scores":{"faceCompare":0.99},"warning":[{"code":"UNDER_18"}]}`,
			wantDecision: "reject",
		},
		{
			name:         "biometric warning prevents automatic acceptance",
			response:     `{"success":true,"transactionId":"txn-face","decision":"accept","scores":{"faceCompare":0.99},"warning":[{"code":"FACE_LIVENESS_ERR"}]}`,
			wantDecision: "review",
		},
		{
			name:         "missing face score prevents automatic acceptance",
			response:     `{"success":true,"transactionId":"txn-score","decision":"accept","scores":{"faceCompare":null}}`,
			wantDecision: "review",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, tt.response)
			}))
			defer server.Close()

			service := NewIDAnalyzerService("test-api-key", "profile-123", "us")
			service.endpoint = server.URL
			service.client = server.Client()
			result, err := service.Verify(context.Background(), []byte("front"), nil, [][]byte{[]byte("one"), []byte("two")})
			if err != nil {
				t.Fatalf("Verify() error = %v", err)
			}
			if result.Decision != tt.wantDecision {
				t.Fatalf("decision = %q, want %q", result.Decision, tt.wantDecision)
			}
		})
	}
}

func TestIDAnalyzerVerifyDoesNotExposeUpstreamErrorBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "sensitive provider response body", http.StatusUnauthorized)
	}))
	defer server.Close()

	service := NewIDAnalyzerService("test-api-key", "profile-123", "us")
	service.endpoint = server.URL
	service.client = server.Client()
	_, err := service.Verify(context.Background(), []byte("front"), nil, [][]byte{[]byte("one"), []byte("two")})
	if err == nil {
		t.Fatal("Verify() error = nil, want upstream error")
	}
	if strings.Contains(err.Error(), "sensitive provider response body") {
		t.Fatalf("upstream body leaked into error: %v", err)
	}
}

func TestIDAnalyzerVerifyRequiresConfiguration(t *testing.T) {
	service := NewIDAnalyzerService("", "profile-123", "us")
	_, err := service.Verify(context.Background(), []byte("front"), nil, [][]byte{[]byte("one"), []byte("two")})
	if err != ErrIDAnalyzerNotConfigured {
		t.Fatalf("Verify() error = %v, want %v", err, ErrIDAnalyzerNotConfigured)
	}
}

func TestIDAnalyzerCreateDocuPassSession(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/docupass" {
			t.Errorf("path = %q, want /docupass", r.URL.Path)
		}
		if got := r.Header.Get("X-API-KEY"); got != "test-api-key" {
			t.Errorf("X-API-KEY = %q, want test-api-key", got)
		}
		var request struct {
			Version    int    `json:"version"`
			CustomData string `json:"customData"`
			Mode       int    `json:"mode"`
			Profile    string `json:"profile"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if request.Version != 3 || request.CustomData != "opaque-user-token" || request.Mode != 0 || request.Profile != "profile-123" {
			t.Errorf("unexpected DocuPass request: %+v", request)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"reference":"ref-123","url":"https://v.idanalyzer.com/verify?ref=ref-123","qrCode":"qr-data"}`)
	}))
	defer server.Close()

	service := NewIDAnalyzerService("test-api-key", "profile-123", "eu")
	service.endpoint = server.URL + "/scan"
	service.client = server.Client()
	session, err := service.CreateDocuPassSession(context.Background(), "opaque-user-token")
	if err != nil {
		t.Fatalf("CreateDocuPassSession() error = %v", err)
	}
	if session.Reference != "ref-123" || session.URL != "https://v.idanalyzer.com/verify?ref=ref-123" {
		t.Fatalf("unexpected session: %+v", session)
	}
}

func TestIDAnalyzerCreateDocuPassSessionRejectsExternalURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"reference":"ref-123","url":"https://example.com/verify"}`)
	}))
	defer server.Close()

	service := NewIDAnalyzerService("test-api-key", "profile-123", "us")
	service.endpoint = server.URL + "/scan"
	service.client = server.Client()
	if _, err := service.CreateDocuPassSession(context.Background(), "opaque-user-token"); err == nil {
		t.Fatal("CreateDocuPassSession() error = nil, want invalid URL error")
	}
}
