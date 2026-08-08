package repository

import (
	"context"
	"fmt"
	"time"

	"chattie-backend/models"
)

// GetAdminPersonaVaults fetches all managed profiles along with aggregate storage & asset counts
func (r *Repository) GetAdminPersonaVaults(ctx context.Context) ([]models.AdminPersonaVault, error) {
	query := `
       SELECT 
          mp.id::text, 
          mp.name, 
          COALESCE(mp.archetype, 'General'), 
          COALESCE(u.username, 'UNASSIGNED'),
          COALESCE(SUM(um.size_bytes), 0) as total_bytes,
          COUNT(um.id)::int as total_assets,
          COALESCE((SELECT url FROM user_media WHERE user_id = mp.id AND is_primary = TRUE LIMIT 1), ''),
          COALESCE(TO_CHAR(MAX(um.created_at), 'Mon DD, YYYY'), 'Never')
       FROM managed_profiles mp
       LEFT JOIN users u ON mp.manager_id = u.id
       LEFT JOIN user_media um ON mp.id = um.user_id
       GROUP BY mp.id, mp.name, mp.archetype, u.username
       ORDER BY mp.created_at DESC
    `

	rows, err := r.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var vaults []models.AdminPersonaVault
	for rows.Next() {
		var v models.AdminPersonaVault
		var totalBytes int64
		if err := rows.Scan(&v.ID, &v.Name, &v.Archetype, &v.AssignedOp, &totalBytes, &v.TotalAssets, &v.PrimaryImage, &v.LastUpdated); err != nil {
			continue
		}

		// Format byte size nicely
		if totalBytes > 1024*1024*1024 {
			v.StorageUsed = fmt.Sprintf("%.1f GB", float64(totalBytes)/(1024*1024*1024))
		} else {
			v.StorageUsed = fmt.Sprintf("%.1f MB", float64(totalBytes)/(1024*1024))
		}
		if v.PrimaryImage == "" {
			v.PrimaryImage = ""
		}
		vaults = append(vaults, v)
	}
	return vaults, nil
}

// GetVaultGallery fetches all media items belonging to a specific persona
func (r *Repository) GetVaultGallery(ctx context.Context, personaID string) ([]models.AdminMediaItem, error) {
	query := `
       SELECT id::text, url, is_primary, created_at, COALESCE(size_bytes, 2097152), COALESCE(mime_type, 'image/jpeg')
       FROM user_media
       WHERE user_id = $1
       ORDER BY is_primary DESC, created_at DESC
    `
	rows, err := r.DB.QueryContext(ctx, query, personaID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.AdminMediaItem
	for rows.Next() {
		var item models.AdminMediaItem
		var createdAt time.Time
		var sizeBytes int64
		if err := rows.Scan(&item.ID, &item.URL, &item.IsPrimary, &createdAt, &sizeBytes, &item.Type); err != nil {
			continue
		}
		item.UploadedAt = createdAt.Format("2006-01-02")
		item.Size = fmt.Sprintf("%.1f MB", float64(sizeBytes)/(1024*1024))
		items = append(items, item)
	}
	return items, nil
}

// SetPrimaryVaultImage sets a media item as primary and clears others for that persona
func (r *Repository) SetPrimaryVaultImage(ctx context.Context, personaID string, mediaID string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Clear primary status for all media under this persona
	_, err = tx.ExecContext(ctx, `UPDATE user_media SET is_primary = FALSE WHERE user_id = $1`, personaID)
	if err != nil {
		return err
	}

	// Set new primary asset
	_, err = tx.ExecContext(ctx, `UPDATE user_media SET is_primary = TRUE WHERE id = $2 AND user_id = $1`, personaID, mediaID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// DeleteVaultMedia deletes an asset from the vault database
func (r *Repository) DeleteVaultMedia(ctx context.Context, mediaID string) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM user_media WHERE id = $1`, mediaID)
	return err
}

// LogMediaAudit records an administrative action on a vault
func (r *Repository) LogMediaAudit(ctx context.Context, action string, targetID string, adminName string, filename string) error {
	_, err := r.DB.ExecContext(ctx, `
       INSERT INTO media_audit_logs (action, target_profile_id, admin_identifier, filename)
       VALUES ($1, $2, $3, $4)
    `, action, targetID, adminName, filename)
	return err
}

// GetMediaAuditLogs fetches recent logs
func (r *Repository) GetMediaAuditLogs(ctx context.Context) ([]models.AdminMediaAuditLog, error) {
	query := `
       SELECT 
          l.id::text, l.action, COALESCE(mp.name, 'GLOBAL'), l.admin_identifier, COALESCE(l.filename, 'N/A'), l.created_at
       FROM media_audit_logs l
       LEFT JOIN managed_profiles mp ON l.target_profile_id = mp.id
       ORDER BY l.created_at DESC
       LIMIT 50
    `
	rows, err := r.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []models.AdminMediaAuditLog
	for rows.Next() {
		var log models.AdminMediaAuditLog
		var createdAt time.Time
		if err := rows.Scan(&log.ID, &log.Action, &log.Target, &log.Admin, &log.Filename, &createdAt); err != nil {
			continue
		}
		log.Time = createdAt.Format("15:04:05")
		logs = append(logs, log)
	}
	return logs, nil
}
