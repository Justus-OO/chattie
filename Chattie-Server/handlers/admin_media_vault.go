package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
)

type AdminMediaHandler struct {
	Repo *repository.Repository
}

func NewAdminMediaHandler(repo *repository.Repository) *AdminMediaHandler {
	return &AdminMediaHandler{Repo: repo}
}

// GetVaults handles GET /api/admin/media/vaults
func (h *AdminMediaHandler) GetVaults(w http.ResponseWriter, r *http.Request) {
	vaults, err := h.Repo.GetAdminPersonaVaults(r.Context())
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedLoadPersonaVaults", "Failed to load persona vaults"))
		return
	}
	sendAdminJSON(w, http.StatusOK, vaults)
}

// GetVaultGallery handles GET /api/admin/media/vaults/{id}/gallery
func (h *AdminMediaHandler) GetVaultGallery(w http.ResponseWriter, r *http.Request) {
	personaID := chi.URLParam(r, "id")
	items, err := h.Repo.GetVaultGallery(r.Context(), personaID)
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedLoadVaultGallery", "Failed to load vault gallery"))
		return
	}
	sendAdminJSON(w, http.StatusOK, items)
}

// SetPrimary handles PATCH /api/admin/media/vaults/{id}/primary/{mediaId}
func (h *AdminMediaHandler) SetPrimary(w http.ResponseWriter, r *http.Request) {
	personaID := chi.URLParam(r, "id")
	mediaID := chi.URLParam(r, "mediaId")

	if err := h.Repo.SetPrimaryVaultImage(r.Context(), personaID, mediaID); err != nil {
		sendAdminError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedSetPrimaryAsset", "Failed to set primary asset"))
		return
	}
	_ = h.Repo.LogMediaAudit(r.Context(), "SET_PRIMARY", personaID, "ROOT_ADMIN", mediaID)
	sendAdminJSON(w, http.StatusOK, map[string]string{"message": localized(r.Context(), "MsgPrimaryUpdated", "Primary updated successfully")})
}

// DeleteMedia handles DELETE /api/admin/media/assets/{mediaId}
func (h *AdminMediaHandler) DeleteMedia(w http.ResponseWriter, r *http.Request) {
	mediaID := chi.URLParam(r, "mediaId")
	if err := h.Repo.DeleteVaultMedia(r.Context(), mediaID); err != nil {
		sendAdminError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedDeleteAsset", "Failed to delete asset"))
		return
	}
	_ = h.Repo.LogMediaAudit(r.Context(), "DELETE_MEDIA", "", "ROOT_ADMIN", mediaID)
	sendAdminJSON(w, http.StatusOK, map[string]string{"message": localized(r.Context(), "MsgAssetDeleted", "Asset deleted successfully")})
}

// GetAuditLogs handles GET /api/admin/media/audit-logs
func (h *AdminMediaHandler) GetAuditLogs(w http.ResponseWriter, r *http.Request) {
	logs, err := h.Repo.GetMediaAuditLogs(r.Context())
	if err != nil {
		sendAdminError(w, http.StatusInternalServerError, localized(r.Context(), "ErrFailedLoadAuditLogs", "Failed to load audit logs"))
		return
	}
	sendAdminJSON(w, http.StatusOK, logs)
}

// InjectAssets handles POST /api/admin/media/vaults/{id}/inject (Bulk file uploads)
func (h *AdminMediaHandler) InjectAssets(w http.ResponseWriter, r *http.Request) {
	personaID := chi.URLParam(r, "id")

	// Check if the Persona actually exists in the database
	var exists bool
	err := h.Repo.DB.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM managed_profiles WHERE id = $1)`, personaID).Scan(&exists)
	if err != nil || !exists {
		sendAdminError(w, http.StatusNotFound, localized(r.Context(), "ErrPersonaVaultNotFound", "Persona vault not found in database"))
		return
	}

	err = r.ParseMultipartForm(50 << 20) // 50MB limit
	if err != nil {
		sendAdminError(w, http.StatusBadRequest, localized(r.Context(), "ErrInvalidMultipartForm", "Files too large or invalid multipart form"))
		return
	}

	form := r.MultipartForm
	files := form.File["files"]

	os.MkdirAll("uploads/vaults", os.ModePerm)

	for _, fileHeader := range files {
		file, err := fileHeader.Open()
		if err != nil {
			continue
		}
		defer file.Close()

		filename := fmt.Sprintf("%d-%s", time.Now().UnixNano(), fileHeader.Filename)
		filePath := filepath.Join("uploads", "vaults", filename)

		dst, err := os.Create(filePath)
		if err != nil {
			continue
		}
		defer dst.Close()
		io.Copy(dst, file)

		fileURL := "http://localhost:8080/uploads/vaults/" + filename
		sizeBytes := fileHeader.Size

		// Save to database ATTACHED TO THE PERSONA
		_, _ = h.Repo.DB.ExecContext(r.Context(), `
          INSERT INTO user_media (user_id, url, is_primary, size_bytes, mime_type)
          VALUES ($1, $2, FALSE, $3, $4)
       `, personaID, fileURL, sizeBytes, fileHeader.Header.Get("Content-Type"))

		_ = h.Repo.LogMediaAudit(r.Context(), "INJECT_MEDIA", personaID, "ROOT_ADMIN", fileHeader.Filename)
	}

	sendAdminJSON(w, http.StatusCreated, map[string]string{"message": localized(r.Context(), "MsgAssetsInjected", "Assets successfully injected into vault")})
}
