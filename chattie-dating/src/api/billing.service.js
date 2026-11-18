import { apiClient } from './client'; 

export const billingService = {
  /**
   * Fetch all active subscription plans from the database via the backend.
   * @returns {Promise<Array>} Array of plan objects (id, duration, price, monthly, save, isPopular)
   */
  getPlans: async () => {
    const response = await apiClient.get('/subscriptions/plans');
    return response.data;
  },

  /**
   * Initialize a checkout session using the country-aware provider selected by the backend.
   * 
   * @param {number} planId The duration in months (e.g., 1, 6, 12). Maps to req.PlanID in Go.
   * @returns {Promise<Object>} Provider checkout details and a durable billing_reference.
   */
  initiateUpgrade: async (planId = 1) => {
    const response = await apiClient.post('/subscriptions/upgrade', { plan_id: planId });
    return response.data;
  },

  /**
   * Verify a successful Stripe or Paystack payment.
   * Triggers the database upgrade and WebSocket unlocks on the backend.
   * 
   * @param {Object} params The verification parameters
   * @param {string} [params.sessionId] Stripe session_id
   * @param {string} [params.reference] Paystack reference
   * @param {number|string} params.months Duration purchased
   * @returns {Promise<Object>} Success message
   */
  verifyPayment: async ({ sessionId, reference, months }) => {
    const queryParams = new URLSearchParams();
    
    if (sessionId) queryParams.append('session_id', sessionId);
    if (reference) queryParams.append('reference', reference);
    if (months) queryParams.append('months', months.toString());

    // Send as GET because your Go backend VerifyPayment handler reads from r.URL.Query()
    const response = await apiClient.get(`/subscriptions/verify?${queryParams.toString()}`);
    return response.data;
  },

  getMpesaPaymentStatus: async (billingReference) => {
    const response = await apiClient.get('/subscriptions/mpesa/status', {
      params: { billing_reference: billingReference }
    });
    return response.data;
  },

  getPaymentMethods: async () => {
    const response = await apiClient.get('/subscriptions/payment-methods');
    return response.data;
  },

  removePaymentMethod: async (id) => {
    const response = await apiClient.delete(`/subscriptions/payment-methods/${encodeURIComponent(id)}`);
    return response.data;
  },
};