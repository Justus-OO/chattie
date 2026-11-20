import { apiClient } from './client';

export const AFTER_DARK_CREATOR_POLICY_VERSION = 'afterdark-creator-v1';

/**
 * After Dark API Service
 * 
 * Maps 1:1 with the Go Backend /api/afterdark routes.
 * 
 * CRITICAL RULE FOR FRONTEND DEVELOPERS:
 * Never use "Optimistic UI" for financial transactions, unlocks, or file uploads.
 * Always wait for the Promise to resolve before revealing media, deducting local balances,
 * or showing a success state.
 */
export const afterDarkService = {
  // =====================================================================
  // ONBOARDING & PROFILES
  // =====================================================================
  
  /**
   * Submits the creator application
   * @component OptInGateModal.jsx
   * @param {Object} applicationData - Includes alias, eligibility, payout, and versioned policy consent.
   */
  submitCreatorApplication: async (applicationData) => {
    const response = await apiClient.post('/afterdark/me/creator-application', applicationData);
    return response.data;
  },

  getMyCreatorApplication: async () => {
    const response = await apiClient.get('/afterdark/me/creator-application');
    return response.data;
  },

  /**
   * Fetches the current user's creator profile and onboarding status.
   * @component AfterDarkSettings.jsx (Creator Tab), AfterDarkMyChannel.jsx
   */
  getMyPerformerProfile: async () => {
    const response = await apiClient.get('/afterdark/me/creator-profile');
    return response.data;
  },

  /**
   * Fetches the current user's settings (watermarks, geo-blocking, DM controls)
   */
  getMySettings: async () => {
    const response = await apiClient.get('/afterdark/me/settings');
    return response.data;
  },

  /**
   * Updates the creator's public persona
   * @component AfterDarkSettings.jsx
   * @param {Object} profileData - { display_name: 'Name', username: 'user', bio: 'New bio', website: 'https...', location: 'Nairobi', dm_control: 'all'|'subscribers'|'none' }
   */
  updateMyPerformerProfile: async (profileData) => {
    const response = await apiClient.patch('/afterdark/me/creator-profile', profileData);
    return response.data;
  },

  uploadCreatorImage: async (kind, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post(`/afterdark/me/creator-profile/${kind}-upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  // =====================================================================
  // DISCOVERY & FEED
  // =====================================================================
  
  /**
   * Searches and filters the creator directory.
   * @component AfterDarkDirectory.jsx
   * @param {Object} params - e.g., { q: 'search term', limit: 20, cursor: '...' }
   */
  getDirectory: async (params) => {
    const response = await apiClient.get('/afterdark/creators', { params });
    return response.data;
  },

  /**
   * Fetches a specific creator's public profile data.
   * @component AfterDarkCreatorProfile.jsx
   */
  getCreatorProfile: async (creatorId) => {
    const response = await apiClient.get(`/afterdark/creators/${encodeURIComponent(creatorId)}`);
    return response.data;
  },

  /**
   * Fetches the viewer-authorized creator feed.
   * @component AfterDarkFeed.jsx
   * @param {Object} params - e.g., { creator_id: '...', access: 'free'|'subscriber'|'ppv'|'all', feed_scope: 'discover'|'following', page: 0 }
   */
  getFeed: async (params) => {
    const response = await apiClient.get('/afterdark/feed', { params });
    return response.data;
  },

  getPostMediaUrl: async (postId) => {
    const response = await apiClient.get(`/afterdark/posts/${encodeURIComponent(postId)}/media-url`);
    return response.data;
  },

  getLiveSessions: async (params) => {
    const response = await apiClient.get('/afterdark/live-sessions', { params });
    return response.data;
  },

  /**
   * Fetches currently active live sessions for the "Stories" bubbles at the top of the feed.
   * @component AfterDarkFeed.jsx (Story Circles)
   */
  getStories: async () => {
    const response = await apiClient.get('/afterdark/stories');
    return response.data;
  },

  // =====================================================================
  // MEDIA VAULT & POSTS
  // =====================================================================
  
  /**
   * Uploads and publishes a new post (Free or PPV).
   * @component UploadExplicitModal.jsx
   * @param {FormData} formData - MUST contain 'media' (file), 'caption', 'access_type', and 'price_cents'.
   */
  createPost: async (formData, onUploadProgress) => {
    const response = await apiClient.post('/afterdark/me/posts', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onUploadProgress
        ? event => {
          if (event.total) onUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
        : undefined,
    });
    return response.data;
  },

  /**
   * Fetches posts owned by the authenticated creator (their vault).
   * @component AfterDarkMyChannel.jsx (Vault Tab)
   * @param {Object} params - e.g., { status: 'published'|'scheduled' }
   */
  getVaultPosts: async (params) => {
    const response = await apiClient.get('/afterdark/me/posts', { params });
    return response.data;
  },

  getMySubscribers: async (params) => {
    const response = await apiClient.get('/afterdark/me/subscribers', { params });
    return response.data;
  },

  getEarningsSummary: async () => {
    const response = await apiClient.get('/afterdark/me/earnings');
    return response.data;
  },

  updatePost: async (postId, postData) => {
    const response = await apiClient.patch(`/afterdark/me/posts/${postId}`, postData);
    return response.data;
  },

  /**
   * Deletes/Archives a post from the creator's vault.
   * @component AfterDarkMyChannel.jsx (Vault Tab)
   */
  deletePost: async (postId) => {
    const response = await apiClient.delete(`/afterdark/me/posts/${postId}`);
    return response.data;
  },

  // =====================================================================
  // INTERACTIONS (LIKES, COMMENTS, REPORTS)
  // =====================================================================
  
  /**
   * Toggles the like status of a post. Idempotent.
   * @component LockedPostCard.jsx
   * @returns {Object} { status: 'success', liked: true/false }
   */
  toggleLike: async (postId) => {
    const response = await apiClient.post(`/afterdark/posts/${postId}/likes`);
    return response.data;
  },

  /**
   * Fetches paginated comments for a post.
   * @component LockedPostCard.jsx (Comment Panel)
   */
  getComments: async (postId, params) => {
    const response = await apiClient.get(`/afterdark/posts/${postId}/comments`, { params });
    return response.data;
  },

  /**
   * Adds a new comment to a post.
   * @component LockedPostCard.jsx (Comment Input)
   */
  addComment: async (postId, content) => {
    const response = await apiClient.post(`/afterdark/posts/${postId}/comments`, { content });
    return response.data;
  },

  /**
   * Submits a Trust & Safety report for a user, post, message, or comment.
   * @component Overflow Menus (Profile, Post, Comment)
   * @param {Object} reportData - { target_type: 'post', target_id: 'uuid', reason: 'Spam', details: '...' }
   */
  submitReport: async (reportData) => {
    const response = await apiClient.post('/afterdark/moderation/reports', reportData);
    return response.data;
  },

  // =====================================================================
  // PRIVATE CHATS (DMs)
  // =====================================================================
  
  /**
   * Initiates a stable 1-on-1 thread with another user.
   * @component AfterDarkCreatorProfile.jsx (Message Button), AfterDarkChatHub.jsx
   * @param {string} targetUserId - The ID of the user you want to chat with.
   * @returns {Object} { conversation_id: 'uuid' }
   */
  initConversation: async (targetUserId) => {
    const response = await apiClient.post('/afterdark/conversations', { target_user_id: targetUserId });
    return response.data;
  },

  /**
   * Fetches message history for a thread.
   * @component AfterDarkChatHub.jsx, SubscriberMessageModal.jsx
   */
  getMessages: async (conversationId, params) => {
    const response = await apiClient.get(`/afterdark/conversations/${conversationId}/messages`, { params });
    return response.data;
  },

  getConversations: async (params) => {
    const response = await apiClient.get('/afterdark/conversations', { params });
    return response.data;
  },

  uploadMessageAttachment: async (conversationId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post(`/afterdark/conversations/${conversationId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /**
   * Sends a message in a specific conversation.
   * @component AfterDarkChatHub.jsx, SubscriberMessageModal.jsx
   * @param {Object} messageData - { content: 'hello', is_explicit: false, media_asset_id: '' }
   */
  sendMessage: async (conversationId, messageData) => {
    const response = await apiClient.post(`/afterdark/conversations/${conversationId}/messages`, messageData);
    return response.data;
  },

  pinMessage: async (conversationId, messageId, pinned) => {
    const response = await apiClient.post(`/afterdark/conversations/${conversationId}/messages/pin`, {
      message_id: messageId,
      pinned,
    });
    return response.data;
  },

  toggleMessageReaction: async (conversationId, messageId, emoji) => {
    const response = await apiClient.post(`/afterdark/conversations/${conversationId}/messages/reactions`, {
      message_id: messageId,
      emoji,
    });
    return response.data;
  },

  getConversationCallToken: async (conversationId, participantName) => {
    const response = await apiClient.post(`/afterdark/conversations/${conversationId}/voice-token`, {
      participant_name: participantName,
    });
    return response.data;
  },

  recordConversationCallEvent: async (conversationId, event, mode) => {
    const response = await apiClient.post(`/afterdark/conversations/${conversationId}/call-events`, { event, mode });
    return response.data;
  },

  /**
   * Updates the read receipt cursor when the user opens a thread.
   * @component AfterDarkChatHub.jsx (on thread selection)
   */
  markConversationRead: async (conversationId) => {
    const response = await apiClient.post(`/afterdark/conversations/${conversationId}/read`);
    return response.data;
  },

  unlockChatWithWallet: async (conversationId) => {
    const response = await apiClient.post(`/afterdark/conversations/${conversationId}/unlock`);
    return response.data;
  },

  setConversationBlock: async (conversationId, blocked) => {
    const response = await apiClient.post(`/afterdark/conversations/${conversationId}/block`, { blocked });
    return response.data;
  },

  // =====================================================================
  // WALLET & FINANCIALS
  // =====================================================================
  
  /**
   * Fetches the user's available, pending, and reserved balances.
   * @component AfterDarkWallet.jsx, AfterDarkSidebar.jsx
   */
  getWallet: async () => {
    const response = await apiClient.get('/afterdark/wallet');
    return response.data;
  },

  getTransactions: async (params) => {
    const response = await apiClient.get('/afterdark/wallet/transactions', { params });
    return response.data;
  },

  getWithdrawals: async (params) => {
    const response = await apiClient.get('/afterdark/wallet/withdrawals', { params });
    return response.data;
  },

  getPayoutMethods: async () => {
    const response = await apiClient.get('/afterdark/me/payout-methods');
    return response.data;
  },

  getCheckoutIntent: async (intentId) => {
    const response = await apiClient.get(`/afterdark/checkout-intents/${intentId}`);
    return response.data;
  },

  createCheckoutIntent: async (checkoutData) => {
    const response = await apiClient.post('/afterdark/checkout-intents', checkoutData);
    return response.data;
  },

  startPayment: async (paymentData) => {
    // PPV checkouts may set use_wallet to apply available balance before charging the provider remainder.
    const response = await apiClient.post('/afterdark/payments/checkout', paymentData);
    return response.data;
  },

  getCheckoutConfig: async () => {
    const response = await apiClient.get('/afterdark/payments/config');
    return response.data;
  },

  getPaymentStatus: async (intentId) => {
    const response = await apiClient.get(`/afterdark/payments/${intentId}`);
    return response.data;
  },

  /**
   * Purchases/unlocks a Pay-Per-View post using the Wallet Balance.
   * @component LockedPostCard.jsx (Unlock Button)
   * @param {Object} postData - { post_id: 'uuid', creator_id: 'uuid', price_cents: 50000 }
   * @notes CRITICAL: Wrap this in a try/catch. If err.response.status === 402, show "Insufficient Funds" prompt.
   */
  unlockPostWithWallet: async (postData) => {
    const response = await apiClient.post('/afterdark/checkout-intents', postData);
    return response.data;
  },

  /**
   * Initiates a top-up deposit (M-Pesa/Card) tracking intent.
   * @component MpesaPaystackModal.jsx, AfterDarkWallet.jsx
   * @param {Object} depositData - { amount_cents: 100000, provider: 'mpesa' }
   */
  initiateDeposit: async (depositData) => {
    const response = await apiClient.post('/afterdark/wallet/deposits', depositData);
    return response.data;
  },

  /**
   * Requests a payout/withdrawal of cleared creator earnings.
   * @component AfterDarkMyChannel.jsx (Earnings Tab / Withdraw Modal)
   * @param {Object} withdrawalData - { amount_cents: 50000, payout_method_id: 'uuid' }
   * @notes Wrap in try/catch. 402 means "Insufficient cleared funds". 
   */
  requestWithdrawal: async (withdrawalData) => {
    const response = await apiClient.post('/afterdark/wallet/withdrawals', withdrawalData);
    return response.data;
  },

  /**
   * Saves a payout destination (Bank/M-Pesa number) for a creator.
   * @component AfterDarkSettings.jsx (Monetization Tab)
   * @param {Object} methodData - { provider: 'mpesa', account_number: '2547...', account_name: 'John Doe' }
   */
  addPayoutMethod: async (methodData) => {
    const response = await apiClient.post('/afterdark/me/payout-methods', methodData);
    return response.data;
  },

  getPaystackPayoutBanks: async (type) => {
    const response = await apiClient.get('/afterdark/payout-methods/paystack/banks', { params: { type } });
    return response.data;
  },

  // =====================================================================
  // SUBSCRIPTIONS & FOLLOWS
  // =====================================================================
  
  /**
   * Subscribes to a creator for 30 days using wallet balance.
   * @component AfterDarkCreatorProfile.jsx, LockedPostCard.jsx
   * @notes Handle 402 error for insufficient funds.
   */
  subscribeToCreator: async (creatorId) => {
    const response = await apiClient.post(`/afterdark/creators/${creatorId}/subscriptions`);
    return response.data;
  },

  sendTip: async (creatorId, tipData) => {
    const response = await apiClient.post(`/afterdark/creators/${creatorId}/tips`, tipData);
    return response.data;
  },

  /**
   * Fetches the user's active subscriptions to other creators.
   * @component AfterDarkMyChannel.jsx (Customers Tab - conceptually reversed)
   */
  getMySubscriptions: async () => {
    const response = await apiClient.get('/afterdark/me/subscriptions');
    return response.data;
  },

  /**
   * Toggles follow status (free tier following).
   * @component AfterDarkCreatorProfile.jsx, SubscriberOnly cards
   */
  toggleFollow: async (creatorId) => {
    const response = await apiClient.post(`/afterdark/creators/${creatorId}/follow`);
    return response.data;
  },

  // =====================================================================
  // LIVE SESSIONS & CO-STREAMING
  // =====================================================================
  
  /**
   * Creator starts a live broadcast. Returns Session ID and Host SFU Token.
   * @component AfterDarkFeed.jsx (Go Live Button)
   * @param {Object} priceData - { price_cents: 0 } (0 for free/subscribers, >0 for PPV pass)
   */
  startLiveSession: async (priceData) => {
    const response = await apiClient.post('/afterdark/live-sessions', priceData);
    return response.data;
  },

  refreshHostToken: async (sessionId) => {
    const response = await apiClient.post(`/afterdark/live-sessions/${sessionId}/host-token`);
    return response.data;
  },

  /**
   * Viewer attempts to join a broadcast. Returns Viewer SFU token.
   * @component AfterDarkLiveViewingModal.jsx
   * @notes Fails with 403 if the user does not have a session pass or active subscription.
   */
  joinLiveSession: async (sessionId) => {
    const response = await apiClient.post(`/afterdark/live-sessions/${sessionId}/join`);
    return response.data;
  },

  tipLiveSession: async (sessionId, tipData) => {
    const response = await apiClient.post(`/afterdark/live-sessions/${sessionId}/tips`, tipData);
    return response.data;
  },

  /**
   * Creator ends their broadcast. Kicks all viewers.
   * @component AfterDarkFeed.jsx (End Live Button)
   */
  endLiveSession: async (sessionId) => {
    const response = await apiClient.post(`/afterdark/live-sessions/${sessionId}/end`);
    return response.data;
  },

  leaveLiveSession: async (sessionId) => {
    const response = await apiClient.post(`/afterdark/live-sessions/${sessionId}/leave`);
    return response.data;
  },

  /**
   * Viewer requests to co-stream / join the stage.
   * @component AfterDarkLiveViewingModal.jsx (Request Camera)
   */
  requestStage: async (sessionId) => {
    const response = await apiClient.post(`/afterdark/live-sessions/${sessionId}/guest-requests`);
    return response.data;
  },

  /**
   * Host approves a viewer's stage request.
   * @component AfterDarkFeed.jsx (Host Live Controls)
   */
  approveGuest: async (sessionId, viewerId) => {
    const response = await apiClient.post(`/afterdark/live-sessions/${sessionId}/guest-requests/${viewerId}/approve`);
    return response.data;
  },

  denyGuest: async (sessionId, requestId) => {
    const response = await apiClient.post(`/afterdark/live-sessions/${sessionId}/guest-requests/${requestId}/deny`);
    return response.data;
  },

  /**
   * Host forcibly removes a guest from the stage.
   * @component AfterDarkFeed.jsx (Host Live Controls)
   */
  removeGuest: async (sessionId, participantId) => {
    const response = await apiClient.post(`/afterdark/live-sessions/${sessionId}/stage/${participantId}/remove`);
    return response.data;
  },

  // =====================================================================
  // SETTINGS, LIFECYCLE & SHARE LINKS
  // =====================================================================
  
  /**
   * Updates watermarks, geo-blocking, etc.
   * @component AfterDarkSettings.jsx
   */
  updateSettings: async (settingsData) => {
    const response = await apiClient.patch('/afterdark/me/settings', settingsData);
    return response.data;
  },

  updatePassword: async (passwordData) => {
    const response = await apiClient.post('/settings/password', passwordData);
    return response.data;
  },

  updateTwoFactor: async (enabled, channel = 'email') => {
    const response = await apiClient.post('/auth/two-factor/setup', { enabled, channel });
    return response.data;
  },

  /**
   * Temporarily hides the creator profile from discovery.
   * @component AfterDarkSettings.jsx (Danger Tab)
   */
  pauseCreator: async () => {
    const response = await apiClient.post('/afterdark/me/creator-pause');
    return response.data;
  },

  /**
   * Un-hides the creator profile.
   * @component AfterDarkSettings.jsx (Danger Tab)
   */
  resumeCreator: async () => {
    const response = await apiClient.delete('/afterdark/me/creator-pause');
    return response.data;
  },

  /**
   * Permanently deactivates creator tools for this account.
   * @component AfterDarkSettings.jsx (Danger Tab)
   */
  deactivateCreator: async () => {
    const response = await apiClient.delete('/afterdark/me/creator-status');
    return response.data;
  },

  /**
   * Queues an After Dark data archive generation.
   * @component AfterDarkSettings.jsx (Data Tab)
   */
  requestDataExport: async () => {
    const response = await apiClient.post('/afterdark/me/data-export');
    return response.data;
  },

  /**
   * Generates a 7-day expiring share URL for a profile or post.
   * @component Overflow Menus (Share Button)
   * @param {Object} linkData - { target_type: 'profile'|'post', target_id: 'uuid' }
   */
  createShareLink: async (linkData) => {
    const response = await apiClient.post('/afterdark/share-links', linkData);
    return response.data;
  },
};