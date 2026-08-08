package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"chattie-backend/middlewares" // <-- ADDED IMPORT
	"chattie-backend/models"
	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
)

type SettingsHandler struct {
	Repo *repository.SettingsRepository
}

func NewSettingsHandler(repo *repository.SettingsRepository) *SettingsHandler {
	return &SettingsHandler{Repo: repo}
}

func (h *SettingsHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// FIX: Use middlewares.UserIDKey
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		log.Println("CRITICAL 401: user_id missing from request context in GetSettings!")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized: Missing context"})
		return
	}

	settings, err := h.Repo.GetSettings(userID)
	if err != nil {
		log.Printf("500 Error in GetSettings for user %s: %v\n", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to fetch settings"})
		return
	}

	json.NewEncoder(w).Encode(settings)
}

func (h *SettingsHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// FIX: Use middlewares.UserIDKey
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		log.Println("CRITICAL 401: user_id missing from request context in UpdateSettings!")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized: Missing context"})
		return
	}

	var payload models.SettingsPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid payload"})
		return
	}

	if err := h.Repo.UpdateSettings(userID, payload); err != nil {
		log.Printf("500 Error in UpdateSettings for user %s: %v\n", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to update settings"})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Settings saved successfully"})
}

func (h *SettingsHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// FIX: Use middlewares.UserIDKey
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	if err := h.Repo.DeleteAccount(userID); err != nil {
		log.Printf("500 Error deleting account for user %s: %v\n", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete account"})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Account terminated"})
}

// GetMediaVault serves the user's uploaded images to the React frontend
func (h *SettingsHandler) GetMediaVault(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized"})
		return
	}

	media, err := h.Repo.GetUserMedia(userID)
	if err != nil {
		log.Printf("500 Error fetching media vault for user %s: %v\n", userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to fetch media vault"})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(media)
}
func (h *SettingsHandler) UploadMedia(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// 1. Verify User
	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized"})
		return
	}

	// 2. Parse the multipart form (Limit upload size to 10MB)
	err := r.ParseMultipartForm(10 << 20)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "File too large or invalid form"})
		return
	}

	// 3. Retrieve the file from the form data
	file, handler, err := r.FormFile("file")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Error retrieving file"})
		return
	}
	defer file.Close()

	// 4. Create an 'uploads' directory if it doesn't exist
	os.MkdirAll("uploads", os.ModePerm)

	// 5. Create a unique filename to prevent overwriting
	filename := fmt.Sprintf("%d-%s", time.Now().Unix(), handler.Filename)
	filePath := filepath.Join("uploads", filename)

	// 6. Save the file to your server's disk
	dst, err := os.Create(filePath)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Error saving file to server"})
		return
	}
	defer dst.Close()
	io.Copy(dst, file)

	// 7. Generate the public URL for this image
	// Note: In production, this would be an S3 or Cloudinary URL
	fileURL := "http://localhost:8080/uploads/" + filename

	// 8. Save the URL to the Database
	if err := h.Repo.SaveUserMedia(userID, fileURL); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to save file URL to database"})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "File uploaded successfully",
		"url":     fileURL,
	})
}

func (h *SettingsHandler) DeleteMedia(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	// Extract the media ID from the URL (e.g., /api/settings/media/{media_id})
	mediaID := chi.URLParam(r, "media_id")
	if mediaID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Media ID is required"})
		return
	}

	// Delete from database
	if err := h.Repo.DeleteUserMedia(userID, mediaID); err != nil {
		log.Printf("500 Error deleting media %s for user %s: %v\n", mediaID, userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to delete media"})
		return
	}

	// Note: For a production app, you would also delete the physical file using os.Remove() here.

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Media deleted successfully"})
}

// SetPrimaryMedia sets a specific vault image as the user's main profile picture
func (h *SettingsHandler) SetPrimaryMedia(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	mediaID := chi.URLParam(r, "media_id")
	if mediaID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Media ID is required"})
		return
	}

	if err := h.Repo.SetPrimaryMedia(userID, mediaID); err != nil {
		log.Printf("500 Error setting primary media %s for user %s: %v\n", mediaID, userID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to set primary profile picture"})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Profile picture updated!"})
}
