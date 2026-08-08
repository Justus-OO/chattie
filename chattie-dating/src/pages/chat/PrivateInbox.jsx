import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  MessageSquare, Search, MoreVertical, BellOff, 
  Trash2, Archive, CheckCircle2, Flame, AlertTriangle, Clock,
  Loader2, RefreshCw, Send, ArrowLeft, Bot, Sparkles, Check, CheckCheck, X,Heart,
  Image as ImageIcon, Smile, Upload, Video, Mic, MicOff, PhoneOff, Phone
  , Headphones
} from 'lucide-react';
import { toast } from 'sonner';
import EmojiPicker from 'emoji-picker-react';
import { useAppStore } from '../../store/useAppStore';

import { 
  LiveKitRoom, 
  RoomAudioRenderer, 
  useParticipants, 
  useLocalParticipant,
  TrackToggle,
  useTracks,
  VideoTrack
} from '@livekit/components-react';
import { Track, LocalAudioTrack } from 'livekit-client';

// Services
import { chatService } from '../../api/chat.service'; 
import { discoveryService } from '../../api/discovery.service';
import { apiClient } from '../../api/client'; 
import { MediaVaultModal, DeleteConfirmModal, BlockUserModal } from '../../components/chat/ChatModals';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || "ws://localhost:7880"; 

const CANNED_REPLIES = [
  "Hey there! Thanks for the tip ❤️ Let's chat.",
  "Welcome to my private chat! How's your day going?",
  "Just saw your request, skipping the line for you! 😘",
  "Hey VIP! Let's take this to a private video call?"
];

const getUserTier = (spend, flagged) => {
  if (flagged) return { label: 'Flagged', color: 'border-red-500', text: 'text-red-500', bg: 'bg-red-500/10' };
  if (spend >= 1000) return { label: 'Whale', color: 'border-yellow-400', text: 'text-yellow-400', bg: 'bg-yellow-400/10' };
  if (spend >= 100) return { label: 'Premium', color: 'border-blue-400', text: 'text-blue-400', bg: 'bg-blue-400/10' };
  return { label: 'Standard', color: 'border-zinc-500', text: 'text-zinc-400', bg: 'bg-zinc-900' };
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function PrivateInbox() {
  const navigate = useNavigate();
  const theme = useAppStore((state) => state.userPreferences.theme);

  // --- STATE ---
  const [conversations, setConversations] = useState([]);
  const [newMatches, setNewMatches] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('All');
  
  // --- REAL CHAT MODAL STATE ---
  const [activeChat, setActiveChat] = useState(null); 
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [autoPilot, setAutoPilot] = useState(false);
  
  // --- CALL / WEBRTC STATE ---
  const [callToken, setCallToken] = useState("");
  const [isInCall, setIsInCall] = useState(false);
  const [isConnectingCall, setIsConnectingCall] = useState(false);
  const [callMode, setCallMode] = useState('video');
  const [callStartedAt, setCallStartedAt] = useState(null);
  const [callElapsedSec, setCallElapsedSec] = useState(0);
  // Incoming call / ringing state
  const [incomingCallData, setIncomingCallData] = useState(null); // { fromId, fromName, roomId, mode }
  const notificationSocketRef = useRef(null);
  const ringtoneCtxRef = useRef(null);
  const ringtonePlayingRef = useRef(false);
  const audioCtxRef = useRef(null);
  const [ringtoneProfile, setRingtoneProfile] = useState('sweet'); // 'sweet' | 'soft' | 'classic'
  const [micGain, setMicGain] = useState(1.0);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const micGainRef = useRef(micGain);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);

  // Auto-publish microphone helper component (placed inside LiveKitRoom children)
  function AutoPublishMic() {
    const { localParticipant } = useLocalParticipant();
    const publishedRef = useRef(null);
    const srcStreamRef = useRef(null);
    const gainNodeRef = useRef(null);
    useEffect(() => { micGainRef.current = micGain; }, [micGain]);

    useEffect(() => {
      if (!localParticipant) return;
      let mounted = true;
      let audioCtx = audioCtxRef.current || new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = audioCtx;

      const setup = async () => {
        try {
          setMicEnabled(true);
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (!mounted) return;
          srcStreamRef.current = stream;
          const src = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          analyserRef.current = analyser;
          const gainNode = audioCtx.createGain();
          gainNode.gain.value = micGainRef.current ?? 1.0;
          gainNodeRef.current = gainNode;
          const dest = audioCtx.createMediaStreamDestination();
          src.connect(analyser);
          analyser.connect(gainNode);
          gainNode.connect(dest);

          const processedTrack = dest.stream.getAudioTracks()[0];

          const updateLevel = () => {
            if (!mounted || !analyserRef.current) return;
            const data = new Uint8Array(analyserRef.current.fftSize);
            analyserRef.current.getByteTimeDomainData(data);
            const mean = data.reduce((sum, v) => sum + v, 0) / data.length;
            const rms = Math.sqrt(data.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / data.length) / 128;
            const value = Math.min(1, Math.max(0, rms));
            setMicLevel(value);
            if (!micEnabled && value > 0.001) {
              setMicEnabled(true);
            }
            rafRef.current = requestAnimationFrame(updateLevel);
          };
          updateLevel();

          if (LocalAudioTrack && localParticipant.publishTrack) {
            try {
              const localAudioTrack = new LocalAudioTrack(processedTrack);
              const publication = await localParticipant.publishTrack(localAudioTrack);
              publishedRef.current = { publication, localAudioTrack };
              return;
            } catch (e) {
              console.warn('publishTrack failed, falling back to setMicrophoneEnabled', e);
            }
          }

          // Fallback: enable built-in microphone publish
          if (localParticipant.setMicrophoneEnabled) {
            await localParticipant.setMicrophoneEnabled(true);
          }
        } catch (e) {
          console.warn('AutoPublishMic setup failed', e);
        }
      };

      setup();

      return () => {
        mounted = false;
        // unpublish if needed
        try {
          if (publishedRef.current && localParticipant.unpublishTrack) {
            localParticipant.unpublishTrack(publishedRef.current.localAudioTrack).catch(() => {});
          }
        } catch (e) {}
        // stop source tracks
        if (srcStreamRef.current) {
          srcStreamRef.current.getTracks().forEach(t => t.stop());
          srcStreamRef.current = null;
        }
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        if (analyserRef.current) {
          try { analyserRef.current.disconnect(); } catch (e) {}
          analyserRef.current = null;
        }
        if (gainNodeRef.current) {
          try { gainNodeRef.current.disconnect(); } catch (e) {}
          gainNodeRef.current = null;
        }
        setMicEnabled(false);
        setMicLevel(0);
      };
    }, [localParticipant]);

    // Update gain when slider moves
    useEffect(() => {
      if (gainNodeRef.current) gainNodeRef.current.gain.value = micGain;
    }, [micGain]);

    return null;
  }

  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [swappedCamera, setSwappedCamera] = useState(false);
  const [showReactions, setShowReactions] = useState(false);

  // --- TEXTING FEATURES STATE ---
  const [showMediaVault, setShowMediaVault] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [attachedMedia, setAttachedMedia] = useState(null);
  const [vaultImages, setVaultImages] = useState([]);
  const [isLoadingVault, setIsLoadingVault] = useState(false);
  
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const persistedCallEventsRef = useRef({});
  const lastTypingTimeRef = useRef(0);
  const typingTimeoutRef = useRef(null);
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const [partnerPresence, setPartnerPresence] = useState('offline');
  const [replyingTo, setReplyingTo] = useState(null);
  const [firstUnreadId, setFirstUnreadId] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const localVideoRef = useRef(null);

  const currentUser = useAppStore((s) => s.user) || { id: 'me', name: 'You' };
  const appToken = useAppStore((state) => state.token);
  
  const [contextMenuTarget, setContextMenuTarget] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(null);
  
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listRef = useRef(null);

  const smartSuggestions = [
    "I'm here! What's on your mind?",
    "Thanks for the tip, VIP! 😘",
    "Want to move this to a video call?"
  ];

  const normalizeId = (value) => value == null ? '' : String(value);

  const formatChatTimestamp = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const parseMessageContent = (text = '') => {
    if (typeof text !== 'string') return { quoted: null, text: '' };
    const match = text.match(/^\[REPLY\]([\s\S]*?)\[\/REPLY\]([\s\S]*)$/i);
    if (!match) return { quoted: null, text: text.trim() };
    return {
      quoted: match[1].trim() || null,
      text: (match[2] || '').trim()
    };
  };

  const getPresenceText = (status) => {
    if (status === 'online' || status === 'active') return 'Active now';
    if (status === 'away') return 'Away';
    return 'Offline';
  };

  // ============================================================================
  // EFFECTS & DATA FETCHING
  // ============================================================================
  const fetchInboxData = async () => {
    setIsLoading(true);
    try {
      const [inboxRes, matchesRes] = await Promise.allSettled([
        chatService.getInbox(),
        discoveryService.getMatches()
      ]);
      
      let matchesList = [];
      if (matchesRes.status === 'fulfilled') {
        const matchData = matchesRes.value;
        matchesList = Array.isArray(matchData) ? matchData : (matchData?.matches || matchData?.data || []);
        setNewMatches(matchesList);
      }

      if (inboxRes.status === 'fulfilled') {
        const inboxData = inboxRes.value || [];
        const formatted = inboxData.map(chat => {
          const partnerId = chat.partner_id || chat.id;
          const matchRecord = matchesList.find(m => (m.id || m.user_id) === partnerId);

          let finalName = chat.name || chat.partner_name || 'Unknown User';
          if (finalName === 'Unknown' || finalName === 'Unknown User') {
            finalName = matchRecord?.name || matchRecord?.display_name || finalName;
          }

          let finalAvatar = chat.avatar || chat.avatar_url || '';
          if (!finalAvatar) {
            finalAvatar = matchRecord?.avatar || matchRecord?.avatar_url || '';
          }

          return {
            id: chat.type === 'room' ? chat.room_id : partnerId,
            type: chat.type || 'dm',
            name: finalName,
            avatar: finalAvatar,
            lastMessage: chat.last_message || chat.content || 'No messages yet.',
            timestamp: chat.last_message_time || chat.created_at
              ? new Date(chat.last_message_time || chat.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
              : 'Just now',
            unreadCount: chat.unread_count || chat.unreadCount || 0,
            isTyping: false,
            status: chat.status || 'offline',
            isMuted: chat.is_muted || false,
            lifetimeSpend: chat.lifetime_spend || chat.lifetimeSpend || 0,
            flagged: chat.flagged || false,
            bio: chat.bio || ''
          };
        });
        setConversations(formatted);
      }
    } catch (error) {
      console.error("Failed to load inbox data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInboxData();
  }, []);

  useEffect(() => {
    if (!showMediaVault) return;
    fetchVaultImages();
  }, [showMediaVault]);

  // ============================================================================
  // WEBSOCKET SETUP WHEN ACTIVE CHAT OPENS
  // ============================================================================
  useEffect(() => {
    setPartnerPresence(activeChat?.status === 'online' ? 'online' : 'offline');
    setFirstUnreadId(null);
    setReplyingTo(null);

    if (!activeChat) {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      setIsInCall(false);
      setCallToken("");
      // cleanup local stream when closing chat
      try {
        if (localStream) {
          localStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
        }
      } catch (e) {}
      setLocalStream(null);
      return;
    }

    const loadChatHistoryAndConnect = async () => {
      try {
        const history = await chatService.getChatHistory(activeChat.id, activeChat.type || 'dm');
        const formatted = (Array.isArray(history) ? history : []).map(msg => ({
          id: msg.id || Math.random().toString(),
          sender: (msg.sender_id === activeChat.id || msg.sender === 'partner') ? 'partner' : 'me',
          text: msg.content || msg.text || '',
          media: msg.media || null,
          status: msg.status || msg.read === false ? 'unread' : 'delivered',
          time: formatChatTimestamp(msg.created_at || msg.timestamp || msg.createdAt || msg.sent_at || Date.now()) || 'Just now'
        }));
        const persistedEvents = persistedCallEventsRef.current[activeChat.id] || [];
        const initialMessages = [...formatted, ...persistedEvents];
        setMessages(initialMessages);
        const firstUnread = initialMessages.find(m => m.unread || m.is_unread || m.status === 'unread')
          || (activeChat?.unreadCount > 0 ? initialMessages.filter(m => m.sender === 'partner')[Math.max(0, initialMessages.filter(m => m.sender === 'partner').length - activeChat.unreadCount)] : null);
        setFirstUnreadId(firstUnread?.id || null);
      } catch (err) {
        setMessages([]);
      }

      let token = useAppStore.getState().token;
      if (!token) {
        try {
          const stored = localStorage.getItem('chattie-session-storage');
          if (stored) token = JSON.parse(stored)?.state?.token || '';
        } catch (e) {}
      }

      const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const shouldUseRoom = activeChat.type === 'room';
      const chatTarget = activeChat.id;
      const wsUrl = `${wsProtocol}//localhost:8080/ws?${shouldUseRoom ? `room_id=${chatTarget}` : `target_id=${chatTarget}`}&token=${encodeURIComponent(cleanToken)}`;

      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        const presencePayload = activeChat.type === 'room'
          ? { type: 'presence', status: 'online', room_id: activeChat.id }
          : { type: 'presence', status: 'online', target_id: activeChat.id };

        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify(presencePayload));
        }

        if (activeChat?.type === 'dm') {
          apiClient.patch(`/chats/${activeChat.id}/read`).catch(() => {});
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
              type: 'mark_read',
              target_id: activeChat.id
            }));
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const incoming = JSON.parse(event.data);

          if (incoming.type === 'mark_read') {
            setMessages(prev => prev.map(msg => msg.sender === 'me' ? { ...msg, status: 'read' } : msg));
            return;
          }

          if (incoming.type === 'presence') {
            const isMatching = incoming.target_id === activeChat.id || incoming.room_id === activeChat.id;
            if (isMatching) {
              setPartnerPresence(incoming.status === 'online' ? 'online' : incoming.status === 'away' ? 'away' : 'offline');
            }
            return;
          }

          if (incoming.type === 'typing') {
            const senderId = incoming.sender_id || incoming.from;
            if (senderId === activeChat.id) {
              setIsPartnerTyping(true);
              if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
              typingTimeoutRef.current = window.setTimeout(() => setIsPartnerTyping(false), 3000);
            }
            return;
          }

          // Handle incoming call signaling
          if (incoming.type === 'incoming_call') {
            if (isInCall) {
              stopRingtone();
              return;
            }
            // ignore self echoes
            if (incoming.from === currentUser?.id || incoming.sender_id === currentUser?.id) return;
            // If this socket is the active chat with the caller, or notification arrives here,
            // show incoming call UI to allow accept/reject.
            setIncomingCallData({
              fromId: incoming.from || incoming.sender_id,
              fromName: incoming.from_name || incoming.sender_name || 'Caller',
              roomId: incoming.room_id,
              mode: incoming.mode || 'video'
            });
            return;
          }

          // Handle call answered/rejected signals so caller/receiver stop ringing and update UI
          if (incoming.type === 'call_answered') {
            // If we were the caller, stop our ringtone and mark as in-call if we have a token
            stopRingtone();
            setIncomingCallData(null);
            if (!isInCall) {
              setIsInCall(true);
              setCallStartedAt(Date.now());
            }
            return;
          }

          if (incoming.type === 'call_rejected') {
            stopRingtone();
            setIncomingCallData(null);
            toast.error('Call was rejected');
            setIsInCall(false);
            setCallToken('');
            setCallStartedAt(null);
            return;
          }

          // Other message types fall back to chat message rendering
          const newMsg = {
            id: incoming.id || Date.now().toString(),
            sender: incoming.sender_id === activeChat.id ? 'partner' : 'me',
            text: incoming.content || incoming.text || '',
            media: incoming.media || null,
            status: incoming.sender_id === activeChat.id ? 'delivered' : 'sent',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          setMessages(prev => {
            if (prev.some(m => m.id === newMsg.id)) return prev;
            const next = [...prev, newMsg];
            if (activeChat?.type === 'dm' && incoming.sender_id === activeChat.id) {
              setTimeout(() => {
                if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                  socketRef.current.send(JSON.stringify({
                    type: 'mark_read',
                    target_id: activeChat.id
                  }));
                }
              }, 150);
            }
            return next;
          });
        } catch (e) {}
      };
    };

    loadChatHistoryAndConnect();

    return () => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        const presencePayload = activeChat && activeChat.type === 'room'
          ? { type: 'presence', status: 'offline', room_id: activeChat.id }
          : { type: 'presence', status: 'offline', target_id: activeChat?.id };
        try {
          socketRef.current.send(JSON.stringify(presencePayload));
        } catch (e) {}
      }
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [activeChat]);

  // --- Global notification socket (Rings app-wide) ---
  useEffect(() => {
    // Ensure we actually have a token before trying to connect
    let activeToken = appToken;
    if (!activeToken) {
      try {
        const stored = localStorage.getItem('chattie-session-storage');
        if (stored) activeToken = JSON.parse(stored)?.state?.token || '';
      } catch (e) {}
    }

    if (!activeToken) return; // wait until token hydrates

    const cleanToken = activeToken.startsWith('Bearer ') ? activeToken.slice(7) : activeToken;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const notifyUrl = `${wsProtocol}//localhost:8080/ws?token=${encodeURIComponent(cleanToken)}`;

    try {
      const nws = new WebSocket(notifyUrl);
      notificationSocketRef.current = nws;

      nws.onopen = () => console.log('✅ Global Notification Socket Connected');
      nws.onclose = () => console.log('❌ Global Notification Socket Disconnected');

      nws.onmessage = (ev) => {
        try {
          const incoming = JSON.parse(ev.data);
          if (incoming.type === 'incoming_call') {
            if (isInCall) {
              stopRingtone();
              return;
            }
            // ignore self echoes
            if (incoming.from === currentUser?.id || incoming.sender_id === currentUser?.id) return;
            setIncomingCallData({
              fromId: incoming.from || incoming.sender_id,
              fromName: incoming.from_name || incoming.sender_name || 'Caller',
              roomId: incoming.room_id,
              mode: incoming.mode || 'video'
            });
            return;
          }
          if (incoming.type === 'call_answered') {
            stopRingtone();
            setIncomingCallData(null);
            if (!isInCall) {
              setIsInCall(true);
              setCallStartedAt(Date.now());
            }
            return;
          }
          if (incoming.type === 'call_rejected') {
            stopRingtone();
            setIncomingCallData(null);
            toast.error('Call was rejected');
            setIsInCall(false);
            setCallToken('');
            setCallStartedAt(null);
            return;
          }
        } catch (e) {}
      };
    } catch (e) {
      // ignore
    }

    return () => {
      if (notificationSocketRef.current) {
        try { notificationSocketRef.current.close(); } catch (e) {}
        notificationSocketRef.current = null;
      }
    };
  }, [appToken]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, attachedMedia]);

  useEffect(() => {
    if (!isInCall || !callStartedAt) {
      setCallElapsedSec(0);
      return;
    }

    const id = setInterval(() => {
      setCallElapsedSec(Math.floor((Date.now() - callStartedAt) / 1000));
    }, 1000);

    return () => clearInterval(id);
  }, [isInCall, callStartedAt]);

  useEffect(() => {
    if (incomingCallData) {
      playRingtone(ringtoneProfile);
    } else {
      stopRingtone();
    }
    return () => stopRingtone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCallData]);

  useEffect(() => {
    if (isInCall) {
      stopRingtone();
      setIncomingCallData(null);
    }
  }, [isInCall]);

  useEffect(() => {
    // if the ringtone profile changes while ringing, restart with new profile
    if (incomingCallData) {
      stopRingtone();
      playRingtone(ringtoneProfile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringtoneProfile]);

  // ============================================================================
  // CALL HANDLERS (LiveKit Integration)
  // ============================================================================
  const startCall = async (mode = 'video') => {
    if (!activeChat?.id) return;
    appendSystemMessage(`Calling ${activeChat.name}...`, 'call_started', { mode });
    setCallMode(mode);
    setIsConnectingCall(true);
    try {
      if (mode === 'video' && navigator?.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          setLocalStream(stream);
        } catch (err) {
          // permission denied or device not available - still proceed to request token
          console.warn('Camera permission not granted:', err);
        }
      }
      const res = await apiClient.post('/rooms/voice-token', {
        room_id: `dm_call_${activeChat.id}`,
        participant_name: useAppStore.getState().user?.name || 'Host'
      });
      setCallToken(res.data.token);
      setIsInCall(true);
      setCallStartedAt(Date.now());
      // Try to resume audio playback (user gesture)
      await ensureAudioPlayback();
      // Notify callee via websocket that an incoming call is ringing
      const notify = {
        type: 'incoming_call',
        from: currentUser?.id,
        from_name: currentUser?.name,
        target_id: activeChat.id,
        room_id: `dm_call_${activeChat.id}`,
        mode
      };
      try {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify(notify));
        } else if (notificationSocketRef.current && notificationSocketRef.current.readyState === WebSocket.OPEN) {
          notificationSocketRef.current.send(JSON.stringify(notify));
        }
      } catch (e) {
        // Best-effort notify
      }
    } catch (err) {
      toast.error("Failed to start secure call.");
    } finally {
      setIsConnectingCall(false);
    }
  };

  const endCall = () => {
    appendSystemMessage('Call ended', 'call_ended');
    setIsInCall(false);
    setCallToken("");
    setCallStartedAt(null);
    setCallElapsedSec(0);
    // Stop local media streams if any
    try {
      if (localStream) {
        localStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
      }
    } catch (e) {}
    setLocalStream(null);
  };

  const acceptCall = async () => {
    if (!incomingCallData) return;
    setCallMode(incomingCallData.mode || 'video');
    setIncomingCallData(null);
    stopRingtone();
    setIsConnectingCall(true);
    try {
      if ((incomingCallData.mode || 'video') === 'video' && navigator?.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          setLocalStream(stream);
        } catch (err) {
          console.warn('Camera permission not granted for accept:', err);
        }
      }
      const res = await apiClient.post('/rooms/voice-token', {
        room_id: incomingCallData.roomId,
        participant_name: currentUser?.name || 'Guest'
      });
      setCallToken(res.data.token);
      setIsInCall(true);
      setCallStartedAt(Date.now());
      appendSystemMessage('Call connected', 'call_connected');
      stopRingtone();
      setIncomingCallData(null);
      // Ensure audio plays after user accepted
      await ensureAudioPlayback();
      // Notify caller that we've answered
      const ack = { type: 'call_answered', room_id: incomingCallData.roomId, from: currentUser?.id, to: incomingCallData.fromId };
      try {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(ack));
        if (notificationSocketRef.current && notificationSocketRef.current.readyState === WebSocket.OPEN) notificationSocketRef.current.send(JSON.stringify(ack));
      } catch (e) {}
    } catch (err) {
      toast.error('Failed to join call.');
    } finally {
      setIsConnectingCall(false);
    }
  };

  const rejectCall = (reason = 'rejected') => {
    if (!incomingCallData) return;
    appendSystemMessage(`Missed call from ${incomingCallData.fromName}`, 'missed_call', { mode: incomingCallData.mode || 'audio' });
    const rej = { type: 'call_rejected', room_id: incomingCallData.roomId, from: currentUser?.id, to: incomingCallData.fromId, reason };
    try {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(rej));
      if (notificationSocketRef.current && notificationSocketRef.current.readyState === WebSocket.OPEN) notificationSocketRef.current.send(JSON.stringify(rej));
    } catch (e) {}
    setIncomingCallData(null);
    stopRingtone();
  };

  const reconnectCall = (mode = 'audio') => {
    if (!activeChat?.id) return;
    startCall(mode);
  };

  // Simple generated ringtone using WebAudio (avoids external assets)
  const playRingtone = (profile = 'sweet') => {
    if (ringtonePlayingRef.current) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();

      // master gain to control overall volume
      const master = ctx.createGain();
      master.gain.value = 1.0;
      master.connect(ctx.destination);

      // schedule motifs depending on profile
      const scheduleMotif = () => {
        const now = ctx.currentTime;
        const playNote = (freq, offset, dur = 0.16, type = 'triangle', vol = 0.05) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = type;
          osc.frequency.value = freq;
          const start = now + offset;
          g.gain.setValueAtTime(0.0001, start);
          g.gain.exponentialRampToValueAtTime(vol, start + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, start + dur - 0.02);
          osc.connect(g);
          g.connect(master);
          osc.start(start);
          osc.stop(start + dur + 0.02);
        };

        if (profile === 'soft') {
          // soft two-note gentle ping
          playNote(660, 0, 0.22, 'sine', 0.04);
          playNote(880, 0.32, 0.18, 'sine', 0.035);
        } else if (profile === 'classic') {
          // classic phone-like arpeggio
          playNote(880, 0, 0.14, 'square', 0.06);
          playNote(659, 0.18, 0.14, 'square', 0.06);
          playNote(880, 0.36, 0.14, 'square', 0.06);
        } else {
          // sweet (default) 3-note triangle motif
          playNote(880, 0, 0.18, 'triangle', 0.055);
          playNote(660, 0.22, 0.18, 'triangle', 0.05);
          playNote(990, 0.46, 0.16, 'triangle', 0.045);
        }
      };

      // determine interval length by profile
      const intervalMs = profile === 'soft' ? 1400 : (profile === 'classic' ? 1000 : 1200);
      scheduleMotif();
      const interval = setInterval(scheduleMotif, intervalMs);

      ringtoneCtxRef.current = { ctx, master, interval };
      ringtonePlayingRef.current = true;
    } catch (e) {
      // WebAudio not available or blocked by browser autoplay policies
      // swallow quietly
    }
  };

  const stopRingtone = () => {
    try {
      if (!ringtonePlayingRef.current || !ringtoneCtxRef.current) return;
      const { ctx, interval } = ringtoneCtxRef.current;
      try { clearInterval(interval); } catch (e) {}
      try { ctx.close(); } catch (e) {}
    } finally {
      ringtoneCtxRef.current = null;
      ringtonePlayingRef.current = false;
    }
  };

  // Ensure browser audio can play (resume AudioContext) — call on user gesture like Accept
  const ensureAudioPlayback = async () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AC();
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
    } catch (e) {
      // ignore
    }
  };

  // ============================================================================
  // DATA PROCESSING & ACTIONS
  // ============================================================================
  const processedConversations = useMemo(() => {
    let result = [...conversations];
    if (activeTab === 'Unread') result = result.filter(c => c.unreadCount > 0);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => c.name.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q));
    }
    return result;
  }, [conversations, searchQuery, activeTab]);

  const handleOpenChatModal = (id, name, avatar, type = 'dm', extraData = {}) => {
    if (!id) return;
    setContextMenuTarget(null);
    setActiveChat({
      id,
      type,
      name: name || 'User',
      avatar: avatar || '',
      lifetimeSpend: extraData.lifetimeSpend || extraData.lifetime_spend || 0,
      flagged: extraData.flagged || false,
      bio: extraData.bio || ''
    });
    setConversations(prev => prev.map(chat => chat.id === id ? { ...chat, unreadCount: 0 } : chat));
  };

  const appendSystemMessage = (text, type = 'system', meta = {}) => {
    const systemMsg = {
      id: `system-${Date.now()}-${Math.random()}`,
      sender: 'system',
      type,
      text,
      meta,
      time: formatChatTimestamp(Date.now())
    };
    setMessages((prev) => [...prev, systemMsg]);

    if (type.startsWith('call') && activeChat?.id) {
      const chatId = activeChat.id;
      persistedCallEventsRef.current[chatId] = [
        ...(persistedCallEventsRef.current[chatId] || []),
        systemMsg
      ];
    }
  };

  const handleSendMessage = (overrideText = null) => {
    const textToSend = overrideText !== null ? overrideText : inputText;
    if (!textToSend.trim() && !attachedMedia && !isSending) return;

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      toast.error("Chat connection offline.");
      return;
    }

    const isRoomChat = activeChat?.type === 'room';
    const isDmChat = activeChat?.type === 'dm';
    const localMessageId = `local-${Date.now()}-${Math.random()}`;
    const newMsg = {
      id: localMessageId,
      sender: 'me',
      text: textToSend,
      media: attachedMedia,
      status: 'sent',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, newMsg]);
    setIsSending(true);
    try {
      const payload = {
        room_id: isRoomChat ? activeChat.id : "",
        recipient_id: isDmChat ? activeChat.id : "",
        target_id: isDmChat ? activeChat.id : "",
        content: textToSend,
        text: textToSend,
        reply_to_id: replyingTo?.id,
        media: attachedMedia
      };

      socketRef.current.send(JSON.stringify(payload));
      setMessages(prev => prev.map(msg => msg.id === localMessageId ? { ...msg, status: 'delivered' } : msg));
      if (overrideText === null) setInputText('');
      setAttachedMedia(null);
      setShowEmojiPicker(false);
      setReplyingTo(null);
    } catch (err) {
      toast.error("Failed to send message.");
    } finally {
      setIsSending(false);
    }
  };

  const handleTyping = (event) => {
    const nextText = event.target.value;
    setInputText(nextText);

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    if (!activeChat?.id) return;

    const now = Date.now();
    if (now - lastTypingTimeRef.current < 1500) return;
    lastTypingTimeRef.current = now;

    const typingPayload = activeChat.type === 'room'
      ? { type: 'typing', room_id: activeChat.id }
      : { type: 'typing', target_id: activeChat.id };

    try {
      socketRef.current.send(JSON.stringify(typingPayload));
    } catch (e) {
      // best-effort only
    }
  };

  const handleToggleMute = (chatId) => {
    setConversations(prev => prev.map(chat => chat.id === chatId ? { ...chat, isMuted: !chat.isMuted } : chat));
    setContextMenuTarget(null);
  };

  const handleDeleteChat = async () => {
    if (!showDeleteModal) return;

    try {
      await chatService.deleteChat(showDeleteModal.id, showDeleteModal.type || 'dm');
      setConversations(prev => prev.filter(chat => chat.id !== showDeleteModal.id));
      if (activeChat?.id === showDeleteModal.id) setActiveChat(null);
      setShowDeleteModal(null);
      toast.success('Conversation deleted.');
    } catch (err) {
      console.error('Delete chat failed:', err);
      toast.error('Unable to delete conversation.');
    }
  };

  const fetchVaultImages = async () => {
    setIsLoadingVault(true);
    try {
      const res = await apiClient.get('/settings/media');
      setVaultImages(res.data || []);
    } catch (err) {
      console.error("Failed to fetch media vault", err);
    } finally {
      setIsLoadingVault(false);
    }
  };

  const handleUploadMedia = async (file) => {
    if (!file) return;
    setIsLoadingVault(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await apiClient.post('/settings/media', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      await fetchVaultImages();
      toast.success('Photo uploaded to vault.');
    } catch (err) {
      console.error('Upload failed', err);
      toast.error('Upload failed.');
    } finally {
      setIsLoadingVault(false);
    }
  };

  const handleBlockUser = async () => {
    if (!activeChat) return;
    try {
      await discoveryService.blockUser(activeChat.id);
      setConversations(prev => prev.filter(chat => chat.id !== activeChat.id));
      if (activeChat?.id) setActiveChat(null);
      setShowBlockModal(false);
      toast.success(`${activeChat.name} has been blocked.`);
    } catch (err) {
      console.error('Block user failed:', err);
      toast.error(err.message || 'Failed to block user.');
    }
  };

  const handleEmojiSelect = (emojiData) => {
    setInputText(prev => prev + emojiData.emoji);
    setShowEmojiPicker(false);
  };

  const totalUnread = conversations.reduce((acc, curr) => acc + curr.unreadCount, 0);

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center w-full h-full" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-primary)', fontFamily: 'Roboto, sans-serif' }}>
        <Loader2 className="w-10 h-10 animate-spin mb-4" style={{ color: 'var(--accent)' }} />
        <h2 className="text-sm font-medium tracking-wide">Loading your conversations...</h2>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col w-full h-full relative overflow-hidden" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-primary)', fontFamily: 'Roboto, sans-serif' }}>
      
      {/* HEADER */}
      <header className="p-4 md:p-6 shrink-0 flex flex-col gap-4 z-10" style={{ backgroundColor: 'var(--glass)', borderBottom: '1px solid var(--border)', backdropFilter: 'blur(18px)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-2xl shadow-sm" style={{ backgroundColor: 'var(--surface-strong)' }}>
              <MessageSquare className="w-5 h-5" style={{ color: 'var(--accent-strong)' }} />
            </div>
            <div>
              <h1 className="font-bold text-2xl tracking-tight" style={{ color: 'var(--text-primary)' }}>Inbox</h1>
              <p className="text-sm mt-0.5 font-medium" style={{ color: 'var(--text-secondary)' }}>
                {totalUnread > 0 ? `You have ${totalUnread} unread messages` : "You're all caught up!"}
              </p>
            </div>
          </div>
          <button onClick={fetchInboxData} className="p-2.5 rounded-full transition-all shadow-sm" style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="relative w-full max-w-xl">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-2xl pl-11 pr-4 py-3 text-sm focus:outline-none transition-all placeholder:text-zinc-500"
            style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto flex flex-col" style={{ backgroundColor: 'var(--surface)' }}>
        
        {/* NEW MATCHES BAR */}
        {!searchQuery && (
          <div className="shrink-0 pb-2" style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface-alt)' }}>
            <h2 className="text-xs font-semibold px-6 pt-5 pb-3 flex items-center gap-2 tracking-wide uppercase" style={{ color: 'var(--text-secondary)' }}>
              <Flame className="w-4 h-4" style={{ color: 'var(--accent)' }} /> New Matches
            </h2>
            <div className="flex gap-5 overflow-x-auto px-6 pb-2 custom-scrollbar">
              <div onClick={() => navigate('/likes')} className="flex flex-col items-center gap-2 min-w-[68px] cursor-pointer group shrink-0">
                <div className="w-16 h-16 rounded-full flex items-center justify-center group-hover:border-orange-500 transition-colors shadow-sm" style={{ backgroundColor: 'var(--surface-strong)', border: '2px solid rgba(210, 79, 116, 0.32)' }}>
                  <Heart className="w-6 h-6" style={{ color: 'var(--accent)', fill: 'rgba(210, 79, 116, 0.14)' }} />
                </div>
                <span className="text-xs font-medium group-hover:text-white transition-colors" style={{ color: 'var(--text-primary)' }}>Likes</span>
              </div>

              {newMatches.length === 0 ? (
                <div className="flex items-center justify-center w-full min-h-[64px]">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>No new matches yet</span>
                </div>
              ) : (
                newMatches.map(match => {
                  const matchId = match.targetId || match.target_id || match.recipient_id || match.partner_id || match.user_id || match.id;
                  return (
                    <div 
                      key={match.id || match.user_id}
                      onClick={() => handleOpenChatModal(matchId, match.name || match.display_name, match.avatar || match.avatar_url, 'dm', match)}
                      className="flex flex-col items-center gap-2 min-w-[68px] max-w-[76px] cursor-pointer group shrink-0"
                    >
                      <div className="relative">
                        {match.avatar || match.avatar_url ? (
                          <img src={match.avatar || match.avatar_url} alt="match" className="w-16 h-16 object-cover rounded-full border-2 border-transparent group-hover:border-white transition-all shadow-sm" />
                        ) : (
                          <div className="w-16 h-16 rounded-full flex items-center justify-center text-lg font-medium border-2 border-transparent group-hover:border-white transition-all shadow-sm" style={{ backgroundColor: 'var(--surface-muted)', color: 'var(--text-primary)' }}>
                            {(match.name || match.display_name || 'U').charAt(0).toUpperCase()}
                          </div>
                        )}
                        {match.status === 'online' && <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full" style={{ backgroundColor: 'var(--success)', border: '2px solid var(--surface)' }}></span>}
                      </div>
                      <span className="text-xs font-medium group-hover:text-zinc-200 truncate w-full text-center px-1 transition-colors" style={{ color: 'var(--text-secondary)' }}>{match.name || match.display_name}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* CHAT TABS */}
        <div className="flex shrink-0 px-4 pt-2" style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface)' }}>
          {['All', 'Unread'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 
                ${activeTab === tab ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
              style={activeTab === tab ? { color: 'var(--text-primary)', borderBottomColor: 'var(--accent)' } : { color: 'var(--text-muted)' }}
            >
              {tab} Messages
            </button>
          ))}
        </div>

        {/* CONVERSATIONS LIST */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {processedConversations.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-24">
              <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ backgroundColor: 'var(--surface-alt)' }}>
                <MessageSquare className="w-8 h-8" style={{ color: 'var(--text-muted)' }} />
              </div>
              <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>No conversations yet</h3>
              <p className="text-sm max-w-xs" style={{ color: 'var(--text-muted)' }}>When you match with someone or receive a message, it will appear here.</p>
            </div>
          ) : (
            <div ref={listRef} className="flex flex-col py-2 px-3 gap-1">
              {processedConversations.map((chat, idx) => {
                const isFocused = focusedIndex === idx;

                return (
                  <div key={chat.id} className="relative group">
                    <button 
                      onClick={() => handleOpenChatModal(chat.id, chat.name, chat.avatar, chat.type, chat)}
                      className={`w-full flex items-center justify-between p-3.5 transition-all text-left rounded-2xl
                        ${isFocused ? 'bg-zinc-800/80' : 'bg-transparent hover:bg-zinc-900/60'}`}
                      style={isFocused ? { backgroundColor: 'var(--surface-alt)' } : {}}
                    >
                      <div className="flex items-center gap-4 overflow-hidden">
                        <div className="relative shrink-0 shadow-sm">
                          {chat.avatar ? (
                            <img src={chat.avatar} alt="avatar" className="w-14 h-14 object-cover rounded-full" />
                          ) : (
                            <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-medium" style={{ backgroundColor: 'var(--surface-muted)', color: 'var(--text-primary)' }}>
                              {chat.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          {chat.status === 'online' && <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full" style={{ backgroundColor: 'var(--success)', border: '2px solid var(--surface)' }}></span>}
                        </div>
                        <div className="overflow-hidden pr-2">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className={`text-base truncate tracking-tight ${chat.unreadCount > 0 ? 'font-semibold' : 'font-medium'}`} style={{ color: chat.unreadCount > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                              {chat.name}
                            </h3>
                            {chat.isMuted && <BellOff className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />}
                          </div>
                          <p className={`text-sm truncate ${chat.unreadCount > 0 ? 'font-medium' : 'font-normal'}`} style={{ color: chat.unreadCount > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {chat.lastMessage}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0 pl-3">
                        <span className={`text-xs whitespace-nowrap ${chat.unreadCount > 0 ? 'font-medium' : 'font-normal'}`} style={{ color: chat.unreadCount > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {chat.timestamp}
                        </span>
                        {chat.unreadCount > 0 ? (
                          <span className="min-w-[22px] h-[22px] px-1.5 flex items-center justify-center rounded-full text-xs font-bold shadow-sm" style={{ backgroundColor: 'var(--accent)', color: 'var(--surface-strong)' }}>
                            {chat.unreadCount}
                          </span>
                        ) : (
                          <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                        )}
                      </div>
                    </button>

                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setContextMenuTarget(contextMenuTarget?.id === chat.id ? null : chat);
                      }}
                      className={`absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full transition-all shadow-md
                        md:opacity-0 md:group-hover:opacity-100 ${contextMenuTarget?.id === chat.id ? 'opacity-100 z-20' : ''}`}
                      style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-secondary)' }}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ================================================================== */}
      {/* FULL FEATURED LIVE CHAT INTERFACE & CALL OVERLAY */}
      {/* ================================================================== */}
      {activeChat && (() => {
        const tier = getUserTier(activeChat.lifetimeSpend, activeChat.flagged);
        return (
          <div className="absolute inset-0 z-50 flex flex-col animate-in slide-in-from-right-8 duration-300" style={{ backgroundColor: 'var(--surface)' }}>
            
            {/* Header with Call Triggers */}
            <div className="flex items-center justify-between px-6 py-4 shrink-0 z-20" style={{ backgroundColor: 'var(--glass)', borderBottom: '1px solid var(--border)', backdropFilter: 'blur(18px)' }}>
              <div className="flex items-center gap-5">
                <button onClick={() => setActiveChat(null)} className="p-2.5 rounded-full transition-colors" style={{ backgroundColor: 'var(--surface-strong)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-3.5">
                  <div className="relative">
                    {activeChat.avatar ? (
                      <img src={activeChat.avatar} alt="avatar" className="w-11 h-11 rounded-full object-cover shadow-sm" />
                    ) : (
                      <div className="w-11 h-11 rounded-full flex items-center justify-center text-lg font-medium" style={{ backgroundColor: 'var(--surface-muted)', color: 'var(--text-primary)' }}>
                        {activeChat.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full" style={{ backgroundColor: 'var(--success)', border: '2px solid var(--surface)' }}></span>
                  </div>
                  <div className="flex flex-col">
                    <h2 className="text-base font-semibold tracking-tight flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                      {activeChat.name}
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${tier.bg} ${tier.text}`}>
                        {tier.label}
                      </span>
                    </h2>
                    <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {getPresenceText(partnerPresence)}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => startCall('audio')}
                  disabled={isConnectingCall}
                  className="px-4 py-2 rounded-full font-medium text-sm flex items-center gap-2 transition-colors shadow-sm disabled:opacity-50"
                  style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  <Phone className="w-4 h-4 text-emerald-400" /> <span className="hidden md:inline">{isConnectingCall && callMode === 'audio' ? 'Connecting...' : 'Audio Call'}</span>
                </button>
                <button 
                  onClick={() => startCall('video')}
                  disabled={isConnectingCall}
                  className="px-4 py-2 rounded-full font-medium text-sm flex items-center gap-2 transition-colors shadow-sm disabled:opacity-50"
                  style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  <Video className="w-4 h-4 text-blue-400" /> <span className="hidden md:inline">{isConnectingCall && callMode === 'video' ? 'Connecting...' : 'Video Call'}</span>
                </button>
              </div>
            </div>

            {/* CALL ROOM OVERLAY (LiveKit WebRTC) */}
            {/* INCOMING CALL RINGING UI */}
            {incomingCallData && !isInCall && (
              <div className="absolute inset-0 z-60 flex items-center justify-center p-6">
                <div className="w-full max-w-md p-6 rounded-2xl shadow-2xl" style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-zinc-900 flex items-center justify-center text-xl font-bold">
                      {(incomingCallData.fromName || 'C').charAt(0).toUpperCase()
}
                    </div>
                    {/* Local preview when available */}
                    {localStream && (
                      <div className="w-14 h-14 rounded-md overflow-hidden bg-black">
                        <video autoPlay muted playsInline ref={(el) => { if (el) try { el.srcObject = localStream; } catch(e){} }} className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="text-sm font-bold">Incoming {incomingCallData.mode === 'video' ? 'Video' : 'Audio'} Call</div>
                      <div className="text-xs text-zinc-400">{incomingCallData.fromName}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-zinc-400">Ringtone</label>
                        <select value={ringtoneProfile} onChange={(e) => setRingtoneProfile(e.target.value)} className="text-xs bg-black border border-zinc-800 px-2 py-1">
                          <option value="sweet">Sweet</option>
                          <option value="soft">Soft</option>
                          <option value="classic">Classic</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => rejectCall()} className="px-3 py-2 rounded-md text-sm" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>Decline</button>
                        <button onClick={() => acceptCall()} className="px-3 py-2 rounded-md text-sm font-bold" style={{ backgroundColor: 'var(--accent)', color: 'var(--surface-strong)' }}>Answer</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {isInCall && callToken && (
              <div className="absolute inset-0 z-50 flex flex-col animate-in fade-in duration-300" style={{ backgroundColor: 'var(--surface)' }}>
                <LiveKitRoom
                  serverUrl={LIVEKIT_URL}
                  token={callToken}
                  connect={true}
                  audio={true}
                  video={callMode === 'video'}
                  className="flex-1 flex flex-col"
                >
                    <RoomAudioRenderer />
                      <AutoPublishMic />
                      <InboxCallStage activeChat={activeChat} callMode={callMode} callElapsedSec={callElapsedSec} localStream={localStream} micEnabled={micEnabled} micLevel={micLevel} />
                  <div className="p-8 pb-12 flex items-center justify-center gap-6 shrink-0 relative">
                    <TrackToggle source={Track.Source.Microphone} className="w-14 h-14 rounded-full flex items-center justify-center transition-colors shadow-lg" style={{ backgroundColor: 'var(--surface-strong)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                    {callMode === 'video' && <TrackToggle source={Track.Source.Camera} className="w-14 h-14 rounded-full flex items-center justify-center transition-colors shadow-lg" style={{ backgroundColor: 'var(--surface-strong)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />}

                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-zinc-400">Mic</label>
                      <input
                        type="range"
                        min="0.1"
                        max="2"
                        step="0.1"
                        value={micGain}
                        onChange={(e) => setMicGain(parseFloat(e.target.value))}
                        className="w-32"
                        aria-label="Microphone gain"
                      />
                    </div>

                    <button onClick={() => { setIsScreenSharing(!isScreenSharing); toast(isScreenSharing ? 'Screen share stopped' : 'Screen share started (placeholder)'); }} className={`w-12 h-12 rounded-full flex items-center justify-center border-2 ${isScreenSharing ? 'bg-green-500 text-black border-green-500' : 'border-zinc-700 text-zinc-200'}`} title="Toggle Screen Share">
                      <ImageIcon className="w-5 h-5" />
                    </button>

                    <button onClick={() => { setSwappedCamera(!swappedCamera); toast('Camera swapped'); }} className="w-12 h-12 rounded-full flex items-center justify-center border-2 border-zinc-700 text-zinc-200" title="Swap Camera">
                      <ArrowLeft className="w-4 h-4" />
                    </button>

                    <button onClick={() => { setSpeakerOn(!speakerOn); toast(speakerOn ? 'Speaker off' : 'Speaker on'); }} className={`w-12 h-12 rounded-full flex items-center justify-center border-2 ${speakerOn ? 'border-white text-white' : 'border-zinc-700 text-zinc-200'}`} title="Toggle Speaker">
                      <Headphones className="w-5 h-5" />
                    </button>

                    <button onClick={() => { setShowReactions(!showReactions); }} className="w-12 h-12 rounded-full flex items-center justify-center border-2 border-zinc-700 text-zinc-200" title="Reactions">
                      <Smile className="w-5 h-5" />
                    </button>

                    <button onClick={() => { try { socketRef.current && socketRef.current.send(JSON.stringify({ type: 'mute_all', room_id: activeChat?.id })); } catch (e) {} ; toast('Requested mute-all'); }} className="w-12 h-12 rounded-full flex items-center justify-center border-2 border-zinc-700 text-zinc-200" title="Mute All">
                      <MicOff className="w-5 h-5" />
                    </button>

                    <button onClick={endCall} className="px-6 py-4 rounded-full font-bold text-sm flex items-center gap-2 transition-colors shadow-lg" style={{ backgroundColor: 'var(--accent)', color: 'var(--surface-strong)' }}>
                      <PhoneOff className="w-5 h-5" /> End Call
                    </button>

                    {showReactions && (
                      <div className="absolute bottom-28 right-1/2 transform translate-x-1/2 bg-[var(--surface-strong)] border border-[var(--border)] p-2 rounded-xl flex gap-2 z-50">
                        {['👍','❤️','🔥','😂','🎉'].map(r => (
                          <button key={r} onClick={() => { try { if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'reaction', emoji: r, to: activeChat?.id })); } catch (e) {} toast.success('Reacted ' + r); setShowReactions(false); }} className="p-2 text-xl">{r}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </LiveKitRoom>
              </div>
            )}

            <div className="flex flex-1 overflow-hidden relative">
              <div className="flex-1 flex flex-col lg:border-r relative" style={{ backgroundColor: 'var(--surface)' , borderColor: 'var(--border)' }}>
                
                {/* Messages stream */}
                <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 custom-scrollbar">
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center px-4">
                      <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: 'var(--surface-alt)' }}>
                        <MessageSquare className="w-8 h-8" style={{ color: 'var(--text-muted)' }} />
                      </div>
                      <h3 className="font-semibold text-lg mb-1" style={{ color: 'var(--text-primary)' }}>Say hello to {activeChat.name}!</h3>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>This is the start of your private, end-to-end encrypted conversation.</p>
                    </div>
                  ) : (
                    messages.map((msg, index) => {
                      const isSystem = msg.sender === 'system';
                      const isMissedCall = msg.type === 'missed_call';
                      const isModel = msg.sender === 'model' || msg.sender === 'me';
                      const isOutgoing = msg.sender === 'me';
                      const showAvatar = !isSystem && !isModel && (index === 0 || messages[index - 1]?.sender !== msg.sender);
                      const { quoted, text: parsedText } = parseMessageContent(msg.text || '');

                      return (
                        <React.Fragment key={msg.id}>
                          {firstUnreadId === msg.id && (
                            <div className="flex items-center justify-center pt-2">
                              <div className="px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400 bg-zinc-950 border border-zinc-800">
                                New messages
                              </div>
                            </div>
                          )}
                          <div key={msg.id} className={`flex gap-3 max-w-[85%] md:max-w-[70%] ${isSystem ? 'self-center justify-center' : isModel ? 'self-end items-end ml-auto flex-row-reverse' : 'self-start items-end'}`}>
                          
                          {/* Avatar for partner */}
                          {!isSystem && !isModel && (
                            <div className="shrink-0 w-8 h-8 mb-1">
                              {showAvatar ? (
                                <img src={activeChat.avatar} alt="avatar" className="w-8 h-8 rounded-full object-cover shadow-sm" />
                              ) : <div className="w-8" />}
                            </div>
                          )}

                          <div className={`flex flex-col ${isSystem ? 'items-center' : isModel ? 'items-end' : 'items-start'}`}>
                            <div className={`px-5 py-4 text-sm leading-relaxed flex flex-col gap-3 shadow-xl ${isSystem ? 'rounded-[32px] border' : 'rounded-[28px]'} ${isModel ? 'rounded-br-[12px] rounded-tl-[28px] rounded-tr-[28px] rounded-bl-[28px]' : isSystem ? 'rounded-[32px]' : 'rounded-bl-[12px] rounded-tr-[28px] rounded-br-[28px] rounded-tl-[28px]'}`}
                              style={{
                                backgroundColor: isSystem ? 'var(--surface-strong)' : isModel ? 'var(--accent)' : 'var(--surface-alt)',
                                color: isSystem ? 'var(--text-primary)' : isModel ? 'var(--surface-strong)' : 'var(--text-primary)',
                                borderColor: isMissedCall ? 'var(--accent)' : isSystem ? 'var(--border)' : 'transparent'
                              }}>
                              {msg.media && (
                                <div className="overflow-hidden rounded-xl" style={{ backgroundColor: 'var(--surface-muted)' }}>
                                  <img src={msg.media} alt="attachment" className="w-full max-w-[260px] h-auto object-cover rounded-xl" />
                                </div>
                              )}
                              {(quoted || parsedText) && (
                                <div className="flex flex-col gap-3 text-left">
                                  {quoted && (
                                    <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-300">
                                      {quoted}
                                    </div>
                                  )}
                                  {parsedText && (
                                    <div className="whitespace-pre-wrap font-normal text-sm">
                                      {parsedText}
                                    </div>
                                  )}
                                </div>
                              )}
                              {msg.type && ['missed_call','call_started','call_connected','call_ended'].includes(msg.type) && (
                                <div className="whitespace-pre-wrap font-normal flex items-center justify-center gap-2 text-center">
                                  {msg.type === 'missed_call' && <PhoneOff className="w-4 h-4 text-red-400" />}
                                  {msg.type === 'call_started' && <Phone className="w-4 h-4 text-blue-400" />}
                                  {msg.type === 'call_connected' && <Phone className="w-4 h-4 text-emerald-400" />}
                                  {msg.type === 'call_ended' && <PhoneOff className="w-4 h-4 text-zinc-400" />}
                                  <span>{msg.text}</span>
                                </div>
                              )}
                              {isMissedCall && (
                                <button
                                  type="button"
                                  onClick={() => reconnectCall(msg.meta?.mode || 'audio')}
                                  className="self-center inline-flex items-center justify-center rounded-full px-3 py-1.5 text-xs font-semibold transition-colors shadow-sm"
                                  style={{
                                    backgroundColor: 'var(--accent)',
                                    color: 'var(--surface-strong)',
                                    border: '1px solid var(--border)'
                                  }}>
                                  <RefreshCw className="w-3.5 h-3.5 mr-2" /> Reconnect
                                </button>
                              )}
                            </div>
                            {replyingTo && replyingTo.id === msg.id && (
                              <div className="mb-2 px-3 py-2 rounded-2xl bg-zinc-950 border border-zinc-700 text-xs text-zinc-300">
                                Replying to {replyingTo.sender === 'me' ? 'yourself' : activeChat.name}
                              </div>
                            )}
                            <span className="text-[11px] font-medium mt-1.5 px-1 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                              {msg.time}
                              {isModel && (
                                msg.status === 'sent'
                                  ? <Check className="w-3 h-3 text-zinc-400" />
                                  : <CheckCheck className={`w-3 h-3 ${msg.status === 'read' ? 'text-blue-400' : 'text-zinc-400'}`} />
                              )}
                            </span>
                          </div>
                        </div>
                      </React.Fragment>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} className="h-2" />
                </div>

                {/* Suggestions Bar */}
                <div className="p-3 flex items-center gap-3 overflow-x-auto custom-scrollbar shrink-0" style={{ backgroundColor: 'var(--surface-strong)', borderTop: '1px solid var(--border)' }}>
                  <button 
                    onClick={() => setAutoPilot(!autoPilot)}
                    className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold transition-colors shrink-0 rounded-full shadow-sm
                      ${autoPilot ? 'bg-blue-500 text-white' : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800'}
                    `}
                  >
                    <Bot className="w-4 h-4" /> {autoPilot ? 'Smart Assistant Active' : 'Smart Assistant Off'}
                  </button>
                  <div className="w-[1px] h-5 shrink-0" style={{ backgroundColor: 'var(--border)' }} />
                  {smartSuggestions.map((sug, i) => (
                    <button 
                      key={i} onClick={() => setInputText(sug)}
                      className="whitespace-nowrap px-4 py-2 bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs font-medium rounded-full hover:bg-zinc-800 hover:text-white transition-colors shadow-sm"
                    >
                      {sug}
                    </button>
                  ))}
                </div>

                {/* Chat Input Area */}
                <div className="p-4 md:px-6 md:pb-6 shrink-0 relative z-30" style={{ backgroundColor: 'var(--surface)' }}>
                  
                  {/* Emoji Picker Modal */}
                  {showEmojiPicker && (
                    <div className="absolute bottom-[calc(100%+10px)] left-4 md:left-6 z-50 shadow-2xl rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
                      <EmojiPicker 
                        theme={theme}
                        onEmojiClick={handleEmojiSelect} 
                        searchDisabled={true} 
                        skinTonesDisabled={true} 
                        height={350} 
                        width={320} 
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-3">
                    
                    {/* Media Preview before send */}
                    {attachedMedia && (
                      <div className="flex items-center gap-4 p-2.5 w-max rounded-2xl shadow-sm" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
                        <img src={attachedMedia} alt="preview" className="w-14 h-14 object-cover rounded-xl" />
                        <div className="flex flex-col pr-4">
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Photo attached</span>
                          <span className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Ready to send</span>
                        </div>
                        <button 
                          onClick={() => setAttachedMedia(null)} 
                          className="p-1.5 rounded-full transition-colors ml-2"
                          style={{ backgroundColor: 'var(--surface-strong)', color: 'var(--text-secondary)' }}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    <div className="flex items-end gap-2 rounded-3xl p-1.5 transition-colors shadow-sm" style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
                      <div className="flex items-center gap-1 shrink-0 mb-1 pl-1">
                        <button onClick={() => setShowMediaVault(true)} className="p-2.5 rounded-full transition-colors" style={{ color: 'var(--text-secondary)' }}>
                          <ImageIcon className="w-5 h-5" />
                        </button>
                        <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="hidden md:block p-2.5 rounded-full transition-colors" style={{ color: 'var(--text-secondary)' }}>
                          <Smile className="w-5 h-5" />
                        </button>
                      </div>

                      <textarea 
                        value={inputText} 
                        onChange={(e) => handleTyping(e)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                        placeholder={autoPilot ? "Smart Assistant is drafting..." : "Type a message..."}
                        disabled={autoPilot}
                        className="flex-1 bg-transparent py-3.5 px-2 font-normal text-sm resize-none outline-none custom-scrollbar disabled:opacity-50 placeholder:text-zinc-500"
                        rows="1"
                        style={{ color: 'var(--text-primary)', minHeight: '48px', maxHeight: '120px' }}
                      />
                      
                      <button 
                        onClick={() => handleSendMessage()} 
                        disabled={(!inputText.trim() && !attachedMedia) || autoPilot || isSending}
                        className="h-[44px] w-[44px] md:w-auto md:px-6 mb-1 mr-1 font-semibold text-sm rounded-full disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
                        style={{ backgroundColor: 'var(--accent)', color: 'var(--surface-strong)' }}
                      >
                        <span className="hidden md:inline">Send</span>
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Profile Panel (Desktop Only) */}
              <div className="hidden lg:flex w-80 flex-col overflow-y-auto custom-scrollbar" style={{ backgroundColor: 'var(--surface-alt)' }}>
                <div className="p-8 flex flex-col items-center text-center" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="relative mb-4">
                    <img 
                      src={activeChat.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'} 
                      alt="User" 
                      className="w-32 h-32 object-cover rounded-full shadow-lg" 
                      style={{ border: '4px solid var(--surface)' }}
                    />
                    <div className="absolute bottom-1 right-3 w-4 h-4 rounded-full" style={{ backgroundColor: 'var(--success)', border: '2px solid var(--surface)' }}></div>
                  </div>
                  <h2 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{activeChat.name}</h2>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold mt-3 ${tier.bg} ${tier.text}`}>
                    {tier.label} User
                  </span>
                </div>
                
                <div className="p-6 space-y-6">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>About</h3>
                    <p className="text-sm leading-relaxed p-4 rounded-2xl" style={{ backgroundColor: 'var(--surface-strong)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                      {activeChat.bio ? `"${activeChat.bio}"` : "No bio provided yet."}
                    </p>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Support History</h3>
                    <div className="p-4 rounded-2xl flex items-center gap-3" style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(210, 79, 116, 0.1)', color: 'var(--accent)' }}>
                        <Flame className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>${activeChat.lifetimeSpend}</div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Lifetime Contribution</div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="pt-4 space-y-3">
                    <button className="w-full py-3.5 text-sm font-semibold rounded-2xl transition-colors shadow-sm" style={{ backgroundColor: 'var(--surface-strong)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                      View Full Profile
                    </button>
                    <button onClick={() => setShowBlockModal(true)} className="w-full py-3.5 bg-transparent text-sm font-semibold rounded-2xl hover:bg-red-500/10 transition-colors" style={{ color: 'var(--accent)' }}>
                      Block User
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <MediaVaultModal
        isOpen={showMediaVault}
        images={vaultImages}
        onClose={() => setShowMediaVault(false)}
        onSelect={(url) => {
          setAttachedMedia(url);
          setShowMediaVault(false);
        }}
        isLoading={isLoadingVault}
        onUpload={handleUploadMedia}
      />

      <BlockUserModal
        isOpen={showBlockModal}
        targetName={activeChat?.name || 'this user'}
        onClose={() => setShowBlockModal(false)}
        onBlock={handleBlockUser}
      />

      <DeleteConfirmModal
        isOpen={Boolean(showDeleteModal)}
        targetName={showDeleteModal?.name || 'this conversation'}
        onClose={() => setShowDeleteModal(null)}
        onConfirm={handleDeleteChat}
      />

      {/* CONTEXT MENU */}
      {contextMenuTarget && (
        <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center p-4">
          <div className="absolute inset-0 md:bg-transparent" onClick={() => setContextMenuTarget(null)} style={{ backgroundColor: 'rgba(24, 19, 16, 0.25)' }} />
          <div className="relative w-full md:w-64 flex flex-col p-2 shadow-2xl rounded-2xl animate-in zoom-in-95 duration-100" style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
            <div className="p-3 mb-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="text-sm font-semibold truncate block" style={{ color: 'var(--text-primary)' }}>{contextMenuTarget.name}</span>
            </div>
            <button onClick={() => handleToggleMute(contextMenuTarget.id)} className="w-full flex items-center gap-3 p-3 text-sm font-medium rounded-xl text-left transition-colors" style={{ color: 'var(--text-primary)' }}>
              <BellOff className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /> {contextMenuTarget.isMuted ? 'Unmute Chat' : 'Mute Notifications'}
            </button>
            <button onClick={() => { setShowDeleteModal(contextMenuTarget); setContextMenuTarget(null); }} className="w-full flex items-center gap-3 p-3 text-sm font-medium rounded-xl text-left transition-colors mt-1" style={{ color: 'var(--accent)' }}>
              <Trash2 className="w-4 h-4" /> Delete Conversation
            </button>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0" onClick={() => setShowDeleteModal(null)} style={{ backgroundColor: 'rgba(24, 19, 16, 0.45)', backdropFilter: 'blur(10px)' }} />
          <div className="relative w-full max-w-sm p-6 rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 text-center" style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5 mx-auto" style={{ backgroundColor: 'rgba(210, 79, 116, 0.1)', border: '1px solid rgba(210, 79, 116, 0.2)' }}>
              <AlertTriangle className="w-8 h-8" style={{ color: 'var(--accent)' }} />
            </div>
            <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Delete Conversation</h3>
            <p className="text-sm mb-8 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>Are you sure you want to delete this chat with <strong style={{ color: 'var(--text-primary)' }}>{showDeleteModal.name}</strong>? This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteModal(null)} className="flex-1 py-3.5 text-sm font-semibold rounded-xl transition-colors" style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-primary)' }}>Cancel</button>
              <button onClick={handleDeleteChat} className="flex-1 py-3.5 text-sm font-semibold rounded-xl transition-colors shadow-lg" style={{ backgroundColor: 'var(--accent)', color: 'var(--surface-strong)' }}>Delete</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function InboxCallStage({ activeChat, callMode, callElapsedSec, localStream, micEnabled, micLevel }) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const remoteParticipants = participants.filter((p) => p.identity !== localParticipant?.identity);
  const remotePrimary = remoteParticipants[0];
  const localCameraTrack = cameraTracks.find((t) => t.participant.identity === localParticipant?.identity);
  const remoteCameraTrack = cameraTracks.find((t) => t.participant.identity !== localParticipant?.identity);
  const connectedCount = remoteParticipants.length + 1;

  return (
    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 p-6 items-center justify-center max-w-6xl mx-auto w-full">
      <div className="col-span-full text-center text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
        {callMode === 'video' ? 'Video call' : 'Audio call'} • {connectedCount} participant{connectedCount === 1 ? '' : 's'} • {formatDuration(callElapsedSec)}
      </div>
      <div className="w-full h-full max-h-[52vh] rounded-3xl flex flex-col items-center justify-center relative overflow-hidden shadow-2xl gap-4" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
        {callMode === 'video' && (localCameraTrack || localStream) ? (
          <>
            {localCameraTrack ? (
              <VideoTrack trackRef={localCameraTrack} className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <video ref={(el) => { if (el && localStream) { try { el.srcObject = localStream; } catch(e){} } }} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
          </>
        ) : (
          <div className="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-bold z-10" style={{ backgroundColor: 'var(--surface-strong)', color: 'var(--text-primary)' }}>
            {(localParticipant?.name || 'You').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="text-sm font-semibold z-10 px-3 py-1.5 rounded-lg" style={{ color: 'var(--text-primary)', backgroundColor: 'rgba(0,0,0,0.45)' }}>You</div>
        <div className="text-xs z-10 flex flex-col gap-2" style={{ color: 'var(--text-muted)' }}>
          {micEnabled ? (
            <>
              <span>Mic on — {micLevel < 0.02 ? 'No sound' : micLevel < 0.1 ? 'Quiet' : micLevel < 0.25 ? 'Speaking softly' : micLevel < 0.5 ? 'Speaking' : 'Loud input'}</span>
              <div className="flex items-center gap-1">
                {[0.05, 0.15, 0.3, 0.5].map((threshold, index) => {
                  const active = micLevel >= threshold;
                  return (
                    <span key={index} className="inline-block h-2 rounded-full transition-all duration-150" style={{ width: `${6 + index * 4}px`, backgroundColor: active ? 'var(--success)' : 'rgba(100,116,139,0.3)' }} />
                  );
                })}
              </div>
            </>
          ) : (
            <div className="inline-flex items-center gap-2">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              <span>Mic off</span>
            </div>
          )}
        </div>
      </div>

      <div className="w-full h-full max-h-[52vh] rounded-3xl flex flex-col items-center justify-center relative overflow-hidden shadow-2xl gap-4" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
        {callMode === 'video' && remoteCameraTrack && (
          <>
            <VideoTrack trackRef={remoteCameraTrack} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
          </>
        )}
        {remotePrimary ? (
          <>
            {(!remoteCameraTrack || callMode !== 'video') && (
              <div className="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-bold z-10" style={{ backgroundColor: 'var(--surface-strong)', color: 'var(--text-primary)' }}>
                {(remotePrimary?.name || activeChat?.name || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="text-sm font-semibold z-10 px-3 py-1.5 rounded-lg" style={{ color: 'var(--text-primary)', backgroundColor: 'rgba(0,0,0,0.45)' }}>{remotePrimary?.name || activeChat?.name}</div>
            <div className="text-xs z-10 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
              <span>{remotePrimary?.isSpeaking ? 'Speaking' : 'Connected'}</span>
              <span className="inline-block w-16 h-1 bg-zinc-800 rounded overflow-hidden">
                <span className="block h-full bg-emerald-400" style={{ width: `${Math.min(100, Math.round(((remotePrimary?.audioLevel ?? remotePrimary?.audio_level) || 0) * 200))}%`, transition: 'width 120ms linear' }} />
              </span>
            </div>
          </>
        ) : (
          <>
            {activeChat?.avatar ? (
              <img src={activeChat.avatar} alt={activeChat.name} className="w-24 h-24 rounded-full object-cover z-10" />
            ) : (
              <div className="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-bold z-10" style={{ backgroundColor: 'var(--surface-strong)', color: 'var(--text-primary)' }}>
                {(activeChat?.name || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="text-sm font-semibold z-10 px-3 py-1.5 rounded-lg" style={{ color: 'var(--text-primary)', backgroundColor: 'rgba(0,0,0,0.45)' }}>{activeChat?.name}</div>
            <div className="text-xs z-10" style={{ color: 'var(--text-muted)' }}>Ringing...</div>
          </>
        )}
      </div>
    </div>
  );
}

function formatDuration(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const secs = (totalSeconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}