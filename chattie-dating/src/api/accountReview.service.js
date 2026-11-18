import { apiClient } from './client';

export const accountReviewService = {
  getMyReview: async () => {
    const response = await apiClient.get('/account-review');
    return response.data.review;
  },
  submitReview: async (reason) => {
    const response = await apiClient.post('/account-review', { reason });
    return response.data.review;
  },
};
