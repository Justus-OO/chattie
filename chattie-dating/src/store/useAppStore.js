import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MOCK_ROOMS, MOCK_MATCHES, MOCK_MESSAGES } from '../mocks/dummyData';

export const useAppStore = create(
  persist(
    (set, get) => ({
      // ======================================================================
      // 1. AUTH & USER PROFILE (Persisted)
      // ======================================================================
      user: null,
      token: null, // JWT for Go Backend Authorization
      isAuthenticated: false,
      userPreferences: {
        theme: 'light',
        language: 'en',
        notificationsEnabled: true,
        isPremium: false,
      },

      login: (userData, token) => set({ 
        user: userData, 
        token: token, 
        isAuthenticated: true,
        // Hydrate creator state if provided in login payload
        isCreator: userData?.isCreator || false,
        afterDarkCreatorAlias: userData?.afterDarkCreatorAlias || '',
        afterDarkCreatorApplicationStatus: userData?.afterDarkCreatorApplicationStatus || '',
        isIdentityVerified: Boolean(userData?.verified || userData?.isVerified || userData?.identityVerified),
        identityVerificationKnown: ['verified', 'isVerified', 'identityVerified'].some(key => typeof userData?.[key] === 'boolean'),
        walletBalance: userData?.walletBalance || 0,
      }),
      
      logout: () => set({ 
        user: null, 
        token: null, 
        isAuthenticated: false,
        isCreator: false,
        afterDarkCreatorAlias: '',
        afterDarkCreatorApplicationStatus: '',
        isIdentityVerified: false,
        identityVerificationKnown: false,
        walletBalance: 0,
        afterDarkConversations: {},
        afterDarkChatAccess: {},
        afterDarkSubscriptions: {},
        afterDarkLivePasses: {},
        // Clear sensitive data on logout, but keep preferences & terms agreement
        messagesByRoom: {},
        matches: []
      }),

      // Allows partial updates to the user object
      updateUser: (updates) => set((state) => ({
        user: state.user ? { ...state.user, ...updates } : null
      })),

      updatePreferences: (newPrefs) => set((state) => ({
        userPreferences: { ...state.userPreferences, ...newPrefs }
      })),

      toggleTheme: () => set((state) => ({
        userPreferences: {
          ...state.userPreferences,
          theme: state.userPreferences.theme === 'dark' ? 'light' : 'dark'
        }
      })),

      // ======================================================================
      // 2. AFTER DARK CREATOR STATE (Persisted)
      // ======================================================================
      isCreator: false,
      afterDarkCreatorAlias: '',
      afterDarkCreatorApplicationStatus: '',
      isIdentityVerified: false,
      identityVerificationKnown: false,
      walletBalance: 0,
      hasAgreedToAfterDarkTerms: false,
      afterDarkConversations: {},
      afterDarkChatAccess: {},
      afterDarkSubscriptions: {},
      afterDarkLivePasses: {},

      setCreatorStatus: (status) => set((state) => ({
        isCreator: status,
        user: state.user ? { ...state.user, isCreator: status } : null,
      })),
      setAfterDarkCreatorAlias: (alias) => set({ afterDarkCreatorAlias: alias }),
      setAfterDarkCreatorApplicationStatus: (status) => set({ afterDarkCreatorApplicationStatus: status }),
      setIdentityVerificationStatus: (status) => set({
        isIdentityVerified: Boolean(status),
        identityVerificationKnown: true,
      }),
      
      setWalletBalance: (balance) => set({ walletBalance: balance }),
      
      updateWalletBalance: (amount) => set((state) => ({ 
        walletBalance: state.walletBalance + amount 
      })),
      
      setAfterDarkTermsAgreement: (agreed) => set({ hasAgreedToAfterDarkTerms: agreed }),
      grantAfterDarkChatAccess: (creatorId) => set((state) => ({
        afterDarkChatAccess: { ...state.afterDarkChatAccess, [creatorId]: true },
      })),
      grantAfterDarkSubscription: (creatorId) => set((state) => ({
        afterDarkSubscriptions: { ...state.afterDarkSubscriptions, [creatorId]: true },
      })),
      grantAfterDarkLivePass: (creatorId, sessionId) => set((state) => ({
        afterDarkLivePasses: {
          ...state.afterDarkLivePasses,
          [`${creatorId}:${sessionId}`]: true,
        },
      })),
      sendAfterDarkMessage: (conversationId, message) => set((state) => ({
        afterDarkConversations: {
          ...state.afterDarkConversations,
          [conversationId]: [
            ...(state.afterDarkConversations?.[conversationId] || []),
            {
              id: `afterdark_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              ...message,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      })),

      // ======================================================================
      // 3. DISCOVERY & DIRECTORIES (In-Memory for Session)
      // ======================================================================
      rooms: MOCK_ROOMS,
      matches: MOCK_MATCHES,
      
      addMatch: (newMatch) => set((state) => ({
        matches: [newMatch, ...state.matches]
      })),

      removeMatch: (matchId) => set((state) => ({
        matches: state.matches.filter(m => m.id !== matchId)
      })),

      // ======================================================================
      // 4. WEBSOCKET & CHAT ENGINE
      // ======================================================================
      socketConnected: false,
      setSocketStatus: (status) => set({ socketConnected: status }),

      messagesByRoom: {
        'default': MOCK_MESSAGES 
      },

      sendMessage: (roomId, newMessage) => set((state) => {
        const targetRoom = roomId || 'default';
        const currentMessages = state.messagesByRoom[targetRoom] || [];
        
        const messageObject = {
          id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          ...newMessage,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isMe: true,
          status: 'sending'
        };

        return {
          messagesByRoom: {
            ...state.messagesByRoom,
            [targetRoom]: [...currentMessages, messageObject]
          }
        };
      }),

      addIncomingMessage: (roomId, incomingMessage) => set((state) => {
        const targetRoom = roomId || 'default';
        const currentMessages = state.messagesByRoom[targetRoom] || [];
        
        if (currentMessages.some(msg => msg.id === incomingMessage.id)) {
          return state;
        }

        return {
          messagesByRoom: {
            ...state.messagesByRoom,
            [targetRoom]: [...currentMessages, incomingMessage]
          }
        };
      }),

      // ======================================================================
      // 5. REAL-TIME PRESENCE & TYPING INDICATORS
      // ======================================================================
      typingIndicators: {},

      setTypingStatus: (roomId, userName, isTyping) => set((state) => {
        const targetRoom = roomId || 'default';
        const currentTyping = state.typingIndicators[targetRoom] || [];
        
        let newTyping = [...currentTyping];
        if (isTyping && !newTyping.includes(userName)) {
          newTyping.push(userName);
        } else if (!isTyping) {
          newTyping = newTyping.filter(name => name !== userName);
        }

        return {
          typingIndicators: {
            ...state.typingIndicators,
            [targetRoom]: newTyping
          }
        };
      }),

      // ======================================================================
      // 6. NOTIFICATIONS & UNREAD COUNTS
      // ======================================================================
      unreadCountsByRoom: {},

      incrementUnread: (roomId) => set((state) => ({
        unreadCountsByRoom: {
          ...state.unreadCountsByRoom,
          [roomId]: (state.unreadCountsByRoom[roomId] || 0) + 1
        }
      })),

      markRoomAsRead: (roomId) => set((state) => ({
        unreadCountsByRoom: {
          ...state.unreadCountsByRoom,
          [roomId]: 0
        }
      })),

    }),
    {
      name: 'chattie-session-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        const userCreatorStatus = persistedState.user?.isCreator;
        return {
          ...persistedState,
          isCreator: typeof userCreatorStatus === 'boolean'
            ? userCreatorStatus
            : Boolean(persistedState.isCreator),
          afterDarkCreatorApplicationStatus: persistedState.afterDarkCreatorApplicationStatus || '',
        };
      },
      // SECURITY: Added After Dark state fields to persistence 
      partialize: (state) => ({ 
        user: state.user, 
        token: state.token, 
        isAuthenticated: state.isAuthenticated,
        userPreferences: state.userPreferences,
        isCreator: state.isCreator,
        afterDarkCreatorAlias: state.afterDarkCreatorAlias,
        afterDarkCreatorApplicationStatus: state.afterDarkCreatorApplicationStatus,
        isIdentityVerified: state.isIdentityVerified,
        identityVerificationKnown: state.identityVerificationKnown,
        walletBalance: state.walletBalance,
        hasAgreedToAfterDarkTerms: state.hasAgreedToAfterDarkTerms,
        afterDarkConversations: state.afterDarkConversations,
        afterDarkChatAccess: state.afterDarkChatAccess,
        afterDarkSubscriptions: state.afterDarkSubscriptions,
        afterDarkLivePasses: state.afterDarkLivePasses,
      }),
    }
  )
);