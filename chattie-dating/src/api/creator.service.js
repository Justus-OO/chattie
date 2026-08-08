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

// ============================================================================
// NEW ADMIN CREATOR & OPERATOR ENGINE SERVICE
// ============================================================================
export const adminService = {
  getOperatorRoster: async () => {
    const res = await apiClient.get('/admin/operators');
    return res.data; // Array of OperatorDetail
  },
  updateCommission: async (operatorId, rate) => {
    const res = await apiClient.patch(`/admin/operators/${operatorId}/commission`, { rate: Number(rate) });
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

  updateOperatorStatus: async (operatorId, status) => {
    const res = await apiClient.patch(`/admin/operators/${operatorId}/status`, { status });
    return res.data;
  },
  
  toggleAutoPilot: async (operatorId, active) => {
    const res = await apiClient.patch(`/admin/operators/${operatorId}/autopilot`, { active });
    return res.data;
  },
  
  bindPersona: async (operatorId, personaId) => {
    const res = await apiClient.post(`/admin/operators/${operatorId}/personas/${personaId}`);
    return res.data;
  },
  
  unbindPersona: async (operatorId, personaId) => {
    const res = await apiClient.delete(`/admin/operators/${operatorId}/personas/${personaId}`);
    return res.data;
  },

  createPersona: async (payload) => {
    const res = await apiClient.post('/admin/personas', payload);
    return res.data;
  },
  
};