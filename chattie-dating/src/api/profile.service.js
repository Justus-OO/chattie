import { apiClient } from './client';

export const profileService = {
  requestEmailOTP: async (token) => {
    try {
      const response = await apiClient.post('/profile/request-otp', { channel: 'email' }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Could not send verification code');
    }
  },

  verifyOTP: async (code, token) => {
    try {
      const response = await apiClient.post('/profile/verify-otp', { code }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Invalid OTP');
    }
  },

  setupBasics: async (data, token) => {
    try {
      const response = await apiClient.post('/profile/setup', data, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to save profile basics');
    }
  },

  uploadInitialMedia: async (formData, token) => {
    try {
      const response = await apiClient.post('/profile/media/initial', formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to upload photo');
    }
  },

  updateLocation: async (data, token) => {
    try {
      const response = await apiClient.post('/profile/location', data, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to update location');
    }
  },

  updatePreferences: async (data, token) => {
    try {
      const response = await apiClient.post('/profile/preferences', data, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to update preferences');
    }
  },

  activateAccount: async (token) => {
    try {
      const response = await apiClient.post('/profile/activate', {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data;
    } catch (error) {
      const responseData = error.response?.data;
      const missing = Array.isArray(responseData?.missing) ? responseData.missing : [];
      const message = responseData?.error || 'Failed to activate account';
      throw new Error(missing.length ? `${message} ${missing.join('; ')}` : message);
    }
  }
};