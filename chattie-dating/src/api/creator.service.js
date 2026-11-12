import { apiClient } from './client';

export const creatorService = {
  getAssignedProfiles: async () => {
    const res = await apiClient.get('/creator/profiles');
    return res.data; // Array of managed profiles
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
  processQueueAction: async (requestId, action, profileId) => {
    const res = await apiClient.post(`/creator/queue/${requestId}/action`, { action }, { params: { profile_id: profileId } });
    return res.data;
  },
  getLedger: async (profileId) => {
    const res = await apiClient.get('/creator/ledger', { params: { profile_id: profileId } });
    return res.data; // Array of Transaction
  },
  requestPayout: async (amount) => {
    const res = await apiClient.post('/creator/payout', { amount: Number(amount) });
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