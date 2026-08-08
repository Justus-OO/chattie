import { useEffect, useRef, useCallback } from 'react';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { useAppStore } from '../store/useAppStore';
import { toast } from 'sonner';

/**
 * ============================================================================
 * CHATTIE WEBSOCKET ENGINE
 * Robust STOMP client hook handling messaging, presence, and typing indicators.
 * ============================================================================
 */
export const useWebSocket = (roomId) => {
  // --- REFS ---
  const stompClient = useRef(null);
  const messageSubscription = useRef(null);
  const typingSubscription = useRef(null);

  // --- GLOBAL STATE ---
  const token = useAppStore((state) => state.token);
  const user = useAppStore((state) => state.user);
  const addIncomingMessage = useAppStore((state) => state.addIncomingMessage);
  const setSocketStatus = useAppStore((state) => state.setSocketStatus);
  const setTypingStatus = useAppStore((state) => state.setTypingStatus);

  // ============================================================================
  // CONNECTION & LIFECYCLE MANAGEMENT
  // ============================================================================
  useEffect(() => {
    // Prevent connection if unauthenticated
    if (!token) return;

    // Define the STOMP Client
    const client = new Client({
      webSocketFactory: () => new SockJS('http://localhost:8080/ws'),
      connectHeaders: {
        Authorization: `Bearer ${token}`,
      },
      // Resiliency Configuration
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      debug: (str) => {
        // Disable in production, but useful for debugging frame drops
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[STOMP]', str);
        }
      },

      onConnect: () => {
        setSocketStatus(true);
        console.log(`[STOMP] Connected to chat server.`);

        // Subscribe to the main room message feed
        messageSubscription.current = client.subscribe(
          `/topic/rooms/${roomId}`,
          (frame) => {
            if (frame.body) {
              const parsedMessage = JSON.parse(frame.body);
              // Route to the specific room in Zustand
              addIncomingMessage(roomId, parsedMessage);
            }
          }
        );

        // Subscribe to typing indicator events for this room
        typingSubscription.current = client.subscribe(
          `/topic/rooms/${roomId}/typing`,
          (frame) => {
            if (frame.body) {
              const { username, isTyping } = JSON.parse(frame.body);
              // Don't show typing indicator for ourselves
              if (username !== user?.username) {
                setTypingStatus(roomId, username, isTyping);
              }
            }
          }
        );
      },

      onWebSocketClose: () => {
        setSocketStatus(false);
      },

      onDisconnect: () => {
        setSocketStatus(false);
      },

      onStompError: (frame) => {
        console.error('[STOMP] Broker Error:', frame.headers['message']);
        console.error('[STOMP] Details:', frame.body);
        toast.error('Lost connection to chat server. Reconnecting...', { id: 'stomp-error' });
        setSocketStatus(false);
      },
    });

    // Activate the connection
    stompClient.current = client;
    client.activate();

    // ============================================================================
    // CLEANUP
    // ============================================================================
    return () => {
      // Unsubscribe from specific room channels to prevent memory leaks
      if (messageSubscription.current) messageSubscription.current.unsubscribe();
      if (typingSubscription.current) typingSubscription.current.unsubscribe();
      
      // Clear typing status on exit
      setTypingStatus(roomId, null, false);
      
      // Deactivate client
      if (stompClient.current) {
        stompClient.current.deactivate();
      }
    };
  }, [roomId, token, addIncomingMessage, setSocketStatus, setTypingStatus, user?.username]);

  // ============================================================================
  // PUBLISH METHODS
  // ============================================================================
  
  /**
   * Send a text message (and optional attachments) to the room.
   */
  const publishMessage = useCallback((text, attachments = []) => {
    if (stompClient.current && stompClient.current.connected) {
      const payload = {
        content: text,
        sender: user?.username || 'Unknown',
        attachments: attachments.map(a => a.url || a.preview), // Simplified for demo
        timestamp: new Date().toISOString()
      };

      stompClient.current.publish({
        destination: `/app/chat/${roomId}/send`,
        body: JSON.stringify(payload),
      });
    } else {
      toast.error('Cannot send message. Connecting to server...', { id: 'stomp-offline' });
    }
  }, [roomId, user?.username]);

  /**
   * Broadcast typing status to the room.
   * Best used with a debounced input handler in the UI.
   */
  const publishTyping = useCallback((isTyping) => {
    if (stompClient.current && stompClient.current.connected) {
      stompClient.current.publish({
        destination: `/app/chat/${roomId}/typing`,
        body: JSON.stringify({
          username: user?.username,
          isTyping: isTyping
        }),
      });
    }
  }, [roomId, user?.username]);

  return { 
    publishMessage, 
    publishTyping,
    isConnected: stompClient.current?.connected || false 
  };
};