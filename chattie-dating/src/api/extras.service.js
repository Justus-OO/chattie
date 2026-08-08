import { apiClient } from './client';

export const extrasService = {
  /**
   * Process a VIP subscription upgrade
   * POST /api/subscriptions/upgrade
   * 
   * @param {number} planId - The duration of the plan in months (e.g., 1, 6, 12)
   * @param {number} price - The total price being charged
   * @param {string} paymentToken - Optional mock/real payment token for Stripe
   */
  upgradeSubscription: async (planId, price, paymentToken = '') => {
    try {
      const response = await apiClient.post('/subscriptions/upgrade', {
        plan_id: planId,
        price: price,
        payment_token: paymentToken
      });
      return response.data; // Returns { message: "..." }
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to process subscription upgrade');
    }
  },

  /**
   * Acknowledge and agree to the community guidelines
   * POST /api/extras/guidelines/agree
   */
  agreeToGuidelines: async () => {
    try {
      const response = await apiClient.post('/extras/guidelines/agree');
      return response.data; // Returns { message: "..." }
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to acknowledge guidelines');
    }
  },

  /**
   * Submit a detailed moderation report
   * POST /api/extras/report
   * 
   * @param {Object} data 
   * @param {string} [data.reportedId] - UUID of the user if reporting directly from a profile
   * @param {string} [data.reportedUsername] - Username if entered manually in the form
   * @param {string} data.reason - Category of violation
   * @param {string} data.description - Detailed explanation
   */
  submitReport: async ({ reportedId = '', reportedUsername = '', reason, description }) => {
    try {
      const response = await apiClient.post('/extras/report', {
        reported_id: reportedId,
        reported_username: reportedUsername,
        reason: reason,
        description: description
      });
      return response.data; // Returns { message: "..." }
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to submit report');
    }
  }
};