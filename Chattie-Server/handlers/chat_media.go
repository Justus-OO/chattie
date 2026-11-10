package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"chattie-backend/middlewares"
	"chattie-backend/models"
)

// NSFWCheckResponse represents the JSON response from Sightengine
type NSFWCheckResponse struct {
	Status string `json:"status"`
	Nudity struct {
		Safe   float64 `json:"safe"`
		Sexual float64 `json:"sexual"`
	} `json:"nudity"`
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

// CheckNSFW sends the image buffer to an external moderation API
func CheckNSFW(fileBytes []byte, filename string) (bool, error) {
	// Note: Replace these with your actual Sightengine (or AWS/GCP) credentials
	apiUser := os.Getenv("NSFW_API_USER")
	apiSecret := os.Getenv("NSFW_API_SECRET")

	if apiUser == "NSFW_API_USER" {
		// Bypass if credentials aren't set yet so your app doesn't break during dev
		return false, nil
	}

	payload := &bytes.Buffer{}
	writer := multipart.NewWriter(payload)

	part, err := writer.CreateFormFile("media", filename)
	if err != nil {
		return false, err
	}
	part.Write(fileBytes)

	_ = writer.WriteField("models", "nudity-2.0")
	_ = writer.WriteField("api_user", apiUser)
	_ = writer.WriteField("api_secret", apiSecret)
	writer.Close()

	req, err := http.NewRequest("POST", "https://api.sightengine.com/1.0/check.json", payload)
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	var result NSFWCheckResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, err
	}

	if result.Status == "failure" {
		return false, fmt.Errorf("API Error: %s", result.Error.Message)
	}

	// If the image is highly sexual/explicit, flag it
	// Sightengine returns confidence scores from 0.0 to 1.0
	if result.Nudity.Sexual > 0.5 {
		return true, nil
	}

	return false, nil
}

// UploadChatMedia handles the HTTP upload, checks for NSFW, and saves to disk
func UploadChatMedia(w http.ResponseWriter, r *http.Request) {
	// 1. Get the user ID from the JWT context
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	// 2. Parse the incoming form data (limit to 10MB)
	r.ParseMultipartForm(10 << 20)
	file, handler, err := r.FormFile("image")
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrCouldNotReadImage", "Could not read image file"), http.StatusBadRequest)
		return
	}
	defer file.Close()

	// 3. Read the file into memory
	fileBytes, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedProcessImage", "Failed to process image"), http.StatusInternalServerError)
		return
	}

	// 4. Run the NSFW Check
	isNSFW, err := CheckNSFW(fileBytes, handler.Filename)
	if err != nil {
		fmt.Printf("[MODERATION WARNING] API call failed: %v\n", err)
		// Decide if you want to block or allow if the 3rd party API goes down.
		// We'll allow it to pass in this example so chat doesn't break.
	}

	if isNSFW {
		// Log the violation using the action logger we built earlier
		ActionLogQueue <- models.ActionLog{
			UserID:     userID,
			ActionType: "NSFW_FLAG",
			IP:         r.RemoteAddr,
			Metadata:   `{"reason": "Explicit image blocked before upload"}`,
		}

		http.Error(w, localized(r.Context(), "ErrExplicitContentGuidelines", "Image violates community guidelines regarding explicit content."), http.StatusUnprocessableEntity)
		return
	}

	// 5. Image is safe! Save it locally to the 'uploads' directory
	// Ensure the directory exists
	uploadDir := "uploads"
	if _, err := os.Stat(uploadDir); os.IsNotExist(err) {
		os.Mkdir(uploadDir, os.ModePerm)
	}

	// Generate a unique filename
	ext := filepath.Ext(handler.Filename)
	newFilename := fmt.Sprintf("chat_%s_%d%s", userID[:8], time.Now().UnixMilli(), ext)
	filePath := filepath.Join(uploadDir, newFilename)

	destFile, err := os.Create(filePath)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedSaveImage", "Failed to save image"), http.StatusInternalServerError)
		return
	}
	defer destFile.Close()

	if _, err := destFile.Write(fileBytes); err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedWriteImage", "Failed to write image"), http.StatusInternalServerError)
		return
	}

	// 6. Return the public URL to the frontend
	mediaURL := fmt.Sprintf("/uploads/%s", newFilename)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"media_url": mediaURL,
	})
}
