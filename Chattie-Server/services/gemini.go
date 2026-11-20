package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const (
	defaultGeminiModel = "gemini-2.5-flash"
	geminiAPIEndpoint  = "https://generativelanguage.googleapis.com/v1beta/models/"
	maxGeminiPrompt    = 24000
)

var geminiModelPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

type GeminiService struct {
	apiKey   string
	model    string
	endpoint string
	client   *http.Client
}

func NewGeminiService(apiKey, model string) *GeminiService {
	model = strings.TrimSpace(model)
	if model == "" {
		model = defaultGeminiModel
	}
	return &GeminiService{
		apiKey:   strings.TrimSpace(apiKey),
		model:    model,
		endpoint: geminiAPIEndpoint,
		client:   &http.Client{Timeout: 25 * time.Second},
	}
}

func (s *GeminiService) Available() bool {
	return s != nil && s.apiKey != ""
}

type geminiTextPart struct {
	Text string `json:"text"`
}

type geminiRequest struct {
	SystemInstruction struct {
		Parts []geminiTextPart `json:"parts"`
	} `json:"system_instruction"`
	Contents []struct {
		Role  string           `json:"role"`
		Parts []geminiTextPart `json:"parts"`
	} `json:"contents"`
	GenerationConfig struct {
		Temperature      float64       `json:"temperature"`
		MaxOutputTokens  int           `json:"maxOutputTokens"`
		ResponseMimeType string        `json:"responseMimeType,omitempty"`
		ResponseSchema   *geminiSchema `json:"responseSchema,omitempty"`
	} `json:"generationConfig"`
}

type geminiSchema struct {
	Type       string                  `json:"type"`
	Properties map[string]geminiSchema `json:"properties,omitempty"`
	Items      *geminiSchema           `json:"items,omitempty"`
	Required   []string                `json:"required,omitempty"`
	MinItems   int                     `json:"minItems,omitempty"`
	MaxItems   int                     `json:"maxItems,omitempty"`
}

type geminiResponse struct {
	Candidates []struct {
		Content struct {
			Parts []geminiTextPart `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
}

func (s *GeminiService) Generate(ctx context.Context, systemInstruction, prompt string, maxOutputTokens int) (string, error) {
	return s.generate(ctx, systemInstruction, prompt, maxOutputTokens, nil)
}

func (s *GeminiService) GenerateJSON(ctx context.Context, systemInstruction, prompt string, maxOutputTokens int) (string, error) {
	schema := &geminiSchema{
		Type: "OBJECT",
		Properties: map[string]geminiSchema{
			"suggestions": {
				Type:     "ARRAY",
				Items:    &geminiSchema{Type: "STRING"},
				MinItems: 3,
				MaxItems: 3,
			},
		},
		Required: []string{"suggestions"},
	}
	return s.generate(ctx, systemInstruction, prompt, maxOutputTokens, schema)
}

func NormalizeGeminiJSON(response string) (string, error) {
	response = strings.TrimSpace(response)
	if strings.HasPrefix(response, "```") {
		fenced := strings.TrimPrefix(response, "```")
		newline := strings.IndexByte(fenced, '\n')
		if newline < 0 {
			return "", errors.New("Gemini returned an incomplete JSON code fence")
		}
		language := strings.TrimSpace(fenced[:newline])
		if language != "" && !strings.EqualFold(language, "json") {
			return "", errors.New("Gemini returned a non-JSON code fence")
		}
		response = strings.TrimSpace(fenced[newline+1:])
		if !strings.HasSuffix(response, "```") {
			return "", errors.New("Gemini returned an incomplete JSON code fence")
		}
		response = strings.TrimSpace(strings.TrimSuffix(response, "```"))
	}
	if !json.Valid([]byte(response)) {
		return "", errors.New("Gemini response is not valid JSON")
	}
	return response, nil
}

func (s *GeminiService) generate(ctx context.Context, systemInstruction, prompt string, maxOutputTokens int, responseSchema *geminiSchema) (string, error) {
	if s == nil || s.apiKey == "" {
		return "", errors.New("Gemini is not configured")
	}
	if !geminiModelPattern.MatchString(s.model) {
		return "", errors.New("Gemini model configuration is invalid")
	}
	systemInstruction = strings.TrimSpace(systemInstruction)
	prompt = strings.TrimSpace(prompt)
	if systemInstruction == "" || prompt == "" {
		return "", errors.New("Gemini prompt cannot be empty")
	}
	if len(systemInstruction)+len(prompt) > maxGeminiPrompt {
		return "", errors.New("Gemini prompt exceeds the maximum length")
	}
	if maxOutputTokens < 1 || maxOutputTokens > 2048 {
		return "", errors.New("Gemini output token limit is invalid")
	}

	requestBody := geminiRequest{}
	requestBody.SystemInstruction.Parts = []geminiTextPart{{Text: systemInstruction}}
	requestBody.Contents = []struct {
		Role  string           `json:"role"`
		Parts []geminiTextPart `json:"parts"`
	}{{Role: "user", Parts: []geminiTextPart{{Text: prompt}}}}
	requestBody.GenerationConfig.Temperature = 0.6
	requestBody.GenerationConfig.MaxOutputTokens = maxOutputTokens
	if responseSchema != nil {
		requestBody.GenerationConfig.ResponseMimeType = "application/json"
		requestBody.GenerationConfig.ResponseSchema = responseSchema
	}

	encodedBody, err := json.Marshal(requestBody)
	if err != nil {
		return "", fmt.Errorf("encode Gemini request: %w", err)
	}

	callCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()

	request, err := http.NewRequestWithContext(
		callCtx,
		http.MethodPost,
		s.endpoint+s.model+":generateContent",
		bytes.NewReader(encodedBody),
	)
	if err != nil {
		return "", fmt.Errorf("create Gemini request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-goog-api-key", s.apiKey)

	response, err := s.client.Do(request)
	if err != nil {
		return "", fmt.Errorf("call Gemini API: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("Gemini API returned status %d", response.StatusCode)
	}

	var result geminiResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil {
		return "", fmt.Errorf("decode Gemini response: %w", err)
	}
	if len(result.Candidates) == 0 {
		return "", errors.New("Gemini returned no response candidate")
	}

	var text strings.Builder
	for _, part := range result.Candidates[0].Content.Parts {
		text.WriteString(part.Text)
	}
	generated := strings.TrimSpace(text.String())
	if generated == "" {
		return "", errors.New("Gemini returned an empty response")
	}
	return generated, nil
}
