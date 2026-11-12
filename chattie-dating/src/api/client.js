// src/api/client.js
import axios from 'axios';
import { useAppStore } from '../store/useAppStore';

export const apiClient = axios.create({
  // Use the environment variable if available, otherwise fallback to localhost
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8080/api', 
  headers: {
    'Content-Type': 'application/json',
  },
});

// REQUEST INTERCEPTOR
apiClient.interceptors.request.use(
  (config) => {
    // 1. Try getting token from Zustand store
    let token = useAppStore.getState().token;

    // 2. Fallback: If Zustand doesn't have it yet, check localStorage directly
    if (!token) {
      try {
        const storedData = localStorage.getItem('chattie-session-storage');
        if (storedData) {
          const parsed = JSON.parse(storedData);
          token = parsed?.state?.token || '';
        }
      } catch (err) {
        console.error("Error reading token from storage fallback:", err);
      }
    }

    if (token) {
      const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
      config.headers.Authorization = `Bearer ${cleanToken}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// RESPONSE INTERCEPTOR
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response && error.response.status === 401) {
      const requestPath = error.config?.url || '';
      const isPublicAuthRequest = [
        '/auth/login',
        '/auth/login/verify',
        '/auth/password-reset/request',
        '/auth/password-reset/complete',
        '/auth/register',
        '/auth/google',
        '/auth/apple',
      ].some(path => requestPath === path || requestPath.startsWith(`${path}?`));
      if (!isPublicAuthRequest) {
        console.error('Session expired. Logging out.');
        useAppStore.getState().logout();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);