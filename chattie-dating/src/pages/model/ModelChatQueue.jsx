import React, { lazy, Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  X, MessageSquare, Activity, ArrowLeft, Send, Image as ImageIcon, Video,
  Sparkles, Loader2, RefreshCw, Smile, Phone, PhoneOff, Pin, PinOff, Ban, Flag
} from 'lucide-react';
import { toast } from 'sonner';
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
import { creatorService } from '../../api/creator.service';
import { chatService } from '../../api/chat.service'; 
import { apiClient } from '../../api/client';
import { useI18n } from '../../i18n';
import { useAppDialogs } from '../../components/modals/useAppDialogs';
const EmojiPicker = lazy(() => import('emoji-picker-react'));

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || "ws://localhost:7880";

const getWsUrl = (query) => {
  if (import.meta.env.VITE_WS_URL) return `${import.meta.env.VITE_WS_URL}${query}`;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'localhost:8080'
    : window.location.host;
  return `${protocol}//${host}/ws${query}`;
};

// ============================================================================
// COMPONENT: MODEL CHAT QUEUE
// ============================================================================
export default function ModelChatQueue() {
  const {
    activeProfileId,
    activeProfile = { id: '', name: 'Select Profile' },
    modelSettings = { ai_drafts_enabled: false },
  } = useOutletContext();
  const { t } = useI18n();
  const translateRef = useRef(t);
  translateRef.current = t;

  const [masterQueue, setMasterQueue] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const queueRequestRef = useRef(0);

  const [activeChatRoom, setActiveChatRoom] = useState(null);

  const fetchQueue = useCallback(async (isManual = false) => {
    if (!activeProfileId) {
      setMasterQueue([]);
      setIsLoading(false);
      return;
    }
    const requestId = ++queueRequestRef.current;

    if (isManual) setIsRefreshing(true);
    
    try {
      const data = await creatorService.getProfileConversations(activeProfileId);
      if (requestId !== queueRequestRef.current) return;
      const queueList = (Array.isArray(data) ? data : []).map((conversation) => ({
        id: conversation.partner_id,
        client_id: conversation.partner_id,
        user: conversation.partner_name || 'Unknown user',
        avatar: conversation.avatar_url || '',
        status: 'ACTIVE',
        unreadCount: Number(conversation.unread_count || 0),
        lastMessage: conversation.last_message || '',
        lastMessageTime: conversation.last_message_time,
        timeAdded: conversation.last_message_time,
      }));
      setMasterQueue((current) => {
        if (current.length !== queueList.length) return queueList;
        const currentById = new Map(current.map((item) => [item.id, item]));
        const unchanged = queueList.every((item) => {
          const previous = currentById.get(item.id);
          return previous &&
            previous.user === item.user &&
            previous.avatar === item.avatar &&
            previous.unreadCount === item.unreadCount &&
            previous.lastMessage === item.lastMessage &&
            previous.lastMessageTime === item.lastMessageTime;
        });
        return unchanged ? current : queueList;
      });
      
      if (isManual) toast.success(translateRef.current('queueRefreshed'));
    } catch (error) {
      if (requestId !== queueRequestRef.current) return;
      console.error("Queue fetch error:", error);
      toast.error(isManual ? translateRef.current('queueRefreshFailed') : translateRef.current('coreUiProfileInboxLoadFailed'));
    } finally {
      if (requestId === queueRequestRef.current) {
        setIsLoading(false);
        if (isManual) setIsRefreshing(false);
      }
    }
  }, [activeProfileId]);

  useEffect(() => {
    if (!activeProfileId) {
      setMasterQueue([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetchQueue(); 
    
    const pollTimer = setInterval(() => {
      fetchQueue(false);
    }, 15000);
    
    return () => {
      queueRequestRef.current += 1;
      clearInterval(pollTimer);
    };
  }, [activeProfileId, fetchQueue]);

  const filteredQueue = useMemo(() => {
    let q = [...masterQueue];
    if (activeFilter === 'UNREAD') q = q.filter((conversation) => conversation.unreadCount > 0);
    return q.sort((a, b) => new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0));
  }, [masterQueue, activeFilter]);
  
  useEffect(() => {
    setActiveChatRoom(null);
    setActiveFilter('ALL');
  }, [activeProfileId]);

  if (activeChatRoom) {
    return (
      <LiveChatInterface 
        chatData={activeChatRoom} 
        activeProfileId={activeProfileId}
        onBack={() => setActiveChatRoom(null)} 
        onEnd={() => setActiveChatRoom(null)}
        onBlocked={() => {
          setMasterQueue((previous) => previous.filter((item) => item.id !== activeChatRoom.id));
          setActiveChatRoom(null);
        }}
        modelName={activeProfile.name}
        profileChatUserId={activeProfile.chat_user_id || activeProfileId}
        aiDraftsEnabled={modelSettings.ai_drafts_enabled === true}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="chat-theme-sharp flex h-full min-h-0 min-w-0 flex-1 items-center justify-center bg-black text-zinc-300">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="chat-theme-sharp flex h-full min-h-0 min-w-0 flex-col text-zinc-300 font-mono" style={{ backgroundColor: 'var(--app-bg)', color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      <div className="border-b p-3 md:p-4 shrink-0" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))', color: 'var(--text-on-accent)' }}>
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-[0.22em]" style={{ color: 'var(--text-muted)' }}>{t('coreUiProfileInbox')}</p>
              <h1 className="text-xl md:text-2xl font-black uppercase tracking-[0.18em]" style={{ color: 'var(--text-primary)' }}>{activeProfile.name}</h1>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-3">
            <div className="flex items-center gap-2 rounded-full border px-3 py-1.5" style={{ background: 'rgba(var(--success-rgb), 0.08)', borderColor: 'rgba(var(--success-rgb), 0.35)', color: 'var(--success)' }}>
              <span className="inline-block h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--success)' }} />
              <span className="text-[9px] font-black uppercase tracking-[0.18em]">{t('coreUiSyncLive')}</span>
            </div>
            <button
              onClick={() => fetchQueue(true)}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] border transition-all disabled:opacity-50"
              style={{ borderColor: 'var(--border)', background: 'rgba(var(--highlight-rgb), 0.02)', color: 'var(--text-primary)' }}
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b p-2 sm:p-3 lg:p-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="border p-3" style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)' }}>
            <p className="text-[9px] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>{t('coreUiConversations')}</p>
            <p className="mt-2 text-2xl font-black" style={{ color: 'var(--text-primary)' }}>{masterQueue.length}</p>
          </div>
          <div className="border p-3" style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)' }}>
            <p className="text-[9px] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>{t('coreUiUnreadMessages')}</p>
            <p className="mt-2 text-2xl font-black" style={{ color: 'var(--text-primary)' }}>{masterQueue.reduce((count, item) => count + item.unreadCount, 0)}</p>
          </div>
          <div className="border p-3" style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)' }}>
            <p className="text-[9px] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>{t('coreUiSelectedProfile')}</p>
            <p className="mt-2 text-lg font-black truncate" style={{ color: 'var(--text-primary)' }}>{activeProfile.name}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {['ALL', 'UNREAD'].map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className="px-3 py-2 text-[9px] font-black uppercase tracking-[0.18em] border transition-all"
              style={{
                backgroundColor: activeFilter === f ? 'var(--accent)' : 'var(--surface-strong)',
                color: activeFilter === f ? 'var(--text-on-accent)' : 'var(--text-primary)',
                borderColor: activeFilter === f ? 'var(--accent)' : 'var(--border)'
              }}
            >
              {f === 'UNREAD' ? `Unread (${masterQueue.reduce((count, item) => count + (item.unreadCount > 0 ? 1 : 0), 0)})` : 'All conversations'}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-2 sm:p-3 lg:p-4">
        <div className="w-full space-y-3">
          {filteredQueue.length === 0 ? (
            <div className="p-16 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center text-center" style={{ borderColor: 'var(--border)', background: 'rgba(var(--highlight-rgb), 0.02)' }}>
              <Activity className="w-12 h-12 mb-4" style={{ color: 'var(--text-muted)' }} />
              <h3 className="text-xl font-black uppercase tracking-[0.18em]" style={{ color: 'var(--text-primary)' }}>
                {activeFilter === 'UNREAD' ? 'You are all caught up' : 'No conversations yet'}
              </h3>
              <p className="mt-2 text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
                {activeFilter === 'UNREAD' ? 'Unread messages will appear here' : `Messages sent to ${activeProfile.name} will appear here`}
              </p>
            </div>
          ) : (
            filteredQueue.map((req) => {
              return (
                <div
                  key={req.id}
                  className="border overflow-hidden transition-colors hover:border-white/30"
                  style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)' }}
                >
                  <button
                    onClick={() => setActiveChatRoom({
                      id: req.client_id,
                      user_id: req.client_id,
                      type: 'dm',
                      name: req.user,
                      user: req.user,
                      avatar: req.avatar,
                      unreadCount: req.unreadCount,
                    })}
                    className="w-full p-4 flex items-center gap-4 text-left"
                  >
                    {req.avatar ? (
                      <img src={req.avatar} alt="" className="w-14 h-14 object-cover border" style={{ borderColor: 'var(--border)' }} />
                    ) : (
                      <span className="w-14 h-14 flex items-center justify-center border text-lg font-black" style={{ background: 'rgba(var(--highlight-rgb), 0.03)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                        {req.user.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-black uppercase tracking-[0.12em] truncate" style={{ color: 'var(--text-primary)' }}>{req.user}</span>
                        <span className="text-[9px] shrink-0" style={{ color: 'var(--text-muted)' }}>
                          {req.lastMessageTime ? new Date(req.lastMessageTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : ''}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-3">
                        <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>{req.lastMessage || 'Open conversation'}</span>
                        {req.unreadCount > 0 && (
                          <span className="min-w-5 h-5 px-1 flex items-center justify-center text-[10px] font-black" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>
                            {req.unreadCount > 99 ? '99+' : req.unreadCount}
                          </span>
                        )}
                      </span>
                    </span>
                    <MessageSquare className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SUB-COMPONENT: FULL FEATURED LIVE CHAT INTERFACE WITH WEBRTC CALLS
// ==========================================
function LiveChatInterface({ chatData, activeProfileId, profileChatUserId, onBack, onEnd, onBlocked, modelName, aiDraftsEnabled }) {
  const { confirm, prompt } = useAppDialogs();
  const { t } = useI18n();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [isGeneratingAISuggestions, setIsGeneratingAISuggestions] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isChatConnected, setIsChatConnected] = useState(false);
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const [outgoingCallData, setOutgoingCallData] = useState(null);
  const [pinningMessageId, setPinningMessageId] = useState(null);
  const [isModerating, setIsModerating] = useState(false);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const typingTimeoutRef = useRef(null);
  const stopTypingTimeoutRef = useRef(null);
  const lastTypingSentAtRef = useRef(0);
  const outgoingCallRef = useRef(null);
  const callTimeoutRef = useRef(null);
  const callActionRef = useRef(false);
  const callHistoryEventsRef = useRef(new Set());
  const processedCallSignalsRef = useRef(new Set());
  const callSignalHandlerRef = useRef(null);
  const activeCallRoomRef = useRef('');
  const activeCallPeerRef = useRef('');
  
  // TEXTING & MEDIA VAULT STATES
  const [showMediaVault, setShowMediaVault] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [attachedMedia, setAttachedMedia] = useState(null);
  const [vaultImages, setVaultImages] = useState([]);
  const [isLoadingVault, setIsLoadingVault] = useState(false);

  // --- CALL / WEBRTC STATE ---
  const [callToken, setCallToken] = useState("");
  const [isInCall, setIsInCall] = useState(false);
  const [isConnectingCall, setIsConnectingCall] = useState(false);
  const [callMode, setCallMode] = useState('video');
  const [callStartedAt, setCallStartedAt] = useState(null);
  const [callElapsedSec, setCallElapsedSec] = useState(0);
  const [incomingCallData, setIncomingCallData] = useState(null);
  const [localStream, setLocalStream] = useState(null); // <-- Added Local Stream State
  
  const notificationSocketRef = useRef(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const ringtoneCtxRef = useRef(null);
  const ringtonePlayingRef = useRef(false);
  const audioCtxRef = useRef(null);
  const ringtoneProfile = 'sweet';
  const micGain = 1.0;
  const [micEnabled, setMicEnabled] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const micGainRef = useRef(micGain);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);

  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);

  const theme = useAppStore((state) => state.userPreferences.theme);
  const appToken = useAppStore((state) => state.token);
  
  // CRITICAL FIX: Ensure we use target client id, not queue item id
  const roomId = chatData.user_id || chatData.id || "";
  const chatPartnerName = chatData.user || chatData.name || 'Member';

  useEffect(() => {
    setAvatarFailed(false);
  }, [chatData.avatar]);

  const smartSuggestions = [
    "Hi, how is your day going?",
    "What would you like to chat about?",
    "Would you like to have a quick call?"
  ];

  const generateAISuggestions = async () => {
    if (!aiDraftsEnabled || isGeneratingAISuggestions) return;
    setIsGeneratingAISuggestions(true);
    setAiSuggestions([]);
    try {
      const result = await creatorService.generateModelReplySuggestions(activeProfileId, roomId);
      if (!Array.isArray(result?.suggestions) || result.suggestions.length !== 3) {
        throw new Error('The AI assistant returned invalid reply drafts.');
      }
      setAiSuggestions(result.suggestions);
    } catch (error) {
      console.error('Failed to generate model chat reply drafts:', error);
      const detail = error.response?.data?.error || error.response?.data;
      toast.error(typeof detail === 'string' ? detail : t('coreUiAiDraftGenerationFailed'));
    } finally {
      setIsGeneratingAISuggestions(false);
    }
  };

  // Auto-publish microphone helper component
  function AutoPublishMic() {
    const { localParticipant } = useLocalParticipant();
    const publishedRef = useRef(null);
    const srcStreamRef = useRef(null);
    const gainNodeRef = useRef(null);

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
        try {
          if (publishedRef.current && localParticipant.unpublishTrack) {
            localParticipant.unpublishTrack(publishedRef.current.localAudioTrack).catch(() => {});
          }
        } catch (e) {}
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

    return null;
  }

  // --- FETCH CHAT HISTORY ---
  useEffect(() => {
    const loadHistory = async () => {
      if (!roomId || !activeProfileId) {
        setMessages([]);
        setIsLoadingHistory(false);
        return;
      }
      setIsLoadingHistory(true);
      setMessages([]);
      try {
        const history = await creatorService.getProfileChatHistory(activeProfileId, roomId);
        if (Array.isArray(history) && history.length > 0) {
          const formatted = history
            .filter(msg => msg.message_kind !== 'typing' && msg.message_kind !== 'stop_typing')
            .map(msg => ({
            id: msg.id || msg.message_id || `history-${Date.now()}-${Math.random()}`,
            sender: msg.message_kind === 'call_event' ? 'system' :
              String(msg.sender_id || msg.senderId) === String(profileChatUserId) ? 'model' : 'user',
            text: msg.content || msg.text || '',
            media: msg.media || null,
            isPinned: Boolean(msg.is_pinned || msg.isPinned),
            flagged: Boolean(msg.is_flagged || msg.isFlagged),
            messageKind: msg.message_kind || msg.messageKind || 'chat',
            time: msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'
          }));
          setMessages(formatted);
        }
      } catch (err) {
        console.error("Failed to load chat history:", err);
      } finally {
        setIsLoadingHistory(false);
      }
    };
    loadHistory();
  }, [roomId, activeProfileId, profileChatUserId]);

  // --- FETCH PROFILE-SPECIFIC MEDIA VAULT ---
  useEffect(() => {
    const fetchProfileVault = async () => {
      if (!showMediaVault || !activeProfileId) return;
      setIsLoadingVault(true);
      try {
        const res = await apiClient.get(`/creator/profiles/${activeProfileId}/media`);
        setVaultImages(res.data || []);
      } catch (err) {
        console.error("Failed to fetch profile media vault", err);
      } finally {
        setIsLoadingVault(false);
      }
    };
    fetchProfileVault();
  }, [showMediaVault, activeProfileId]);

  // --- WEBSOCKET CONNECTION SETUP ---
  useEffect(() => {
    let token = '';
    try {
      const storedData = localStorage.getItem('chattie-session-storage');
      if (storedData) {
        const parsed = JSON.parse(storedData);
        token = parsed?.state?.token || '';
      }
    } catch (err) {}
    if (!token) token = localStorage.getItem('token') || '';
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;

    if (!roomId || !activeProfileId) return undefined;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setIsPartnerTyping(false);
    const query = `?target_id=${encodeURIComponent(roomId)}&profile_id=${encodeURIComponent(activeProfileId)}&token=${encodeURIComponent(cleanToken)}`;
    const wsUrl = getWsUrl(query);
    
    let manuallyClosed = false;
    const connect = () => {
      if (manuallyClosed) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setIsChatConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const incomingMsg = JSON.parse(event.data);

        if (incomingMsg.type === 'typing' || incomingMsg.type === 'stop_typing'
          || incomingMsg.message_kind === 'typing' || incomingMsg.message_kind === 'stop_typing') {
          if (String(incomingMsg.sender_id || incomingMsg.from) === String(roomId)) {
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            if (incomingMsg.type === 'stop_typing') {
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

        if (['incoming_call', 'call_answered', 'call_rejected', 'call_cancelled', 'call_ended'].includes(incomingMsg.type)) {
          callSignalHandlerRef.current?.(incomingMsg);
          return;
        }

        if (incomingMsg.type === 'pin_update') {
          setMessages((previous) => previous.map((message) => message.id === incomingMsg.message_id
            ? { ...message, isPinned: Boolean(incomingMsg.is_pinned) }
            : message));
          return;
        }

        if (incomingMsg.type && incomingMsg.type !== 'chat') return;
        if (incomingMsg.message_kind && !['chat', 'call_event'].includes(incomingMsg.message_kind)) return;
        if (!incomingMsg.content && !incomingMsg.text && !incomingMsg.media && !incomingMsg.media_url) return;

        const msgId = incomingMsg.id || incomingMsg.message_id || `msg-${Date.now()}-${Math.random()}`;
        const clientMessageId = incomingMsg.client_message_id;
        setMessages(prev => {
          if (prev.some(m => m.id === msgId)) return prev;
          const optimisticIndex = clientMessageId
            ? prev.findIndex((message) => message.id === clientMessageId)
            : -1;
          const message = {
            id: msgId,
            sender: incomingMsg.message_kind === 'call_event' ? 'system' :
              String(incomingMsg.sender_id || incomingMsg.senderId) === String(profileChatUserId) ? 'model' : 'user',
            text: incomingMsg.text || incomingMsg.content || '',
            media: incomingMsg.media || incomingMsg.media_url || null,
            isPinned: Boolean(incomingMsg.is_pinned || incomingMsg.isPinned),
            flagged: Boolean(incomingMsg.is_flagged || incomingMsg.isFlagged),
            messageKind: incomingMsg.message_kind || incomingMsg.messageKind || 'chat',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          if (optimisticIndex >= 0) {
            const next = [...prev];
            next[optimisticIndex] = { ...next[optimisticIndex], ...message };
            return next;
          }
          return [
            ...prev,
            message
          ];
        });
        } catch (err) {}
      };

      ws.onclose = () => {
        setIsChatConnected(false);
        if (manuallyClosed) return;
        const attempt = reconnectAttemptsRef.current++;
        const delay = Math.min(30000, Math.max(1000, 2 ** attempt * 500));
        reconnectTimerRef.current = setTimeout(connect, delay);
      };
      ws.onerror = () => setIsChatConnected(false);
    };

    connect();

    return () => {
      manuallyClosed = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
      typingTimeoutRef.current = null;
      stopTypingTimeoutRef.current = null;
      setIsPartnerTyping(false);
      setIsChatConnected(false);
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
    };
  }, [roomId, activeProfileId, profileChatUserId]);

  // Global notification socket for calls
  useEffect(() => {
    let activeToken = appToken;
    if (!activeToken) {
      try {
        const stored = localStorage.getItem('chattie-session-storage');
        if (stored) activeToken = JSON.parse(stored)?.state?.token || '';
      } catch (e) {}
    }
    if (!activeToken) return;

    const cleanToken = activeToken.startsWith('Bearer ') ? activeToken.slice(7) : activeToken;
    const notifyUrl = getWsUrl(`?token=${encodeURIComponent(cleanToken)}`);

    try {
      const nws = new WebSocket(notifyUrl);
      notificationSocketRef.current = nws;

      nws.onmessage = (ev) => {
        try {
          const incoming = JSON.parse(ev.data);
          if (['incoming_call', 'call_answered', 'call_rejected', 'call_cancelled', 'call_ended'].includes(incoming.type)) {
            callSignalHandlerRef.current?.(incoming);
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
  }, [incomingCallData]);

  useEffect(() => {
    if (isInCall) {
      stopRingtone();
      setIncomingCallData(null);
    }
  }, [isInCall]);

  // --- CALL HANDLERS ---
  const sendCallSignal = (payload) => {
    const socket = [wsRef.current, notificationSocketRef.current]
      .find(candidate => candidate?.readyState === WebSocket.OPEN);
    if (!socket) throw new Error('Call signaling is not connected');
    socket.send(JSON.stringify(payload));
  };

  const clearCallTimeout = () => {
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  };

  const clearLocalStream = () => {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    setLocalStream(null);
  };

  const startCall = async (mode = 'video') => {
    if (callActionRef.current || isInCall || outgoingCallRef.current || incomingCallData) return;
    callActionRef.current = true;
    callHistoryEventsRef.current.clear();
    setCallMode(mode);
    setIsConnectingCall(true);
    try {
      if (mode === 'video' && navigator?.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          setLocalStream(stream);
        } catch (err) {
          console.warn('Camera permission not granted:', err);
        }
      }

      const res = await apiClient.post(`/chats/${encodeURIComponent(roomId)}/voice-token`, {
        participant_name: modelName || 'Model'
      }, {
        params: { profile_id: activeProfileId }
      });
      if (!res?.data?.token || !res.data.room_id) throw new Error('No direct call token was returned');

      const pendingCall = {
        token: res.data.token,
        roomId: res.data.room_id,
        targetId: roomId,
        targetName: chatPartnerName,
        mode
      };
      outgoingCallRef.current = pendingCall;
      activeCallPeerRef.current = roomId;
      setOutgoingCallData(pendingCall);
      sendCallSignal({
        type: 'incoming_call',
        from: profileChatUserId,
        from_name: modelName,
        target_id: roomId,
        room_id: pendingCall.roomId,
        mode
      });
      appendSystemMessage(`Calling ${chatPartnerName}...`, 'call_started', { mode });

      clearCallTimeout();
      callTimeoutRef.current = window.setTimeout(() => {
        if (outgoingCallRef.current?.roomId !== pendingCall.roomId) return;
        outgoingCallRef.current = null;
        setOutgoingCallData(null);
        activeCallPeerRef.current = '';
        try {
          sendCallSignal({
            type: 'call_cancelled',
            from: profileChatUserId,
            target_id: roomId,
            room_id: pendingCall.roomId
          });
        } catch (error) {
          console.warn('Could not send the unanswered call cancellation:', error);
        }
        appendSystemMessage(`${chatPartnerName} did not answer`, 'call_no_answer', { mode });
        clearLocalStream();
        toast.info(`${chatPartnerName} did not answer.`);
        clearCallTimeout();
      }, 45000);
    } catch (err) {
      outgoingCallRef.current = null;
      setOutgoingCallData(null);
      clearCallTimeout();
      clearLocalStream();
      console.error('Failed to start profile call:', err);
      toast.error(t('secureCallFailed'));
    } finally {
      callActionRef.current = false;
      setIsConnectingCall(false);
    }
  };

  const endCall = () => {
    const activeRoomId = activeCallRoomRef.current;
    const peerId = activeCallPeerRef.current || roomId;
    clearCallTimeout();
    if (activeRoomId) {
      try {
        sendCallSignal({
          type: 'call_ended',
          from: profileChatUserId,
          target_id: peerId,
          room_id: activeRoomId
        });
      } catch (error) {
        console.warn('Could not notify the other participant that the call ended:', error);
      }
    }
    appendSystemMessage('Call ended', 'call_ended');
    activeCallRoomRef.current = '';
    activeCallPeerRef.current = '';
    setIsInCall(false);
    setCallToken("");
    setCallStartedAt(null);
    setCallElapsedSec(0);
    clearLocalStream();
  };

  const acceptCall = async () => {
    if (!incomingCallData || callActionRef.current || isInCall || outgoingCallRef.current) return;
    const call = incomingCallData;
    callActionRef.current = true;
    callHistoryEventsRef.current.clear();
    setCallMode(call.mode || 'video');
    setIsConnectingCall(true);
    try {
      if ((call.mode || 'video') === 'video' && navigator?.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          setLocalStream(stream);
        } catch (err) {
          console.warn('Camera permission not granted for accept:', err);
        }
      }

      const res = await apiClient.post(`/chats/${encodeURIComponent(call.fromId)}/voice-token`, {
        participant_name: modelName || 'Model'
      }, {
        params: { profile_id: activeProfileId }
      });
      if (!res?.data?.token || res.data.room_id !== call.roomId) {
        throw new Error('The caller token did not match the call room');
      }
      activeCallRoomRef.current = call.roomId;
      activeCallPeerRef.current = call.fromId;
      sendCallSignal({
        type: 'call_answered',
        room_id: call.roomId,
        from: profileChatUserId,
        target_id: call.fromId
      });
      setCallToken(res.data.token);
      setIsInCall(true);
      setCallStartedAt(Date.now());
      setIncomingCallData(null);
      stopRingtone();
      appendSystemMessage('Call connected', 'call_connected');
      await ensureAudioPlayback();
    } catch (err) {
      activeCallRoomRef.current = '';
      activeCallPeerRef.current = '';
      clearLocalStream();
      console.error('Failed to join profile call:', err);
      toast.error(t('joinCallFailed'));
    } finally {
      callActionRef.current = false;
      setIsConnectingCall(false);
    }
  };

  const rejectCall = () => {
    if (!incomingCallData) return;
    const call = incomingCallData;
    appendSystemMessage(`Call declined`, 'call_declined', { mode: call.mode || 'audio' });
    try {
      sendCallSignal({
        type: 'call_rejected',
        room_id: call.roomId,
        from: profileChatUserId,
        target_id: call.fromId
      });
    } catch (error) {
      console.warn('Could not notify the caller that the call was declined:', error);
    }
    setIncomingCallData(null);
    stopRingtone();
  };

  const cancelOutgoingCall = () => {
    const pending = outgoingCallRef.current;
    if (!pending) return;
    clearCallTimeout();
    outgoingCallRef.current = null;
    setOutgoingCallData(null);
    activeCallPeerRef.current = '';
    try {
      sendCallSignal({
        type: 'call_cancelled',
        from: profileChatUserId,
        target_id: pending.targetId,
        room_id: pending.roomId
      });
    } catch (error) {
      console.warn('Could not cancel the outgoing call:', error);
    }
    clearLocalStream();
  };

  const handleCallSignal = (incoming) => {
    const type = incoming.type;
    const signalRoomId = incoming.room_id;
    const senderId = incoming.from || incoming.sender_id || '';
    const signalKey = `${type}:${signalRoomId}:${senderId}`;
    if (processedCallSignalsRef.current.has(signalKey)) return;
    processedCallSignalsRef.current.add(signalKey);
    if (processedCallSignalsRef.current.size > 100) {
      processedCallSignalsRef.current.delete(processedCallSignalsRef.current.values().next().value);
    }

    if (type === 'incoming_call') {
      if (!senderId || senderId === profileChatUserId || !signalRoomId) return;
      if (isInCall || isConnectingCall || outgoingCallRef.current || callActionRef.current) {
        try {
          sendCallSignal({
            type: 'call_rejected',
            from: profileChatUserId,
            target_id: senderId,
            room_id: signalRoomId,
            reason: 'busy'
          });
        } catch (error) {
          console.warn('Could not decline a call while busy:', error);
        }
        return;
      }
      if (incomingCallData?.roomId === signalRoomId) return;
      callHistoryEventsRef.current.clear();
      setIncomingCallData({
        fromId: senderId,
        fromName: incoming.from_name || incoming.sender_name || chatPartnerName,
        roomId: signalRoomId,
        mode: incoming.mode === 'audio' ? 'audio' : 'video'
      });
      return;
    }

    if (type === 'call_answered') {
      const pending = outgoingCallRef.current;
      if (!pending || pending.roomId !== signalRoomId) return;
      clearCallTimeout();
      outgoingCallRef.current = null;
      setOutgoingCallData(null);
      setCallToken(pending.token);
      setCallMode(pending.mode);
      activeCallRoomRef.current = pending.roomId;
      activeCallPeerRef.current = pending.targetId;
      setIsInCall(true);
      setCallStartedAt(Date.now());
      appendSystemMessage('Call connected', 'call_connected', { mode: pending.mode });
      ensureAudioPlayback();
      return;
    }

    if (type === 'call_rejected' || type === 'call_cancelled') {
      const pending = outgoingCallRef.current;
      if (pending?.roomId === signalRoomId) {
        clearCallTimeout();
        outgoingCallRef.current = null;
        setOutgoingCallData(null);
        activeCallPeerRef.current = '';
        clearLocalStream();
        if (type === 'call_rejected') {
          appendSystemMessage('Call declined', 'call_declined', { mode: pending.mode });
          toast.error(incoming.reason === 'busy' ? t('coreUiPersonAlreadyOnCall') : t('callRejected'));
        }
      }
      if (incomingCallData?.roomId === signalRoomId) {
        setIncomingCallData(null);
        stopRingtone();
      }
      return;
    }

    if (type === 'call_ended' && activeCallRoomRef.current === signalRoomId) {
      appendSystemMessage('Call ended', 'call_ended', { mode: callMode });
      activeCallRoomRef.current = '';
      activeCallPeerRef.current = '';
      setIsInCall(false);
      setCallToken('');
      setCallStartedAt(null);
      setCallElapsedSec(0);
      clearLocalStream();
    }
  };
  callSignalHandlerRef.current = handleCallSignal;

  useEffect(() => () => {
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
    callTimeoutRef.current = null;
  }, [roomId, activeProfileId]);

  useEffect(() => () => {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
  }, [localStream]);

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
        } else {
          playNote(880, 0, 0.18, 'triangle', 0.055);
          playNote(660, 0.22, 0.18, 'triangle', 0.05);
          playNote(990, 0.46, 0.16, 'triangle', 0.045);
        }
      };
      scheduleMotif();
      const interval = setInterval(scheduleMotif, 1200);
      ringtoneCtxRef.current = { ctx, master, interval };
      ringtonePlayingRef.current = true;
    } catch (e) {}
  };

  const stopRingtone = () => {
    try {
      if (!ringtonePlayingRef.current || !ringtoneCtxRef.current) return;
      const { ctx, interval } = ringtoneCtxRef.current;
      clearInterval(interval);
      ctx.close();
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

  const appendSystemMessage = (text, type = 'system', meta = {}) => {
    const callEvents = {
      call_started: 'started',
      call_connected: 'connected',
      call_ended: 'ended',
      missed_call: 'missed',
      call_no_answer: 'no_answer',
      call_declined: 'declined',
    };
    const event = callEvents[type];
    const callRoomId = activeCallRoomRef.current || outgoingCallRef.current?.roomId
      || incomingCallData?.roomId || roomId;
    const eventKey = event ? `${callRoomId}:${event}` : '';
    if (event && callHistoryEventsRef.current.has(eventKey)) return;
    if (event) callHistoryEventsRef.current.add(eventKey);

    const systemMsg = {
      id: `system-${Date.now()}-${Math.random()}`,
      sender: 'system',
      type,
      text,
      meta,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, systemMsg]);
    if (event) {
      chatService.recordDirectCallEvent(roomId, event, meta.mode || callMode, activeProfileId)
        .catch((error) => {
          console.error('Failed to save profile call history:', error);
          toast.error(t('coreUiCallHistorySaveFailed'));
        });
    }
  };

  const sendTypingStatus = (type) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    try {
      wsRef.current.send(JSON.stringify({ type, target_id: roomId }));
    } catch (error) {
      console.warn('Could not send creator chat typing status:', error);
    }
  };

  const handleTypingInput = (event) => {
    const value = event.target.value;
    setInputText(value);
    if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
    if (!value.trim()) {
      if (lastTypingSentAtRef.current) sendTypingStatus('stop_typing');
      lastTypingSentAtRef.current = 0;
      stopTypingTimeoutRef.current = null;
      return;
    }
    const now = Date.now();
    if (!lastTypingSentAtRef.current || now - lastTypingSentAtRef.current >= 1500) {
      sendTypingStatus('typing');
      lastTypingSentAtRef.current = now;
    }
    stopTypingTimeoutRef.current = window.setTimeout(() => {
      sendTypingStatus('stop_typing');
      lastTypingSentAtRef.current = 0;
      stopTypingTimeoutRef.current = null;
    }, 2000);
  };

  const handleSend = (overrideText = null) => {
    const textToSend = overrideText !== null ? overrideText : inputText;
    if (!textToSend.trim() && !attachedMedia) return;

    const uniqueMsgId = `model-${Date.now()}-${Math.random()}`;
    const messagePayload = {
      type: 'chat',
      client_message_id: uniqueMsgId,
      target_id: roomId, // Send to specific user_id
      content: textToSend, 
      text: textToSend,    
      media: attachedMedia
    };

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      toast.error(t('coreUiChatReconnecting'));
      return;
    }

    try {
      wsRef.current.send(JSON.stringify(messagePayload));
      sendTypingStatus('stop_typing');
      lastTypingSentAtRef.current = 0;
      if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
      stopTypingTimeoutRef.current = null;
    } catch (error) {
      console.error('Failed to send creator chat message:', error);
      toast.error(t('sendMessageFailed'));
      return;
    }

    setMessages(prev => [...prev, {
      id: uniqueMsgId,
      sender: 'model',
      text: textToSend,
      media: attachedMedia,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }]);
    
    if (overrideText === null) setInputText('');
    setAttachedMedia(null);
    setShowEmojiPicker(false);
  };

  const handlePinMessage = async (message) => {
    if (!message?.id || pinningMessageId) return;
    const pinned = !message.isPinned;
    setPinningMessageId(message.id);
    try {
      await chatService.pinDirectMessage(roomId, message.id, pinned, activeProfileId);
      setMessages((previous) => previous.map((item) => item.id === message.id
        ? { ...item, isPinned: pinned }
        : item));
    } catch (error) {
      console.error('Failed to update profile message pin:', error);
      toast.error(t('coreUiMessagePinUpdateFailed'));
    } finally {
      setPinningMessageId(null);
    }
  };

  const handleBlockUser = async () => {
    if (!await confirm(t('commonUiBlockUserConfirm', { name: chatData.user }), {
      title: 'Block user',
      confirmLabel: 'Block',
      tone: 'danger',
    })) return;
    setIsModerating(true);
    try {
      await creatorService.blockProfileConversationUser(activeProfileId, roomId);
      toast.success(`${chatData.user} has been blocked.`);
      onBlocked?.();
    } catch (error) {
      console.error('Failed to block profile conversation user:', error);
      toast.error(error.response?.data?.error || t('coreUiBlockUserFailed'));
    } finally {
      setIsModerating(false);
    }
  };

  const handleReportUser = async () => {
    const reason = await prompt(t('commonUiReportUserReason', { name: chatData.user }), {
      title: 'Report user',
      inputLabel: 'Reason',
      placeholder: 'Enter the reason for this report',
    });
    if (!reason?.trim()) return;
    setIsModerating(true);
    try {
      await creatorService.reportProfileConversationUser(activeProfileId, roomId, reason.trim());
      toast.success(t('coreUiReportSubmittedModeration'));
    } catch (error) {
      console.error('Failed to report profile conversation user:', error);
      toast.error(error.response?.data?.error || t('coreUiReportSubmitFailed'));
    } finally {
      setIsModerating(false);
    }
  };

  const handleEmojiSelect = (emojiData) => {
    setInputText(prev => prev + emojiData.emoji);
    setShowEmojiPicker(false);
  };

  const latestPinnedMessage = [...messages].reverse().find((message) => message.isPinned);

  return (
    <div className="chat-theme-sharp flex flex-col h-full bg-black text-zinc-300 font-mono absolute inset-0 z-50 animate-in slide-in-from-right-10" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      
      {/* Chat Header */}
      <div className="flex items-center justify-between p-4 border-b-2 border-zinc-800 bg-black shrink-0 shadow-[0_4px_20px_rgba(var(--shadow-rgb), 0.5)] z-20">
        <div className="flex items-center gap-4">
          <button onClick={onBack} disabled={isInCall || Boolean(outgoingCallData)} className="p-2 border-2 border-zinc-800 hover:border-white hover:text-white transition-colors bg-zinc-950 disabled:opacity-40">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            {chatData.avatar && !avatarFailed ? (
              <img src={chatData.avatar} alt={chatPartnerName} onError={() => setAvatarFailed(true)} className="w-10 h-10 border-2 border-zinc-800 object-cover" />
            ) : (
              <div className="w-10 h-10 border-2 border-zinc-800 bg-zinc-900 flex items-center justify-center font-bold text-white">
                {chatPartnerName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h2 className="text-lg font-black uppercase tracking-widest flex items-center gap-2 text-white">
                {chatData.user || chatData.name}
              </h2>
              <span className={`text-[9px] font-bold uppercase tracking-widest flex items-center gap-1 ${isChatConnected ? 'text-green-400' : 'text-yellow-400'}`}>
                <span className={`w-1.5 h-1.5 animate-pulse rounded-full ${isChatConnected ? 'bg-green-500' : 'bg-yellow-500'}`} /> {isChatConnected ? 'Connected' : 'Reconnecting'} [{modelName}]
                {isPartnerTyping && <span className="text-white">· {chatData.user || chatData.name} is typing…</span>}
              </span>
            </div>
          </div>
        </div>

        {/* Call Trigger Buttons */}
        <div className="flex items-center gap-2">
          <button onClick={() => startCall('audio')} disabled={isConnectingCall || isInCall || Boolean(outgoingCallData) || Boolean(incomingCallData)} className="px-3 py-2 bg-zinc-950 border-2 border-zinc-800 text-zinc-200 hover:border-white text-xs font-black uppercase flex items-center gap-2 disabled:opacity-40">
            <Phone className="w-4 h-4 text-emerald-400" /> {outgoingCallData?.mode === 'audio' ? 'Calling…' : 'Audio'}
          </button>
          <button onClick={() => startCall('video')} disabled={isConnectingCall || isInCall || Boolean(outgoingCallData) || Boolean(incomingCallData)} className="px-3 py-2 bg-zinc-950 border-2 border-zinc-800 text-zinc-200 hover:border-white text-xs font-black uppercase flex items-center gap-2 disabled:opacity-40">
            <Video className="w-4 h-4 text-blue-400" /> {outgoingCallData?.mode === 'video' ? 'Calling…' : 'Video'}
          </button>
          <button onClick={handleReportUser} disabled={isModerating} title={t('coreUiReportUser')} className="p-2 border-2 border-zinc-800 text-zinc-300 hover:border-yellow-500 hover:text-yellow-400 disabled:opacity-50">
            <Flag className="w-4 h-4" />
          </button>
          <button onClick={handleBlockUser} disabled={isModerating} title={t('coreUiBlockUser')} className="p-2 border-2 border-zinc-800 text-red-400 hover:border-red-500 disabled:opacity-50">
            <Ban className="w-4 h-4" />
          </button>
          <button onClick={onEnd} disabled={isInCall || Boolean(outgoingCallData)} className="px-4 py-2 border-2 border-zinc-700 text-zinc-300 hover:border-white hover:text-white font-black uppercase text-[10px] tracking-widest transition-colors ml-2 disabled:opacity-40">
            Back to inbox
          </button>
        </div>
      </div>

      {latestPinnedMessage && (
        <button
          onClick={() => document.getElementById(`creator-message-${latestPinnedMessage.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          className="px-4 py-2 flex items-center gap-2 text-left border-b border-zinc-800 bg-zinc-900/80"
        >
          <Pin className="w-4 h-4 text-yellow-400 shrink-0" />
          <span className="text-[9px] font-black uppercase tracking-widest text-yellow-400 shrink-0">{t('coreUiPinned')}</span>
          <span className="text-xs text-zinc-300 truncate">{latestPinnedMessage.text || 'Attachment'}</span>
        </button>
      )}

      {outgoingCallData && !isInCall && (
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950 px-4 py-3">
          <div className="flex items-center gap-3 text-white">
            {outgoingCallData.mode === 'video'
              ? <Video className="h-4 w-4 text-blue-400" />
              : <Phone className="h-4 w-4 text-emerald-400" />}
            <span className="text-xs font-bold">Calling {outgoingCallData.targetName}…</span>
          </div>
          <button
            type="button"
            onClick={cancelOutgoingCall}
            className="flex items-center gap-2 border border-zinc-700 px-3 py-2 text-[10px] font-bold uppercase text-zinc-300 hover:border-red-500 hover:text-red-400"
          >
            <PhoneOff className="h-3.5 w-3.5" /> Cancel
          </button>
        </div>
      )}

      {/* INCOMING CALL OVERLAY */}
      {incomingCallData && !isInCall && (
        <div className="absolute inset-0 z-60 flex items-center justify-center p-6 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md p-6 bg-zinc-950 border-2 border-white shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.2)] text-center">
            <h3 className="text-lg font-black text-white uppercase tracking-widest mb-2">Incoming {incomingCallData.mode} Call</h3>
            <p className="text-xs text-zinc-400 uppercase font-bold mb-6">From {incomingCallData.fromName}</p>
            <div className="flex gap-4">
              <button onClick={rejectCall} className="flex-1 py-3 bg-black border-2 border-red-500 text-red-500 font-black uppercase text-xs">{t('coreUiDecline')}</button>
              <button onClick={acceptCall} disabled={isConnectingCall} className="flex-1 py-3 bg-green-500 border-2 border-green-500 text-black font-black uppercase text-xs disabled:opacity-50">
                {isConnectingCall ? 'Connecting…' : 'Answer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LIVEKIT ACTIVE CALL INTERFACE */}
      {isInCall && callToken && (
        <div className="absolute inset-0 z-50 flex flex-col bg-black animate-in fade-in duration-300">
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
            <InboxCallStage activeChat={chatData} callMode={callMode} callElapsedSec={callElapsedSec} localStream={localStream} micEnabled={micEnabled} micLevel={micLevel} />
            <div className="p-6 pb-10 flex items-center justify-center gap-4 bg-zinc-950 border-t-2 border-zinc-800">
              <TrackToggle source={Track.Source.Microphone} className="p-4 bg-black border-2 border-zinc-700 text-white" />
              {callMode === 'video' && <TrackToggle source={Track.Source.Camera} className="p-4 bg-black border-2 border-zinc-700 text-white" />}
              <button onClick={endCall} className="px-6 py-3 bg-red-600 border-2 border-red-500 text-black font-black uppercase text-xs flex items-center gap-2">
                <PhoneOff className="w-4 h-4" /> End Call
              </button>
            </div>
          </LiveKitRoom>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex-1 flex flex-col border-r-2 border-zinc-800 bg-zinc-950 relative">
          
          <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3 lg:p-4 space-y-4 custom-scrollbar flex flex-col">
            {isLoadingHistory ? (
              <div className="flex items-center justify-center h-full text-zinc-500">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-500 font-bold uppercase tracking-widest text-[10px]">
                <p>{t('coreUiNoMessageHistory')}</p>
              </div>
            ) : (
              messages.map((msg) => {
                const isSystem = msg.sender === 'system';
                const isModel = msg.sender === 'model';
                const bubbleStyle = isSystem
                  ? 'chat-bubble chat-bubble--system border border-zinc-800 bg-zinc-900/80 px-4 py-2 text-center text-xs font-medium text-zinc-400'
                  : isModel
                    ? 'chat-bubble chat-bubble--mine border border-amber-200/60 bg-gradient-to-br from-amber-200 to-amber-100 px-4 py-3 text-zinc-950 shadow-amber-950/20'
                    : 'chat-bubble chat-bubble--other border border-zinc-700 bg-gradient-to-br from-zinc-800 to-zinc-900 px-4 py-3 text-zinc-100 shadow-black/30';

                return (
                  <div id={`creator-message-${msg.id}`} key={msg.id} className={`flex flex-col max-w-[min(88%,42rem)] ${isSystem ? 'self-center' : isModel ? 'self-end items-end ml-auto' : 'self-start items-start'}`}>
                    {!isSystem && (
                      <span className="mb-1 px-1 text-[10px] font-medium text-zinc-500">
                        {isModel ? modelName : (chatData.user || chatData.name)} • {msg.time}
                      </span>
                    )}
                    {msg.flagged && <span className="mb-1 text-[9px] font-black uppercase text-red-400">{t('coreUiFlaggedByModeration')}</span>}
                    <div className={`flex max-w-full flex-col gap-2 text-sm leading-relaxed ${bubbleStyle}`}>
                      {msg.media && (
                        <div className="w-full max-w-[min(70vw,22rem)] overflow-hidden rounded-xl border border-black/10">
                          <img src={msg.media} alt={t('coreUiChatAttachment')} className="max-h-80 w-full object-cover" />
                        </div>
                      )}
                      {msg.text && <div className="whitespace-pre-wrap break-words">{msg.text}</div>}
                    </div>
                    {!isSystem && (
                      <button
                        onClick={() => handlePinMessage(msg)}
                        disabled={pinningMessageId === msg.id}
                        aria-label={msg.isPinned ? 'Unpin message' : 'Pin message'}
                        title={msg.isPinned ? 'Unpin message' : 'Pin message'}
                        className={`mt-1 p-1 border border-zinc-800 disabled:opacity-50 ${msg.isPinned ? 'text-yellow-400' : 'text-zinc-500 hover:text-white'}`}
                      >
                        {msg.isPinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions only populate the composer; they never send messages. */}
          <div className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-3 py-2">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                <Sparkles className="h-3 w-3 text-amber-400" />
                Suggestions only add text to your draft. Review before sending.
              </div>
              {aiDraftsEnabled ? (
                <button
                  type="button"
                  onClick={generateAISuggestions}
                  disabled={isGeneratingAISuggestions || isLoadingHistory}
                  className="inline-flex items-center gap-1.5 border border-amber-300/60 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-amber-200 transition-colors hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isGeneratingAISuggestions ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {isGeneratingAISuggestions ? 'Drafting...' : 'Generate AI drafts'}
                </button>
              ) : (
                <Link to="/model/settings" className="text-[9px] font-bold uppercase tracking-widest text-amber-300 underline underline-offset-2">
                  Enable AI drafts in settings
                </Link>
              )}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar">
              {smartSuggestions.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setInputText(sug)}
                  className="whitespace-nowrap rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-amber-300/70 hover:text-amber-200"
                >
                  {sug}
                </button>
              ))}
            </div>
            {aiSuggestions.length > 0 && (
              <div className="mt-2 space-y-2" aria-live="polite">
                <p className="text-[9px] font-bold uppercase tracking-widest text-amber-300">{t('coreUiAiDraftsReviewBeforeSending')}</p>
                {aiSuggestions.map((suggestion, index) => (
                  <button
                    key={`${index}-${suggestion}`}
                    type="button"
                    onClick={() => setInputText(suggestion)}
                    className="block w-full border border-amber-300/20 bg-black px-3 py-2 text-left text-xs leading-relaxed text-zinc-300 transition-colors hover:border-amber-300/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Chat Input */}
          <div className="p-4 bg-zinc-950 border-t-2 border-zinc-800 shrink-0 relative z-30">
            {showEmojiPicker && (
              <div className="absolute bottom-[calc(100%+10px)] left-16 z-50 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] border-2 border-zinc-700 bg-black">
                <Suspense fallback={<div className="p-4 text-xs text-zinc-400">{t('coreUiLoadingEmoji')}</div>}>
                  <EmojiPicker
                    theme={theme}
                    onEmojiClick={handleEmojiSelect}
                    searchDisabled={true}
                    skinTonesDisabled={true}
                    height={350}
                    width={300}
                  />
                </Suspense>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {attachedMedia && (
                <div className="flex items-center gap-4 bg-black border-2 border-zinc-700 p-2 w-max">
                  <img src={attachedMedia} alt={t('coreUiPreview')} className="w-12 h-12 object-cover border-2 border-zinc-800" />
                  <div className="flex flex-col pr-2">
                    <span className="text-[9px] font-black uppercase text-zinc-400">{t('coreUiAttachedFile')}</span>
                    <span className="text-[10px] font-bold text-white uppercase">{t('coreUiReadyToSend')}</span>
                  </div>
                  <button 
                    onClick={() => setAttachedMedia(null)} 
                    className="p-1 bg-red-500 text-black hover:bg-red-600 transition-colors border-2 border-black"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              <div className="flex gap-3">
                <div className="hidden md:flex items-center gap-1 shrink-0 bg-black border-2 border-zinc-800 p-1">
                  <button onClick={() => setShowMediaVault(true)} className="p-2 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                    <ImageIcon className="w-4 h-4" />
                  </button>
                  <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="p-2 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                    <Smile className="w-4 h-4" />
                  </button>
                </div>

                <textarea 
                  value={inputText} onChange={handleTypingInput}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={t('coreUiTypeMessage')}
                  className="flex-1 bg-black border-2 border-zinc-700 p-3 text-white font-bold text-sm resize-none outline-none focus:border-white transition-colors custom-scrollbar disabled:opacity-50"
                  rows="2"
                />
                <button 
                  onClick={() => handleSend()} disabled={!inputText.trim() && !attachedMedia}
                  className="w-24 bg-white border-2 border-white text-black flex flex-col items-center justify-center gap-1 font-black uppercase tracking-widest hover:bg-black hover:text-white disabled:opacity-50 transition-colors"
                >
                  <Send className="w-5 h-5" />
                  <span className="text-[10px]">{t('send')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Profile Panel */}
        <div className="hidden w-[clamp(14rem,22vw,20rem)] flex-col overflow-y-auto border-l-2 border-zinc-800 bg-black p-6 custom-scrollbar lg:flex">
          <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest border-b-2 border-zinc-800 pb-2 mb-6">{t('coreUiTargetProfile')}</h3>
          {chatData.avatar && !avatarFailed ? (
            <img src={chatData.avatar} alt={chatPartnerName} onError={() => setAvatarFailed(true)} className="aspect-[3/2] w-full object-cover border-2 border-zinc-800 grayscale mb-4" />
          ) : (
            <div className="aspect-[3/2] w-full border-2 border-zinc-800 bg-zinc-900 flex items-center justify-center text-xl font-bold text-white mb-4">
              {(chatData.user || chatData.name || 'U').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="text-[8px] text-zinc-500 font-black uppercase block">{t('coreUiChatSafety')}</label>
              <div className="text-[10px] font-bold text-zinc-400 mt-1">{t('coreUiChatSafetyDescription')}</div>
            </div>
          </div>
        </div>
      </div>

      {/* MEDIA VAULT MODAL */}
      {showMediaVault && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowMediaVault(false)} />
          <div className="relative flex h-[80dvh] min-h-0 w-full max-w-2xl flex-col border-2 border-zinc-600 bg-black shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center shrink-0">
              <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-zinc-400" /> [{modelName.toUpperCase()}] APPROVED MEDIA VAULT
              </h2>
              <button onClick={() => setShowMediaVault(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-6">{t('coreUiSelectApprovedGalleryImage')}</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {isLoadingVault ? (
                  <div className="col-span-full flex items-center justify-center py-10">
                    <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
                  </div>
                ) : vaultImages.length === 0 ? (
                  <div className="col-span-full text-center py-10 text-[10px] font-black text-zinc-500 tracking-widest uppercase border-2 border-dashed border-zinc-800">
                    No approved media available in this vault.
                  </div>
                ) : (
                  vaultImages.map((mediaObj) => (
                    <button 
                      key={mediaObj.id}
                      onClick={() => {
                        setAttachedMedia(mediaObj.url || mediaObj.media_url); 
                        setShowMediaVault(false);
                      }}
                      className="aspect-square bg-zinc-950 border-2 border-zinc-800 hover:border-white transition-all overflow-hidden group relative"
                    >
                      <img src={mediaObj.url || mediaObj.media_url} alt={t('coreUiMediaVaultItem')} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-[10px] font-black text-white uppercase tracking-widest border-2 border-white px-3 py-1">{t('coreUiSelect')}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
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
    <div className="grid min-h-0 w-full flex-1 grid-cols-1 items-center justify-center gap-3 p-2 sm:gap-4 sm:p-3 md:grid-cols-2 lg:p-4">
      <div className="col-span-full text-center text-xs font-semibold text-zinc-400">
        {callMode === 'video' ? 'Video call' : 'Audio call'} • {connectedCount} participant{connectedCount === 1 ? '' : 's'} • {formatDuration(callElapsedSec)}
      </div>
      
      <div className="relative flex h-full w-full max-h-[52dvh] flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {callMode === 'video' && (localCameraTrack || localStream) ? (
          <>
            {localCameraTrack ? (
              <VideoTrack trackRef={localCameraTrack} className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <video 
                ref={(el) => { if (el && localStream) { try { el.srcObject = localStream; } catch(e){} } }} 
                autoPlay muted playsInline 
                className="absolute inset-0 w-full h-full object-cover" 
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
          </>
        ) : (
          <div className="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-bold z-10 bg-zinc-800 text-white">
            {(localParticipant?.name || 'You').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="text-sm font-semibold z-10 px-3 py-1.5 rounded-lg bg-black/50 text-white">{t('coreUiYou')}</div>
        <div className="text-xs z-10 flex flex-col gap-2 text-zinc-400">
          {micEnabled ? (
            <>
              <div className="flex items-center gap-1 justify-center mt-2">
                {[0.05, 0.15, 0.3, 0.5].map((threshold, index) => {
                  const active = micLevel >= threshold;
                  return (
                    <span 
                      key={index} 
                      className="inline-block h-2 rounded-full transition-all duration-150" 
                      style={{ 
                        width: `${6 + index * 4}px`, 
                        backgroundColor: active ? 'var(--success)' : 'rgba(var(--text-muted-rgb), 0.3)'
                      }} 
                    />
                  );
                })}
              </div>
            </>
          ) : (
            <div className="inline-flex items-center gap-2 mt-2">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              <span>{t('coreUiMicOff')}</span>
            </div>
          )}
        </div>
      </div>

      <div className="relative flex h-full w-full max-h-[52dvh] flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {callMode === 'video' && remoteCameraTrack && (
          <VideoTrack trackRef={remoteCameraTrack} className="absolute inset-0 w-full h-full object-cover" />
        )}
        {remotePrimary ? (
          <>
            {(!remoteCameraTrack || callMode !== 'video') && (
              <div className="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-bold z-10 bg-zinc-800 text-white">
                {(remotePrimary?.name || activeChat?.name || activeChat?.user || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="text-sm font-semibold z-10 px-3 py-1.5 rounded-lg bg-black/50 text-white">{remotePrimary?.name || activeChat?.user || activeChat?.name}</div>
          </>
        ) : (
          <>
            {activeChat?.avatar ? (
              <img src={activeChat.avatar} alt={activeChat.user} className="w-24 h-24 rounded-full object-cover z-10" />
            ) : (
              <div className="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-bold z-10 bg-zinc-800 text-white">
                {(activeChat?.user || activeChat?.name || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="text-sm font-semibold z-10 px-3 py-1.5 rounded-lg bg-black/50 text-white">{activeChat?.user || activeChat?.name}</div>
            <div className="text-xs z-10 text-zinc-400">{t('coreUiRinging')}</div>
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