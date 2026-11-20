import { apiClient } from './client';

export const supportService = {
  listTickets: async () => {
    const response = await apiClient.get('/support/tickets');
    return response.data;
  },

  createTicket: async (subject, message) => {
    const response = await apiClient.post('/support/tickets', { subject, message });
    return response.data;
  },

  getMessages: async (ticketId) => {
    const response = await apiClient.get(`/support/tickets/${encodeURIComponent(ticketId)}/messages`);
    return response.data;
  },

  sendMessage: async (ticketId, message) => {
    const response = await apiClient.post(`/support/tickets/${encodeURIComponent(ticketId)}/messages`, { message });
    return response.data;
  },

  requestHuman: async (ticketId) => {
    const response = await apiClient.post(`/support/tickets/${encodeURIComponent(ticketId)}/handoff`);
    return response.data;
  },

  updateTicketStatus: async (ticketId, status) => {
    const response = await apiClient.patch(`/support/tickets/${encodeURIComponent(ticketId)}`, { status });
    return response.data;
  },

  listAdminTickets: async () => {
    const response = await apiClient.get('/admin/support/tickets');
    return response.data;
  },

  getAdminMessages: async (ticketId) => {
    const response = await apiClient.get(`/admin/support/tickets/${encodeURIComponent(ticketId)}/messages`);
    return response.data;
  },

  sendAdminMessage: async (ticketId, message) => {
    const response = await apiClient.post(`/admin/support/tickets/${encodeURIComponent(ticketId)}/messages`, { message });
    return response.data;
  },

  updateAdminTicket: async (ticketId, status) => {
    const response = await apiClient.patch(`/admin/support/tickets/${encodeURIComponent(ticketId)}`, { status });
    return response.data;
  },
};
