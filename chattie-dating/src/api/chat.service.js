import { apiClient } from './client';

const normalizeRoom = (room) => {
  let tags = room?.tags;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch {
      tags = [];
    }
  }
  return {
    ...room,
    desc: room?.desc ?? room?.description ?? '',
    active: Number(room?.active ?? room?.active_count ?? room?.activeCount ?? 0),
    isPrivate: Boolean(room?.isPrivate ?? room?.is_private),
    tags: Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string') : [],
  };
};

export const chatService = {
  // ============================================================================
  // ROOMS (Public, Private & Voice Lounges)
  // ============================================================================

  getAllRooms: async () => {
    try {
      const response = await apiClient.get('/rooms');
      const payload = response.data;
      const rooms = Array.isArray(payload) ? payload : payload?.data;
      if (!Array.isArray(rooms)) {
        throw new Error('The room service returned an invalid response.');
      }
      return rooms.map(normalizeRoom);
    } catch (error) {
      console.error("Failed to fetch rooms:", error);
      throw error;
    }
  },



  

  createRoom: async (roomData) => {
    try {
      const response = await apiClient.post('/rooms', roomData);
      return normalizeRoom(response.data);
    } catch (error) {
      console.error("Failed to create room:", error);
      throw error;
    }
  },

  // NEW: Join a room using a shareable room code or link
  joinRoomByCode: async (roomCode) => {
    try {
      const response = await apiClient.post('/rooms/join', { room_code: roomCode });
      return response.data;
    } catch (error) {
      console.error("Failed to join room by code:", error);
      throw error;
    }
  },

  // NEW: "Knock" to request entry into a private room
  requestRoomAccess: async (roomCode) => {
    try {
      const response = await apiClient.post('/rooms/request-access', { room_code: roomCode });
      return response.data;
    } catch (error) {
      console.error("Failed to request room access:", error);
      throw error;
    }
  },

  // NEW: Fetch room admin details, invite links, and pending requests
  getRoomAdminDetails: async (roomId) => {
    try {
      const response = await apiClient.get(`/rooms/${roomId}/admin-details`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch admin details for room ${roomId}:`, error);
      throw error;
    }
  },

  // NEW: Admin action to approve or reject pending room join requests
  manageJoinRequest: async (roomId, targetId, approve) => {
    try {
      const response = await apiClient.post(`/rooms/${roomId}/manage-request`, {
        target_id: targetId,
        approve: approve
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to manage request for room ${roomId}:`, error);
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

  sendMessage: async (id, messageData, type = 'room') => {
    try {
      const response = await apiClient.post(`/chats/${id}?type=${type}`, messageData);
      return response.data;
    } catch (error) {
      console.error(`Failed to send message to ${type} ${id}:`, error);
      throw error;
    }
  },

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