import { apiClient } from './client';

export const discoveryService = {
  // 1. Fetch the swipe deck profiles
  getSwipeDeck: async (limit = 20, offset = 0) => {
    try {
      const response = await apiClient.get(`/discover/deck`, {
        params: { limit, offset },
      });
      return response.data; // Returns array of DiscoverProfile
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to load discover deck');
    }
  },

  // 2. Fetch grid browse profiles with advanced filters and sorting
  getGridProfiles: async (filters = {}) => {
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
      });
      return response.data; // Returns array of DiscoverProfile
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to load grid profiles');
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
      const err = new Error(error.response?.data?.error || 'Failed to process interaction');
      err.status = error.response?.status;
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

  // 5. Undo the last swipe action (Rewind)
  undoLastAction: async () => {
    try {
      const response = await apiClient.post('/extras/undo');
      return response.data;
    } catch (error) {
      const err = new Error(error.response?.data?.error || 'Failed to undo action');
      err.status = error.response?.status;
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