import { apiClient } from './client';

export const settingsService = {
  getSettings: async () => {
    const response = await apiClient.get('/settings');
    return response.data;
  },

  updateSettings: async (settingsData) => {
    const response = await apiClient.put('/settings', settingsData);
    return response.data;
  },

  deleteAccount: async () => {
    const response = await apiClient.delete('/settings/account');
    return response.data;
  },

  // =====================================================================
  // SECURITY & PRIVACY ACTIONS
  // =====================================================================

  createPlaidIdentityVerificationLinkToken: async (verificationConsent) => {
    const response = await apiClient.post('/settings/identity-verification/link-token', {
      verification_consent: verificationConsent === true,
    });
    return response.data;
  },

  completePlaidIdentityVerification: async (attemptId, identityVerificationId) => {
    const response = await apiClient.post('/settings/identity-verification/complete', {
      attempt_id: attemptId,
      identity_verification_id: identityVerificationId,
    });
    return response.data;
  },

  getPlaidIdentityVerificationStatus: async (attemptId) => {
    const response = await apiClient.get(
      `/settings/identity-verification/${encodeURIComponent(attemptId)}/status`,
    );
    return response.data;
  },

  requestDataDownload: async () => {
    const response = await apiClient.post('/settings/request-data');
    return response.data;
  },

  terminateOtherSessions: async () => {
    const response = await apiClient.post('/settings/terminate-sessions');
    return response.data;
  },

  getActiveSessions: async () => {
    const response = await apiClient.get('/settings/sessions');
    return response.data;
  },

  revokeSession: async (sessionId) => {
    const response = await apiClient.delete(`/settings/sessions/${encodeURIComponent(sessionId)}`);
    return response.data;
  },

  getPushVapidPublicKey: async () => {
    const response = await apiClient.get('/notifications/push/vapid');
    return response.data.public_key;
  },

  savePushSubscription: async (subscription) => {
    const response = await apiClient.post('/notifications/push/subscriptions', subscription);
    return response.data;
  },

  deletePushSubscription: async (endpoint) => {
    const response = await apiClient.delete('/notifications/push/subscriptions', { data: { endpoint } });
    return response.data;
  },

  getTwoFactorSettings: async () => {
    const response = await apiClient.get('/auth/two-factor');
    return response.data;
  },

  requestTwoFactorChange: async (enabled, channel) => {
    const response = await apiClient.post('/auth/two-factor/setup', { enabled, channel });
    return response.data;
  },

  verifyTwoFactorChange: async (challengeId, code, enabled) => {
    const response = await apiClient.post('/auth/two-factor/verify', {
      challenge_id: challengeId,
      code,
      enabled,
    });
    return response.data;
  },

  getBlockedUsers: async () => {
    const response = await apiClient.get('/settings/blocked');
    return response.data;
  },

  unblockUser: async (blockedId) => {
    const response = await apiClient.delete(`/settings/blocked/${blockedId}`);
    return response.data;
  },

  // =====================================================================
  // MEDIA VAULT MANAGEMENT
  // =====================================================================
  getMediaVault: async () => {
    const response = await apiClient.get('/settings/media');
    return response.data; 
  },

  uploadMedia: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await apiClient.post('/settings/media', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  deleteMedia: async (mediaId) => {
    const response = await apiClient.delete(`/settings/media/${mediaId}`);
    return response.data;
  },

  setPrimaryMedia: async (mediaId) => {
    const response = await apiClient.put(`/settings/media/${mediaId}/primary`);
    return response.data;
  },
};