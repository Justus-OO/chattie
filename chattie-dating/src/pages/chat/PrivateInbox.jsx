import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  MessageSquare, Search, MoreVertical, BellOff, 
  Trash2, Archive, CheckCircle2, Flame, AlertTriangle, Clock,
  Loader2, RefreshCw, Send, ArrowLeft, Bot, Sparkles, Check, CheckCheck, X, Heart,
  Image as ImageIcon, Smile, Upload, Video, Mic, MicOff, PhoneOff, Phone, Headphones,
  Pin, PinOff, PhoneCall
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
import { ChattieService } from '../../api/chattie.service';
import { MediaVaultModal, DeleteConfirmModal, BlockUserModal } from '../../components/chat/ChatModals';
import { useI18n } from '../../i18n';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || "ws://localhost:7880"; 

const getPrivateCallRoomId = (firstUserId, secondUserId) =>
  `dm_call_${[String(firstUserId), String(secondUserId)].sort().join('_')}`;

function AutoPublishMic({ micGain, setMicEnabled, setMicLevel }) {
  const { localParticipant } = useLocalParticipant();
  const publishedRef = useRef(null);
  const srcStreamRef = useRef(null);
  const analyserRef = useRef(null);
  const gainNodeRef = useRef(null);
  const micGainRef = useRef(micGain);

  useEffect(() => {
    micGainRef.current = micGain;
  }, [micGain]);

  useEffect(() => {
    if (!localParticipant) return undefined;
    let mounted = true;
    let animationFrame = null;
    let lastLevelUpdate = 0;
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    const setup = async () => {
      try {
        await audioContext.resume();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!mounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        srcStreamRef.current = stream;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        const gainNode = audioContext.createGain();
        gainNode.gain.value = micGainRef.current ?? 1;
        gainNodeRef.current = gainNode;
        const destination = audioContext.createMediaStreamDestination();
        source.connect(analyser);
        analyser.connect(gainNode);
        gainNode.connect(destination);

        const updateLevel = () => {
          if (!mounted || !analyserRef.current) return;
          const data = new Uint8Array(analyserRef.current.fftSize);
          analyserRef.current.getByteTimeDomainData(data);
          const mean = data.reduce((sum, value) => sum + value, 0) / data.length;
          const rms = Math.sqrt(data.reduce((sum, value) => sum + (value - mean) ** 2, 0) / data.length) / 128;
          const now = performance.now();
          if (now - lastLevelUpdate >= 100) {
            setMicLevel(Math.min(1, Math.max(0, rms)));
            lastLevelUpdate = now;
          }
          animationFrame = requestAnimationFrame(updateLevel);
        };
        updateLevel();

        if (LocalAudioTrack && localParticipant.publishTrack) {
          const localAudioTrack = new LocalAudioTrack(destination.stream.getAudioTracks()[0]);
          try {
            const publication = await localParticipant.publishTrack(localAudioTrack);
            if (!mounted) {
              await localParticipant.unpublishTrack(localAudioTrack);
              return;
            }
            publishedRef.current = { publication, localAudioTrack };
            setMicEnabled(true);
            return;
          } catch (error) {
            console.warn('Processed microphone publish failed; falling back to LiveKit microphone:', error);
          }
        }

        if (localParticipant.setMicrophoneEnabled) {
          await localParticipant.setMicrophoneEnabled(true);
          setMicEnabled(true);
        }
      } catch (error) {
        if (mounted) {
          setMicEnabled(false);
          console.error('Private call microphone setup failed:', error);
          toast.error('Could not access your microphone. Check browser permissions and try again.');
        }
      }
    };

    setup();

    return () => {
      mounted = false;
      if (publishedRef.current) {
        localParticipant.unpublishTrack(publishedRef.current.localAudioTrack).catch((error) => {
          console.warn('Could not unpublish the private call microphone:', error);
        });
        publishedRef.current = null;
      }
      if (srcStreamRef.current) {
        srcStreamRef.current.getTracks().forEach((track) => track.stop());
        srcStreamRef.current = null;
      }
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      analyserRef.current?.disconnect();
      analyserRef.current = null;
      gainNodeRef.current?.disconnect();
      gainNodeRef.current = null;
      audioContext.close().catch((error) => {
        console.warn('Could not close private call audio context:', error);
      });
      setMicEnabled(false);
      setMicLevel(0);
    };
  }, [localParticipant, setMicEnabled, setMicLevel]);

  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = micGain;
  }, [micGain]);

  return null;
}

// --- ROBUST WS URL BUILDER ---
const getWsUrl = (queryParameters) => {
  if (import.meta.env.VITE_WS_URL) {
    return `${import.meta.env.VITE_WS_URL}${queryParameters}`;
  }
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'localhost:8080' 
    : window.location.host;
  return `${wsProtocol}//${host}/ws${queryParameters}`;
};

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
  const { t } = useI18n();
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
  const [aiSuggestions, setAISuggestions] = useState([]);
  const [isGeneratingAISuggestions, setIsGeneratingAISuggestions] = useState(false);
  const [aiAutoReplyEnabled, setAIAutoReplyEnabled] = useState(false);
  const [isLoadingAIAutoReply, setIsLoadingAIAutoReply] = useState(false);
  const [isUpdatingAIAutoReply, setIsUpdatingAIAutoReply] = useState(false);
  
  // --- CALL / WEBRTC STATE ---
  const [callToken, setCallToken] = useState("");
  const [isInCall, setIsInCall] = useState(false);
  const [isConnectingCall, setIsConnectingCall] = useState(false);
  const [callMode, setCallMode] = useState('video');
  const [callRoomId, setCallRoomId] = useState('');
  const [outgoingCallData, setOutgoingCallData] = useState(null);
  const [callStartedAt, setCallStartedAt] = useState(null);
  const [callElapsedSec, setCallElapsedSec] = useState(0);
  const [activeCallPeerId, setActiveCallPeerId] = useState('');
  const [pinningMessageId, setPinningMessageId] = useState(null);
  
  // Incoming call / ringing state
  const [incomingCallData, setIncomingCallData] = useState(null); 
  const notificationSocketRef = useRef(null);
  const callTimeoutRef = useRef(null);
  const outgoingCallRef = useRef(null);
  const incomingCallRef = useRef(null);
  const isInCallRef = useRef(false);
  const callRoomRef = useRef('');
  const notificationReconnectAttempts = useRef(0);
  const notificationIntentionalClose = useRef(false);

  const ringtoneCtxRef = useRef(null);
  const ringtonePlayingRef = useRef(false);
  const audioCtxRef = useRef(null);
  const [ringtoneProfile, setRingtoneProfile] = useState('sweet'); 
  const [micGain, setMicGain] = useState(1.0);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  // --- TEXTING FEATURES STATE ---
  const [showMediaVault, setShowMediaVault] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [attachedMedia, setAttachedMedia] = useState(null);
  const [attachedFile, setAttachedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [attachedMediaMeta, setAttachedMediaMeta] = useState(null);
  const [attachedMediaType, setAttachedMediaType] = useState(null);
  const [revealedMediaIds, setRevealedMediaIds] = useState(new Set());
  const [vaultImages, setVaultImages] = useState([]);
  const [isLoadingVault, setIsLoadingVault] = useState(false);
  
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageRefs = useRef(new Map());
  const socketMetaRef = useRef({ reconnectAttempts: 0, manuallyClosed: false, reconnectTimer: null });
  const activeChatRef = useRef(null);
  const conversationsRef = useRef(conversations);
  const lastIncomingCallRef = useRef(null);
  const lastTypingTimeRef = useRef(0);
  const typingTimeoutRef = useRef(null);
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const [partnerPresence, setPartnerPresence] = useState('offline');
  const [replyingTo, setReplyingTo] = useState(null);
  const [firstUnreadId, setFirstUnreadId] = useState(null);
  const currentUser = useAppStore((s) => s.user) || { id: 'me', name: 'You' };
  const appToken = useAppStore((state) => state.token);
  const currentUserRef = useRef(currentUser);
  activeChatRef.current = activeChat;
  conversationsRef.current = conversations;
  currentUserRef.current = currentUser;
  outgoingCallRef.current = outgoingCallData;
  incomingCallRef.current = incomingCallData;
  isInCallRef.current = isInCall;
  callRoomRef.current = callRoomId;

  useEffect(() => {
    let cancelled = false;
    setAISuggestions([]);
    setAIAutoReplyEnabled(false);
    if (!activeChat?.id || activeChat.type !== 'dm') {
      setIsLoadingAIAutoReply(false);
      return () => { cancelled = true; };
    }

    setIsLoadingAIAutoReply(true);
    chatService.getAIAutoReplyPreference(activeChat.id)
      .then(({ enabled }) => {
        if (!cancelled) setAIAutoReplyEnabled(Boolean(enabled));
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error.response?.data?.error || 'Could not load AI auto-reply setting.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAIAutoReply(false);
      });

    return () => { cancelled = true; };
  }, [activeChat?.id, activeChat?.type]);

  const handleGenerateAISuggestions = async () => {
    if (!activeChat?.id || activeChat.type !== 'dm' || isGeneratingAISuggestions) return;
    const targetId = activeChat.id;
    setIsGeneratingAISuggestions(true);
    try {
      const response = await chatService.generateAISuggestions(targetId);
      if (activeChatRef.current?.id === targetId) {
        setAISuggestions(Array.isArray(response.suggestions) ? response.suggestions : []);
      }
    } catch (error) {
      const message = typeof error.response?.data === 'string'
        ? error.response.data
        : error.response?.data?.error || 'AI suggestions are unavailable right now.';
      toast.error(message);
    } finally {
      setIsGeneratingAISuggestions(false);
    }
  };

  const handleToggleAIAutoReply = async () => {
    if (!activeChat?.id || activeChat.type !== 'dm' || isUpdatingAIAutoReply) return;
    const targetId = activeChat.id;
    const enabled = !aiAutoReplyEnabled;
    setIsUpdatingAIAutoReply(true);
    try {
      const response = await chatService.setAIAutoReplyPreference(targetId, enabled);
      if (activeChatRef.current?.id === targetId) {
        setAIAutoReplyEnabled(Boolean(response.enabled));
      }
      toast.success(enabled
        ? 'AI replies are enabled for this chat after 5 hours without your reply.'
        : 'AI replies are disabled for this chat.');
    } catch (error) {
      const message = typeof error.response?.data === 'string'
        ? error.response.data
        : error.response?.data?.error || 'Could not update AI auto-reply setting.';
      toast.error(message);
    } finally {
      setIsUpdatingAIAutoReply(false);
    }
  };

  const applyPinUpdate = (message) => {
    if (!message.message_id) return;
    setMessages((previous) => previous.map((item) => item.id === message.message_id
      ? { ...item, isPinned: Boolean(message.is_pinned) }
      : item));
  };

  const appendCallEventMessage = (message) => {
    const partnerId = message.sender_id === currentUserRef.current?.id
      ? message.recipient_id
      : message.sender_id;
    const chatMessage = {
      id: message.id,
      sender: message.sender_id === currentUserRef.current?.id ? 'me' : 'partner',
      text: message.content || message.text || '',
      messageKind: message.message_kind || 'call_event',
      callMode: message.call_mode || 'audio',
      status: message.status || 'sent',
      time: formatChatTimestamp(message.created_at || Date.now())
    };

    if (activeChatRef.current?.id === partnerId) {
      setMessages((previous) => previous.some((item) => item.id === chatMessage.id)
        ? previous
        : [...previous, chatMessage]);
    }
    setConversations((previous) => {
      const exists = previous.some((chat) => chat.id === partnerId);
      if (!exists) return previous;
      return previous.map((chat) => chat.id === partnerId
        ? { ...chat, lastMessage: chatMessage.text, timestamp: chatMessage.time }
        : chat);
    });
  };

  const recordCallEvent = async (targetId, event, mode) => {
    const message = await chatService.recordDirectCallEvent(targetId, event, mode);
    appendCallEventMessage(message);
    return message;
  };

  const sendCallSignal = (type, targetId, extra = {}) => {
    const payload = {
      type,
      target_id: targetId,
      from: currentUserRef.current?.id,
      ...extra
    };
    const socket = [socketRef.current, notificationSocketRef.current]
      .find((candidate) => candidate?.readyState === WebSocket.OPEN);
    if (!socket) throw new Error('Call signaling is not connected');
    socket.send(JSON.stringify(payload));
  };

  const clearCallTimeout = () => {
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  };

  const receiveIncomingCall = (incoming) => {
    const callerId = incoming.from || incoming.sender_id;
    if (!callerId || callerId === currentUserRef.current?.id || !incoming.room_id) return;
    if (incoming.room_id !== getPrivateCallRoomId(callerId, currentUserRef.current?.id)) return;
    if (isInCallRef.current || outgoingCallRef.current) {
      try {
        sendCallSignal('call_rejected', callerId, {
          room_id: incoming.room_id,
          reason: 'busy'
        });
      } catch (error) {
        console.warn('Could not decline a call while busy:', error);
      }
      return;
    }
    if (lastIncomingCallRef.current === incoming.room_id) return;

    lastIncomingCallRef.current = incoming.room_id;
    const caller = conversationsRef.current.find((chat) => chat.id === callerId);
    setActiveChat((current) => current?.id === callerId ? current : {
      id: callerId,
      type: 'dm',
      name: incoming.from_name || incoming.sender_name || caller?.name || 'Caller',
      avatar: caller?.avatar || '',
      lifetimeSpend: caller?.lifetimeSpend || 0,
      flagged: caller?.flagged || false,
      bio: caller?.bio || ''
    });
    setIncomingCallData({
      fromId: callerId,
      fromName: incoming.from_name || incoming.sender_name || caller?.name || 'Caller',
      roomId: incoming.room_id,
      mode: incoming.mode === 'audio' ? 'audio' : 'video'
    });
  };

  const handleCallAnswered = (incoming) => {
    const pending = outgoingCallRef.current;
    if (!pending || pending.roomId !== incoming.room_id) return;
    clearCallTimeout();
    outgoingCallRef.current = null;
    setOutgoingCallData(null);
    setCallToken(pending.token);
    setCallMode(pending.mode);
    setCallRoomId(pending.roomId);
    setActiveCallPeerId(pending.targetId);
    setIsInCall(true);
    setCallStartedAt(Date.now());
    try {
      localStorage.setItem('chattie.activeCall', JSON.stringify({
        chatId: pending.targetId,
        roomId: pending.roomId,
        token: pending.token,
        mode: pending.mode,
        startedAt: Date.now()
      }));
    } catch (error) {
      console.warn('Could not persist active call state:', error);
    }
    recordCallEvent(pending.targetId, 'connected', pending.mode)
      .catch((error) => {
        console.error('Could not save call history:', error);
        toast.error('The call connected, but its history could not be saved.');
      });
    ensureAudioPlayback();
  };

  const handleCallRejected = (incoming) => {
    const pending = outgoingCallRef.current;
    if (!pending || pending.roomId !== incoming.room_id) return;
    clearCallTimeout();
    outgoingCallRef.current = null;
    setOutgoingCallData(null);
    setCallToken('');
    setCallStartedAt(null);
    setCallRoomId('');
    setActiveCallPeerId('');
    try { localStorage.removeItem('chattie.activeCall'); } catch (error) {
      console.warn('Could not clear active call state:', error);
    }
    stopRingtone();
    toast.error(incoming.reason === 'busy' ? 'This person is already on another call.' : t('callRejectedInbox'));
  };

  const finishCallFromSignal = (incoming) => {
    if (callRoomRef.current && incoming.room_id !== callRoomRef.current) return;
    setIsInCall(false);
    setCallToken('');
    setCallStartedAt(null);
    setCallElapsedSec(0);
    setCallRoomId('');
    try { localStorage.removeItem('chattie.activeCall'); } catch (error) {
      console.warn('Could not clear active call state:', error);
    }
  };

  const handleCallSignal = (incoming) => {
    if (incoming.type === 'incoming_call') {
      receiveIncomingCall(incoming);
    } else if (incoming.type === 'call_answered') {
      handleCallAnswered(incoming);
    } else if (incoming.type === 'call_rejected') {
      handleCallRejected(incoming);
    } else if (incoming.type === 'call_ended') {
      finishCallFromSignal(incoming);
    } else if (incoming.type === 'call_cancelled') {
      if (incomingCallRef.current?.roomId === incoming.room_id) {
        setIncomingCallData(null);
        lastIncomingCallRef.current = null;
        stopRingtone();
      }
    }
  };
  
  const [contextMenuTarget, setContextMenuTarget] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(null);
  
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listRef = useRef(null);

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
  // WEBSOCKET SETUP WHEN ACTIVE CHAT OPENS (ROBUST BACKOFF)
  // ============================================================================
  useEffect(() => {
    let disposed = false;
    const chatSockets = new Set();
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setIsPartnerTyping(false);
    setPartnerPresence(activeChat?.status === 'online' ? 'online' : 'offline');
    setFirstUnreadId(null);
    setReplyingTo(null);
    activeChatRef.current = activeChat;

    if (!activeChat) {
      if (socketRef.current) {
        // CLEAN DISCONNECT: Sends code 1000 to backend so it doesn't log 1005 errors
        socketRef.current.close(1000, "User left chat");
        socketRef.current = null;
      }
      setIsInCall(false);
      setCallToken("");
      return;
    }

    const connectWsForChat = () => {
      socketMetaRef.current.manuallyClosed = false;

      const doConnect = () => {
        if (disposed) return;
        let token = appToken || '';
        try {
          const stored = localStorage.getItem('chattie-session-storage');
          if (!token && stored) token = JSON.parse(stored)?.state?.token || '';
        } catch (e) {}

        const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
        const shouldUseRoom = activeChatRef.current?.type === 'room';
        const chatTarget = activeChatRef.current?.id;
        
        // USE ROBUST URL BUILDER
        const wsUrl = getWsUrl(`?${shouldUseRoom ? `room_id=${chatTarget}` : `target_id=${chatTarget}`}&token=${encodeURIComponent(cleanToken)}`);

        try {
          const ws = new WebSocket(wsUrl);
          chatSockets.add(ws);
          socketRef.current = ws;

          ws.onopen = () => {
            if (disposed) {
              ws.close(1000, "Chat view closed");
              return;
            }
            socketMetaRef.current.reconnectAttempts = 0;
            const presencePayload = activeChatRef.current?.type === 'room'
              ? { type: 'presence', status: 'online', room_id: activeChatRef.current.id }
              : { type: 'presence', status: 'online', target_id: activeChatRef.current?.id };
            try { ws.send(JSON.stringify(presencePayload)); } catch (e) {}
            
            if (activeChatRef.current?.type === 'dm') {
              try { apiClient.patch(`/chats/${activeChatRef.current.id}/read`).catch(()=>{}); } catch(e){}
              try { ws.send(JSON.stringify({ type: 'read_receipt', target_id: activeChatRef.current.id })); } catch(e){}
            }
          };

          ws.onmessage = (event) => {
            if (disposed) return;
            try {
              const incoming = JSON.parse(event.data);

              if (incoming.type === 'mark_read' || incoming.type === 'read_receipt') {
                setMessages(prev => prev.map(msg => msg.sender === 'me' ? { ...msg, status: 'read' } : msg));
                return;
              }

              if (incoming.type === 'presence') {
                const isMatching = incoming.target_id === activeChatRef.current?.id || incoming.room_id === activeChatRef.current?.id;
                if (isMatching) {
                  setPartnerPresence(incoming.status === 'online' ? 'online' : incoming.status === 'away' ? 'away' : 'offline');
                }
                return;
              }

              if (incoming.type === 'typing' || incoming.type === 'stop_typing') {
                const senderId = incoming.sender_id || incoming.from;
                if (senderId === activeChatRef.current?.id) {
                  if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                  if (incoming.type === 'stop_typing') {
                    typingTimeoutRef.current = null;
                    setIsPartnerTyping(false);
                  } else {
                    setIsPartnerTyping(true);
                    typingTimeoutRef.current = window.setTimeout(() => {
                      typingTimeoutRef.current = null;
                      setIsPartnerTyping(false);
                    }, 3000);
                  }
                }
                return;
              }

              if (['incoming_call', 'call_answered', 'call_rejected', 'call_ended', 'call_cancelled'].includes(incoming.type)) {
                handleCallSignal(incoming);
                return;
              }

              if (incoming.type === 'chat' && incoming.message_kind === 'call_event') {
                appendCallEventMessage(incoming);
                return;
              }
              if (incoming.type === 'pin_update') {
                applyPinUpdate(incoming);
                return;
              }

              const newMsg = {
                id: incoming.id || Date.now().toString(),
                sender: incoming.sender_id === activeChatRef.current?.id ? 'partner' : 'me',
                text: incoming.content || incoming.text || '',
                media: incoming.media || null,
                nsfw: incoming.nsfw || incoming.is_flagged || incoming.flagged || false,
                flagged: incoming.flagged || incoming.is_flagged || incoming.isFlagged || false,
                isPinned: incoming.is_pinned || false,
                isAIGenerated: Boolean(incoming.is_ai_generated),
                messageKind: incoming.message_kind || 'chat',
                callMode: incoming.call_mode || '',
                status: incoming.sender_id === activeChatRef.current?.id ? 'delivered' : 'sent',
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              };
              setMessages(prev => {
                if (prev.some(m => m.id === newMsg.id)) return prev;
                const optimisticIndex = incoming.client_message_id
                  ? prev.findIndex(message => message.id === incoming.client_message_id)
                  : -1;
                if (optimisticIndex >= 0) {
                  const next = [...prev];
                  next[optimisticIndex] = { ...next[optimisticIndex], ...newMsg, status: 'delivered' };
                  return next;
                }
                const next = [...prev, newMsg];
                if (activeChatRef.current?.type === 'dm' && incoming.sender_id === activeChatRef.current?.id) {
                  setTimeout(() => {
                    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                      try { socketRef.current.send(JSON.stringify({ type: 'read_receipt', target_id: activeChatRef.current.id })); } catch (e) {}
                    }
                  }, 150);
                }
                return next;
              });
            } catch (e) {}
          };

          ws.onclose = () => {
            chatSockets.delete(ws);
            if (socketRef.current === ws) socketRef.current = null;
            if (disposed || socketMetaRef.current.manuallyClosed) return;
            socketMetaRef.current.reconnectAttempts = (socketMetaRef.current.reconnectAttempts || 0) + 1;
            const attempt = socketMetaRef.current.reconnectAttempts;
            const delay = Math.min(30000, Math.pow(2, attempt) * 500);
            if (socketMetaRef.current.reconnectTimer) clearTimeout(socketMetaRef.current.reconnectTimer);
            socketMetaRef.current.reconnectTimer = setTimeout(doConnect, delay);
          };
        } catch (e) {
          socketMetaRef.current.reconnectAttempts = (socketMetaRef.current.reconnectAttempts || 0) + 1;
          const attempt = socketMetaRef.current.reconnectAttempts;
          const delay = Math.min(30000, Math.pow(2, attempt) * 500);
          socketMetaRef.current.reconnectTimer = setTimeout(doConnect, delay);
        }
      };

      doConnect();
    };

    const loadChatHistoryAndConnect = async () => {
      try {
        const history = await chatService.getChatHistory(activeChat.id, activeChat.type || 'dm');
        const formatted = (Array.isArray(history) ? history : []).map(msg => ({
          id: msg.id || Math.random().toString(),
          sender: (msg.sender_id === activeChat.id || msg.sender === 'partner') ? 'partner' : 'me',
          text: msg.content || msg.text || '',
          media: msg.media || null,
          nsfw: msg.nsfw || msg.is_flagged || msg.isFlagged || false,
          flagged: msg.flagged || msg.is_flagged || msg.isFlagged || false,
          isPinned: msg.is_pinned || false,
          isAIGenerated: Boolean(msg.is_ai_generated),
          messageKind: msg.message_kind || 'chat',
          callMode: msg.call_mode || '',
          status: (msg.status || (msg.read === false ? 'unread' : undefined)) || 'delivered',
          time: formatChatTimestamp(msg.created_at || msg.timestamp || msg.createdAt || msg.sent_at || Date.now()) || 'Just now'
        }));
        const initialMessages = formatted;
        setMessages(initialMessages);
        const firstUnread = initialMessages.find(m => m.unread || m.is_unread || m.status === 'unread')
          || (activeChat?.unreadCount > 0 ? initialMessages.filter(m => m.sender === 'partner')[Math.max(0, initialMessages.filter(m => m.sender === 'partner').length - activeChat.unreadCount)] : null);
        setFirstUnreadId(firstUnread?.id || null);
      } catch (err) {
        setMessages([]);
      }

      connectWsForChat();
    };

    loadChatHistoryAndConnect();

    return () => {
      disposed = true;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
      try {
        socketMetaRef.current.manuallyClosed = true;
        if (socketMetaRef.current.reconnectTimer) { clearTimeout(socketMetaRef.current.reconnectTimer); socketMetaRef.current.reconnectTimer = null; }
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          const presencePayload = activeChat && activeChat.type === 'room'
            ? { type: 'presence', status: 'offline', room_id: activeChat.id }
            : { type: 'presence', status: 'offline', target_id: activeChat?.id };
          try { socketRef.current.send(JSON.stringify(presencePayload)); } catch(e){}
        }
      } catch (e) {}
      // CLEAN DISCONNECT
      chatSockets.forEach((ws) => {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => ws.close(1000, "Intentional disconnect");
        } else if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "Intentional disconnect");
        }
      });
      if (socketRef.current && chatSockets.has(socketRef.current)) socketRef.current = null;
    };
  }, [activeChat, appToken]);

  // ============================================================================
  // GLOBAL NOTIFICATION SOCKET (WITH EXPONENTIAL BACKOFF)
  // ============================================================================
  useEffect(() => {
    let disposed = false;
    let reconnectTimer;
    let activeToken = appToken;
    if (!activeToken) {
      try {
        const stored = localStorage.getItem('chattie-session-storage');
        if (stored) activeToken = JSON.parse(stored)?.state?.token || '';
      } catch (e) {}
    }

    if (!activeToken) return;

    const connectGlobalNotifications = () => {
      if (disposed) return;
      notificationIntentionalClose.current = false;
      const cleanToken = activeToken.startsWith('Bearer ') ? activeToken.slice(7) : activeToken;
      
      // USE ROBUST URL BUILDER
      const notifyUrl = getWsUrl(`?token=${encodeURIComponent(cleanToken)}`);

      try {
        const nws = new WebSocket(notifyUrl);
        notificationSocketRef.current = nws;

        nws.onopen = () => {
          if (disposed) {
            nws.close(1000, "Notifications view closed");
            return;
          }
          notificationReconnectAttempts.current = 0;
          console.log('✅ Global Notification Socket Connected');
        };

        nws.onmessage = (ev) => {
          if (disposed) return;
          try {
            const incoming = JSON.parse(ev.data);
            if (['incoming_call', 'call_answered', 'call_rejected', 'call_ended', 'call_cancelled'].includes(incoming.type)) {
              handleCallSignal(incoming);
              return;
            }
            if (incoming.type === 'chat' && incoming.message_kind === 'call_event') {
              appendCallEventMessage(incoming);
              return;
            }
            if (incoming.type === 'pin_update') {
              applyPinUpdate(incoming);
              return;
            }
          } catch (e) {}
        };

        nws.onclose = () => {
          if (disposed || notificationIntentionalClose.current) return;
          // Exponential backoff for notification socket
          const attempt = notificationReconnectAttempts.current;
          const delay = Math.min(30000, Math.pow(2, attempt) * 1000);
          notificationReconnectAttempts.current += 1;
          reconnectTimer = setTimeout(connectGlobalNotifications, delay);
        };
      } catch (e) {
        // Fallback retry
        reconnectTimer = setTimeout(connectGlobalNotifications, 2000);
      }
    };

    connectGlobalNotifications();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      notificationIntentionalClose.current = true;
      if (notificationSocketRef.current) {
        const ws = notificationSocketRef.current;
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => ws.close(1000, "Intentional disconnect");
        } else if (ws.readyState === WebSocket.OPEN) {
          try { ws.close(1000, "Intentional disconnect"); } catch (e) {}
        }
        notificationSocketRef.current = null;
      }
    };
  }, [appToken, currentUser?.id]);

  // Rehydrate persisted active call on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('chattie.activeCall');
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && obj.token) {
        setCallToken(obj.token);
        setIsInCall(true);
        setCallMode(obj.mode || 'video');
        setCallStartedAt(obj.startedAt || Date.now());
      }
    } catch (e) {}
  }, []);

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
    if (incomingCallData) playRingtone(ringtoneProfile);
    else stopRingtone();
    return () => stopRingtone();
  }, [incomingCallData]);

  useEffect(() => {
    if (isInCall) {
      stopRingtone();
      setIncomingCallData(null);
    }
  }, [isInCall]);

  useEffect(() => {
    if (incomingCallData) {
      stopRingtone();
      playRingtone(ringtoneProfile);
    }
  }, [ringtoneProfile]);

  // ============================================================================
  // CALL HANDLERS
  // ============================================================================
  const startCall = async (mode = 'video') => {
    if (!activeChat?.id || isInCall || outgoingCallData) return;
    setCallMode(mode);
    setIsConnectingCall(true);
    try {
      const res = await apiClient.post(`/chats/${activeChat.id}/voice-token`, {
        participant_name: currentUser?.name || 'Host'
      });
      if (!res?.data?.token || !res.data.room_id) throw new Error('No direct call token was returned');
      const roomId = res.data.room_id;
      if (roomId !== getPrivateCallRoomId(activeChat.id, currentUserRef.current?.id)) {
        throw new Error('The call token returned an unexpected room');
      }

      outgoingCallRef.current = {
        roomId,
        mode,
        token: res.data.token,
        targetId: activeChat.id,
        targetName: activeChat.name
      };
      setOutgoingCallData(outgoingCallRef.current);
      recordCallEvent(activeChat.id, 'started', mode).catch((error) => {
        console.error('Could not save call history:', error);
        toast.error('The call started, but its history could not be saved.');
      });
      sendCallSignal('incoming_call', activeChat.id, {
        from_name: currentUser?.name || 'Caller',
        room_id: roomId,
        mode
      });
      clearCallTimeout();
      callTimeoutRef.current = window.setTimeout(() => {
        const pending = outgoingCallRef.current;
        if (!pending || pending.roomId !== roomId) return;
        outgoingCallRef.current = null;
        setOutgoingCallData(null);
        try {
          sendCallSignal('call_cancelled', activeChat.id, { room_id: roomId });
        } catch (error) {
          console.warn('Could not send call timeout signal:', error);
        }
        recordCallEvent(activeChat.id, 'no_answer', mode).catch((error) => {
          console.error('Could not save unanswered call history:', error);
          toast.error('The unanswered call could not be added to chat history.');
        });
        toast.info(`${activeChat.name} did not answer.`);
      }, 45000);
    } catch (err) {
      outgoingCallRef.current = null;
      setOutgoingCallData(null);
      clearCallTimeout();
      console.error('Failed to start private call:', err);
      toast.error(t('secureCallFailedInbox'));
    } finally {
      setIsConnectingCall(false);
    }
  };

  const endCall = () => {
    const peerId = activeCallPeerId || activeChatRef.current?.id;
    const mode = callMode;
    const roomId = callRoomRef.current;
    if (peerId) {
      recordCallEvent(peerId, 'ended', mode).catch((error) => {
        console.error('Could not save ended call history:', error);
        toast.error('Call ended, but its history could not be saved.');
      });
      try {
        sendCallSignal('call_ended', peerId, { room_id: roomId });
      } catch (error) {
        console.warn('Could not notify the other participant that the call ended:', error);
      }
    }
    clearCallTimeout();
    outgoingCallRef.current = null;
    setOutgoingCallData(null);
    setIsInCall(false);
    setCallToken("");
    setCallStartedAt(null);
    setCallElapsedSec(0);
    setCallRoomId('');
    setActiveCallPeerId('');
    try { localStorage.removeItem('chattie.activeCall'); } catch (e) {}
  };

  const acceptCall = async () => {
    const incoming = incomingCallRef.current;
    if (!incoming || isConnectingCall) return;
    const mode = incoming.mode || 'video';
    setCallMode(mode);
    stopRingtone();
    setIsConnectingCall(true);
    try {
      const res = await apiClient.post(`/chats/${incoming.fromId}/voice-token`, {
        participant_name: currentUser?.name || 'Guest'
      });
      if (!res?.data?.token || res.data.room_id !== incoming.roomId) {
        throw new Error('The caller token did not match the requested room');
      }
      sendCallSignal('call_answered', incoming.fromId, { room_id: incoming.roomId });
      setCallToken(res.data.token);
      setIsInCall(true);
      setCallStartedAt(Date.now());
      setCallRoomId(incoming.roomId);
      setActiveCallPeerId(incoming.fromId);
      try {
        localStorage.setItem('chattie.activeCall', JSON.stringify({
          chatId: incoming.fromId,
          roomId: incoming.roomId,
          token: res.data.token,
          mode,
          startedAt: Date.now()
        }));
      } catch (error) {
        console.warn('Could not persist active call state:', error);
      }
      stopRingtone();
      setIncomingCallData(null);
      lastIncomingCallRef.current = null;
      await ensureAudioPlayback();
    } catch (err) {
      console.error('Failed to accept private call:', err);
      toast.error(t('joinCallFailedInbox'));
    } finally {
      setIsConnectingCall(false);
    }
  };

  const rejectCall = (reason = 'rejected') => {
    const incoming = incomingCallRef.current;
    if (!incoming) return;
    recordCallEvent(incoming.fromId, reason === 'rejected' ? 'declined' : 'missed', incoming.mode || 'audio')
      .catch((error) => {
        console.error('Could not save declined call history:', error);
        toast.error('The call was declined, but its history could not be saved.');
      });
    try {
      sendCallSignal('call_rejected', incoming.fromId, {
        room_id: incoming.roomId,
        reason
      });
    } catch (error) {
      console.error('Could not notify the caller that the call was declined:', error);
      toast.error('Could not send the decline notice. Check your connection.');
    }
    recordCallEvent(incoming.fromId, 'missed', incoming.mode || 'audio').catch((error) => {
      console.error('Could not save missed call history:', error);
      toast.error('The missed call could not be added to chat history.');
    });
    setIncomingCallData(null);
    lastIncomingCallRef.current = null;
    stopRingtone();
  };

  const reconnectCall = (mode = 'audio') => {
    if (!activeChat?.id) return;
    startCall(mode);
  };

  const playRingtone = (profile = 'sweet') => {
    if (ringtonePlayingRef.current) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const master = ctx.createGain();
      master.gain.value = 1.0;
      master.connect(ctx.destination);

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
          playNote(660, 0, 0.22, 'sine', 0.04);
          playNote(880, 0.32, 0.18, 'sine', 0.035);
        } else if (profile === 'classic') {
          playNote(880, 0, 0.14, 'square', 0.06);
          playNote(659, 0.18, 0.14, 'square', 0.06);
          playNote(880, 0.36, 0.14, 'square', 0.06);
        } else {
          playNote(880, 0, 0.18, 'triangle', 0.055);
          playNote(660, 0.22, 0.18, 'triangle', 0.05);
          playNote(990, 0.46, 0.16, 'triangle', 0.045);
        }
      };

      const intervalMs = profile === 'soft' ? 1400 : (profile === 'classic' ? 1000 : 1200);
      scheduleMotif();
      const interval = setInterval(scheduleMotif, intervalMs);

      ringtoneCtxRef.current = { ctx, master, interval };
      ringtonePlayingRef.current = true;
    } catch (e) {}
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

  const ensureAudioPlayback = async () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();
    } catch (e) {}
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

  const pinnedMessages = useMemo(
    () => messages.filter((message) => message.isPinned),
    [messages]
  );
  const latestPinnedMessage = pinnedMessages[pinnedMessages.length - 1];

  const toggleDirectMessagePin = async (message) => {
    if (!activeChat?.id || !message?.id || pinningMessageId) return;
    const pinned = !message.isPinned;
    setPinningMessageId(message.id);
    try {
      await chatService.pinDirectMessage(activeChat.id, message.id, pinned);
      setMessages((previous) => previous.map((item) => item.id === message.id
        ? { ...item, isPinned: pinned }
        : item));
      toast.success(pinned ? 'Message pinned' : 'Message unpinned');
    } catch (error) {
      console.error('Failed to update direct message pin:', error);
      toast.error('Could not update the message pin.');
    } finally {
      setPinningMessageId(null);
    }
  };

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

  const handleSendMessage = async (overrideText = null) => {
    const textToSend = overrideText !== null ? overrideText : inputText;
    if (!textToSend.trim() && !attachedMedia && !isSending) return;

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      toast.error(t('chatOffline'));
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
    const sendPayload = async () => {
      if (attachedFile && !attachedMedia) {
        try { await uploadChatFile(attachedFile); } 
        catch (e) { toast.error(t('uploadFailed')); setIsSending(false); return; }
      }

      const payload = {
        client_message_id: localMessageId,
        room_id: isRoomChat ? activeChat.id : "",
        recipient_id: isDmChat ? activeChat.id : "",
        target_id: isDmChat ? activeChat.id : "",
        content: textToSend,
        text: textToSend,
        reply_to_id: replyingTo?.id,
        media: attachedMedia
      };

      try {
        socketRef.current.send(JSON.stringify(payload));
      } catch (err) {
        throw err;
      }
    };

    try {
      await sendPayload();
      setMessages(prev => prev.map(msg => msg.id === localMessageId ? { ...msg, status: 'delivered' } : msg));
      if (overrideText === null) setInputText('');
      setAttachedMedia(null);
      setAttachedFile(null);
      setShowEmojiPicker(false);
      setReplyingTo(null);
    } catch (err) {
      toast.error(t('sendMessageFailed'));
    } finally {
      setIsSending(false);
    }
  };

  const fileInputRef = useRef(null);
  const handlePickFileClick = () => fileInputRef.current?.click();
  const uploadChatFile = async (file) => {
    const form = new FormData();
    form.append('file', file);
    try {
      setUploadProgress(0);
      const res = await apiClient.post('/chats/media', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (ev) => {
          if (ev.total) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      });
      const data = res.data || {};
      const url = data.url || data.path || (data.data && data.data.url) || null;
      setAttachedMedia(url);
      setAttachedMediaMeta(data || null);
      try {
        const inferred = file && file.type ? file.type : (data.type || null) || (url && url.endsWith('.mp4') ? 'video/mp4' : null);
        setAttachedMediaType(inferred);
      } catch (e) {}

      if (data.nsfw || data.is_flagged) {
        toast.warning(t('mediaFlagged'));
      }

      try {
        setMessages(prev => {
          const out = [...prev];
          for (let i = out.length - 1; i >= 0; i--) {
            const m = out[i];
            if (m && String(m.id).startsWith('local-') && m.sender === 'me' && !m.media) {
              out[i] = { ...m, media: url, nsfw: !!(data.nsfw || data.is_flagged), flagged: !!(data.flagged || data.is_flagged) };
              break;
            }
          }
          return out;
        });
      } catch (e) {}
      return data;
    } catch (err) {
      console.error('uploadChatFile error', err);
      throw err;
    } finally {
      setUploadProgress(0);
    }
  };

  const handleFilePicked = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setAttachedFile(f);
    try { setAttachedMediaType(f.type || null); } catch (e) {}
    try {
      await uploadChatFile(f);
      toast.success('File attached');
    } catch (e) {
      setAttachedFile(null);
      toast.error('Failed to upload file');
    }
    try { e.target.value = ''; } catch (e) {}
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

    try { socketRef.current.send(JSON.stringify(typingPayload)); } catch (e) {}
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
      toast.error('Unable to delete conversation.');
    }
  };

  const fetchVaultImages = async () => {
    setIsLoadingVault(true);
    try {
        const media = await ChattieService.getMediaVault();
        setVaultImages(media || []);
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
      await ChattieService.uploadVaultMedia(file);
      await fetchVaultImages();
      toast.success('Photo uploaded to vault.');
    } catch (err) {
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
      <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col items-center justify-center p-6 text-center bg-black text-zinc-300" style={{ fontFamily: 'Roboto, sans-serif' }}>
        <Loader2 className="w-8 h-8 animate-spin mb-4 text-yellow-400" />
        <h2 className="text-sm font-bold uppercase tracking-widest">{t('loadingConversations')}</h2>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col w-full relative overflow-hidden bg-black text-zinc-300" style={{ fontFamily: 'Roboto, sans-serif' }}>
      
      {/* HEADER */}
      <header className="p-4 md:p-6 shrink-0 flex flex-col gap-4 z-10 bg-zinc-950 border-b-2 border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 border-2 border-zinc-700 bg-black flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <h1 className="font-black text-xl md:text-2xl uppercase tracking-widest text-white">{t('inbox')}</h1>
              <p className="text-[10px] mt-1 font-bold uppercase tracking-widest text-zinc-500">
                {totalUnread > 0 ? `You have ${totalUnread} unread messages` : "You're all caught up!"}
              </p>
            </div>
          </div>
          <button onClick={fetchInboxData} aria-label="Refresh inbox" className="p-2.5 border-2 border-zinc-800 bg-black text-zinc-400 hover:border-white hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="relative w-full max-w-xl">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input 
            type="text" 
            placeholder={t('searchMessages')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full border border-zinc-700 bg-black pl-11 pr-4 py-3 text-sm text-white focus:outline-none focus:border-yellow-400 transition-colors placeholder:text-zinc-600"
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto flex flex-col bg-black">
        
        {/* NEW MATCHES BAR */}
        {!searchQuery && (
          <div className="shrink-0 pb-2 border-b border-zinc-800 bg-zinc-950">
            <h2 className="text-[10px] font-black px-6 pt-5 pb-3 flex items-center gap-2 tracking-widest uppercase text-zinc-400">
              <Flame className="w-4 h-4 text-yellow-400" /> New Matches
            </h2>
            <div className="flex gap-5 overflow-x-auto px-6 pb-2 custom-scrollbar">
              <div onClick={() => navigate('/likes')} className="flex min-w-[clamp(4rem,9vw,5rem)] shrink-0 cursor-pointer flex-col items-center gap-2 group">
                <div className="flex size-[clamp(3.5rem,9vw,4rem)] items-center justify-center border-2 border-zinc-700 bg-black transition-colors group-hover:border-yellow-400">
                  <Heart className="w-6 h-6 text-yellow-400" />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider group-hover:text-white transition-colors text-zinc-400">{t('likes')}</span>
              </div>

              {newMatches.length === 0 ? (
                <div className="flex min-h-[clamp(3.5rem,8vw,4rem)] w-full items-center justify-center">
                  <span className="text-xs font-bold uppercase tracking-widest text-zinc-600">{t('noNewMatches')}</span>
                </div>
              ) : (
                newMatches.map(match => {
                  const matchId = match.targetId || match.target_id || match.recipient_id || match.partner_id || match.user_id || match.id;
                  return (
                    <div 
                      key={match.id || match.user_id}
                      onClick={() => handleOpenChatModal(matchId, match.name || match.display_name, match.avatar || match.avatar_url, 'dm', match)}
                      className="flex min-w-[clamp(4rem,9vw,5rem)] max-w-[clamp(4.5rem,10vw,5.25rem)] shrink-0 cursor-pointer flex-col items-center gap-2 group"
                    >
                      <div className="relative">
                        {match.avatar || match.avatar_url ? (
                          <img src={match.avatar || match.avatar_url} alt="match" className="size-[clamp(3.5rem,9vw,4rem)] object-cover border-2 border-transparent group-hover:border-white transition-all" />
                        ) : (
                          <div className="flex size-[clamp(3.5rem,9vw,4rem)] items-center justify-center border-2 border-zinc-700 bg-black text-lg font-bold text-white transition-all group-hover:border-white">
                            {(match.name || match.display_name || 'U').charAt(0).toUpperCase()}
                          </div>
                        )}
                        {match.status === 'online' && <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-black"></span>}
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider group-hover:text-white truncate w-full text-center px-1 transition-colors text-zinc-500">{match.name || match.display_name}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* CHAT TABS */}
        <div className="flex shrink-0 px-4 pt-2 border-b border-zinc-800 bg-black">
          {['All', 'Unread'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 
                ${activeTab === tab ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
              style={activeTab === tab ? { color: '#ffffff', borderBottomColor: '#facc15' } : { color: '#71717a' }}
            >
              {tab} Messages
            </button>
          ))}
        </div>

        {/* CONVERSATIONS LIST */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {processedConversations.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-24">
              <div className="w-20 h-20 border-2 border-zinc-800 bg-zinc-950 flex items-center justify-center mb-6">
                <MessageSquare className="w-8 h-8 text-zinc-600" />
              </div>
              <h3 className="text-sm font-black uppercase tracking-widest text-white mb-2">{t('noConversations')}</h3>
              <p className="text-xs max-w-xs text-zinc-500">{t('conversationEmpty')}</p>
            </div>
          ) : (
            <div ref={listRef} className="flex flex-col py-2 px-3 gap-1">
              {processedConversations.map((chat, idx) => {
                const isFocused = focusedIndex === idx;

                return (
                  <div key={chat.id} className="relative group">
                    <button 
                      onClick={() => handleOpenChatModal(chat.id, chat.name, chat.avatar, chat.type, chat)}
                      className={`w-full flex items-center justify-between p-3.5 transition-colors text-left border
                        ${isFocused ? 'bg-zinc-900 border-zinc-600' : 'bg-transparent border-transparent hover:bg-zinc-950 hover:border-zinc-800'}`}
                    >
                      <div className="flex items-center gap-4 overflow-hidden">
                        <div className="relative shrink-0 shadow-sm">
                          {chat.avatar ? (
                            <img src={chat.avatar} alt="avatar" className="w-14 h-14 object-cover border border-zinc-700" />
                          ) : (
                            <div className="w-14 h-14 flex items-center justify-center text-lg font-bold border border-zinc-700 bg-black text-white">
                              {chat.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          {chat.status === 'online' && <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 bg-green-500 border-2 border-black"></span>}
                        </div>
                        <div className="overflow-hidden pr-2">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className={`text-sm truncate uppercase tracking-wider ${chat.unreadCount > 0 ? 'font-black text-white' : 'font-bold text-zinc-300'}`}>
                              {chat.name}
                            </h3>
                            {chat.isMuted && <BellOff className="w-3.5 h-3.5 shrink-0 text-zinc-600" />}
                          </div>
                          <p className={`text-xs truncate ${chat.unreadCount > 0 ? 'font-semibold text-zinc-300' : 'font-normal text-zinc-500'}`}>
                            {chat.lastMessage}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0 pl-3">
                        <span className={`text-[10px] whitespace-nowrap uppercase tracking-wider ${chat.unreadCount > 0 ? 'font-bold text-white' : 'font-medium text-zinc-600'}`}>
                          {chat.timestamp}
                        </span>
                        {chat.unreadCount > 0 ? (
                          <span className="min-w-[22px] h-[22px] px-1.5 flex items-center justify-center bg-yellow-400 text-black text-xs font-black">
                            {chat.unreadCount}
                          </span>
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-zinc-700" />
                        )}
                      </div>
                    </button>

                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setContextMenuTarget(contextMenuTarget?.id === chat.id ? null : chat);
                      }}
                      className={`absolute right-4 top-1/2 -translate-y-1/2 p-2 border border-zinc-700 bg-black text-zinc-400 hover:text-white transition-all shadow-md
                        md:opacity-0 md:group-hover:opacity-100 ${contextMenuTarget?.id === chat.id ? 'opacity-100 z-20' : ''}`}
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
          <div className="absolute inset-0 z-50 flex flex-col animate-in slide-in-from-right-8 duration-300 bg-black">
            
            {/* Header with Call Triggers */}
            <div className="flex items-center justify-between gap-3 px-3 md:px-6 py-3 shrink-0 z-20 bg-zinc-950 border-b-2 border-zinc-800">
              <div className="flex items-center gap-3 md:gap-5 min-w-0">
                <button
                  onClick={() => setActiveChat(null)}
                  disabled={isInCall || Boolean(outgoingCallData)}
                  aria-label="Back to inbox"
                  className="p-2 border-2 border-zinc-800 bg-black text-zinc-300 hover:border-white hover:text-white disabled:opacity-40 transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative">
                    {activeChat.avatar ? (
                      <img src={activeChat.avatar} alt="avatar" className="w-11 h-11 border border-zinc-700 object-cover" />
                    ) : (
                      <div className="w-11 h-11 border border-zinc-700 bg-black flex items-center justify-center text-lg font-bold text-white">
                        {activeChat.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-black"></span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <h2 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 text-white truncate">
                      <span className="truncate">{activeChat.name}</span>
                      <span className={`hidden sm:inline-block px-2 py-0.5 border text-[9px] font-black uppercase tracking-wider ${tier.color} ${tier.text}`}>
                        {tier.label}
                      </span>
                    </h2>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      {isPartnerTyping ? 'Typing…' : getPresenceText(partnerPresence)}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-1.5">
                <button 
                  onClick={() => startCall('audio')}
                  disabled={isConnectingCall || isInCall || Boolean(outgoingCallData)}
                  className="px-2.5 md:px-4 py-2 border-2 border-zinc-700 bg-black text-zinc-200 font-black uppercase tracking-wider text-[9px] md:text-[10px] flex items-center gap-2 hover:border-white hover:text-white disabled:opacity-50 transition-colors"
                >
                  <Phone className="w-4 h-4 text-green-400" /> <span className="hidden md:inline">{isConnectingCall && callMode === 'audio' ? 'Connecting...' : outgoingCallData?.mode === 'audio' ? 'Calling...' : 'Audio'}</span>
                </button>
                <button 
                  onClick={() => startCall('video')}
                  disabled={isConnectingCall || isInCall || Boolean(outgoingCallData)}
                  className="px-2.5 md:px-4 py-2 border-2 border-zinc-700 bg-black text-zinc-200 font-black uppercase tracking-wider text-[9px] md:text-[10px] flex items-center gap-2 hover:border-white hover:text-white disabled:opacity-50 transition-colors"
                >
                  <Video className="w-4 h-4 text-yellow-400" /> <span className="hidden md:inline">{isConnectingCall && callMode === 'video' ? 'Connecting...' : outgoingCallData?.mode === 'video' ? 'Calling...' : 'Video'}</span>
                </button>
              </div>
            </div>

            {latestPinnedMessage && (
              <button
                type="button"
                onClick={() => messageRefs.current.get(latestPinnedMessage.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-4 py-2 text-left hover:bg-zinc-900"
              >
                <Pin className="h-4 w-4 shrink-0 text-yellow-400" />
                <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-yellow-400">
                  {pinnedMessages.length > 1 ? `${pinnedMessages.length} pinned` : 'Pinned'}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{latestPinnedMessage.text || 'Attachment'}</span>
              </button>
            )}

            {outgoingCallData && !isInCall && (
              <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950 px-4 py-3">
                <div className="flex items-center gap-3 text-white">
                  {outgoingCallData.mode === 'video' ? <Video className="h-4 w-4 text-yellow-400" /> : <Phone className="h-4 w-4 text-green-400" />}
                  <span className="text-xs font-black uppercase tracking-widest">Calling {outgoingCallData.targetName}…</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const pending = outgoingCallRef.current;
                    if (!pending) return;
                    clearCallTimeout();
                    try { sendCallSignal('call_cancelled', pending.targetId, { room_id: pending.roomId }); } catch (error) {
                      console.warn('Could not cancel outgoing call:', error);
                    }
                    outgoingCallRef.current = null;
                    setOutgoingCallData(null);
                    recordCallEvent(pending.targetId, 'no_answer', pending.mode).catch((error) => {
                      console.error('Could not save cancelled call history:', error);
                    });
                  }}
                  className="border-2 border-zinc-700 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:border-red-500 hover:text-red-400"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* CALL ROOM OVERLAY (LiveKit WebRTC) */}
            {/* INCOMING CALL RINGING UI */}
            {incomingCallData && !isInCall && (
              <div className="absolute inset-0 z-[80] flex items-center justify-center p-4 bg-black/80">
                <div className="w-full max-w-md border-2 border-zinc-600 bg-zinc-950 p-6 shadow-[8px_8px_0px_rgba(255,255,255,0.12)]">
                  <div className="flex items-center gap-4">
                    <div className="h-14 w-14 border-2 border-yellow-400 bg-black flex items-center justify-center text-xl font-black text-white">
                      {(incomingCallData.fromName || 'C').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] font-black uppercase tracking-widest text-yellow-400">Incoming {incomingCallData.mode === 'video' ? 'video' : 'voice'} call</p>
                      <p className="mt-1 truncate text-sm font-black uppercase tracking-widest text-white">{incomingCallData.fromName}</p>
                    </div>
                  </div>
                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <button
                      onClick={() => rejectCall()}
                      className="flex items-center justify-center gap-2 border-2 border-red-500 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-red-400 hover:bg-red-500 hover:text-black"
                    >
                      <PhoneOff className="h-4 w-4" /> {t('decline')}
                    </button>
                    <button
                      onClick={() => acceptCall()}
                      disabled={isConnectingCall}
                      className="flex items-center justify-center gap-2 border-2 border-green-500 bg-green-500 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-green-400 disabled:opacity-50"
                    >
                      {isConnectingCall ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                      {isConnectingCall ? 'Connecting…' : t('answer')}
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {isInCall && callToken && (
              <div className="absolute inset-0 z-50 flex flex-col animate-in fade-in duration-300 bg-black">
                <LiveKitRoom
                  serverUrl={LIVEKIT_URL}
                  token={callToken}
                  connect={true}
                  audio={false}
                  video={callMode === 'video'}
                  onConnected={() => toast.success(`${callMode === 'video' ? 'Video' : 'Audio'} call connected`)}
                  onError={(error) => {
                    console.error('Private LiveKit call failed:', error);
                    toast.error(error.message || 'The call connection failed.');
                    endCall();
                  }}
                  className="flex-1 flex flex-col"
                >
                    <RoomAudioRenderer />
                      <AutoPublishMic micGain={micGain} setMicEnabled={setMicEnabled} setMicLevel={setMicLevel} />
                      <InboxCallStage activeChat={activeChat} callMode={callMode} callElapsedSec={callElapsedSec} micEnabled={micEnabled} micLevel={micLevel} />
                  <div className="flex flex-wrap items-center justify-center gap-3 border-t-2 border-zinc-800 bg-black px-4 py-5 shrink-0 relative">
                    <TrackToggle source={Track.Source.Microphone} aria-label="Toggle microphone" className="w-12 h-12 border-2 border-zinc-700 bg-zinc-950 flex items-center justify-center text-white hover:border-white" />
                    {callMode === 'video' && <TrackToggle source={Track.Source.Camera} aria-label="Toggle camera" className="w-12 h-12 border-2 border-zinc-700 bg-zinc-950 flex items-center justify-center text-white hover:border-white" />}

                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-zinc-400">{t('microphoneGain')}</label>
                      <input
                        type="range"
                        min="0.1"
                        max="2"
                        step="0.1"
                        value={micGain}
                        onChange={(e) => setMicGain(parseFloat(e.target.value))}
                        className="w-[clamp(7rem,15vw,9rem)]"
                        aria-label={t('microphoneGain')}
                      />
                    </div>

                    <TrackToggle source={Track.Source.ScreenShare} aria-label="Toggle screen sharing" className="w-12 h-12 border-2 border-zinc-700 bg-zinc-950 flex items-center justify-center text-white hover:border-white" />

                    <button onClick={endCall} className="flex items-center gap-2 border-2 border-red-500 bg-red-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-red-400">
                      <PhoneOff className="w-5 h-5" /> End Call
                    </button>
                  </div>
                </LiveKitRoom>
              </div>
            )}

            <div className="flex flex-1 overflow-hidden relative">
              <div className="flex-1 flex flex-col lg:border-r relative bg-black border-zinc-800">
                
                {/* Messages stream */}
                <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3 lg:p-4 space-y-4 custom-scrollbar">
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center px-4">
                      <div className="w-20 h-20 border-2 border-zinc-800 bg-zinc-950 flex items-center justify-center mb-4">
                        <MessageSquare className="w-8 h-8 text-zinc-600" />
                      </div>
                      <h3 className="font-black text-sm uppercase tracking-widest text-white mb-1">Say hello to {activeChat.name}!</h3>
                      <p className="text-xs text-zinc-500">{t('conversationEmpty')}</p>
                    </div>
                  ) : (
                    messages.map((msg, index) => {
                      const isCallEvent = msg.messageKind === 'call_event' || msg.message_kind === 'call_event';
                      const isSystem = msg.sender === 'system' || isCallEvent;
                      const isMissedCall = isCallEvent && /missed|not answered/i.test(msg.text || '');
                      const isModel = msg.sender === 'model' || msg.sender === 'me';
                      const showAvatar = !isSystem && !isModel && (index === 0 || messages[index - 1]?.sender !== msg.sender);
                      const { quoted, text: parsedText } = parseMessageContent(msg.text || '');

                      return (
                        <React.Fragment key={msg.id}>
                          {firstUnreadId === msg.id && (
                            <div className="flex items-center justify-center pt-2">
                              <div className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-400 bg-zinc-950 border border-zinc-800">
                                New messages
                              </div>
                            </div>
                          )}
                          <div
                            ref={(element) => {
                              if (element) messageRefs.current.set(msg.id, element);
                              else messageRefs.current.delete(msg.id);
                            }}
                            className={`flex gap-3 max-w-[90%] md:max-w-[75%] ${isSystem ? 'self-center justify-center' : isModel ? 'self-end items-end ml-auto flex-row-reverse' : 'self-start items-end'}`}
                          >
                          
                          {/* Avatar for partner */}
                          {!isSystem && !isModel && (
                            <div className="shrink-0 w-8 h-8 mb-1">
                              {showAvatar ? (
                                <img src={activeChat.avatar} alt="avatar" className="w-8 h-8 border border-zinc-700 object-cover" />
                              ) : <div className="w-8" />}
                            </div>
                          )}

                          <div className={`flex flex-col ${isSystem ? 'items-center' : isModel ? 'items-end' : 'items-start'}`}>
                            <div className={`px-4 py-3 text-sm leading-relaxed flex flex-col gap-3 border shadow-none ${
                              isSystem ? 'border-zinc-700 bg-zinc-950 text-zinc-300' :
                              isModel ? 'border-white bg-white text-black' :
                              'border-zinc-700 bg-zinc-950 text-zinc-100'
                            }`}
                              style={{
                                borderColor: isMissedCall ? '#ef4444' : undefined
                              }}>
                              {msg.isAIGenerated && (
                                <span className="text-[9px] font-black uppercase tracking-widest text-yellow-600">
                                  AI-generated reply
                                </span>
                              )}
                              {msg.media && (
                                <div className="relative overflow-hidden rounded-xl" style={{ backgroundColor: 'var(--surface-muted)' }}>
                                  <img
                                    src={msg.media}
                                    alt="attachment"
                                    className="h-auto w-full max-w-[min(70vw,16rem)] object-cover rounded-xl"
                                    style={{ filter: (msg.nsfw || msg.flagged) && !revealedMediaIds.has(msg.id) ? 'blur(8px) grayscale(40%)' : 'none' }}
                                  />
                                  {(msg.nsfw || msg.flagged) && (
                                    <div className="absolute top-2 left-2 px-2 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#ffb86b' }}>
                                      NSFW
                                    </div>
                                  )}
                                  {(msg.nsfw || msg.flagged) && !revealedMediaIds.has(msg.id) && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <button onClick={() => { setRevealedMediaIds(prev => new Set([...Array.from(prev), msg.id])); }} className="px-3 py-2 rounded-full font-semibold" style={{ backgroundColor: 'var(--accent)', color: 'var(--surface-strong)' }}>{t('reveal')}</button>
                                    </div>
                                  )}
                                </div>
                              )}
                              {(quoted || (parsedText && !isCallEvent)) && (
                                <div className="flex flex-col gap-3 text-left">
                                  {quoted && (
                                    <div className="border-l-2 border-zinc-500 bg-black p-3 text-sm text-zinc-300">
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
                              {isCallEvent && (
                                <div className="whitespace-pre-wrap font-black uppercase tracking-wide flex items-center gap-2 text-center text-xs">
                                  {msg.callMode === 'video' ? <Video className={`h-4 w-4 ${isMissedCall ? 'text-red-400' : 'text-yellow-400'}`} /> : <PhoneCall className={`h-4 w-4 ${isMissedCall ? 'text-red-400' : 'text-green-400'}`} />}
                                  <span>{msg.text}</span>
                                </div>
                              )}
                              {isMissedCall && (
                                <button
                                  type="button"
                                  onClick={() => reconnectCall(msg.callMode || 'audio')}
                                  className="self-center inline-flex items-center justify-center border border-zinc-700 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:border-white hover:text-white transition-colors">
                                  <RefreshCw className="w-3.5 h-3.5 mr-2" /> Reconnect
                                </button>
                              )}
                            </div>
                            {replyingTo && replyingTo.id === msg.id && (
                              <div className="mb-2 px-3 py-2 rounded-2xl bg-zinc-950 border border-zinc-700 text-xs text-zinc-300">
                                Replying to {replyingTo.sender === 'me' ? 'yourself' : activeChat.name}
                              </div>
                            )}
                            <div className="mt-1 flex items-center justify-between gap-3">
                            <span className="text-[10px] font-medium px-1 flex items-center gap-1 text-zinc-600">
                              {msg.time}
                              {isModel && (
                                msg.status === 'sent'
                                  ? <Check className="w-3 h-3 text-zinc-400" />
                                  : <CheckCheck className={`w-3 h-3 ${msg.status === 'read' ? 'text-green-400' : 'text-zinc-500'}`} />
                              )}
                            </span>
                            {!isSystem && (
                              <button
                                type="button"
                                onClick={() => toggleDirectMessagePin(msg)}
                                disabled={pinningMessageId === msg.id}
                                aria-label={msg.isPinned ? 'Unpin message' : 'Pin message'}
                                title={msg.isPinned ? 'Unpin message' : 'Pin message'}
                                className={`inline-flex items-center gap-1 px-2 py-1 text-[9px] font-black uppercase tracking-widest transition-colors ${
                                  msg.isPinned ? 'text-yellow-400' : 'text-zinc-600 hover:text-white'
                                }`}
                              >
                                {pinningMessageId === msg.id ? <Loader2 className="h-3 w-3 animate-spin" /> : msg.isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                                {msg.isPinned ? 'Pinned' : ''}
                              </button>
                            )}
                            </div>
                          </div>
                        </div>
                        </React.Fragment>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} className="h-2" />
                </div>

                {activeChat.type === 'dm' && (
                  <div className="shrink-0 border-t border-zinc-800 bg-zinc-950 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleGenerateAISuggestions}
                        disabled={isGeneratingAISuggestions}
                        className="flex items-center gap-2 border border-zinc-700 bg-black px-3 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:border-yellow-400 hover:text-white disabled:opacity-50"
                      >
                        {isGeneratingAISuggestions
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Sparkles className="h-4 w-4" />}
                        {isGeneratingAISuggestions ? 'Generating…' : 'Draft AI replies'}
                      </button>
                      <button
                        type="button"
                        onClick={handleToggleAIAutoReply}
                        disabled={isLoadingAIAutoReply || isUpdatingAIAutoReply}
                        aria-pressed={aiAutoReplyEnabled}
                        className={`flex items-center gap-2 border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50 ${
                          aiAutoReplyEnabled
                            ? 'border-yellow-400 text-yellow-300'
                            : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
                        }`}
                      >
                        <Bot className="h-4 w-4" />
                        {isUpdatingAIAutoReply
                          ? 'Saving…'
                          : `AI auto-reply ${aiAutoReplyEnabled ? 'on' : 'off'} · 5h`}
                      </button>
                      <span className="text-[10px] text-zinc-500">
                        Recent messages are sent to Gemini for drafts. Auto-replies are labeled AI.
                      </span>
                    </div>
                    {aiSuggestions.length > 0 && (
                      <div className="mt-2 flex gap-2 overflow-x-auto custom-scrollbar">
                        {aiSuggestions.map((suggestion, index) => (
                          <button
                            type="button"
                            key={`${index}-${suggestion}`}
                            onClick={() => setInputText(suggestion)}
                            className="max-w-[22rem] shrink-0 border border-zinc-800 bg-black px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:border-yellow-400 hover:text-white"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Chat Input Area */}
                <div className="p-4 md:px-6 md:pb-6 shrink-0 relative z-30 bg-black border-t border-zinc-800">
                  
                  {/* Emoji Picker Modal */}
                  {showEmojiPicker && (
                    <div className="absolute bottom-[calc(100%+10px)] left-4 md:left-6 z-50 shadow-2xl border border-zinc-700 overflow-hidden">
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
                      <div className="flex items-center gap-4 p-2.5 w-max border border-zinc-700 bg-zinc-950">
                        <div className="relative">
                          {attachedMediaType && attachedMediaType.startsWith && attachedMediaType.startsWith('video') ? (
                            <video src={attachedMedia} className="aspect-video w-[clamp(6rem,20vw,8rem)] border border-zinc-700 object-cover" controls muted />
                          ) : (
                            <img src={attachedMedia} alt="preview" className="size-[clamp(3rem,8vw,3.5rem)] border border-zinc-700 object-cover" />
                          )}
                        </div>
                        <div className="flex flex-col pr-4">
                          <span className="text-xs font-bold uppercase tracking-wider text-white">{attachedMediaType && attachedMediaType.startsWith && attachedMediaType.startsWith('video') ? 'Video attached' : 'Photo attached'}</span>
                          <span className="text-[10px] mt-0.5 text-zinc-500">{t('readyToSend')}</span>
                        </div>
                        <button 
                          onClick={() => { setAttachedMedia(null); setAttachedFile(null); }} 
                          className="p-1.5 border border-zinc-700 bg-black text-zinc-400 hover:text-white transition-colors ml-2"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    <div className="flex items-end gap-2 border border-zinc-700 bg-zinc-950 p-1.5 transition-colors">
                      <div className="flex items-center gap-1 shrink-0 mb-1 pl-1">
                        <input ref={fileInputRef} onChange={handleFilePicked} type="file" accept="image/*,video/*" className="hidden" />
                        <button onClick={() => fileInputRef.current?.click()} className="p-2.5 border border-transparent text-zinc-400 hover:border-zinc-700 hover:text-white transition-colors" title={t('attachMedia')} aria-label={t('attachMedia')}>
                          <ImageIcon className="w-5 h-5" />
                        </button>
                        <button onClick={() => setShowMediaVault(true)} className="p-2.5 border border-transparent text-zinc-400 hover:border-zinc-700 hover:text-white transition-colors" style={{ color: 'var(--text-secondary)' }} title={t('vault')} aria-label={t('vault')}>
                          <Upload className="w-5 h-5" />
                        </button>
                        <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} aria-label="Choose emoji" className="hidden md:block p-2.5 border border-transparent text-zinc-400 hover:border-zinc-700 hover:text-white transition-colors">
                          <Smile className="w-5 h-5" />
                        </button>
                      </div>

                      <textarea 
                        value={inputText} 
                        onChange={(e) => handleTyping(e)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                        placeholder={t('typeMessage')}
                        className="flex-1 bg-transparent py-3.5 px-2 font-normal text-sm resize-none outline-none custom-scrollbar disabled:opacity-50 placeholder:text-zinc-500"
                        rows="1"
                        style={{ color: '#ffffff', minHeight: '48px', maxHeight: '120px' }}
                      />
                      
                      <button 
                        onClick={() => handleSendMessage()} 
                        disabled={(!inputText.trim() && !attachedMedia) || isSending}
                        className="h-[44px] w-[44px] md:w-auto md:px-6 mb-1 mr-1 border-2 border-white bg-white text-black font-black uppercase tracking-widest text-[10px] disabled:opacity-50 transition-colors flex items-center justify-center gap-2 hover:bg-zinc-200"
                      >
                        <span className="hidden md:inline">{t('send')}</span>
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Profile Panel (Desktop Only) */}
              <div className="hidden w-[clamp(14rem,22vw,20rem)] flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-950 custom-scrollbar lg:flex">
                <div className="p-8 flex flex-col items-center text-center border-b border-zinc-800">
                  <div className="relative mb-4">
                    <img 
                      src={activeChat.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'} 
                      alt="User" 
                      className="size-[clamp(6rem,14vw,8rem)] border-4 border-yellow-400 bg-black object-cover"
                    />
                    <div className={`absolute bottom-1 right-3 h-4 w-4 border-2 border-black ${partnerPresence === 'online' ? 'bg-green-400' : 'bg-zinc-600'}`} />
                  </div>
                  <h2 className="text-xl font-black uppercase tracking-wide text-white">{activeChat.name}</h2>
                  <span className={`px-3 py-1 border text-[10px] font-black uppercase tracking-widest mt-3 ${tier.bg} ${tier.text} ${tier.color}`}>
                    {tier.label} User
                  </span>
                </div>
                
                <div className="p-6 space-y-6">
                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest mb-2 text-zinc-500">{t('about')}</h3>
                    <p className="text-sm leading-relaxed p-4 border border-zinc-800 bg-black text-zinc-300">
                      {activeChat.bio ? `"${activeChat.bio}"` : "No bio provided yet."}
                    </p>
                  </div>

                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest mb-2 text-zinc-500">{t('supportHistory')}</h3>
                    <div className="p-4 border border-zinc-800 bg-black flex items-center gap-3">
                      <div className="w-10 h-10 border border-yellow-400/40 bg-yellow-400/10 text-yellow-400 flex items-center justify-center">
                        <Flame className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-lg font-black text-white">${activeChat.lifetimeSpend}</div>
                        <div className="text-xs text-zinc-500">{t('lifetimeContribution')}</div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="pt-4 space-y-3">
                    <button className="w-full border border-zinc-700 bg-black py-3.5 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:border-white">
                      View Full Profile
                    </button>
                    <button onClick={() => setShowBlockModal(true)} className="w-full border border-red-500/50 bg-transparent py-3.5 text-[10px] font-black uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/10">
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
          <div className="relative flex w-full flex-col border border-zinc-700 bg-zinc-950 p-2 shadow-2xl animate-in zoom-in-95 duration-100 md:w-[clamp(12rem,24vw,18rem)]">
            <div className="p-3 mb-2 border-b border-zinc-800">
              <span className="text-sm font-black uppercase tracking-widest truncate block text-white">{contextMenuTarget.name}</span>
            </div>
            <button onClick={() => handleToggleMute(contextMenuTarget.id)} className="w-full flex items-center gap-3 p-3 text-sm font-bold text-zinc-300 text-left transition-colors hover:bg-zinc-900 hover:text-white">
              <BellOff className="w-4 h-4 text-zinc-500" /> {contextMenuTarget.isMuted ? 'Unmute Chat' : 'Mute Notifications'}
            </button>
            <button onClick={() => { setShowDeleteModal(contextMenuTarget); setContextMenuTarget(null); }} className="w-full flex items-center gap-3 p-3 text-sm font-bold text-red-400 text-left transition-colors hover:bg-red-500/10 mt-1">
              <Trash2 className="w-4 h-4" /> Delete Conversation
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

function InboxCallStage({ activeChat, callMode, callElapsedSec, micEnabled, micLevel }) {
  const { t } = useI18n();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const remoteParticipants = participants.filter((p) => p.identity !== localParticipant?.identity);
  const remotePrimary = remoteParticipants[0];
  const localCameraTrack = cameraTracks.find((t) => t.participant.identity === localParticipant?.identity);
  const remoteCameraTrack = cameraTracks.find((t) => t.participant.identity !== localParticipant?.identity);
  const connectedCount = remoteParticipants.length + 1;
  const microphoneEnabled = localParticipant?.isMicrophoneEnabled ?? micEnabled;

  return (
    <div className="flex min-h-0 flex-1 grid-cols-1 grid w-full items-center justify-center gap-3 p-2 sm:gap-4 sm:p-3 md:grid-cols-2 lg:p-4">
      <div className="col-span-full text-center text-[10px] font-black uppercase tracking-widest text-zinc-400">
        {callMode === 'video' ? 'Video call' : 'Audio call'} · {connectedCount} participant{connectedCount === 1 ? '' : 's'} · {formatDuration(callElapsedSec)}
      </div>
      <div className="relative flex h-full w-full min-h-[min(35dvh,18rem)] max-h-full flex-col items-center justify-center gap-4 overflow-hidden border-2 border-zinc-700 bg-zinc-950">
        {callMode === 'video' && localCameraTrack ? (
          <>
            <VideoTrack trackRef={localCameraTrack} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
          </>
        ) : (
          <div className="w-24 h-24 border-2 border-yellow-400 bg-black flex items-center justify-center text-2xl font-black text-white z-10">
            {(localParticipant?.name || 'You').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="text-[10px] font-black uppercase tracking-widest z-10 px-3 py-1.5 bg-black/70 text-white">{t('you')}</div>
        <div className="text-xs z-10 flex flex-col gap-2 text-zinc-300">
          {microphoneEnabled ? (
            <>
              <span>Mic on — {micLevel < 0.02 ? 'No sound' : micLevel < 0.1 ? 'Quiet' : micLevel < 0.25 ? 'Speaking softly' : micLevel < 0.5 ? 'Speaking' : 'Loud input'}</span>
              <div className="flex items-center gap-1">
                {[0.05, 0.15, 0.3, 0.5].map((threshold, index) => {
                  const active = micLevel >= threshold;
                  return (
                    <span key={index} className={`inline-block h-2 transition-all duration-150 ${active ? 'bg-green-400' : 'bg-zinc-700'}`} style={{ width: `${6 + index * 4}px` }} />
                  );
                })}
              </div>
            </>
          ) : (
            <div className="inline-flex items-center gap-2">
              <span className="inline-flex h-2.5 w-2.5 bg-red-500" />
              <span>{t('micOff')}</span>
            </div>
          )}
        </div>
      </div>

      <div className="relative flex h-full w-full min-h-[min(35dvh,18rem)] max-h-full flex-col items-center justify-center gap-4 overflow-hidden border-2 border-zinc-700 bg-zinc-950">
        {callMode === 'video' && remoteCameraTrack && (
          <>
            <VideoTrack trackRef={remoteCameraTrack} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
          </>
        )}
        {remotePrimary ? (
          <>
            {(!remoteCameraTrack || callMode !== 'video') && (
              <div className="w-24 h-24 border-2 border-green-400 bg-black flex items-center justify-center text-2xl font-black text-white z-10">
                {(remotePrimary?.name || activeChat?.name || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="text-[10px] font-black uppercase tracking-widest z-10 px-3 py-1.5 bg-black/70 text-white">{remotePrimary?.name || activeChat?.name}</div>
            <div className="text-xs z-10 flex items-center gap-2 text-zinc-300">
              <span>{remotePrimary?.isSpeaking ? 'Speaking' : 'Connected'}</span>
              <span className="inline-block w-16 h-1 bg-zinc-800 overflow-hidden">
                <span className="block h-full bg-emerald-400" style={{ width: `${Math.min(100, Math.round(((remotePrimary?.audioLevel ?? remotePrimary?.audio_level) || 0) * 200))}%`, transition: 'width 120ms linear' }} />
              </span>
            </div>
          </>
        ) : (
          <>
            {activeChat?.avatar ? (
              <img src={activeChat.avatar} alt={activeChat.name} className="w-24 h-24 border-2 border-green-400 object-cover z-10" />
            ) : (
              <div className="w-24 h-24 border-2 border-green-400 bg-black flex items-center justify-center text-2xl font-black text-white z-10">
                {(activeChat?.name || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="text-[10px] font-black uppercase tracking-widest z-10 px-3 py-1.5 bg-black/70 text-white">{activeChat?.name}</div>
            <div className="text-xs z-10 text-yellow-400">{t('ringing')}</div>
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