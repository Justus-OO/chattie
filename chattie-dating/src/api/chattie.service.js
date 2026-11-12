import { apiClient } from './client';

export const ChattieService = {

  // 1. Settings & Profile
  getSettings: async () => (await apiClient.get('/settings')).data,
  updateSettings: async (settingsData) => (await apiClient.put('/settings', settingsData)).data,
  deleteAccount: async () => (await apiClient.delete('/settings/account')).data,

  // 2. Media Vault & NSFW Moderation
  getMediaVault: async () => (await apiClient.get('/settings/media')).data,
  uploadVaultMedia: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return (await apiClient.post('/settings/media', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })).data;
  },

  uploadChatMedia: async (file) => {
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await apiClient.post('/api/chats/media', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      return res.data.media_url || res.data;
    } catch (error) {
      if (error.response?.status === 422) {
        throw new Error('Image rejected: Violates explicit content guidelines.');
      }
      throw error;
    }
  },

  deleteMedia: async (mediaId) => (await apiClient.delete(`/settings/media/${mediaId}`)).data,
  setPrimaryMedia: async (mediaId) => (await apiClient.put(`/settings/media/${mediaId}/primary`)).data,

  // 3. Chat & Read Receipts
  getInbox: async () => (await apiClient.get('/api/chats/inbox')).data,
  getChatHistory: async (targetId, type = 'dm') => (await apiClient.get(`/api/chats/${targetId}?type=${type}`)).data,
  markMessagesAsRead: async (targetId) => (await apiClient.patch(`/api/chats/${targetId}/read`)).data,

  // 4. Model/Operator Insights
  getUserInsights: async (userId) => (await apiClient.get(`/api/creator/insights/${userId}`)).data,

  // 5. Admin Trust & Safety
  getModerationQueue: async () => (await apiClient.get('/api/admin/moderation/queue')).data,
  resolveIncident: async (incidentId, targetId, actionType, note) => {
    return (await apiClient.post('/api/admin/moderation/action', { incidentId, targetId, actionType, note })).data;
  },
  getUserTelemetry: async (userId) => (await apiClient.get(`/api/admin/clients/${userId}/telemetry`)).data,
  getAuditLogs: async () => (await apiClient.get('/api/admin/moderation/audit')).data,
  getFirewallRules: async () => (await apiClient.get('/api/admin/moderation/rules')).data,
  toggleFirewallRule: async (ruleId) => (await apiClient.post('/api/admin/moderation/rules/toggle', { ruleId })).data
};

export default ChattieService;
