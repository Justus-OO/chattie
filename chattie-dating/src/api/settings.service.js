import { apiClient } from './client';

export const settingsService = {
  /**
   * Fetches the user's current profile and settings data
   * GET /api/settings
   */
  getSettings: async () => {
    try {
      const response = await apiClient.get('/settings');
      return response.data;
    } catch (error) {
      console.error("Failed to fetch settings:", error);
      throw error;
    }
  },

  /**
   * Pushes the entire profile and settings object to the backend
   * PUT /api/settings
   */
  updateSettings: async (settingsData) => {
    try {
      const response = await apiClient.put('/settings', settingsData);
      return response.data;
    } catch (error) {
      console.error("Failed to save settings:", error);
      throw error;
    }
  },

  /**
   * Permanently deletes the user account
   * DELETE /api/settings/account
   */
  deleteAccount: async () => {
    try {
      const response = await apiClient.delete('/settings/account');
      return response.data;
    } catch (error) {
      console.error("Failed to delete account:", error);
      throw error;
    }
  },

  // =====================================================================
  // MEDIA VAULT MANAGEMENT
  // =====================================================================

  /**
   * Fetches the user's uploaded media vault images
   * GET /api/settings/media
   */
  getMediaVault: async () => {
    try {
      const response = await apiClient.get('/settings/media');
      return response.data; // Returns array of media objects
    } catch (error) {
      console.error("Failed to fetch media vault:", error);
      throw error;
    }
  },

  /**
   * Uploads a new image to the user's media vault
   * POST /api/settings/media
   */
  uploadMedia: async (file) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await apiClient.post('/settings/media', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error) {
      console.error("Failed to upload media:", error);
      throw error;
    }
  },

  /**
   * Deletes a specific media item from the vault
   * DELETE /api/settings/media/{media_id}
   */
  deleteMedia: async (mediaId) => {
    try {
      const response = await apiClient.delete(`/settings/media/${mediaId}`);
      return response.data;
    } catch (error) {
      console.error("Failed to delete media:", error);
      throw error;
    }
  },

  /**
   * Sets a specific media item as the primary profile picture
   * PUT /api/settings/media/{media_id}/primary
   */
  setPrimaryMedia: async (mediaId) => {
    try {
      const response = await apiClient.put(`/settings/media/${mediaId}/primary`);
      return response.data;
    } catch (error) {
      console.error("Failed to set primary media:", error);
      throw error;
    }
  }
};