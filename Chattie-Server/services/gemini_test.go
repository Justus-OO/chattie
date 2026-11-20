package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGeminiGenerateUsesServerKeyHeaderAndReturnsText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("x-goog-api-key"); got != "test-secret" {
			t.Fatalf("unexpected API key header: %q", got)
		}
		if strings.Contains(r.URL.String(), "test-secret") {
			t.Fatal("API key must not be sent in the URL")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"Hello there"}]}}]}`))
	}))
	defer server.Close()

	service := NewGeminiService("test-secret", "gemini-test")
	service.client = server.Client()
	service.endpoint = server.URL + "/"

	got, err := service.Generate(context.Background(), "system", "prompt", 128)
	if err != nil {
		t.Fatalf("Generate returned an error: %v", err)
	}
	if got != "Hello there" {
		t.Fatalf("Generate returned %q", got)
	}
}

func TestGeminiGenerateJSONRequestsStructuredSuggestions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			GenerationConfig struct {
				ResponseMimeType string `json:"responseMimeType"`
				ResponseSchema   struct {
					Type       string `json:"type"`
					Properties map[string]struct {
						Type     string `json:"type"`
						MinItems int    `json:"minItems"`
						MaxItems int    `json:"maxItems"`
						Items    struct {
							Type string `json:"type"`
						} `json:"items"`
					} `json:"properties"`
					Required []string `json:"required"`
				} `json:"responseSchema"`
			} `json:"generationConfig"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if request.GenerationConfig.ResponseMimeType != "application/json" {
			t.Errorf("responseMimeType = %q, want application/json", request.GenerationConfig.ResponseMimeType)
		}
		suggestions := request.GenerationConfig.ResponseSchema.Properties["suggestions"]
		if request.GenerationConfig.ResponseSchema.Type != "OBJECT" ||
			suggestions.Type != "ARRAY" || suggestions.Items.Type != "STRING" ||
			suggestions.MinItems != 3 || suggestions.MaxItems != 3 ||
			len(request.GenerationConfig.ResponseSchema.Required) != 1 ||
			request.GenerationConfig.ResponseSchema.Required[0] != "suggestions" {
			t.Errorf("unexpected response schema: %+v", request.GenerationConfig.ResponseSchema)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"{\"suggestions\":[\"one\",\"two\",\"three\"]}"}]}}]}`))
	}))
	defer server.Close()

	service := NewGeminiService("test-secret", "gemini-test")
	service.client = server.Client()
	service.endpoint = server.URL + "/"

	got, err := service.GenerateJSON(context.Background(), "system", "prompt", 128)
	if err != nil {
		t.Fatalf("GenerateJSON returned an error: %v", err)
	}
	if got != `{"suggestions":["one","two","three"]}` {
		t.Fatalf("GenerateJSON returned %q", got)
	}
}

func TestGeminiGenerateRejectsMissingKey(t *testing.T) {
	service := NewGeminiService("", "")
	if _, err := service.Generate(context.Background(), "system", "prompt", 128); err == nil {
		t.Fatal("expected an error when the API key is missing")
	}
}

func TestNormalizeGeminiJSONAcceptsPlainAndFencedJSON(t *testing.T) {
	for _, response := range []string{
		`{"answer":"ok"}`,
		"```json\n{\"answer\":\"ok\"}\n```",
		"```JSON\r\n{\"answer\":\"ok\"}\r\n```",
	} {
		got, err := NormalizeGeminiJSON(response)
		if err != nil {
			t.Errorf("NormalizeGeminiJSON(%q) error = %v", response, err)
			continue
		}
		if got != `{"answer":"ok"}` {
			t.Errorf("NormalizeGeminiJSON(%q) = %q", response, got)
		}
	}
}

func TestNormalizeGeminiJSONRejectsInvalidOutput(t *testing.T) {
	for _, response := range []string{
		"```json\n{\"answer\":\"ok\"}",
		"```text\n{\"answer\":\"ok\"}\n```",
		"not json",
	} {
		if _, err := NormalizeGeminiJSON(response); err == nil {
			t.Errorf("NormalizeGeminiJSON(%q) succeeded; want an error", response)
		}
	}
}
