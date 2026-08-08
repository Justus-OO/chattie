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
        notificationsEnabled: true,
        isPremium: false,
      },

      login: (userData, token) => set({ 
        user: userData, 
        token: token, 
        isAuthenticated: true 
      }),
      
      logout: () => set({ 
        user: null, 
        token: null, 
        isAuthenticated: false,
        // Clear sensitive data on logout, but keep preferences
        messagesByRoom: {},
        matches: []
      }),

      // NEW: Allows partial updates to the user object (e.g., flipping status to 'active' after onboarding)
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
      // 2. DISCOVERY & DIRECTORIES (In-Memory for Session)
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
      // 3. WEBSOCKET & CHAT ENGINE
      // ======================================================================
      socketConnected: false,
      setSocketStatus: (status) => set({ socketConnected: status }),

      // Dictionary Pattern: { [roomId]: [ {id, text, time, ...}, ... ] }
      // Initializes with MOCK_MESSAGES in a 'default' room for backwards compatibility
      messagesByRoom: {
        'default': MOCK_MESSAGES 
      },

      /**
       * OPTIMISTIC UI UPDATE: Instantly renders the user's message before 
       * the server confirms it, preventing UI lag.
       */
      sendMessage: (roomId, newMessage) => set((state) => {
        const targetRoom = roomId || 'default';
        const currentMessages = state.messagesByRoom[targetRoom] || [];
        
        const messageObject = {
          id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          ...newMessage,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isMe: true,
          status: 'sending' // Will update to 'sent'/'read' via WebSocket confirmation
        };

        return {
          messagesByRoom: {
            ...state.messagesByRoom,
            [targetRoom]: [...currentMessages, messageObject]
          }
        };
      }),

      /**
       * WEBSOCKET LISTENER: Injects messages received from the Go WebSocket broker 
       * directly into the correct room's array.
       */
      addIncomingMessage: (roomId, incomingMessage) => set((state) => {
        const targetRoom = roomId || 'default';
        const currentMessages = state.messagesByRoom[targetRoom] || [];
        
        // Prevent duplicate renders if the server echoes our own message back
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
      // 4. REAL-TIME PRESENCE & TYPING INDICATORS
      // ======================================================================
      
      // Dictionary Pattern: { [roomId]: ['Elena', 'Marcus'] }
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
      // 5. NOTIFICATIONS & UNREAD COUNTS
      // ======================================================================
      unreadCountsByRoom: {}, // { 'room_1': 2, 'user_5': 1 }

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
      storage: createJSONStorage(() => localStorage), // Explicitly define storage
      // SECURITY: We only persist authentication and user preferences.
      // Chat messages, typing states, and socket statuses should NEVER be stored 
      // in local storage due to memory bloat and XSS security risks.
      partialize: (state) => ({ 
        user: state.user, 
        token: state.token, 
        isAuthenticated: state.isAuthenticated,
        userPreferences: state.userPreferences
      }),
    }
  )
);