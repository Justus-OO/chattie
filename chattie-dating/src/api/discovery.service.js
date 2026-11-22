import { apiClient } from './client';

let premiumStatusRequest = null;

export const discoveryService = {
  // 1. Fetch the swipe deck profiles
  getSwipeDeck: async (limit = 20, offset = 0) => {
    try {
      const response = await apiClient.get(`/discover/deck`, {
        params: { limit, offset },
      });
      return response.data; // Returns array of DiscoverProfile
    } catch (error) {
      const requestError = new Error(error.response?.data?.error || 'Failed to load discover deck');
      requestError.status = error.response?.status;
      requestError.code = error.response?.data?.code || error.response?.data?.error;
      throw requestError;
    }
  },

  getSwipeDeckDiagnostics: async () => {
    try {
      const response = await apiClient.get('/discover/diagnostics');
      return response.data;
    } catch (error) {
      const requestError = new Error(error.response?.data?.error || 'Failed to load discovery diagnostics');
      requestError.status = error.response?.status;
      requestError.code = error.response?.data?.code || error.response?.data?.error;
      throw requestError;
    }
  },

  // 2. Fetch grid browse profiles with advanced filters and sorting
  getGridProfiles: async (filters = {}, { signal } = {}) => {
    try {
      const response = await apiClient.get('/grid', {
        params: {
          limit: filters.limit || 24,
          offset: filters.offset || 0,
          min_age: filters.minAge,
          max_age: filters.maxAge,
          intent: filters.intent,
          status: filters.status,
          q: filters.searchQuery,
          sort: filters.sortBy,
        },
        signal,
      });
      return response.data; // Returns array of DiscoverProfile
    } catch (error) {
      if (error.code === 'ERR_CANCELED') throw error;
      const requestError = new Error(error.response?.data?.message || error.response?.data?.error || 'Failed to load grid profiles');
      requestError.status = error.response?.status;
      requestError.code = error.response?.data?.error;
      throw requestError;
    }
  },

  // 3. Send an interaction (LIKE, PASS, SUPER_LIKE, FLIRT)
  sendInteraction: async (targetId, actionType) => {
    try {
      const response = await apiClient.post('/interactions', {
        target_id: targetId,
        action_type: actionType,
      });
      return response.data; // Returns { allowed, is_match, message }
    } catch (error) {
      // Preserve status code context for UI handling (e.g. 402 for limits, 409 for duplicate)
      const responseData = error.response?.data;
      const err = new Error(responseData?.message || responseData?.error || 'Failed to process interaction');
      err.status = error.response?.status;
      err.code = responseData?.code || responseData?.error;
      throw err;
    }
  },

  // 4. Fetch secret admirers (Likes page)
  getSecretAdmirers: async () => {
    try {
      const response = await apiClient.get('/extras/admirers');
      return response.data; // Returns { is_premium: boolean, admirers: [...] }
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to load secret admirers');
    }
  },

  getPremiumStatus: async () => {
    if (!premiumStatusRequest) {
      premiumStatusRequest = apiClient.get('/extras/admirers')
        .then(response => {
          if (typeof response.data?.is_premium !== 'boolean') {
            throw new Error('The server returned an invalid subscription status');
          }
          return response.data.is_premium;
        })
        .catch(error => {
          throw new Error(error.response?.data?.error || error.message || 'Failed to load subscription status');
        });
    }

    try {
      return await premiumStatusRequest;
    } finally {
      premiumStatusRequest = null;
    }
  },

  // 5. Undo the last swipe action (Rewind)
  undoLastAction: async () => {
    try {
      const response = await apiClient.post('/extras/undo');
      return response.data;
    } catch (error) {
      const responseData = error.response?.data;
      const err = new Error(responseData?.message || responseData?.error || 'Failed to undo action');
      err.status = error.response?.status;
      err.code = responseData?.code || responseData?.error;
      throw err;
    }
  },

  // 6. Report a user
  reportUser: async (reportedId, reason) => {
    try {
      const response = await apiClient.post('/extras/report', {
        reported_id: reportedId,
        reason: reason,
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to submit report');
    }
  },

  // 7. Block a user (UPDATED TO MATCH GO BACKEND)
  blockUser: async (targetId) => {
    try {
      const response = await apiClient.post('/interactions/block', {
        target_id: targetId, // Go backend expects target_id
      });
      return response.data;
    } catch (error) {
      console.error('Failed to block user:', error);
      throw new Error(error.response?.data?.error || 'Failed to block user');
    }
  },

  // 8. Fetch mutual matches (Sidebar & Inbox)
  getMatches: async () => {
    try {
      const response = await apiClient.get('/matches');
      return response.data; // Returns array of MatchResponse
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to load matches');
    }
  },

  // 9. Unmatch a user (NEW)
  unmatchUser: async (targetId) => {
    try {
      const response = await apiClient.post('/interactions/unmatch', {
        target_id: targetId,
      });
      return response.data;
    } catch (error) {
      console.error('Failed to unmatch user:', error);
      throw new Error(error.response?.data?.error || 'Failed to unmatch user');
    }
  },

  // 10. Fetch Full Profile for Drawers/Modals (NEW)
  getFullProfile: async (targetId) => {
    try {
      const response = await apiClient.get(`/interactions/profile/${targetId}`);
      return response.data; // Returns DiscoverProfile with full array of images & bio
    } catch (error) {
      console.error('Failed to fetch full profile:', error);
      throw new Error(error.response?.data?.error || 'Failed to load user profile');
    }
  }
};