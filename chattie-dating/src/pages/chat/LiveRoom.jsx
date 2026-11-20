import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  Send, Image as ImageIcon, Smile, Paperclip, MoreVertical, 
  Users, ChevronLeft, Info, Bell, BellOff, MapPin, Star,
  Heart, X, ShieldAlert, Circle, Activity, Mic, MicOff, Volume2,
  Headphones, Lock, Crown, Upload, Loader2, Search, Pin, MessageSquare,
  Reply, Phone, PhoneOff, Video, Share2, ShieldCheck, UserCheck, 
  Copy, Check, KeyRound, DoorOpen, CheckCheck, Settings, Edit3
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================================
// LIVEKIT WEBRTC IMPORTS
// ============================================================================
import { 
  LiveKitRoom, 
  RoomAudioRenderer, 
  useParticipants, 
  useLocalParticipant,
  TrackToggle,
  VideoTrack,
  useTracks
} from '@livekit/components-react';
import { Track } from 'livekit-client';
const EmojiPicker = lazy(() => import('emoji-picker-react'));

// Services & Hooks
import { useAppStore } from '../../store/useAppStore';
import { chatService } from '../../api/chat.service';
import { apiClient } from '../../api/client';
import { ChattieService } from '../../api/chattie.service';
import { useI18n } from '../../i18n';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || "ws://localhost:7880";

const getWebSocketOrigin = () => {
  const fallback = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8080'
    : window.location.origin;
  const apiUrl = new URL(import.meta.env.VITE_API_URL || fallback, window.location.origin);
  apiUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return apiUrl.origin;
};

// --- Helper to Parse Quoted Replies ---
const parseMessageContent = (rawText) => {
  if (!rawText) return { quote: null, text: '' };
  const replyMatch = rawText.match(/\[REPLY\]([\s\S]*?)\[\/REPLY\]\n([\s\S]*)/);
  if (replyMatch) {
    return { quote: replyMatch[1], text: replyMatch[2] };
  }
  return { quote: null, text: rawText };
};

const formatChatTimestamp = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const ActiveVoiceGrid = ({ members }) => {
  const participants = useParticipants();
  const listenerCount = participants.length;
  return (
    <div className="w-full">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-[10px] font-black uppercase tracking-[0.3em] text-yellow-400">Live room</p>
          <h3 className="text-2xl font-black tracking-tight text-white sm:text-3xl">In the conversation</h3>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          {listenerCount} {listenerCount === 1 ? 'person' : 'people'} connected
        </div>
      </div>
      {listenerCount === 0 ? (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
          <Volume2 className="mx-auto mb-4 h-8 w-8 text-zinc-500" />
          <p className="font-semibold text-white">You’re first in the room</p>
          <p className="mt-1 text-sm text-zinc-400">Others will appear here as they join.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {participants.map((participant) => {
            const member = members.find((entry) => entry.id === participant.identity);
            const avatar = member?.avatar || '';
            const role = member?.role;
            const isSpeaking = participant.isSpeaking;
            const isMuted = participant.isMicrophoneEnabled === false;
            return (
              <div
                key={participant.identity}
                className={`relative flex min-h-[clamp(9rem,28vh,12rem)] flex-col items-center justify-center overflow-hidden rounded-3xl border p-4 text-center transition-colors ${
                  isSpeaking ? 'border-green-500/70 bg-green-500/10 shadow-[0_0_30px_rgba(var(--success-rgb), 0.12)]' : 'border-zinc-800 bg-black/50'
                }`}
              >
                <div className={`mb-3 flex size-[clamp(4rem,9vw,5rem)] items-center justify-center overflow-hidden rounded-full border-2 bg-zinc-950 ${
                  isSpeaking ? 'border-green-500' : 'border-zinc-700'
                }`}>
                  {avatar ? (
                    <img src={avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-2xl font-black text-white">
                      {(member?.name || participant.name || participant.identity || '?').charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <span className="max-w-full truncate text-sm font-bold text-white">
                  {member?.name || participant.name || participant.identity}
                </span>
                {role && role !== 'member' && (
                  <span className="mt-1 text-[9px] font-bold uppercase tracking-wider text-yellow-400">
                    {role === 'creator' ? 'Owner' : role}
                  </span>
                )}
                <span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${
                  isMuted ? 'bg-zinc-900 text-zinc-400' : isSpeaking ? 'bg-green-500/10 text-green-300' : 'bg-zinc-900 text-zinc-300'
                }`}>
                  {isMuted ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                  {isMuted ? 'Muted' : isSpeaking ? 'Speaking' : 'In room'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const RoomVoiceControls = () => {
  const { isMicrophoneEnabled } = useLocalParticipant();
  return (
    <div className="flex flex-col items-center gap-2">
      <TrackToggle
        source={Track.Source.Microphone}
        aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
        className={`w-14 h-14 rounded-full flex items-center justify-center border transition-colors focus:outline-none ${
          isMicrophoneEnabled
            ? 'border-white bg-white text-black hover:bg-zinc-200'
            : 'border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20'
        }`}
      />
      <span className={`text-[9px] font-bold uppercase tracking-widest ${isMicrophoneEnabled ? 'text-zinc-300' : 'text-red-400'}`}>
        Mic {isMicrophoneEnabled ? 'on' : 'muted'}
      </span>
    </div>
  );
};

export default function LiveRoom() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const translateRef = useRef(t);
  translateRef.current = t;
  const { roomId } = useParams();
  const location = useLocation();
  
  const [selectedRoom, setSelectedRoom] = useState(
    location.state?.selectedRoom || { name: 'Connecting...', active: 0, icon: '🐾' }
  );

  const currentUser = useAppStore((state) => state.user) || { id: 'me', name: 'You', tier: 'STANDARD' };
  const appToken = useAppStore((state) => state.token);
  const theme = useAppStore((state) => state.userPreferences?.theme || 'dark');
  
  // --- ACCESS CONTROL & ADMIN STATE ---
  const [membershipStatus, setMembershipStatus] = useState('checking');
  const [roomAdminData, setRoomAdminData] = useState(null);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  
  // Admin Edit Room State
  const [isEditingRoom, setIsEditingRoom] = useState(false);
  const [editRoomForm, setEditRoomForm] = useState({ name: '', description: '', category: '' });

  // --- CORE STATE ---
  const [messages, setMessages] = useState([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isMessageSearchOpen, setIsMessageSearchOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState('');
  const messageRefs = useRef(new Map());
  const messageRoomIdRef = useRef(roomId);
  const wsRef = useRef(null);
  const wsReconnectAttempts = useRef(0);
  const wsIntentionalClose = useRef(false);
  
  const [roomParticipants, setRoomParticipants] = useState([]);
  const [joinRequests, setJoinRequests] = useState([]);
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(false);
  const [activeMode, setActiveMode] = useState('text');
  const [messageInput, setMessageInput] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const messagesEndRef = useRef(null);
  
  // --- GROUP TYPING STATE ---
  const [typingUsers, setTypingUsers] = useState({});
  const lastTypingTimeRef = useRef(0);
  
  // --- VOICE STATE (ROOM) ---
  const [voiceToken, setVoiceToken] = useState("");
  const [isConnectingVoice, setIsConnectingVoice] = useState(false);
  const [voiceSession, setVoiceSession] = useState({ active: false });
  const [isUpdatingVoiceSession, setIsUpdatingVoiceSession] = useState(false);

  // --- PRIVATE CALL STATE ---
  const [privateCallToken, setPrivateCallToken] = useState("");
  const [isInPrivateCall, setIsInPrivateCall] = useState(false);
  const isInPrivateCallRef = useRef(isInPrivateCall);
  isInPrivateCallRef.current = isInPrivateCall;
  const [privateCallMode, setPrivateCallMode] = useState('video');
  const [incomingCallData, setIncomingCallData] = useState(null); 
  const notificationSocketRef = useRef(null);
  const ringtoneCtxRef = useRef(null);
  const ringtonePlayingRef = useRef(false);
  const [localPrivateStream, setLocalPrivateStream] = useState(null);

  // --- UI TOGGLES ---
  const [showSidebar, setShowSidebar] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [isNotificationsMuted, setIsNotificationsMuted] = useState(false);
  
  // --- TEXTING FEATURES STATE (REAL MEDIA VAULT) ---
  const [showMediaVault, setShowMediaVault] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [attachedMedia, setAttachedMedia] = useState(null);
  const [vaultImages, setVaultImages] = useState([]);
  const [isLoadingVault, setIsLoadingVault] = useState(false);
  const fileInputRef = useRef(null);

  // --- CALL AUDIO ---
  const [ringtoneProfile, setRingtoneProfile] = useState('sweet');

  const participantsForSidebar = roomParticipants;
  const onlineCount = participantsForSidebar.filter((p) => (p.status || '').toLowerCase() === 'online').length;
  const isUserAdmin = roomAdminData?.userRole === 'creator' || roomAdminData?.userRole === 'admin';
  const canModerateRoom = isUserAdmin || roomAdminData?.userRole === 'moderator';
  const currentRoomRole = roomAdminData?.userRole || roomParticipants.find((p) => p.id === currentUser?.id)?.role || 'member';
  const canPublishVoice = ['creator', 'admin', 'moderator', 'speaker'].includes(currentRoomRole);

  const userTier = currentUser?.tier || 'PREMIUM';
  const canViewFullProfiles = userTier === 'PREMIUM' || userTier === 'VIP';
  const canUseVoiceChannel = userTier === 'PREMIUM' || userTier === 'VIP';
  const canSendMedia = userTier === 'PREMIUM' || userTier === 'VIP';
  
  const roomHasVoiceFeatures = Boolean(selectedRoom?.isVoiceRoom ?? selectedRoom?.is_voice_room ?? selectedRoom?.hasVoice ?? false);
  const getRoomRoleLabel = (role) => ({
    creator: 'OWNER',
    admin: 'ADMIN',
    moderator: 'MODERATOR',
    speaker: 'SPEAKER',
  }[role] || '');
  const pinnedMessages = messages.filter((message) => message.isPinned);
  const latestPinnedMessage = pinnedMessages[pinnedMessages.length - 1];
  const normalizedMessageSearch = messageSearch.trim().toLowerCase();
  const visibleMessages = normalizedMessageSearch
    ? messages.filter((message) => (
      `${message.sender} ${parseMessageContent(message.text).text}`.toLowerCase().includes(normalizedMessageSearch)
      || (message.media || '').toLowerCase().includes(normalizedMessageSearch)
    ))
    : messages;

  // ============================================================================
  // INITIALIZATION & MEMBERSHIP CHECK
  // ============================================================================
  useEffect(() => {
    let active = true;
    const initializeRoomAccess = async () => {
      try {
        const res = await chatService.getRoomAdminDetails(roomId);
        if (!active) return;
        setRoomAdminData(res);
        setSelectedRoom(res);
        setEditRoomForm({
          name: res.name || '',
          description: res.description || res.desc || '',
          category: res.category || '',
          rules: res.rules || '',
          content_mode: res.content_mode || 'general',
          allow_media: res.allow_media !== false,
          allow_links: res.allow_links !== false,
          slow_mode_seconds: res.slow_mode_seconds || 0,
          is_read_only: Boolean(res.is_read_only),
        });

        if (res.isMember) {
          setMembershipStatus('member');
        } else if (res.hasPendingRequest) {
          setMembershipStatus('pending');
        } else if (res.isPrivate) {
          setMembershipStatus('locked');
        } else {
          await chatService.joinRoom(roomId);
          if (active) setMembershipStatus('member');
        }
      } catch (err) {
        if (active) {
          setMembershipStatus('locked');
          toast.error(err.response?.data?.error || translateRef.current('roomAccessFailed'));
        }
      }
    };
    if (roomId) initializeRoomAccess();
    return () => { active = false; };
  }, [roomId]);

  useEffect(() => {
    if (membershipStatus !== 'member') return undefined;
    let active = true;
    const fetchParticipants = async () => {
      try {
        const participants = await chatService.getRoomParticipants(roomId);
        if (active) setRoomParticipants(Array.isArray(participants) ? participants : []);
      } catch (error) {
        if (active) toast.error(error.response?.data || 'Unable to load room members');
      } finally {
        if (active) setIsLoadingParticipants(false);
      }
    };
    setIsLoadingParticipants(true);
    fetchParticipants();
    const refresh = window.setInterval(fetchParticipants, 30000);
    return () => {
      active = false;
      window.clearInterval(refresh);
    };
  }, [roomId, membershipStatus]);

  // ============================================================================
  // EFFECTS: LOAD HISTORY & CONNECT TEXT WEBSOCKET (WITH RECONNECTION BACKOFF)
  // ============================================================================
  useEffect(() => {
    if (membershipStatus !== 'member') return;
    wsIntentionalClose.current = false;
    if (messageRoomIdRef.current !== roomId) {
      messageRoomIdRef.current = roomId;
      setMessages([]);
      setMessageSearch('');
      setIsMessageSearchOpen(false);
    }
    let disposed = false;
    let reconnectTimer = null;

    const loadHistory = async () => {
      setIsLoadingMessages(true);
      try {
        const history = await chatService.getChatHistory(roomId, 'room');
        if (disposed) return;
        const historyArray = Array.isArray(history) ? history : [];
        const formatted = historyArray.map(msg => ({
          id: msg.id,
          sender: msg.sender_id === currentUser?.id ? 'You' : (msg.sender_name || 'User'),
          sender_id: msg.sender_id,
          role: msg.role || 'member',
          text: msg.content || msg.text,
          media: msg.media || null,
          time: new Date(msg.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isMe: msg.sender_id === currentUser?.id,
          status: 'sent', // History is naturally sent
          avatar: msg.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80',
          isPinned: msg.is_pinned,
          reactions: msg.reactions || [],
        }));
        setMessages((current) => {
          const historyIDs = new Set(formatted.map((message) => message.id));
          return [...formatted, ...current.filter((message) => !historyIDs.has(message.id))];
        });
      } catch (error) {
        if (!disposed) toast.error(error.response?.data?.error || 'Unable to load room messages');
      } finally {
        if (!disposed) setIsLoadingMessages(false);
      }
    };
    
    loadHistory();

    const connectWebSocket = () => {
      if (disposed) return;
      let token = appToken || '';
      if (!token) {
        try {
          const storedData = localStorage.getItem('chattie-session-storage');
          if (storedData) token = JSON.parse(storedData)?.state?.token || '';
        } catch (err) {}
      }

      const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
      const wsUrl = `${getWebSocketOrigin()}/ws?room_id=${encodeURIComponent(roomId)}&token=${encodeURIComponent(cleanToken)}`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        wsReconnectAttempts.current = 0; // Reset backoff on success
      };

      ws.onmessage = (event) => {
        try {
          const incomingMsg = JSON.parse(event.data);
          
          // Disconnect event dispatched from admin eviction/termination
          if (
            incomingMsg.type === 'room_terminated' ||
            incomingMsg.type === 'user_kicked' ||
            ((incomingMsg.type === 'ROOM_KICKED' || incomingMsg.type === 'ROOM_BANNED') && incomingMsg.data?.room_id === roomId)
          ) {
             toast.error(incomingMsg.reason || translateRef.current('disconnectedRoom'));
             wsIntentionalClose.current = true;
             navigate('/rooms');
             return;
          }

          if (incomingMsg.type === 'error') {
            setMessages((current) => current.map((message) => (
              message.id === incomingMsg.client_message_id
                ? { ...message, status: 'failed' }
                : message
            )));
            toast.error(incomingMsg.reason || 'Message was not sent');
            return;
          }

          if (incomingMsg.sender_id === currentUser?.id) {
            if (incomingMsg.client_message_id) {
              setMessages((current) => current.map((message) => (
                message.id === incomingMsg.client_message_id
                  ? { ...message, id: incomingMsg.id, status: 'sent' }
                  : message
              )));
            }
            return;
          }

          if (incomingMsg.type === 'typing') {
            const senderId = incomingMsg.sender_id;
            const senderName = incomingMsg.sender_name || 'Someone';
            
            setTypingUsers(prev => {
              const current = { ...prev };
              if (current[senderId]?.timeout) clearTimeout(current[senderId].timeout);
              current[senderId] = {
                name: senderName,
                timeout: setTimeout(() => {
                  setTypingUsers(p => {
                    const next = { ...p };
                    delete next[senderId];
                    return next;
                  });
                }, 3000)
              };
              return current;
            });
            return;
          }

          if (incomingMsg.type && incomingMsg.type !== 'chat') return;

          const msgId = incomingMsg.id || `msg-${Date.now()}-${Math.random()}`;
          setMessages(prev => {
            if (prev.some(m => m.id === msgId)) return prev;
            
            if (incomingMsg.sender_id) {
              setTypingUsers(p => {
                const next = { ...p };
                if (next[incomingMsg.sender_id]?.timeout) clearTimeout(next[incomingMsg.sender_id].timeout);
                delete next[incomingMsg.sender_id];
                return next;
              });
            }

            return [
              ...prev,
              {
                id: msgId,
                sender: incomingMsg.sender_name || 'User',
                sender_id: incomingMsg.sender_id,
                role: incomingMsg.role || 'member',
                text: incomingMsg.content || incomingMsg.text,
                media: incomingMsg.media || null,
                time: formatChatTimestamp(incomingMsg.created_at || Date.now()),
                isMe: false,
                status: 'sent',
                avatar: incomingMsg.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80',
                isPinned: incomingMsg.is_pinned,
                reactions: incomingMsg.reactions || [],
              }
            ];
          });
        } catch (err) { }
      };

      ws.onclose = () => {
        if (!disposed && !wsIntentionalClose.current) {
          const timeout = Math.min(1000 * (2 ** wsReconnectAttempts.current), 10000);
          wsReconnectAttempts.current += 1;
          console.warn(`WebSocket disconnected. Reconnecting in ${timeout}ms...`);
          reconnectTimer = setTimeout(connectWebSocket, timeout);
        }
      };
    };

    connectWebSocket();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsIntentionalClose.current = true;
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        wsRef.current.close();
      }
    };
  }, [roomId, membershipStatus, currentUser?.id, appToken, navigate]);

  useEffect(() => {
    if (membershipStatus !== 'member' || !roomId || !roomHasVoiceFeatures) return undefined;
    let active = true;
    let hasLoaded = false;
    const refreshVoiceSession = async () => {
      try {
        const session = await chatService.getRoomVoiceSession(roomId);
        if (!active) return;
        const wasActive = voiceSession.active;
        setVoiceSession(session || { active: false });
        hasLoaded = true;
        if (wasActive && !session?.active && voiceToken) {
          setVoiceToken('');
          setActiveMode('text');
          toast('The host ended the voice space');
        }
      } catch (error) {
        if (active && !hasLoaded) {
          toast.error(error.response?.data?.error || 'Unable to load voice space status');
        }
      }
    };
    refreshVoiceSession();
    const refreshInterval = window.setInterval(refreshVoiceSession, 5000);
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
    };
  }, [roomId, membershipStatus, roomHasVoiceFeatures, voiceSession.active, voiceToken]);

  // ============================================================================
  // GLOBAL NOTIFICATION SOCKET (For 1-on-1 Calls)
  // ============================================================================
  // ... (Kept identical to original to preserve your LiveKit Call logic) ...
  useEffect(() => {
    let token = appToken || '';
    if (!token) {
      try {
        const stored = localStorage.getItem('chattie-session-storage');
        if (stored) token = JSON.parse(stored)?.state?.token || '';
      } catch (e) {}
    }

    if (!token) return;

    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    const notifyUrl = `${getWebSocketOrigin()}/ws?token=${encodeURIComponent(cleanToken)}`;

    try {
      const nws = new WebSocket(notifyUrl);
      notificationSocketRef.current = nws;

      nws.onmessage = (ev) => {
        try {
          const incoming = JSON.parse(ev.data);
          if (incoming.type === 'ROOM_ACCESS_APPROVED' && incoming.data?.room_id === roomId) {
            setMembershipStatus('member');
            chatService.getRoomAdminDetails(roomId).then((details) => {
              setRoomAdminData(details);
              setSelectedRoom(details);
            }).catch(() => {
              toast.error('Room access was approved, but room details could not be refreshed');
            });
            toast.success('Your request to join was approved');
            return;
          }
          if ((incoming.type === 'ROOM_KICKED' || incoming.type === 'ROOM_BANNED') && incoming.data?.room_id === roomId) {
            wsIntentionalClose.current = true;
            toast.error('Your access to this room was removed');
            navigate('/rooms');
            return;
          }
          if (incoming.type === 'incoming_call') {
            if (isInPrivateCallRef.current) { stopRingtone(); return; }
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
            if (!isInPrivateCall) setIsInPrivateCall(true);
            return;
          }
          if (incoming.type === 'call_rejected') {
            stopRingtone();
            setIncomingCallData(null);
            toast.error(translateRef.current('callRejected'));
            setIsInPrivateCall(false);
            setPrivateCallToken('');
            return;
          }
        } catch (e) {}
      };
    } catch (e) {}

    return () => {
      if (notificationSocketRef.current) {
        try { notificationSocketRef.current.close(); } catch (e) {}
        notificationSocketRef.current = null;
      }
    };
  }, [appToken, roomId, navigate, currentUser?.id]);

  useEffect(() => {
    if (incomingCallData) playRingtone(ringtoneProfile);
    else stopRingtone();
    return () => stopRingtone();
  }, [incomingCallData, ringtoneProfile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeMode, attachedMedia, typingUsers, replyingTo]);

  // ============================================================================
  // ADMIN & MODERATION HANDLERS
  // ============================================================================
  const handleKnockToJoin = async () => {
    try {
      await chatService.requestRoomAccessByID(roomId);
      setMembershipStatus('pending');
      toast.success(t('accessRequestSent'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('roomAccessFailed'));
    }
  };

  const copyInviteLink = () => {
    if (!roomAdminData?.inviteLink) return;
    navigator.clipboard.writeText(roomAdminData.inviteLink);
    setCopiedLink(true);
    toast.success(t('inviteCopied'));
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleUpdateRoomDetails = async () => {
    try {
      await chatService.updateRoom(roomId, {
        name: editRoomForm.name,
        description: editRoomForm.description,
        category: editRoomForm.category,
        rules: editRoomForm.rules,
        content_mode: editRoomForm.content_mode,
        allow_media: editRoomForm.allow_media,
        allow_links: editRoomForm.allow_links,
        slow_mode_seconds: Number(editRoomForm.slow_mode_seconds),
        is_read_only: editRoomForm.is_read_only,
      });
      setSelectedRoom(prev => ({ ...prev, ...editRoomForm }));
      setRoomAdminData(prev => ({ ...prev, ...editRoomForm }));
      toast.success(t('roomUpdated'));
      setIsEditingRoom(false);
    } catch (err) {
      toast.error(t('roomUpdateFailed'));
    }
  };

  const openAdminPanel = async () => {
    setShowAdminModal(true);
    try {
      setJoinRequests(await chatService.getRoomJoinRequests(roomId));
    } catch (error) {
      toast.error(error.response?.data || 'Unable to load join requests');
    }
  };

  const handleJoinRequest = async (targetId, approve) => {
    try {
      await chatService.manageJoinRequest(roomId, targetId, approve);
      setJoinRequests((requests) => requests.filter((request) => request.user_id !== targetId));
      setRoomAdminData((room) => ({ ...room, pendingCount: Math.max(0, (room.pendingCount || 0) - 1) }));
      toast.success(approve ? 'Member approved' : 'Request declined');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Unable to process join request');
    }
  };

  const handleToggleReaction = async (message, emoji) => {
    try {
      const { added } = await chatService.toggleRoomMessageReaction(roomId, message.id, emoji);
      setMessages((current) => current.map((item) => {
        if (item.id !== message.id) return item;
        const reactions = [...(item.reactions || [])];
        const index = reactions.findIndex((reaction) => reaction.emoji === emoji);
        if (added && index < 0) reactions.push({ emoji, count: 1, reacted: true });
        else if (added) reactions[index] = { ...reactions[index], count: reactions[index].count + 1, reacted: true };
        else if (index >= 0 && reactions[index].count <= 1) reactions.splice(index, 1);
        else if (index >= 0) reactions[index] = { ...reactions[index], count: reactions[index].count - 1, reacted: false };
        return { ...item, reactions };
      }));
    } catch (error) {
      toast.error(error.response?.data || 'Unable to update reaction');
    }
  };

  const handleTogglePin = async (message) => {
    try {
      await chatService.pinRoomMessage(roomId, message.id, !message.isPinned);
      setMessages((current) => current.map((item) => (
        item.id === message.id ? { ...item, isPinned: !item.isPinned } : item
      )));
    } catch (error) {
      toast.error(error.response?.data || 'Unable to update pinned message');
    }
  };

  const jumpToMessage = (messageId) => {
    setMessageSearch('');
    setIsMessageSearchOpen(false);
    window.requestAnimationFrame(() => {
      messageRefs.current.get(messageId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const handleModerateUser = async (targetId, ban = false) => {
    try {
      await apiClient.post(`/rooms/${roomId}/moderate`, { target_id: targetId, ban });
      toast.success(t('userModerated', { action: ban ? t('banned') : t('kicked') }));
      setSelectedProfile(null);
    } catch (err) {
      toast.error(err.response?.data?.error || t('moderateUserFailed'));
    }
  };

  const handleMuteMember = async (target, muted) => {
    try {
      await chatService.setRoomMemberMuted(roomId, target.id, muted);
      setRoomParticipants((participants) => participants.map((participant) => (
        participant.id === target.id ? { ...participant, is_muted: muted } : participant
      )));
      setSelectedProfile((profile) => ({ ...profile, is_muted: muted }));
      toast.success(muted ? 'Member muted' : 'Member unmuted');
    } catch (error) {
      toast.error(error.response?.data || 'Unable to update member restrictions');
    }
  };

  const handleSetMemberRole = async (target, role) => {
    try {
      await chatService.setRoomMemberRole(roomId, target.id, role);
      setRoomParticipants((participants) => participants.map((participant) => (
        participant.id === target.id ? { ...participant, role } : participant
      )));
      setSelectedProfile((profile) => ({ ...profile, role }));
      toast.success(role === 'admin' ? 'Administrator role granted' : 'Administrator role removed');
    } catch (error) {
      toast.error(error.response?.data || 'Unable to update member role');
    }
  };

  const handleLeaveRoom = async () => {
    try {
      await chatService.leaveRoom(roomId);
      toast.success(t('leftRoom', { name: selectedRoom.name }));
      wsIntentionalClose.current = true;
      navigate('/rooms');
    } catch (err) {
      toast.error(err.response?.data || t('leaveRoomFailed'));
    }
  };

  // ============================================================================
  // REAL MEDIA VAULT LOGIC
  // ============================================================================
  const fetchVaultImages = async () => {
    setIsLoadingVault(true);
    try {
      const media = await ChattieService.getMediaVault();
      if (Array.isArray(media)) setVaultImages(media);
      else setVaultImages([]);
    } catch (err) {
      toast.error(t('mediaVaultFailed'));
    } finally {
      setIsLoadingVault(false);
    }
  };

  useEffect(() => {
    if (showMediaVault) fetchVaultImages();
  }, [showMediaVault]);

  const handleUploadMedia = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoadingVault(true);
    try {
      await ChattieService.uploadVaultMedia(file);
      await fetchVaultImages();
      toast.success(t('vaultPhotoSaved'));
    } catch (err) {
      toast.error(t('uploadBackendFailed'));
    } finally {
      setIsLoadingVault(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleMediaClick = () => {
    if (!canSendMedia) {
      toast.error(t('premiumMediaRequired'));
      return;
    }
    setShowMediaVault(true);
  };

  // ============================================================================
  // CHAT HANDLERS
  // ============================================================================
  const connectToVoice = async () => {
    if (!voiceSession.active) {
      toast.error('The room host has not started a voice space');
      return;
    }
    setIsConnectingVoice(true);
    try {
      const res = await apiClient.post('/rooms/voice-token', {
        room_id: roomId,
        participant_name: currentUser.name
      });
      setVoiceToken(res.data.token);
    } catch (err) {
      toast.error(err.response?.data?.error || t('voiceTokenFailed'));
    } finally {
      setIsConnectingVoice(false);
    }
  };

  const handleJoinVoice = () => {
    setActiveMode('voice');
    connectToVoice();
  };

  const disconnectVoice = () => {
    setVoiceToken("");
    setActiveMode('text');
  };

  const handleStartVoiceSession = async () => {
    setIsUpdatingVoiceSession(true);
    try {
      const session = await chatService.startRoomVoiceSession(roomId);
      setVoiceSession(session);
      setActiveMode('voice');
      setIsConnectingVoice(true);
      try {
        const voice = await chatService.getVoiceToken(roomId, currentUser.name || 'Host');
        setVoiceToken(voice.token);
        toast.success('Your voice space is live');
      } catch (error) {
        toast.error(error.response?.data?.error || 'Voice is live, but your microphone could not connect');
      } finally {
        setIsConnectingVoice(false);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Unable to start the voice space');
    } finally {
      setIsUpdatingVoiceSession(false);
    }
  };

  const handleEndVoiceSession = async () => {
    setIsUpdatingVoiceSession(true);
    try {
      const session = await chatService.endRoomVoiceSession(roomId);
      setVoiceSession(session);
      setVoiceToken('');
      setActiveMode('text');
      toast.success('Voice space ended');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Unable to end the voice space');
    } finally {
      setIsUpdatingVoiceSession(false);
    }
  };

  const handleTyping = (e) => {
    setMessageInput(e.target.value);
    const now = Date.now();
    if (now - lastTypingTimeRef.current > 2000) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'typing', room_id: roomId }));
        lastTypingTimeRef.current = now;
      }
    }
  };

  const handleSendMessage = (e) => {
    if (e) e.preventDefault();
    if (!messageInput.trim() && !attachedMedia) return;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      toast.error(t('roomOffline'));
      return;
    }

    let finalContent = messageInput;
    if (replyingTo) {
      finalContent = `[REPLY]${replyingTo.text || 'Media'}[/REPLY]\n${messageInput}`;
    }

    const uniqueMsgId = `local-${Date.now()}-${Math.random()}`;
    const messagePayload = {
      client_message_id: uniqueMsgId,
      room_id: roomId,
      content: finalContent,
      text: finalContent,
      media: attachedMedia 
    };

    wsRef.current.send(JSON.stringify(messagePayload));

    // Optimistic UI Update
    setMessages(prev => [...prev, {
      id: uniqueMsgId,
      sender: 'You',
      text: finalContent,
      media: attachedMedia,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMe: true,
      status: 'sending', // Will update to sent visually
      isPinned: false,
      reactions: [],
      avatar: currentUser?.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=150&q=80'
    }]);
    
    setMessageInput('');
    setAttachedMedia(null);
    setReplyingTo(null);
    setShowEmojiPicker(false);
  };

  const handleEmojiSelect = (emojiData) => {
    setMessageInput(prev => prev + emojiData.emoji);
    setShowEmojiPicker(false);
  };

  const maskName = (name) => {
    if (canViewFullProfiles) return name;
    return `${name.charAt(0)}${'*'.repeat(name.length - 1)}`;
  };

  const activeTypingNames = Object.values(typingUsers).map(u => u.name);
  let typingString = '';
  if (activeTypingNames.length === 1) typingString = `${activeTypingNames[0]} is typing...`;
  else if (activeTypingNames.length === 2) typingString = `${activeTypingNames[0]} and ${activeTypingNames[1]} are typing...`;
  else if (activeTypingNames.length > 2) typingString = `Several people are typing...`;

  // ============================================================================
  // PRIVATE CALL & RINGTONE HANDLERS
  // ============================================================================
  // ... (Kept identical to preserve your custom audio logic) ...
  const acceptPrivateCall = async () => {
    if (!incomingCallData) return;
    if (voiceToken) disconnectVoice();
    setPrivateCallMode(incomingCallData.mode || 'video');
    setIncomingCallData(null);
    stopRingtone();
    try {
      if ((incomingCallData.mode || 'video') === 'video' && navigator?.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          setLocalPrivateStream(stream);
        } catch (err) {}
      }
      const res = await apiClient.post('/rooms/voice-token', {
        room_id: incomingCallData.roomId,
        participant_name: currentUser?.name || 'Guest'
      });
      setPrivateCallToken(res.data.token);
      setIsInPrivateCall(true);
      const ack = { type: 'call_answered', room_id: incomingCallData.roomId, from: currentUser?.id, to: incomingCallData.fromId };
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(ack));
      else if (notificationSocketRef.current && notificationSocketRef.current.readyState === WebSocket.OPEN) notificationSocketRef.current.send(JSON.stringify(ack));
    } catch (err) {
      toast.error(t('privateCallJoinFailed'));
    }
  };

  const rejectPrivateCall = (reason = 'rejected') => {
    if (!incomingCallData) return;
    const rej = { type: 'call_rejected', room_id: incomingCallData.roomId, from: currentUser?.id, to: incomingCallData.fromId, reason };
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(rej));
      else if (notificationSocketRef.current && notificationSocketRef.current.readyState === WebSocket.OPEN) notificationSocketRef.current.send(JSON.stringify(rej));
    } catch (e) {}
    setIncomingCallData(null);
    stopRingtone();
  };

  const endPrivateCall = () => {
    setIsInPrivateCall(false);
    setPrivateCallToken("");
    try {
      if (localPrivateStream) {
        localPrivateStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
      }
    } catch (e) {}
    setLocalPrivateStream(null);
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
          osc.type = type; osc.frequency.value = freq;
          const start = now + offset;
          g.gain.setValueAtTime(0.0001, start);
          g.gain.exponentialRampToValueAtTime(vol, start + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, start + dur - 0.02);
          osc.connect(g); g.connect(master);
          osc.start(start); osc.stop(start + dur + 0.02);
        };
        if (profile === 'soft') { playNote(660, 0, 0.22, 'sine', 0.04); playNote(880, 0.32, 0.18, 'sine', 0.035); } 
        else if (profile === 'classic') { playNote(880, 0, 0.14, 'square', 0.06); playNote(659, 0.18, 0.14, 'square', 0.06); playNote(880, 0.36, 0.14, 'square', 0.06); } 
        else { playNote(880, 0, 0.18, 'triangle', 0.055); playNote(660, 0.22, 0.18, 'triangle', 0.05); playNote(990, 0.46, 0.16, 'triangle', 0.045); }
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

  // ============================================================================
  // RENDERING
  // ============================================================================
  if (membershipStatus === 'checking') {
    return (
      <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col items-center justify-center bg-black p-2 text-center font-mono text-zinc-300 sm:p-3 lg:p-4">
        <Loader2 className="w-10 h-10 text-white animate-spin mb-4" />
        <h2 className="text-sm font-black text-white uppercase tracking-widest">VERIFYING LOUNGE ACCESS...</h2>
      </div>
    );
  }

  if (membershipStatus === 'locked' || membershipStatus === 'pending') {
    return (
      <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col items-center justify-center bg-black p-2 text-center font-mono text-zinc-300 sm:p-3 lg:p-4">
        <div className="w-20 h-20 bg-zinc-950 border-2 border-zinc-800 flex items-center justify-center text-4xl mb-6 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.05)]">
          {selectedRoom.icon || '🔒'}
        </div>
        <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2">{selectedRoom.name}</h2>
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest max-w-sm leading-relaxed mb-8">
          This is a private lounge. You must request entry from the room administrators to participate.
        </p>

        {membershipStatus === 'pending' ? (
          <div className="px-6 py-4 bg-zinc-900 border-2 border-yellow-500/50 text-yellow-400 font-black text-xs uppercase tracking-widest flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> WAITING FOR ADMIN APPROVAL...
          </div>
        ) : (
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button
              onClick={handleKnockToJoin}
              className="py-4 bg-white text-black border-2 border-white font-black uppercase tracking-widest text-xs hover:bg-zinc-200 transition-colors shadow-[4px_4px_0px_rgba(var(--highlight-rgb), 0.2)] flex items-center justify-center gap-2"
            >
              <KeyRound className="w-4 h-4" /> KNOCK TO ENTER
            </button>
            <button 
              onClick={() => navigate('/rooms')}
              className="py-3 bg-black text-zinc-400 border-2 border-zinc-800 font-bold uppercase tracking-widest text-xs hover:text-white hover:border-zinc-600 transition-colors"
            >
              Return to Directory
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full bg-black text-zinc-300 font-mono overflow-hidden relative rounded-none" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      
      <div className="flex-1 flex flex-col min-w-0 h-full relative z-10">
        
        <header className="flex flex-col border-b-2 border-zinc-800 bg-black shrink-0 shadow-[0_4px_20px_rgba(var(--shadow-rgb), 0.5)] z-20">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => navigate('/rooms')}
                className="md:hidden p-2 border-2 border-zinc-800 hover:border-white hover:text-white transition-colors bg-zinc-950"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 border-2 border-zinc-500 bg-zinc-900 flex items-center justify-center font-bold text-white text-xl">
                  {selectedRoom.icon}
                </div>
                <div>
                  <h2 className="text-lg font-black text-white uppercase tracking-widest flex items-center gap-2">
                    {selectedRoom.name}
                  </h2>
                  <span className="text-[9px] font-bold text-green-400 uppercase tracking-widest flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-green-500 animate-pulse rounded-full" /> {onlineCount} online
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
              {isUserAdmin && (
                <button
                  onClick={() => setShowShareModal(true)}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-2 border-2 border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-white hover:text-white transition-colors text-[10px] font-black uppercase tracking-widest"
                >
                  <Share2 className="w-3.5 h-3.5" /> Invite
                </button>
              )}

              {isUserAdmin && (
                <button 
                  onClick={openAdminPanel}
                  className="flex items-center gap-1.5 px-3 py-2 border-2 border-yellow-500/50 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500 hover:text-black transition-colors text-[10px] font-black uppercase tracking-widest"
                >
                  <ShieldCheck className="w-3.5 h-3.5" /> Admin Panel {roomAdminData?.pendingCount > 0 && `(${roomAdminData.pendingCount})`}
                </button>
              )}

              <button 
                onClick={() => {
                  setIsNotificationsMuted(!isNotificationsMuted);
                  toast(isNotificationsMuted ? 'Alerts Enabled' : 'Alerts Muted');
                }}
                className={`hidden sm:flex p-2 border-2 transition-colors ${isNotificationsMuted ? 'text-zinc-600 border-zinc-800 bg-zinc-950' : 'text-zinc-400 border-transparent hover:border-zinc-700 hover:bg-zinc-900 hover:text-white'}`}
              >
                {isNotificationsMuted ? <BellOff className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
              </button>

              <button
                onClick={() => setIsMessageSearchOpen((open) => !open)}
                aria-label={isMessageSearchOpen ? 'Close message search' : 'Search messages'}
                className={`p-2 border-2 transition-colors ${isMessageSearchOpen ? 'border-white bg-white text-black' : 'border-transparent text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-white'}`}
              >
                <Search className="w-5 h-5" />
              </button>
              
              <button 
                onClick={handleLeaveRoom}
                className="flex items-center gap-1.5 p-2 border-2 border-transparent text-red-500 hover:border-red-900 hover:bg-zinc-950 transition-colors text-[10px] font-black uppercase tracking-widest"
                title="Leave room"
                aria-label="Leave room"
              >
                <DoorOpen className="w-5 h-5" />
              </button>

              <button 
                onClick={() => setShowSidebar(!showSidebar)}
                className={`p-2 border-2 transition-colors flex items-center gap-2 ${showSidebar ? 'bg-white text-black border-white' : 'text-zinc-400 border-transparent hover:border-zinc-700 hover:bg-zinc-900 hover:text-white'} lg:border-white lg:bg-white lg:text-black`}
              >
                <Users className="w-5 h-5" />
                <span className="hidden lg:inline text-[10px] font-black uppercase tracking-widest">PARTICIPANTS ({onlineCount})</span>
              </button>
            </div>
          </div>

          {roomHasVoiceFeatures && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-black px-4 py-3 md:px-6">
              <div className="flex items-center gap-3">
                <span className={`h-2.5 w-2.5 rounded-full ${voiceSession.active ? 'bg-red-500 animate-pulse' : 'bg-zinc-600'}`} />
                <div>
                  <p className="text-[11px] font-bold tracking-wide text-white">
                    {voiceSession.active ? 'Live voice space' : 'Voice space is not live'}
                  </p>
                  <p className="text-[10px] text-zinc-400">
                    {voiceSession.active ? 'Join to listen; speaking is role-controlled' : 'Text chat is always available'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {voiceSession.active && canUseVoiceChannel && activeMode !== 'voice' && (
                  <button
                    onClick={handleJoinVoice}
                    className="flex items-center gap-2 border-2 border-white bg-white px-4 py-2 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-zinc-200"
                  >
                    <Headphones className="h-4 w-4" /> Join voice
                  </button>
                )}
                {activeMode === 'voice' && (
                  <button onClick={disconnectVoice} className="border-2 border-zinc-700 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:border-white hover:text-white">
                    Back to chat
                  </button>
                )}
                {isUserAdmin && (voiceSession.active ? (
                  <button
                    onClick={handleEndVoiceSession}
                    disabled={isUpdatingVoiceSession}
                    className="border-2 border-red-500/60 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-red-400 hover:bg-red-500 hover:text-black disabled:opacity-50"
                  >
                    {isUpdatingVoiceSession ? 'Please wait...' : 'End voice'}
                  </button>
                ) : (
                  <button
                    onClick={handleStartVoiceSession}
                    disabled={isUpdatingVoiceSession}
                    className="border-2 border-zinc-700 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:border-yellow-400 hover:text-yellow-400 disabled:opacity-50"
                  >
                    {isUpdatingVoiceSession ? 'Please wait...' : 'Start voice'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </header>

        {activeMode === 'text' && (isMessageSearchOpen || latestPinnedMessage) && (
          <div className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-4 py-2 md:px-6">
            {isMessageSearchOpen && (
              <div className="flex items-center gap-3">
                <Search className="h-4 w-4 shrink-0 text-zinc-500" />
                <input
                  type="search"
                  value={messageSearch}
                  onChange={(event) => setMessageSearch(event.target.value)}
                  placeholder="Search recent messages"
                  aria-label="Search recent messages"
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm text-white outline-none placeholder:text-zinc-600"
                  autoFocus
                />
                <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                  {normalizedMessageSearch ? `${visibleMessages.length} found` : `${messages.length} loaded`}
                </span>
                <button
                  onClick={() => {
                    setMessageSearch('');
                    setIsMessageSearchOpen(false);
                  }}
                  aria-label="Close message search"
                  className="p-1 text-zinc-500 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {!normalizedMessageSearch && latestPinnedMessage && (
              <button
                onClick={() => jumpToMessage(latestPinnedMessage.id)}
                className="flex w-full items-center gap-3 border-l-2 border-yellow-500 px-2 py-2 text-left hover:bg-zinc-900"
              >
                <Pin className="h-4 w-4 shrink-0 text-yellow-400" />
                <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-yellow-400">
                  {pinnedMessages.length > 1 ? `${pinnedMessages.length} pinned` : 'Pinned'}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
                  {latestPinnedMessage.sender}: {parseMessageContent(latestPinnedMessage.text).text || 'Media attachment'}
                </span>
                <span className="shrink-0 text-[8px] font-black uppercase tracking-widest text-zinc-600">Jump</span>
              </button>
            )}
          </div>
        )}

        {activeMode === 'text' && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-2 sm:p-3 lg:p-4 space-y-4 bg-black relative">
              <section className="w-full border border-zinc-800 bg-zinc-950 p-3 sm:p-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">About this room</p>
                    <p className="max-w-3xl text-sm leading-relaxed text-zinc-300">
                      {selectedRoom.description || selectedRoom.desc || "Be respectful and follow the room rules."}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 text-[9px] font-black uppercase tracking-widest">
                    <span className="border border-zinc-700 px-2 py-1 text-zinc-300">
                    {selectedRoom.content_mode === 'mature' ? '18+ room' : 'General room'}
                    </span>
                    {selectedRoom.slow_mode_seconds > 0 && (
                      <span className="border border-zinc-700 px-2 py-1 text-zinc-300">{selectedRoom.slow_mode_seconds}s slow mode</span>
                    )}
                    {selectedRoom.is_read_only && <span className="border border-zinc-700 px-2 py-1 text-zinc-300">Moderator-only posting</span>}
                    {selectedRoom.tags?.map((tag, idx) => (
                      <span key={idx} className="border border-zinc-700 px-2 py-1 text-zinc-400">#{tag}</span>
                    ))}
                  </div>
                </div>
                {selectedRoom.rules && (
                  <details className="mt-3 border-t border-zinc-800 pt-3">
                    <summary className="cursor-pointer text-[9px] font-black uppercase tracking-widest text-yellow-400">Room rules</summary>
                    <p className="mt-2 whitespace-pre-wrap text-[10px] leading-relaxed text-zinc-400">{selectedRoom.rules}</p>
                  </details>
                )}
              </section>

              {isLoadingMessages && messages.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-12 text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-[9px] font-black uppercase tracking-widest">Loading conversation...</span>
                </div>
              ) : visibleMessages.length === 0 ? (
                <div className="mx-auto max-w-md py-12 text-center">
                  <MessageSquare className="mx-auto mb-3 h-6 w-6 text-zinc-700" />
                  <p className="text-xs font-black uppercase tracking-widest text-zinc-400">
                    {normalizedMessageSearch ? 'No matching messages' : 'Start the conversation'}
                  </p>
                  <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
                    {normalizedMessageSearch
                      ? 'Try another phrase. Search covers the recent messages loaded in this room.'
                      : 'Say hello to the group. Keep messages respectful and follow the room rules.'}
                  </p>
                </div>
              ) : visibleMessages.map((msg, idx) => {
                const { quote, text } = parseMessageContent(msg.text);
                const showAvatar = !msg.isMe && (idx === 0 || visibleMessages[idx - 1]?.sender !== msg.sender);
                const messageRole = msg.role || roomParticipants.find((p) => p.id === msg.sender_id)?.role;
                const roleLabel = getRoomRoleLabel(messageRole);

                return (
                  <div
                    key={msg.id}
                    ref={(element) => {
                      if (element) messageRefs.current.set(msg.id, element);
                      else messageRefs.current.delete(msg.id);
                    }}
                    className={`flex gap-3 md:gap-4 w-full group ${msg.isMe ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    
                    {!msg.isMe && (
                      <div className="shrink-0 flex flex-col justify-end pb-1 w-10">
                        {showAvatar && (
                          <div className="relative">
                            <img 
                              src={msg.avatar} alt="avatar"
                              onClick={() => setSelectedProfile({ name: msg.sender, avatar: msg.avatar, role: messageRole || 'member', id: msg.sender_id })}
                              className={`w-10 h-10 object-cover grayscale border-2 cursor-pointer transition-colors ${canViewFullProfiles ? 'border-zinc-700 hover:border-white' : 'blur-[2px] border-zinc-800'}`}
                            />
                            {!canViewFullProfiles && <Lock className="absolute inset-0 m-auto w-4 h-4 text-zinc-400 drop-shadow-md pointer-events-none" />}
                          </div>
                        )}
                      </div>
                    )}

                    <button onClick={() => setReplyingTo(msg)} className={`opacity-0 group-hover:opacity-100 transition-opacity p-2 text-zinc-500 hover:text-white ${msg.isMe ? 'mr-auto' : ''}`}>
                      <Reply className="w-4 h-4" />
                    </button>

                    <div className={`flex flex-col max-w-[85%] md:max-w-[70%] ${msg.isMe ? 'items-end' : 'items-start'}`}>
                      {(showAvatar || msg.isMe) && (
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                            {msg.sender}
                          </span>
                          {roleLabel && (
                            <span className={`border px-1.5 py-0.5 text-[8px] font-black tracking-widest ${
                              messageRole === 'creator' ? 'border-yellow-500/50 text-yellow-400' : 'border-sky-500/40 text-sky-300'
                            }`}>
                              {roleLabel}
                            </span>
                          )}
                        </div>
                      )}
                      
                      <div className={`chat-bubble ${msg.isMe ? 'chat-bubble--mine' : 'chat-bubble--other'} flex max-w-full flex-col gap-2 border p-3.5 text-sm font-medium leading-relaxed tracking-wide
                          ${msg.isMe ? 'border-white/80 bg-gradient-to-br from-white to-zinc-100 text-black shadow-white/10'
                                   : 'border-zinc-600 bg-gradient-to-br from-zinc-900 to-black text-white shadow-black/30'}
                      `}>
                        {quote && (
                          <div className={`pl-3 border-l-2 mb-2 italic text-xs ${msg.isMe ? 'border-black/20 text-black/70' : 'border-white/20 text-white/70'}`}>
                            {quote}
                          </div>
                        )}
                        {msg.media && <img src={msg.media} alt="attachment" className="max-w-[min(70vw,16rem)] border-2 border-black/20 overflow-hidden object-cover" />}
                        {text && <div>{text}</div>}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {msg.isPinned && <span className="text-[9px] uppercase font-black tracking-widest text-yellow-400">Pinned</span>}
                        {(msg.reactions || []).map((reaction) => (
                          <button
                            key={reaction.emoji}
                            onClick={() => handleToggleReaction(msg, reaction.emoji)}
                            className={`px-2 py-1 border text-[10px] ${reaction.reacted ? 'border-yellow-500 text-yellow-300' : 'border-zinc-700 text-zinc-400'}`}
                            aria-label={`Toggle ${reaction.emoji} reaction`}
                          >
                            {reaction.emoji} {reaction.count}
                          </button>
                        ))}
                        <button onClick={() => handleToggleReaction(msg, '👍')} className="px-2 py-1 border border-zinc-800 text-[10px] text-zinc-500 hover:text-white" aria-label="React with thumbs up">+ 👍</button>
                        {canModerateRoom && (
                          <button onClick={() => handleTogglePin(msg)} className="px-2 py-1 border border-zinc-800 text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-yellow-400">
                            {msg.isPinned ? 'Unpin' : 'Pin'}
                          </button>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[9px] font-black tracking-widest text-zinc-500">{msg.time}</span>
                        {msg.isMe && (
                          <span className="text-zinc-500 ml-1">
                            {msg.status === 'sending' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className={`transition-opacity duration-300 ${activeTypingNames.length > 0 ? 'opacity-100' : 'opacity-0'} pointer-events-none mb-2`}>
                <div className="flex items-center gap-3">
                  <div className="px-4 py-3 shadow-sm rounded-[20px] rounded-bl-sm flex items-center gap-2 bg-zinc-900 border-2 border-zinc-800">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce"></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                    </div>
                    <span className="text-[9px] font-black uppercase text-zinc-500 ml-1">{typingString}</span>
                  </div>
                </div>
              </div>

              <div ref={messagesEndRef} className="h-4" />
            </div>

            <div className="p-4 bg-zinc-950 border-t border-zinc-800 shrink-0 relative z-30">
              
              {showEmojiPicker && (
                <div className="absolute bottom-[calc(100%+10px)] left-16 bg-black border-2 border-zinc-700 p-2 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] z-50">
                  <Suspense fallback={<div className="p-4 text-xs text-zinc-400">Loading emoji...</div>}>
                    <EmojiPicker theme={theme} onEmojiClick={handleEmojiSelect} searchDisabled={true} skinTonesDisabled={true} height={350} width={300} />
                  </Suspense>
                </div>
              )}

              <div className="flex flex-col gap-2">
                
                {replyingTo && (
                  <div className="flex items-center justify-between bg-zinc-900 border-l-2 border-white p-2 w-max max-w-full">
                    <div className="flex flex-col overflow-hidden text-xs px-2">
                      <span className="text-white font-black uppercase tracking-widest">{replyingTo.sender}</span>
                      <span className="text-zinc-400 truncate">{parseMessageContent(replyingTo.text).text || 'Media'}</span>
                    </div>
                    <button onClick={() => setReplyingTo(null)} className="p-1 text-zinc-500 hover:text-white"><X className="w-3 h-3" /></button>
                  </div>
                )}

                {attachedMedia && (
                  <div className="flex items-center gap-4 bg-black border-2 border-zinc-700 p-2 w-max">
                    <img src={attachedMedia} alt="preview" className="w-12 h-12 object-cover border-2 border-zinc-800" />
                    <div className="flex flex-col pr-2">
                      <span className="text-[9px] font-black uppercase text-zinc-400">Attached File</span>
                      <span className="text-[10px] font-bold text-white uppercase">Ready to send</span>
                    </div>
                    <button onClick={() => setAttachedMedia(null)} className="p-1 bg-red-500 text-black hover:bg-red-600 transition-colors border-2 border-black">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                <div className="flex gap-3">
                  <div className="flex items-center gap-0.5 md:gap-1 shrink-0 rounded-2xl bg-white/[0.04] border border-white/10 p-0.5 md:p-1">
                    <button onClick={handleMediaClick} aria-label="Attach media" className={`p-1.5 md:p-2 transition-colors border-2 relative ${canSendMedia ? 'text-zinc-500 hover:text-white border-transparent hover:border-zinc-700 hover:bg-zinc-900' : 'text-zinc-800 border-transparent cursor-not-allowed'}`}>
                      <ImageIcon className="w-4 h-4" />
                      {!canSendMedia && <Lock className="w-2.5 h-2.5 absolute top-1 right-1 text-zinc-600" />}
                    </button>
                    <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} aria-label="Choose emoji" className="p-1.5 md:p-2 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                      <Smile className="w-4 h-4" />
                    </button>
                  </div>

                  <textarea
                    value={messageInput}
                    onChange={handleTyping}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                    placeholder="TYPE A MESSAGE..."
                    className="flex-1 rounded-2xl bg-zinc-950 border border-zinc-800 p-3 text-white text-sm resize-none outline-none focus:border-zinc-500 transition-colors custom-scrollbar"
                    rows="2"
                  />

                  <button 
                    onClick={handleSendMessage}
                    disabled={(!messageInput.trim() && !attachedMedia)}
                    className="w-16 md:w-24 rounded-2xl bg-white border border-white text-black flex flex-col items-center justify-center gap-1 font-black uppercase tracking-widest hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                  >
                    <Send className="w-5 h-5" />
                    <span className="text-[10px]">SEND</span>
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {activeMode === 'voice' && (
          <div className="flex-1 bg-black flex flex-col relative">
            {!canUseVoiceChannel ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <Crown className="w-16 h-16 text-yellow-500 mb-6 drop-shadow-[0_0_15px_rgba(var(--warning-rgb), 0.5)]" />
                <h3 className="text-2xl font-black text-white uppercase tracking-widest mb-4">PREMIUM REQUIRED</h3>
                <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest max-w-md leading-relaxed mb-8">
                  Voice lounges are reserved for Premium members to maintain quality and privacy. Upgrade to join the conversation.
                </p>
              </div>
            ) : !voiceToken ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <Headphones className="w-16 h-16 text-zinc-600 mb-6" />
                <button 
                  onClick={connectToVoice}
                  disabled={isConnectingVoice}
                  className="px-10 py-4 bg-white text-black border-2 border-white font-black uppercase tracking-widest text-[10px] hover:bg-zinc-200 transition-colors shadow-[4px_4px_0px_rgba(var(--highlight-rgb), 0.2)] disabled:opacity-50"
                >
                  {isConnectingVoice ? 'CONNECTING...' : 'Connect to Audio'}
                </button>
              </div>
            ) : (
              <LiveKitRoom
                serverUrl={LIVEKIT_URL}
                token={voiceToken}
                connect={true}
                audio={canPublishVoice}
                options={{ adaptiveStream: true, dynacast: true }}
                onConnected={() => toast.success('Connected to the voice space')}
                onError={(error) => {
                  console.error('[ROOM VOICE] LiveKit connection failed:', error);
                  toast.error(error.message || 'Could not connect to room audio');
                  setVoiceToken('');
                  setActiveMode('text');
                }}
                className="flex-1 flex flex-col"
              >
                <RoomAudioRenderer />
                <div className="flex-1 p-5 md:p-10 overflow-y-auto custom-scrollbar">
                  <ActiveVoiceGrid members={roomParticipants} />
                </div>

                <div className="p-4 md:p-6 bg-zinc-950 border-t border-zinc-800 flex items-center justify-center gap-4 z-20">
                  {canPublishVoice ? (
                    <RoomVoiceControls />
                  ) : (
                    <span className="border border-zinc-800 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-zinc-400">
                      Listening only
                    </span>
                  )}

                  <button onClick={disconnectVoice} className="border-2 border-zinc-700 px-6 py-3 text-zinc-300 font-black uppercase tracking-widest text-[10px] hover:border-white hover:text-white transition-colors">
                    Disconnect
                  </button>
                </div>
              </LiveKitRoom>
            )}
          </div>
        )}
      </div>

      {showAdminModal && roomAdminData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowAdminModal(false)} />
          <div className="relative w-full max-w-lg bg-black border-2 border-yellow-500/50 shadow-[8px_8px_0px_rgba(var(--warning-rgb), 0.2)] flex flex-col z-10">
            <div className="flex items-center justify-between border-b-2 border-zinc-800 bg-zinc-950 p-4">
               <div className="flex items-center gap-4">
                  <button onClick={() => setIsEditingRoom(false)} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 ${!isEditingRoom ? 'text-yellow-400 border-yellow-400' : 'text-zinc-500 border-transparent hover:text-white'}`}>
                    <ShieldCheck className="w-4 h-4 inline mr-1" /> Access List
                  </button>
                  <button onClick={() => setIsEditingRoom(true)} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 ${isEditingRoom ? 'text-yellow-400 border-yellow-400' : 'text-zinc-500 border-transparent hover:text-white'}`}>
                    <Settings className="w-4 h-4 inline mr-1" /> Room Settings
                  </button>
               </div>
              <button onClick={() => setShowAdminModal(false)} className="p-1 text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <div className="max-h-[70dvh] overflow-y-auto p-6 space-y-6 custom-scrollbar">
               {isEditingRoom ? (
                  <div className="space-y-4">
                     <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">Room Name</label>
                        <input type="text" value={editRoomForm.name} onChange={e => setEditRoomForm(p => ({...p, name: e.target.value}))} className="w-full bg-zinc-950 border-2 border-zinc-800 text-white p-3 text-xs outline-none focus:border-yellow-500" />
                     </div>
                     <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">Description</label>
                        <textarea value={editRoomForm.description} onChange={e => setEditRoomForm(p => ({...p, description: e.target.value}))} className="w-full bg-zinc-950 border-2 border-zinc-800 text-white p-3 text-xs outline-none focus:border-yellow-500 resize-none h-24" />
                     </div>
                     <div>
                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">Room rules</label>
                        <textarea value={editRoomForm.rules} onChange={e => setEditRoomForm(p => ({...p, rules: e.target.value}))} className="w-full bg-zinc-950 border-2 border-zinc-800 text-white p-3 text-xs outline-none focus:border-yellow-500 resize-none h-20" />
                     </div>
                     <div className="grid grid-cols-2 gap-3">
                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                           Content mode
                           <select value={editRoomForm.content_mode} onChange={e => setEditRoomForm(p => ({...p, content_mode: e.target.value}))} className="mt-2 w-full bg-zinc-950 border-2 border-zinc-800 text-white p-3 text-xs">
                              <option value="general">General</option>
                              <option value="mature">Mature (18+)</option>
                           </select>
                        </label>
                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                           Slow mode (seconds)
                           <input type="number" min="0" max="300" value={editRoomForm.slow_mode_seconds} onChange={e => setEditRoomForm(p => ({...p, slow_mode_seconds: e.target.value}))} className="mt-2 w-full bg-zinc-950 border-2 border-zinc-800 text-white p-3 text-xs" />
                        </label>
                     </div>
                     <div className="grid grid-cols-2 gap-3 text-[10px] font-black uppercase tracking-widest text-zinc-400">
                        {[
                          ['allow_media', 'Allow media'],
                          ['allow_links', 'Allow links'],
                          ['is_read_only', 'Moderator-only posting'],
                        ].map(([key, label]) => (
                          <label key={key} className="flex items-center gap-2 border-2 border-zinc-800 bg-zinc-950 p-3">
                            <input type="checkbox" checked={Boolean(editRoomForm[key])} onChange={e => setEditRoomForm(p => ({...p, [key]: e.target.checked}))} className="accent-yellow-500" />
                            {label}
                          </label>
                        ))}
                     </div>
                     <button onClick={handleUpdateRoomDetails} className="w-full py-3 bg-yellow-500 text-black font-black uppercase tracking-widest text-[10px] border-2 border-yellow-500 hover:bg-yellow-400 mt-2">
                        <Edit3 className="w-4 h-4 inline mr-2" /> Save Changes
                     </button>
                  </div>
               ) : (
                  <>
                     <div className="bg-zinc-950 p-4 border-2 border-zinc-800">
                        <h3 className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Shareable Invite Link</h3>
                        <div className="flex items-center gap-2">
                           <input type="text" readOnly value={roomAdminData.inviteLink || 'Generating link...'} className="flex-1 bg-black border-2 border-zinc-800 px-3 py-2 text-xs text-white font-bold outline-none" />
                           <button onClick={copyInviteLink} className="px-4 py-2 bg-white text-black font-black uppercase text-[10px] border-2 border-white hover:bg-zinc-200">
                           {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                           </button>
                        </div>
                     </div>

                     <div>
                        <h3 className="text-[10px] font-black text-white uppercase tracking-widest mb-3 flex items-center gap-2">
                           <UserCheck className="w-4 h-4 text-blue-400" /> Pending Join Requests ({roomAdminData.pendingCount || 0})
                        </h3>
                        {!joinRequests.length ? (
                           <p className="text-[10px] text-zinc-500 uppercase tracking-widest p-4 border-2 border-dashed border-zinc-800 text-center">No pending requests.</p>
                        ) : (
                           <div className="space-y-2">
                              {joinRequests.map((request) => (
                                <div key={request.id} className="flex items-center justify-between gap-3 border-2 border-zinc-800 bg-zinc-950 p-3">
                                  <div className="flex items-center gap-3 min-w-0">
                                    {request.avatar && <img src={request.avatar} alt="" className="w-9 h-9 object-cover border border-zinc-700" />}
                                    <span className="truncate text-[10px] font-black uppercase tracking-widest text-white">{request.user_name}</span>
                                  </div>
                                  <div className="flex gap-2 shrink-0">
                                    <button onClick={() => handleJoinRequest(request.user_id, true)} className="px-3 py-2 bg-yellow-500 text-black text-[9px] font-black uppercase">Approve</button>
                                    <button onClick={() => handleJoinRequest(request.user_id, false)} className="px-3 py-2 border border-zinc-700 text-zinc-300 text-[9px] font-black uppercase">Decline</button>
                                  </div>
                                </div>
                              ))}
                           </div>
                        )}
                     </div>
                  </>
               )}
            </div>
          </div>
        </div>
      )}

      {showShareModal && roomAdminData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowShareModal(false)} />
          <div className="relative w-full max-w-sm bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] flex flex-col z-10 p-6 text-center">
            <h3 className="text-sm font-black text-white uppercase tracking-widest mb-2">Invite Friends</h3>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-6">Share this room code or link with other members.</p>
            
            <div className="bg-zinc-950 p-4 border-2 border-zinc-800 mb-6">
              <span className="text-2xl font-black text-white tracking-widest">{roomAdminData.roomCode || selectedRoom.roomCode || 'ROOM-CODE'}</span>
            </div>

            <button onClick={copyInviteLink} className="w-full py-3 bg-white text-black font-black uppercase tracking-widest text-[10px] border-2 border-white hover:bg-zinc-200 flex items-center justify-center gap-2">
              <Copy className="w-4 h-4" /> Copy Invite Link
            </button>
          </div>
        </div>
      )}

      {incomingCallData && !isInPrivateCall && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 bg-black border-2 border-white shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 1)]">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 border-2 border-white flex items-center justify-center text-xl font-black text-white bg-zinc-900">
                {(incomingCallData.fromName || 'C').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="text-sm font-black uppercase tracking-widest text-white">Incoming {incomingCallData.mode === 'video' ? 'Video' : 'Audio'} Call</div>
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{incomingCallData.fromName}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => rejectPrivateCall()} className="px-4 py-2 border-2 border-red-500 text-red-500 font-black text-[10px] uppercase hover:bg-red-500 hover:text-black">Decline</button>
                <button onClick={() => acceptPrivateCall()} className="px-4 py-2 border-2 border-green-500 bg-green-500 text-black font-black text-[10px] uppercase hover:bg-black hover:text-green-500">Answer</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isInPrivateCall && privateCallToken && (
        <div className="absolute inset-0 z-[90] flex flex-col bg-zinc-950">
          <LiveKitRoom
            serverUrl={LIVEKIT_URL}
            token={privateCallToken}
            connect={true}
            audio={true}
            video={privateCallMode === 'video'}
            className="flex-1 flex flex-col"
          >
            <RoomAudioRenderer />
            <div className="flex-1 flex items-center justify-center p-6 text-zinc-500 font-black text-sm uppercase tracking-widest">
              [PRIVATE {privateCallMode.toUpperCase()} CALL ACTIVE]
            </div>
            <div className="p-8 pb-12 flex items-center justify-center gap-6 bg-black border-t-2 border-zinc-800">
              <TrackToggle source={Track.Source.Microphone} className="w-14 h-14 rounded-full flex items-center justify-center border-2 border-white text-white" />
              {privateCallMode === 'video' && <TrackToggle source={Track.Source.Camera} className="w-14 h-14 rounded-full flex items-center justify-center border-2 border-white text-white" />}
              <button onClick={endPrivateCall} className="px-6 py-4 border-2 border-red-500 bg-red-500 text-black font-black uppercase text-[10px] flex items-center gap-2">
                <PhoneOff className="w-5 h-5" /> End Call
              </button>
            </div>
          </LiveKitRoom>
        </div>
      )}

      {showSidebar && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-30 lg:hidden" onClick={() => setShowSidebar(false)} />
      )}

      <aside className={`fixed inset-y-0 right-0 z-40 flex w-[min(85vw,22rem)] flex-col border-l-2 border-zinc-800 bg-black transform transition-transform duration-300 ease-in-out lg:relative lg:inset-auto lg:translate-x-0 lg:z-10 lg:w-[clamp(14rem,22vw,20rem)] lg:shrink-0 ${showSidebar ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-4 border-b-2 border-zinc-800 flex items-center justify-between shrink-0 bg-zinc-950">
          <div>
            <h3 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
              <Users className="w-4 h-4 text-zinc-400" /> People
            </h3>
            <p className="mt-1 pl-6 text-[9px] font-bold uppercase tracking-widest text-zinc-500">{onlineCount} online in this room</p>
          </div>
          <button onClick={() => setShowSidebar(false)} className="lg:hidden text-zinc-500 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
          {!canViewFullProfiles && (
            <div className="p-3 border-2 border-yellow-500/30 bg-yellow-500/5 mb-4 flex items-start gap-3">
              <Lock className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-400 leading-relaxed">
                Profile details are hidden. Upgrade to Premium to see full participant info.
              </p>
            </div>
          )}

          <div>
            <h4 className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-3">ONLINE NOW</h4>
            {isLoadingParticipants && (
              <div className="mb-3 flex items-center gap-2 text-zinc-600">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-[9px] font-bold uppercase tracking-widest">Syncing participants...</span>
              </div>
            )}
            <div className="space-y-2">
              {participantsForSidebar.filter(p => (p.status || '').toLowerCase() === 'online').map(user => (
                <button 
                  key={user.id}
                  onClick={() => setSelectedProfile(user)}
                  className="w-full flex items-center gap-3 p-2 bg-black border-2 border-transparent hover:border-zinc-800 hover:bg-zinc-950 transition-colors text-left group relative overflow-hidden"
                >
                  <div className="relative shrink-0">
                    <img src={user.avatar} alt="avatar" className={`w-10 h-10 object-cover border-2 transition-colors ${canViewFullProfiles ? 'grayscale border-zinc-800 group-hover:border-zinc-600' : 'blur-[3px] border-zinc-900 opacity-50'}`} />
                    <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-green-500 border border-black"></span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h5 className="text-[10px] font-black text-zinc-400 group-hover:text-white uppercase tracking-widest truncate transition-colors">
                      {maskName(user.name)}
                    </h5>
                    {getRoomRoleLabel(user.role) && (
                      <span className={`mt-1 inline-block border px-1.5 py-0.5 text-[7px] font-black tracking-widest ${
                        user.role === 'creator' ? 'border-yellow-500/50 text-yellow-400' : 'border-sky-500/40 text-sky-300'
                      }`}>
                        {getRoomRoleLabel(user.role)}
                      </span>
                    )}
                  </div>
                  {!canViewFullProfiles && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Lock className="w-3 h-3 text-zinc-600" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {selectedProfile && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-end">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedProfile(null)} />
          
          <div className="relative flex h-[85dvh] w-full flex-col border-t-2 border-zinc-800 bg-black shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] animate-in slide-in-from-bottom-full duration-300 md:h-full md:w-[clamp(22rem,36vw,30rem)] md:border-l-2 md:border-t-0 md:slide-in-from-right-full">
            
            <div className="relative aspect-[2/1] max-h-[35dvh] shrink-0 overflow-hidden border-b-2 border-zinc-800 bg-zinc-950">
              <img src={selectedProfile.avatar} alt="cover" className={`w-full h-full object-cover opacity-60 transition-all ${canViewFullProfiles ? 'grayscale' : 'blur-xl scale-110'}`} />
              
              <button onClick={() => setSelectedProfile(null)} className="absolute top-4 right-4 p-2 bg-black border-2 border-zinc-800 hover:bg-zinc-900 text-white transition-colors z-10">
                <X className="w-4 h-4" />
              </button>
              
              <div className="absolute bottom-4 left-6 bg-black/80 p-2 border-2 border-zinc-800">
                <h2 className="text-lg font-black text-white uppercase tracking-widest">{maskName(selectedProfile.name)}, {canViewFullProfiles ? selectedProfile.age || '24' : '??'}</h2>
                <div className="flex items-center gap-1.5 text-[9px] font-black text-zinc-400 uppercase tracking-widest mt-1">
                  <MapPin className="w-3 h-3 text-zinc-500" /> {canViewFullProfiles ? selectedProfile.location || 'Unknown' : '[LOCATION HIDDEN]'}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
              {!canViewFullProfiles ? (
                <div className="flex flex-col items-center justify-center p-8 bg-zinc-950 border-2 border-dashed border-zinc-800 text-center h-full">
                  <Lock className="w-12 h-12 text-zinc-700 mb-4" />
                  <h3 className="text-[10px] font-black text-white uppercase tracking-widest mb-2">PREMIUM CONTENT</h3>
                  <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-relaxed mb-6">
                    Detailed profiles, bios, and match percentages are hidden for basic users.
                  </p>
                  <button className="px-6 py-3 bg-white text-black border-2 border-white text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 transition-colors w-full">
                    Upgrade to Unlock
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 p-3 bg-black border-2 border-green-500 text-green-500">
                    <Star className="w-4 h-4" />
                    <p className="text-[10px] font-black uppercase tracking-widest">YOU ARE A {selectedProfile.matchPct || 85}% MATCH.</p>
                  </div>
                  <div className="bg-zinc-950 p-4 border-2 border-zinc-800">
                    <h3 className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-3">ABOUT</h3>
                    <p className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest leading-relaxed">{selectedProfile.bio || 'No bio provided.'}</p>
                  </div>
                  <div className="pt-4 space-y-3">
                    <button onClick={() => { toast.success(t('inviteSent', { name: selectedProfile.name })); setSelectedProfile(null); }} className="w-full py-3 bg-white hover:bg-zinc-200 text-black text-[10px] font-black uppercase tracking-widest border-2 border-white transition-colors flex items-center justify-center gap-2">
                      <Heart className="w-4 h-4" /> INVITE TO PRIVATE CHAT
                    </button>
                    
                    {/* MODERATION TOOLS FOR ROOM ADMINS ONLY */}
                    {canModerateRoom && selectedProfile.id !== currentUser.id && (
                       <div className="flex gap-2 w-full pt-4 border-t-2 border-zinc-800">
                        {!['creator', 'admin', 'moderator'].includes(selectedProfile.role) && (
                          <button onClick={() => handleMuteMember(selectedProfile, !selectedProfile.is_muted)} className="flex-1 py-3 bg-black text-blue-400 hover:bg-zinc-900 border-2 border-transparent hover:border-blue-900 text-[10px] font-black uppercase tracking-widest transition-colors">
                            {selectedProfile.is_muted ? 'Unmute' : 'Mute'}
                          </button>
                        )}
                        {roomAdminData?.userRole === 'creator' && !['creator', 'admin'].includes(selectedProfile.role) && (
                          <button onClick={() => handleSetMemberRole(selectedProfile, selectedProfile.role === 'moderator' ? 'member' : 'moderator')} className="flex-1 py-3 bg-black text-sky-300 hover:bg-zinc-900 border-2 border-transparent hover:border-sky-900 text-[10px] font-black uppercase tracking-widest transition-colors">
                            {selectedProfile.role === 'moderator' ? 'Remove moderator' : 'Make moderator'}
                          </button>
                        )}
                        {roomAdminData?.userRole === 'creator' && selectedProfile.role !== 'creator' && (
                          <button onClick={() => handleSetMemberRole(selectedProfile, selectedProfile.role === 'admin' ? 'member' : 'admin')} className="flex-1 py-3 bg-black text-white hover:bg-zinc-900 border-2 border-transparent hover:border-zinc-600 text-[10px] font-black uppercase tracking-widest transition-colors">
                            {selectedProfile.role === 'admin' ? 'Remove admin' : 'Make admin'}
                          </button>
                        )}
                        <button onClick={() => handleModerateUser(selectedProfile.id, false)} className="flex-1 py-3 bg-black text-yellow-500 hover:bg-zinc-900 border-2 border-transparent hover:border-yellow-900 text-[10px] font-black uppercase tracking-widest transition-colors flex items-center justify-center">
                            Kick User
                         </button>
                         <button onClick={() => handleModerateUser(selectedProfile.id, true)} className="flex-1 py-3 bg-black text-red-500 hover:bg-zinc-900 border-2 border-transparent hover:border-red-900 text-[10px] font-black uppercase tracking-widest transition-colors flex items-center justify-center">
                            Ban User
                         </button>
                       </div>
                    )}
                    
                    {!canModerateRoom && (
                       <button onClick={() => { toast('SYS: RECORD REPORTED.'); setSelectedProfile(null); }} className="w-full py-3 bg-black text-red-500 hover:bg-zinc-900 border-2 border-transparent hover:border-red-900 text-[10px] font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2">
                         <ShieldAlert className="w-4 h-4" /> REPORT USER
                       </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* REAL MEDIA VAULT MODAL */}
      {showMediaVault && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowMediaVault(false)} />
          
          <div className="relative flex h-[80dvh] min-h-0 w-full max-w-2xl flex-col border-2 border-zinc-600 bg-black shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center shrink-0">
              <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-zinc-400" /> YOUR MEDIA VAULT
              </h2>
              <button onClick={() => setShowMediaVault(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-6">Select an image to attach to your message.</p>
              
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <input 
                  type="file" 
                  accept="image/*" 
                  ref={fileInputRef} 
                  className="hidden" 
                  onChange={handleUploadMedia} 
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square bg-zinc-950 border-2 border-dashed border-zinc-700 flex flex-col items-center justify-center gap-2 hover:bg-zinc-900 hover:border-zinc-500 transition-colors text-zinc-500 hover:text-white group"
                >
                  <Upload className="w-8 h-8 group-hover:scale-110 transition-transform" />
                  <span className="text-[9px] font-black uppercase tracking-widest">UPLOAD NEW</span>
                </button>

                {isLoadingVault ? (
                  <div className="col-span-full flex items-center justify-center py-10">
                    <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
                  </div>
                ) : vaultImages.map((mediaObj) => (
                  <button 
                    key={mediaObj.id}
                    onClick={() => { setAttachedMedia(mediaObj.url); setShowMediaVault(false); }}
                    className="aspect-square bg-zinc-950 border-2 border-zinc-800 hover:border-white transition-all overflow-hidden group relative"
                  >
                    <img src={mediaObj.url} alt="vault item" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-[10px] font-black text-white uppercase tracking-widest border-2 border-white px-3 py-1">SELECT</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}