package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"chattie-backend/middlewares"
)

type fakeAITextGenerator struct {
	response string
	calls    int
}

func (g *fakeAITextGenerator) Available() bool { return true }

func (g *fakeAITextGenerator) GenerateJSON(_ context.Context, _, _ string, _ int) (string, error) {
	g.calls++
	return g.response, nil
}

type fakeAIWritingCreatorRepository struct {
	active bool
	err    error
}

func (r fakeAIWritingCreatorRepository) IsActiveCreator(context.Context, string) (bool, error) {
	return r.active, r.err
}

func TestGenerateProfileBiosReturnsThreeSuggestions(t *testing.T) {
	gemini := &fakeAITextGenerator{
		response: `{"suggestions":["Bio one","Bio two","Bio three"]}`,
	}
	handler := NewAIWritingHandler(gemini, nil)
	request := httptest.NewRequest(http.MethodPost, "/api/assistant/profile-bio", strings.NewReader(
		`{"interests":["Coffee","Art"],"draft":"I like quiet weekends."}`,
	))
	request = request.WithContext(context.WithValue(request.Context(), middlewares.UserIDKey, "user-1"))
	response := httptest.NewRecorder()

	handler.GenerateProfileBios(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d: %s", http.StatusOK, response.Code, response.Body.String())
	}
	var result struct {
		Suggestions []string `json:"suggestions"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(result.Suggestions) != 3 || result.Suggestions[0] != "Bio one" {
		t.Fatalf("unexpected suggestions: %#v", result.Suggestions)
	}
	if gemini.calls != 1 {
		t.Fatalf("expected one Gemini call, got %d", gemini.calls)
	}
}

func TestGenerateCreatorCaptionsRequiresActiveCreator(t *testing.T) {
	gemini := &fakeAITextGenerator{response: `{"suggestions":["One","Two","Three"]}`}
	handler := NewAIWritingHandler(gemini, fakeAIWritingCreatorRepository{active: false})
	request := httptest.NewRequest(http.MethodPost, "/api/afterdark/assistant/captions", strings.NewReader(
		`{"context":"A new photo","draft":""}`,
	))
	request = request.WithContext(context.WithValue(request.Context(), middlewares.UserIDKey, "user-1"))
	response := httptest.NewRecorder()

	handler.GenerateCreatorCaptions(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected status %d, got %d", http.StatusForbidden, response.Code)
	}
	if gemini.calls != 0 {
		t.Fatalf("Gemini must not be called for inactive creators, got %d calls", gemini.calls)
	}
}

func TestParseAIWritingSuggestionsRejectsOversizedSuggestion(t *testing.T) {
	_, err := parseAIWritingSuggestions(`{"suggestions":["one","two","`+strings.Repeat("x", 501)+`"]}`, 500)
	if err == nil {
		t.Fatal("expected oversized suggestion to be rejected")
	}
}
