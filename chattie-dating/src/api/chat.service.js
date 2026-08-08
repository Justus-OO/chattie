import { apiClient } from './client';

export const chatService = {
  // ============================================================================
  // ROOMS (Public & Private Lounges)
  // ============================================================================

  getAllRooms: async () => {
    try {
      const response = await apiClient.get('/rooms');
      return response.data || [];
    } catch (error) {
      console.error("Failed to fetch rooms:", error);
      throw error;
    }
  },

  createRoom: async (roomData) => {
    try {
      const response = await apiClient.post('/rooms', roomData);
      return response.data;
    } catch (error) {
      console.error("Failed to create room:", error);
      throw error;
    }
  },

  // Fetch real participants sitting in the room
  getRoomParticipants: async (roomId) => {
    try {
      const response = await apiClient.get(`/rooms/${roomId}/participants`);
      return response.data || [];
    } catch (error) {
      console.error(`Failed to fetch participants for room ${roomId}:`, error);
      throw error;
    }
  },

  // Fetch the VIP LiveKit Voice Token from the Go Bouncer
  getVoiceToken: async (roomId, participantName) => {
    try {
      const response = await apiClient.post('/rooms/voice-token', {
        room_id: roomId,
        participant_name: participantName
      });
      return response.data;
    } catch (error) {
      console.error("Failed to fetch voice token:", error);
      throw error;
    }
  },

  // ============================================================================
  // CHAT & MESSAGING
  // ============================================================================

  // Supports both 'room' (Group Rooms) and 'dm' (1-on-1 Direct Messages)
  getChatHistory: async (id, type = 'room') => {
    try {
      // Sends ?type=dm or ?type=room to the Go backend
      const response = await apiClient.get(`/chats/${id}?type=${type}`);
      return response.data || [];
    } catch (error) {
      console.error(`Failed to fetch chat history for ${type} ${id}:`, error);
      throw error;
    }
  },

  getInbox: async () => {
    try {
      const response = await apiClient.get('/chats/inbox');
      return response.data || [];
    } catch (error) {
      console.error("Failed to fetch inbox:", error);
      throw error;
    }
  },

  // Added type parameter here as well, just in case you use HTTP fallback
  sendMessage: async (id, messageData, type = 'room') => {
    try {
      const response = await apiClient.post(`/chats/${id}?type=${type}`, messageData);
      return response.data;
    } catch (error) {
      console.error(`Failed to send message to ${type} ${id}:`, error);
      throw error;
    }
  },

  // NEW: Triggers the Go backend to mark all messages from this user as read
  markAsRead: async (targetId) => {
    try {
      const response = await apiClient.patch(`/chats/${targetId}/read`);
      return response.data;
    } catch (error) {
      console.error(`Failed to mark chat ${targetId} as read:`, error);
      throw error;
    }
  },

  deleteChat: async (id, type = 'dm') => {
    try {
      const response = await apiClient.delete(`/chats/${id}?type=${type}`);
      return response.data;
    } catch (error) {
      console.error(`Failed to delete chat ${type} ${id}:`, error);
      throw error;
    }
  }
};