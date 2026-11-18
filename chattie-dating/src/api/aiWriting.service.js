import { apiClient } from './client';

export const aiWritingService = {
  generateProfileBios: async ({ interests, draft }) => {
    const response = await apiClient.post('/assistant/profile-bio', { interests, draft });
    return response.data;
  },

  generateCreatorCaptions: async ({ context, draft }) => {
    const response = await apiClient.post('/afterdark/assistant/captions', { context, draft });
    return response.data;
  },
};
