import { apiClient } from './client';

export const creatorService = {
  getAssignedProfiles: async () => {
    const res = await apiClient.get('/creator/profiles');
    return res.data; // Array of managed profiles
  },
  getModelSettings: async () => {
    const res = await apiClient.get('/creator/settings');
    return res.data;
  },
  updateModelSettings: async (settings) => {
    const res = await apiClient.patch('/creator/settings', settings);
    return res.data;
  },
  updateProfileDetails: async (profileId, details) => {
    const res = await apiClient.patch(`/creator/profiles/${encodeURIComponent(profileId)}`, details);
    return res.data;
  },
  updateProfileStatus: async (profileId, status) => {
    const res = await apiClient.patch(`/creator/profiles/${profileId}/status`, { status });
    return res.data;
  },
  getDashboardStats: async (profileId) => {
    const res = await apiClient.get('/creator/dashboard', { params: { profile_id: profileId } });
    return res.data;
  },
  getChatQueue: async (profileId) => {
    const res = await apiClient.get('/creator/queue', { params: { profile_id: profileId } });
    return res.data; // Array of ChatQueueItem
  },
  getProfileConversations: async (profileId) => {
    const res = await apiClient.get(`/creator/profiles/${encodeURIComponent(profileId)}/conversations`);
    return res.data;
  },
  getProfileChatHistory: async (profileId, partnerId) => {
    const res = await apiClient.get(
      `/creator/profiles/${encodeURIComponent(profileId)}/conversations/${encodeURIComponent(partnerId)}/messages`
    );
    return res.data;
  },
  generateModelReplySuggestions: async (profileId, partnerId) => {
    const res = await apiClient.post(
      `/creator/profiles/${encodeURIComponent(profileId)}/conversations/${encodeURIComponent(partnerId)}/assistant/suggestions`
    );
    return res.data;
  },
  blockProfileConversationUser: async (profileId, partnerId) => {
    const res = await apiClient.post(
      `/creator/profiles/${encodeURIComponent(profileId)}/conversations/${encodeURIComponent(partnerId)}/block`
    );
    return res.data;
  },
  reportProfileConversationUser: async (profileId, partnerId, reason) => {
    const res = await apiClient.post(
      `/creator/profiles/${encodeURIComponent(profileId)}/conversations/${encodeURIComponent(partnerId)}/report`,
      { reason }
    );
    return res.data;
  },
  processQueueAction: async (requestId, action, profileId) => {
    const res = await apiClient.post(`/creator/queue/${requestId}/action`, { action }, { params: { profile_id: profileId } });
    return res.data;
  },
  getLedger: async (profileId) => {
    const res = await apiClient.get('/creator/ledger', { params: { profile_id: profileId } });
    return res.data; // Array of Transaction
  },
  getPayoutMethods: async () => {
    const res = await apiClient.get('/creator/payout-methods');
    return res.data;
  },
  savePayoutMethod: async (assetNetwork, walletAddress) => {
    const res = await apiClient.put(`/creator/payout-methods/${encodeURIComponent(assetNetwork)}`, {
      wallet_address: walletAddress
    });
    return res.data;
  },
  getPayoutRequests: async () => {
    const res = await apiClient.get('/creator/payout-requests');
    return res.data;
  },
  requestCryptoPayout: async (payload) => {
    const res = await apiClient.post('/creator/payout', payload);
    return res.data;
  },
  getProfileMedia: async (profileId) => {
    const res = await apiClient.get(`/creator/profiles/${profileId}/media`);
    return res.data;
  },
  toggleOnlineStatus: async (isOnline) => {
    const res = await apiClient.post('/creator/status', { is_online: isOnline });
    return res.data;
  }
};
// Note: admin-related helpers removed from creator.service to avoid duplicate admin exports.