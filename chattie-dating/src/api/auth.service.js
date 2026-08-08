// src/api/auth.service.js
import { apiClient } from './client';
import { useAppStore } from '../store/useAppStore';

export const authService = {
  // 1. Register a new user
  register: async (username, email, password) => {
    try {
      const response = await apiClient.post('/auth/register', { username, email, password });
      return response.data;
    } catch (error) {
      // Pass the Go backend's exact error message to the frontend toast
      throw new Error(error.response?.data?.error || 'Registration failed');
    }
  },


  getClientDirectory: async () => {
    const res = await apiClient.get('/admin/clients');
    return res.data; // Array of AdminUserDetail
  },

  // Fetch top-bar client network telemetry (Total users, VIP counts, DAU)
  getClientTelemetry: async () => {
    const res = await apiClient.get('/admin/clients/telemetry');
    return res.data; // AdminClientTelemetry object
  },

  // Toggle user ban state (Active <-> Banned)
  toggleClientBan: async (userId) => {
    const res = await apiClient.patch(`/admin/clients/${userId}/ban`);
    return res.data;
  },

  // Downgrade a user's subscription tier to Standard
  revokeClientTier: async (userId) => {
    const res = await apiClient.patch(`/admin/clients/${userId}/revoke-tier`);
    return res.data;
  },


  // 2. Login to get the JWT token
  login: async (email, password) => {
    try {
      const response = await apiClient.post('/auth/login', { email, password });
      return response.data; // Returns { token, user }
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Login failed');
    }
  },

  // 3. Connect to Zustand Store
  setSession: (token, user) => {
    // Assuming your Zustand store has a method to set the token and user data
    // Update this to match exactly how your store is structured
    useAppStore.setState({ 
        token: token,
        user: user,
        isAuthenticated: true 
    });
  },
  
};