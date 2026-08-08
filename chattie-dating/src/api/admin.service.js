import { apiClient } from './client';

export const adminService = {
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
    const res = await apiClient.post(`/admin/operators/${operatorId}/personas/${personaId}`);
    return res.data;
  },

  unbindPersona: async (operatorId, personaId) => {
    const res = await apiClient.delete(`/admin/operators/${operatorId}/personas/${personaId}`);
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


  getPersonaMetrics: async () => {
    const res = await apiClient.get('/admin/personas-metrics');
    return res.data; // Array of PersonaMetric
  },

  createPersona: async (payload) => {
    const res = await apiClient.post('/admin/personas', payload);
    return res.data;
  },

  provisionCreator: async (payload) => {
    const res = await apiClient.post('/admin/creators/provision', payload);
    return res.data;
  },
};