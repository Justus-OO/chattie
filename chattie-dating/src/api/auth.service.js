// src/api/auth.service.js
import { apiClient } from './client';
import { useAppStore } from '../store/useAppStore';

export const authService = {
  register: async (username, email, password) => {
    try {
      const response = await apiClient.post('/auth/register', { username, email, password });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Registration failed');
    }
  },

  login: async (email, password) => {
    try {
      const response = await apiClient.post('/auth/login', { email, password });
      return response.data; 
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Login failed');
    }
  },

  verifyLoginCode: async (challengeId, code) => {
    const response = await apiClient.post('/auth/login/verify', { challenge_id: challengeId, code });
    return response.data;
  },

  requestPasswordReset: async (email, channel) => {
    const response = await apiClient.post('/auth/password-reset/request', { email, channel });
    return response.data;
  },

  completePasswordReset: async (challengeId, code, newPassword) => {
    const response = await apiClient.post('/auth/password-reset/complete', {
      challenge_id: challengeId,
      code,
      new_password: newPassword,
    });
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

  // NEW: Google Login
  googleLogin: async (idToken) => {
    try {
      const response = await apiClient.post('/auth/google', { id_token: idToken });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Google login failed');
    }
  },

  // NEW: Apple Login
  appleLogin: async (idToken) => {
    try {
      const response = await apiClient.post('/auth/apple', { id_token: idToken });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Apple login failed');
    }
  },

  setSession: (token, user) => {
    useAppStore.setState({ 
        token: token,
        user: user,
        isAuthenticated: true 
    });
  },
};