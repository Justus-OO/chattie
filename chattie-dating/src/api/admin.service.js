import { apiClient } from './client';

export const adminService = {
  downloadReport: async (type, userId) => {
    const path = type === 'user' ? `/admin/reports/user/${encodeURIComponent(userId)}`
      : `/admin/reports/${encodeURIComponent(type)}`;
    const res = await apiClient.get(path, { responseType: 'blob' });
    return res.data;
  },
  getDashboardTelemetry: async () => {
    const res = await apiClient.get('/admin/dashboard');
    return res.data;
  },

  getModerationTerms: async () => {
    const res = await apiClient.get('/admin/settings/moderation-terms');
    return res.data;
  },

  createModerationTerm: async (payload) => {
    const res = await apiClient.post('/admin/settings/moderation-terms', payload);
    return res.data;
  },

  deleteModerationTerm: async (termId) => {
    const res = await apiClient.delete(`/admin/settings/moderation-terms/${encodeURIComponent(termId)}`);
    return res.data;
  },

  getAfterDarkAutoModeration: async () => {
    const res = await apiClient.get('/admin/settings/afterdark/auto-moderation');
    return res.data;
  },

  updateAfterDarkAutoModeration: async (enabled) => {
    const res = await apiClient.patch('/admin/settings/afterdark/auto-moderation', {
      auto_approve_new_posts: Boolean(enabled),
    });
    return res.data;
  },

  getRegionalCountries: async () => {
    const res = await apiClient.get('/admin/settings/regions/countries');
    return res.data;
  },

  blockRegionalCountry: async (countryCode) => {
    const res = await apiClient.post('/admin/settings/regions/countries', { country_code: countryCode });
    return res.data;
  },

  unblockRegionalCountry: async (countryCode) => {
    const res = await apiClient.delete(`/admin/settings/regions/countries/${encodeURIComponent(countryCode)}`);
    return res.data;
  },

  getFinanceAnalytics: async (period = '30D') => {
    const res = await apiClient.get('/admin/finance', { params: { period } });
    return res.data;
  },

  getAfterDarkPosts: async ({ status = 'all', limit = 50, offset = 0 } = {}) => {
    const res = await apiClient.get('/admin/afterdark/posts', { params: { status, limit, offset } });
    return res.data;
  },

  getAfterDarkPostMedia: async (postId) => {
    const res = await apiClient.get(`/admin/afterdark/posts/${encodeURIComponent(postId)}/media-url`);
    return res.data;
  },

  moderateAfterDarkPost: async (postId, action, reason) => {
    const res = await apiClient.patch(`/admin/afterdark/posts/${encodeURIComponent(postId)}/moderation`, { action, reason });
    return res.data;
  },

  scoreAfterDarkPostSafety: async (postId) => {
    const res = await apiClient.post(`/admin/afterdark/posts/${encodeURIComponent(postId)}/ai-score`);
    return res.data;
  },

  autoApproveSafeAfterDarkPosts: async () => {
    const res = await apiClient.post('/admin/afterdark/posts/ai-auto-approve');
    return res.data;
  },

  getPendingAfterDarkEarnings: async () => {
    const res = await apiClient.get('/admin/afterdark/earnings-clearance');
    return res.data;
  },

  clearAfterDarkEarnings: async (userId, payload) => {
    const res = await apiClient.post(`/admin/afterdark/earnings-clearance/${userId}`, payload);
    return res.data;
  },

  autoClearAfterDarkPPEarnings: async (userId) => {
    const res = await apiClient.post(`/admin/afterdark/earnings-clearance/${encodeURIComponent(userId)}/auto`);
    return res.data;
  },

  // ==========================================
  // 1. OPERATORS & CREATOR ENGINE
  // ==========================================
  getOperatorRoster: async () => {
    const res = await apiClient.get('/admin/operators');
    return res.data; // Array of OperatorDetail
  },

  updateCommission: async (operatorId, rate) => {
    const res = await apiClient.patch(`/admin/operators/${operatorId}/commission`, { rate: Number(rate) });
    return res.data;
  },

  updateOperatorStatus: async (operatorId, status) => {
    const res = await apiClient.patch(`/admin/operators/${operatorId}/status`, { status });
    return res.data;
  },

  toggleAutoPilot: async (operatorId, active) => {
    const res = await apiClient.patch(`/admin/operators/${operatorId}/autopilot`, { active });
    return res.data;
  },

  bindPersona: async (operatorId, personaId) => {
    const res = await apiClient.post(`/admin/operators/${encodeURIComponent(operatorId)}/personas/${encodeURIComponent(personaId)}`);
    return res.data;
  },

  unbindPersona: async (operatorId, personaId) => {
    const res = await apiClient.delete(`/admin/operators/${encodeURIComponent(operatorId)}/personas/${encodeURIComponent(personaId)}`);
    return res.data;
  },

  notifyOperatorPendingReplies: async (operatorId) => {
    const res = await apiClient.post(`/admin/operators/${encodeURIComponent(operatorId)}/notify-pending-replies`);
    return res.data;
  },

  getPersonaMetrics: async () => {
    const res = await apiClient.get('/admin/personas-metrics');
    return res.data; // Array of PersonaMetric
  },

  provisionCreator: async (payload) => {
    const res = await apiClient.post('/admin/creators/provision', payload);
    return res.data;
  },
  getCreatorApplications: async () => {
    const res = await apiClient.get('/admin/creator-applications');
    return res.data;
  },
  reviewCreatorApplication: async (applicationId, decision) => {
    const res = await apiClient.patch(`/admin/creator-applications/${encodeURIComponent(applicationId)}`, { decision });
    return res.data;
  },
  getCreatorPayoutRequests: async (status = 'ALL') => {
    const res = await apiClient.get('/admin/creator-payouts', { params: { status } });
    return res.data;
  },
  reviewCreatorPayout: async (payoutId, payload) => {
    const res = await apiClient.post(`/admin/creator-payouts/${encodeURIComponent(payoutId)}/review`, payload);
    return res.data;
  },

  // ==========================================
  // 2. CLIENT NETWORK DIRECTORY
  // ==========================================
  getClientDirectory: async () => {
    const res = await apiClient.get('/admin/clients');
    return res.data; // Array of AdminUserDetail
  },

  getClientTelemetry: async () => {
    const res = await apiClient.get('/admin/clients/telemetry');
    return res.data; // AdminClientTelemetry object
  },

  toggleClientBan: async (userId) => {
    const res = await apiClient.patch(`/admin/clients/${userId}/ban`);
    return res.data;
  },

  revokeClientTier: async (userId) => {
    const res = await apiClient.patch(`/admin/clients/${userId}/revoke-tier`);
    return res.data;
  },

  // ==========================================
  // 3. MEDIA VAULTS & ASSET INJECTION
  // ==========================================
  getVaults: async () => {
    const res = await apiClient.get('/admin/media/vaults');
    return res.data;
  },

  getVaultGallery: async (personaId) => {
    const res = await apiClient.get(`/admin/media/vaults/${personaId}/gallery`);
    return res.data;
  },

  setPrimary: async (personaId, mediaId) => {
    const res = await apiClient.patch(`/admin/media/vaults/${personaId}/primary/${mediaId}`);
    return res.data;
  },

  deleteAsset: async (mediaId) => {
    const res = await apiClient.delete(`/admin/media/assets/${mediaId}`);
    return res.data;
  },

  injectAssets: async (personaId, formData) => {
    const res = await apiClient.post(`/admin/media/vaults/${personaId}/inject`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return res.data;
  },

  getAuditLogs: async () => {
    const res = await apiClient.get('/admin/media/audit-logs');
    return res.data;
  },





  // ==========================================
  // 4. ROOMS & ROUTING CONTROL
  // ==========================================
  getRooms: async () => {
    const res = await apiClient.get('/admin/rooms');
    return res.data;
  },

  terminateRoom: async (roomId) => {
    const res = await apiClient.delete(`/admin/rooms/${roomId}`);
    return res.data;
  },

  updateRoomStatus: async (roomId, status) => {
    const res = await apiClient.patch(`/admin/rooms/${encodeURIComponent(roomId)}/status`, { status });
    return res.data;
  },

  getRoomParticipants: async (roomId) => {
    const res = await apiClient.get(`/admin/rooms/${roomId}/participants`);
    return res.data;
  },

  kickRoomParticipant: async (roomId, userId) => {
    const res = await apiClient.delete(`/admin/rooms/${roomId}/participants/${userId}`);
    return res.data;
  },

  getKnocks: async () => {
    const res = await apiClient.get('/admin/rooms/knocks');
    return res.data;
  },

  resolveKnock: async (knockId, action) => {
    const res = await apiClient.post(`/admin/rooms/knocks/${knockId}/resolve`, { action });
    return res.data;
  },




  // ==========================================
  // 5. TRUST & SAFETY MODERATION
  // ==========================================
  getModerationQueue: async () => {
    const res = await apiClient.get('/admin/moderation/queue');
    return res.data; // Array of ModerationItem
  },

  resolveIncident: async (incidentId, targetId, actionType, note) => {
    const res = await apiClient.post('/admin/moderation/action', {
      incidentId,
      targetId,
      actionType,
      note
    });
    return res.data;
  },

  getAccountReviewQueue: async () => {
    const res = await apiClient.get('/admin/moderation/appeals');
    return res.data;
  },

  resolveAccountReview: async (reviewId, decision, note) => {
    const res = await apiClient.post(`/admin/moderation/appeals/${encodeURIComponent(reviewId)}`, { decision, note });
    return res.data;
  },

  getModerationAuditLogs: async () => {
    const res = await apiClient.get('/admin/moderation/audit');
    return res.data; // Array of AuditLog
  },

  getFirewallRules: async () => {
    const res = await apiClient.get('/admin/moderation/rules');
    return res.data; // Array of FirewallRule
  },

  toggleFirewallRule: async (ruleId) => {
    const res = await apiClient.post('/admin/moderation/rules/toggle', { ruleId });
    return res.data;
  },


  createPersona: async (payload) => {
    const res = await apiClient.post('/admin/personas', payload);
    return res.data;
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