import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { 
  Clock, DollarSign, X, Check, Filter, ShieldAlert, 
  ChevronDown, Search, History, Star, ShieldCheck, Zap, 
  Volume2, VolumeX, MessageSquare, Activity, ArrowLeft, 
  Send, Image as ImageIcon, Gift, Video, File, XSquare,
  Bot, Sparkles, Loader2, RefreshCw, Smile, Paperclip, Upload,
  Phone, PhoneOff, Headphones, BellOff, Trash2, CheckCircle2, Flame, Heart, MicOff
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
import { creatorService } from '../../api/creator.service';
import { chatService } from '../../api/chat.service'; 
import { apiClient } from '../../api/client';
import { useI18n } from '../../i18n';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || "ws://localhost:7880";

const CANNED_REPLIES = [
  "Hey there! Thanks for the tip ❤️ Let's chat.",
  "Welcome to my private chat! How's your day going?",
  "Just saw your request, skipping the line for you! 😘",
  "Hey VIP! Let's take this to a private video call?"
];

const getUserTier = (spend, flagged) => {
  if (flagged) return { label: 'FLAGGED', color: 'border-red-500', text: 'text-red-500', bg: 'bg-red-500/10' };
  if (spend >= 1000) return { label: 'WHALE', color: 'border-yellow-400', text: 'text-yellow-400', bg: 'bg-yellow-400/10' };
  if (spend >= 100) return { label: 'PREMIUM', color: 'border-blue-400', text: 'text-blue-400', bg: 'bg-blue-400/10' };
  return { label: 'STANDARD', color: 'border-zinc-500', text: 'text-zinc-400', bg: 'bg-zinc-900' };
};

// ============================================================================
// COMPONENT: MODEL CHAT QUEUE
// ============================================================================
export default function ModelChatQueue() {
  const { activeProfileId, activeProfile = { id: '', name: 'Select Profile' } } = useOutletContext();
  const { t } = useI18n();
  const theme = useAppStore((state) => state.userPreferences.theme);

  const [masterQueue, setMasterQueue] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('TIP_DESC');
  const [expandedId, setExpandedId] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [selectedReply, setSelectedReply] = useState(CANNED_REPLIES[0]);

  const [activeChatRoom, setActiveChatRoom] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchQueue = async (isManual = false) => {
    if (!activeProfileId) {
      setIsLoading(false);
      return;
    }

    if (isManual) setIsRefreshing(true);
    
    try {
      const data = await creatorService.getChatQueue(activeProfileId);
      const queueList = Array.isArray(data) ? data : [];
      setMasterQueue(queueList);
      
      if (isManual) toast.success(t('queueRefreshed'));
    } catch (error) {
      console.error("Queue fetch error:", error);
      if (isManual) toast.error(t('queueRefreshFailed'));
    } finally {
      setIsLoading(false);
      if (isManual) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!activeProfileId) return;
    setIsLoading(true);
    fetchQueue(); 
    
    const pollTimer = setInterval(() => {
      fetchQueue(false);
    }, 5000);
    
    return () => clearInterval(pollTimer);
  }, [activeProfileId]);

  const getWaitTime = (timeAdded) => {
    const addedTime = new Date(timeAdded).getTime();
    const diff = Math.max(0, Math.floor((now - addedTime) / 1000));
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  };

  const handleAction = async (id, action, withReply = false) => {
    try {
      await creatorService.processQueueAction(id, action, activeProfileId);
      
      const targetReq = masterQueue.find(q => q.id === id);
      if (!targetReq) return;

      if (action === 'accept') {
        setMasterQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'ACTIVE' } : q));
        
        // STANDARDIZE THE CHAT OBJECT FOR PRIVATE INBOX / DM ROUTING
        setActiveChatRoom({
          queueId: targetReq.id,
          id: targetReq.client_id || targetReq.clientId || targetReq.id, // Ensure we use the client's UUID for DM routing
          user_id: targetReq.client_id || targetReq.clientId || targetReq.id, // Fallback property
          type: 'dm',
          name: targetReq.user,
          user: targetReq.user, // For backward compatibility with LiveChatInterface headers
          avatar: targetReq.avatar,
          lifetimeSpend: targetReq.lifetimeSpend || 0,
          flagged: targetReq.flagged || false,
          bio: targetReq.bio || '',
          initialReply: withReply ? selectedReply : ''
        });

        toast.success(t('requestAccepted'));
      } else if (action === 'reject') {
        setMasterQueue(prev => prev.filter(q => q.id !== id));
        toast.info(t('requestRejected'));
      }
    } catch (err) {
      console.error("Action failed:", err);
      toast.error(t('actionFailed'));
    }
  };

  const filteredQueue = useMemo(() => {
    let q = [...masterQueue];
    if (activeFilter === 'VIP') q = q.filter(req => req.lifetimeSpend >= 1000);
    if (activeFilter === 'HIGH_TIPPERS') q = q.filter(req => req.tip >= 100);
    if (activeFilter === 'FLAGGED') q = q.filter(req => req.flagged);

    return q.sort((a, b) => {
      if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
      if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1;
      if (sortBy === 'TIP_DESC') return b.tip - a.tip;
      if (sortBy === 'WAIT_DESC') return new Date(a.timeAdded) - new Date(b.timeAdded);
      return 0;
    });
  }, [masterQueue, activeFilter, sortBy]);

  const totalValue = filteredQueue.reduce((acc, curr) => acc + (curr.status === 'PENDING' ? curr.tip : 0), 0);
  
  useEffect(() => {
    setExpandedId(null);
  }, [activeProfileId]);

  if (activeChatRoom) {
    return (
      <LiveChatInterface 
        chatData={activeChatRoom} 
        activeProfileId={activeProfileId}
        onBack={() => setActiveChatRoom(null)} 
        onEnd={() => { 
          setMasterQueue(prev => prev.filter(q => q.id !== activeChatRoom.queueId)); 
          setActiveChatRoom(null); 
        }}
        modelName={activeProfile.name}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 bg-black h-full flex items-center justify-center text-zinc-300">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-zinc-300 font-sans rounded-none" style={{ background: 'radial-gradient(circle at top, rgba(210,79,116,0.12), transparent 24%), #0b0c0f' }}>
      <div className="border-b border-white/10 p-3 md:p-4 shrink-0" style={{ background: 'rgba(17,18,22,0.96)' }}>
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))', color: '#fff' }}>
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-[0.22em]" style={{ color: 'var(--text-muted)' }}>Live queue</p>
              <h1 className="text-xl md:text-2xl font-black uppercase tracking-[0.18em]" style={{ color: 'var(--text-primary)' }}>{activeProfile.name}</h1>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-3">
            <div className="flex items-center gap-2 rounded-full border px-3 py-1.5" style={{ background: 'rgba(42,156,107,0.08)', borderColor: 'rgba(42,156,107,0.35)', color: 'var(--success)' }}>
              <span className="inline-block h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--success)' }} />
              <span className="text-[9px] font-black uppercase tracking-[0.18em]">Sync live</span>
            </div>
            <button
              onClick={() => fetchQueue(true)}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] border transition-all disabled:opacity-50"
              style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.02)', color: 'var(--text-primary)' }}
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 md:p-6 border-b border-white/10 shrink-0" style={{ background: 'rgba(17,18,22,0.75)' }}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-2xl border p-3" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
            <p className="text-[9px] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>Pending</p>
            <p className="mt-2 text-2xl font-black" style={{ color: 'var(--text-primary)' }}>{filteredQueue.filter(q => q.status === 'PENDING').length}</p>
          </div>
          <div className="rounded-2xl border p-3" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
            <p className="text-[9px] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>Queue value</p>
            <p className="mt-2 text-2xl font-black" style={{ color: 'var(--text-primary)' }}>${totalValue}</p>
          </div>
          <div className="rounded-2xl border p-3" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
            <p className="text-[9px] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>VIP queue</p>
            <p className="mt-2 text-2xl font-black" style={{ color: 'var(--text-primary)' }}>{filteredQueue.filter(q => q.lifetimeSpend >= 1000).length}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {['ALL', 'VIP', 'HIGH_TIPPERS', 'FLAGGED'].map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className="px-3 py-2 text-[9px] font-black uppercase tracking-[0.18em] border transition-all"
              style={{
                background: activeFilter === f ? 'linear-gradient(135deg, #ffffff, #e7e5e4)' : 'rgba(255,255,255,0.02)',
                color: activeFilter === f ? '#111111' : 'var(--text-primary)',
                borderColor: activeFilter === f ? '#ffffff' : 'var(--border)'
              }}
            >
              {f === 'FLAGGED' && <ShieldAlert className="w-3 h-3 inline mr-1 -mt-0.5 text-red-500" />}
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
        <div className="max-w-6xl mx-auto space-y-3">
          {filteredQueue.length === 0 ? (
            <div className="p-16 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center text-center" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.02)' }}>
              <Activity className="w-12 h-12 mb-4" style={{ color: 'var(--text-muted)' }} />
              <h3 className="text-xl font-black uppercase tracking-[0.18em]" style={{ color: 'var(--text-primary)' }}>Queue empty</h3>
              <p className="mt-2 text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>No requests for {activeProfile.name}</p>
            </div>
          ) : (
            filteredQueue.map((req) => {
              const isExpanded = expandedId === req.id;
              const isActive = req.status === 'ACTIVE';
              const tier = getUserTier(req.lifetimeSpend, req.flagged);

              return (
                <div
                  key={req.id}
                  className="rounded-3xl border overflow-hidden transition-all"
                  style={{
                    background: isActive ? 'linear-gradient(180deg, rgba(42,156,107,0.08), rgba(17,18,22,0.92))' : 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(17,18,22,0.9))',
                    borderColor: isActive ? 'rgba(42,156,107,0.4)' : isExpanded ? 'rgba(255,255,255,0.2)' : 'var(--border)',
                    boxShadow: isActive ? '0 18px 36px rgba(42,156,107,0.12)' : 'none'
                  }}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between p-3 gap-4">
                    <div className="flex items-center gap-4 cursor-pointer flex-1 min-w-0" onClick={() => {
                      if (isActive) {
                        setActiveChatRoom({
                          id: req.client_id || req.clientId || req.id,
                          user_id: req.client_id || req.clientId || req.id,
                          type: 'dm',
                          name: req.user,
                          user: req.user,
                          avatar: req.avatar,
                          lifetimeSpend: req.lifetimeSpend || 0,
                          flagged: req.flagged || false,
                          bio: req.bio || ''
                        });
                      } else {
                        setExpandedId(isExpanded ? null : req.id);
                      }
                    }}>
                      <div className="relative shrink-0">
                        {req.avatar ? (
                          <img src={req.avatar} alt={req.user} className="w-16 h-16 rounded-2xl object-cover border" style={{ borderColor: req.flagged ? '#ef4444' : 'var(--border)' }} />
                        ) : (
                          <div className="w-16 h-16 rounded-2xl flex items-center justify-center border text-lg font-black" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                            {req.user.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] border ${tier.bg} ${tier.text}`}>
                          {tier.label}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-black uppercase tracking-[0.14em] truncate" style={{ color: 'var(--text-primary)' }}>{req.user}</h3>
                          {isActive && (
                            <span className="px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.18em] border" style={{ background: 'rgba(42,156,107,0.14)', color: 'var(--success)', borderColor: 'rgba(42,156,107,0.3)' }}>
                              Active
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] font-black uppercase tracking-[0.14em]">
                          <span className="inline-flex items-center gap-1" style={{ color: req.tip >= 100 ? 'var(--success)' : 'var(--text-primary)' }}>
                            <DollarSign className="w-3 h-3" /> {req.tip}.00
                          </span>
                          {!isActive && (
                            <span className="inline-flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                              <Clock className="w-3 h-3" /> Wait {getWaitTime(req.timeAdded)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 w-full md:w-auto">
                      {isActive ? (
                        <button
                          onClick={() => setActiveChatRoom({
                            id: req.client_id || req.clientId || req.id,
                            user_id: req.client_id || req.clientId || req.id,
                            type: 'dm',
                            name: req.user,
                            user: req.user,
                            avatar: req.avatar,
                            lifetimeSpend: req.lifetimeSpend || 0,
                            flagged: req.flagged || false,
                            bio: req.bio || ''
                          })}
                          className="flex-1 md:flex-none px-5 h-12 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.18em] border"
                          style={{ background: 'linear-gradient(135deg, #2dd4bf, #22c55e)', color: '#0b1220', borderColor: '#22c55e' }}
                        >
                          <MessageSquare className="w-4 h-4" /> Open chat
                        </button>
                      ) : (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); handleAction(req.id, 'reject'); }} className="h-12 w-12 flex items-center justify-center border transition-colors" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                            <X className="w-5 h-5" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleAction(req.id, 'accept'); }} className="px-5 h-12 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.18em] border transition-all" style={{ background: 'linear-gradient(135deg, #ffffff, #f3f4f6)', color: '#111111', borderColor: '#ffffff' }}>
                            <Check className="w-4 h-4" /> Accept
                          </button>
                          <button onClick={() => setExpandedId(isExpanded ? null : req.id)} className="h-12 w-12 flex items-center justify-center border transition-colors" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                            <ChevronDown className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isExpanded && !isActive && (
                    <div className="border-t p-4 grid grid-cols-1 md:grid-cols-2 gap-4" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                      <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'rgba(17,18,22,0.9)' }}>
                        <h4 className="text-[9px] font-black uppercase tracking-[0.2em] mb-3" style={{ color: 'var(--text-muted)' }}>User data</h4>
                        <div className="flex items-end justify-between mb-3">
                          <span className="text-[9px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>Lifetime spent</span>
                          <span className={`text-sm font-black ${tier.text}`}>${req.lifetimeSpend}</span>
                        </div>
                        <p className="text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>"{req.bio || 'No bio provided.'}"</p>
                      </div>

                      <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                        <h4 className="text-[9px] font-black uppercase tracking-[0.2em] mb-3" style={{ color: 'var(--text-muted)' }}>Quick connect</h4>
                        <select value={selectedReply} onChange={(e) => setSelectedReply(e.target.value)} className="w-full border p-2 mb-3 text-[9px] font-bold uppercase tracking-[0.1em] outline-none" style={{ background: 'rgba(17,18,22,0.9)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                          {CANNED_REPLIES.map(reply => <option key={reply} value={reply}>{reply}</option>)}
                        </select>
                        <button onClick={(e) => { e.stopPropagation(); handleAction(req.id, 'accept', true); }} className="w-full py-3 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.18em] border" style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: '#0b1220', borderColor: '#22c55e' }}>
                          <Check className="w-4 h-4" /> Send reply & enter chat
                        </button>
                      </div>
                    </div>
                  )}
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
function LiveChatInterface({ chatData, activeProfileId, onBack, onEnd, modelName }) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState(chatData.initialReply || '');
  const [autoPilot, setAutoPilot] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isChatConnected, setIsChatConnected] = useState(false);
  const initialReplySentRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  
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
  const ringtoneCtxRef = useRef(null);
  const ringtonePlayingRef = useRef(false);
  const audioCtxRef = useRef(null);
  const [ringtoneProfile, setRingtoneProfile] = useState('sweet');
  const [micGain, setMicGain] = useState(1.0);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const micGainRef = useRef(micGain);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);

  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);

  const currentUser = useAppStore((s) => s.user) || { id: activeProfileId, name: modelName };
  const appToken = useAppStore((state) => state.token);
  const tier = getUserTier(chatData.lifetimeSpend, chatData.flagged);
  
  // CRITICAL FIX: Ensure we use target client id, not queue item id
  const roomId = chatData.user_id || chatData.id || "default";

  const smartSuggestions = [
    "I'm here! What's on your mind?",
    "Thanks for the tip, VIP! 😘",
    "Want to move this to a video call?"
  ];

  // Auto-publish microphone helper component
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

    useEffect(() => {
      if (gainNodeRef.current) gainNodeRef.current.gain.value = micGain;
    }, [micGain]);

    return null;
  }

  // --- FETCH CHAT HISTORY ---
  useEffect(() => {
    const loadHistory = async () => {
      setIsLoadingHistory(true);
      setMessages([]);
      initialReplySentRef.current = false;
      try {
        const history = await chatService.getChatHistory(roomId, 'dm');
        if (Array.isArray(history) && history.length > 0) {
          const formatted = history.map(msg => ({
            id: msg.id || msg.message_id || `history-${Date.now()}-${Math.random()}`,
            sender: String(msg.sender_id || msg.senderId) === String(roomId) ? 'user' : 'model',
            text: msg.content || msg.text || '',
            media: msg.media || null,
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
  }, [roomId]);

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

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//localhost:8080/ws?target_id=${roomId}&token=${encodeURIComponent(cleanToken)}`;
    
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

        if (incomingMsg.type === 'incoming_call') {
          if (isInCall) {
            stopRingtone();
            return;
          }
          if (incomingMsg.from === currentUser?.id || incomingMsg.sender_id === currentUser?.id) return;
          setIncomingCallData({
            fromId: incomingMsg.from || incomingMsg.sender_id,
            fromName: incomingMsg.from_name || incomingMsg.sender_name || chatData.user || 'Caller',
            roomId: incomingMsg.room_id || roomId,
            mode: incomingMsg.mode || 'video'
          });
          return;
        }

        if (incomingMsg.type === 'call_answered') {
          stopRingtone();
          setIncomingCallData(null);
          if (!isInCall) {
            setIsInCall(true);
            setCallStartedAt(Date.now());
          }
          return;
        }

        if (incomingMsg.type === 'call_rejected') {
          stopRingtone();
          setIncomingCallData(null);
          toast.error(t('callRejected'));
          setIsInCall(false);
          setCallToken('');
          setCallStartedAt(null);
          setCallElapsedSec(0);
          return;
        }

        const msgId = incomingMsg.id || incomingMsg.message_id || `msg-${Date.now()}-${Math.random()}`;
        setMessages(prev => {
          if (prev.some(m => m.id === msgId)) return prev;
          return [
            ...prev, 
            {
              id: msgId,
              sender: String(incomingMsg.sender_id || incomingMsg.senderId) === String(roomId) ? 'user' : 'model',
              text: incomingMsg.text || incomingMsg.content || '',
              media: incomingMsg.media || null,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }
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
      setIsChatConnected(false);
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
    };
  }, [roomId]);

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
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const notifyUrl = `${wsProtocol}//localhost:8080/ws?token=${encodeURIComponent(cleanToken)}`;

    try {
      const nws = new WebSocket(notifyUrl);
      notificationSocketRef.current = nws;

      nws.onmessage = (ev) => {
        try {
          const incoming = JSON.parse(ev.data);
          if (incoming.type === 'incoming_call') {
            if (isInCall) {
              stopRingtone();
              return;
            }
            if (incoming.from === currentUser?.id || incoming.sender_id === currentUser?.id) return;
            setIncomingCallData({
              fromId: incoming.from || incoming.sender_id,
              fromName: incoming.from_name || incoming.sender_name || 'Caller',
              roomId: incoming.room_id || roomId,
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
            toast.error(t('callRejected'));
            setIsInCall(false);
            setCallToken('');
            setCallStartedAt(null);
            setCallElapsedSec(0);
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
    if (chatData.initialReply && !isLoadingHistory && isChatConnected && !initialReplySentRef.current) {
      initialReplySentRef.current = true;
      handleSend(chatData.initialReply);
      setInputText('');
    }
  }, [isLoadingHistory, isChatConnected]);

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
  const startCall = async (mode = 'video') => {
    appendSystemMessage(`Calling ${chatData.user}...`, 'call_started', { mode });
    setCallMode(mode);
    setIsConnectingCall(true);
    try {
      // Capture local stream for preview before LiveKit hooks in
      if (mode === 'video' && navigator?.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          setLocalStream(stream);
        } catch (err) {
          console.warn('Camera permission not granted:', err);
        }
      }

      const res = await apiClient.post('/rooms/voice-token', {
        room_id: `dm_call_${roomId}`,
        participant_name: modelName || 'Model'
      });
      setCallToken(res.data.token);
      setIsInCall(true);
      setCallStartedAt(Date.now());
      await ensureAudioPlayback();

      const notify = {
        type: 'incoming_call',
        from: currentUser?.id,
        from_name: modelName,
        target_id: roomId,
        room_id: `dm_call_${roomId}`,
        mode
      };
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(notify));
      }
    } catch (err) {
      toast.error("Failed to start secure call.");
      toast.error(t('secureCallFailed'));
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
    // Cleanup WebRTC stream
    if (localStream) {
      localStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
    }
    setLocalStream(null);
  };

  const acceptCall = async () => {
    if (!incomingCallData) return;
    setCallMode(incomingCallData.mode || 'video');
    setIncomingCallData(null);
    stopRingtone();
    setIsConnectingCall(true);
    try {
      // Capture local stream for preview
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
        participant_name: modelName || 'Model'
      });
      setCallToken(res.data.token);
      setIsInCall(true);
      setCallStartedAt(Date.now());
      appendSystemMessage('Call connected', 'call_connected');
      await ensureAudioPlayback();

      const ack = { type: 'call_answered', room_id: incomingCallData.roomId, from: currentUser?.id, to: incomingCallData.fromId };
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(ack));
    } catch (err) {
      toast.error('Failed to join call.');
      toast.error(t('joinCallFailed'));
    } finally {
      setIsConnectingCall(false);
    }
  };

  const rejectCall = () => {
    if (!incomingCallData) return;
    appendSystemMessage(`Missed call from ${incomingCallData.fromName}`, 'missed_call', { mode: incomingCallData.mode || 'audio' });
    const rej = { type: 'call_rejected', room_id: incomingCallData.roomId, from: currentUser?.id, to: incomingCallData.fromId };
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(rej));
    setIncomingCallData(null);
    stopRingtone();
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
    const systemMsg = {
      id: `system-${Date.now()}-${Math.random()}`,
      sender: 'system',
      type,
      text,
      meta,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, systemMsg]);
  };

  const handleSend = (overrideText = null) => {
    const textToSend = overrideText !== null ? overrideText : inputText;
    if (!textToSend.trim() && !attachedMedia) return;

    const uniqueMsgId = `model-${Date.now()}-${Math.random()}`;
    const messagePayload = {
      id: uniqueMsgId,
      target_id: roomId, // Send to specific user_id
      content: textToSend, 
      text: textToSend,    
      media: attachedMedia
    };

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      toast.error("Chat is reconnecting. Your message was not sent.");
        toast.error(t('reconnecting'));
      return;
    }

    wsRef.current.send(JSON.stringify(messagePayload));

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

  const handleEmojiSelect = (emojiData) => {
    setInputText(prev => prev + emojiData.emoji);
    setShowEmojiPicker(false);
  };

  return (
    <div className="flex flex-col h-full bg-black text-zinc-300 font-mono rounded-none absolute inset-0 z-50 animate-in slide-in-from-right-10">
      
      {/* Chat Header */}
      <div className="flex items-center justify-between p-4 border-b-2 border-zinc-800 bg-black shrink-0 shadow-[0_4px_20px_rgba(0,0,0,0.5)] z-20">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 border-2 border-zinc-800 hover:border-white hover:text-white transition-colors bg-zinc-950">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            {chatData.avatar ? (
              <img src={chatData.avatar} alt={chatData.user} className={`w-10 h-10 border-2 object-cover ${tier.color}`} />
            ) : (
              <div className={`w-10 h-10 border-2 bg-zinc-900 ${tier.color} flex items-center justify-center font-bold text-white`}>
                {(chatData.user || chatData.name || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h2 className={`text-lg font-black uppercase tracking-widest flex items-center gap-2 ${tier.text}`}>
                {chatData.user || chatData.name} <span className={`px-2 py-0.5 text-[8px] font-black border-2 ${tier.color} ${tier.bg}`}>{tier.label}</span>
              </h2>
              <span className={`text-[9px] font-bold uppercase tracking-widest flex items-center gap-1 ${isChatConnected ? 'text-green-400' : 'text-yellow-400'}`}>
                <span className={`w-1.5 h-1.5 animate-pulse rounded-full ${isChatConnected ? 'bg-green-500' : 'bg-yellow-500'}`} /> {isChatConnected ? 'Connected' : 'Reconnecting'} [{modelName}]
              </span>
            </div>
          </div>
        </div>

        {/* Call Trigger Buttons */}
        <div className="flex items-center gap-2">
          <button onClick={() => startCall('audio')} disabled={isConnectingCall} className="px-3 py-2 bg-zinc-950 border-2 border-zinc-800 text-zinc-200 hover:border-white text-xs font-black uppercase flex items-center gap-2">
            <Phone className="w-4 h-4 text-emerald-400" /> Audio
          </button>
          <button onClick={() => startCall('video')} disabled={isConnectingCall} className="px-3 py-2 bg-zinc-950 border-2 border-zinc-800 text-zinc-200 hover:border-white text-xs font-black uppercase flex items-center gap-2">
            <Video className="w-4 h-4 text-blue-400" /> Video
          </button>
          <button onClick={onEnd} className="px-6 py-2 border-2 border-red-500 text-red-500 hover:bg-red-500 hover:text-black font-black uppercase text-[10px] tracking-widest transition-colors ml-4">
            End Session
          </button>
        </div>
      </div>

      {/* INCOMING CALL OVERLAY */}
      {incomingCallData && !isInCall && (
        <div className="absolute inset-0 z-60 flex items-center justify-center p-6 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md p-6 bg-zinc-950 border-2 border-white shadow-[8px_8px_0px_rgba(255,255,255,0.2)] text-center">
            <h3 className="text-lg font-black text-white uppercase tracking-widest mb-2">Incoming {incomingCallData.mode} Call</h3>
            <p className="text-xs text-zinc-400 uppercase font-bold mb-6">From {incomingCallData.fromName}</p>
            <div className="flex gap-4">
              <button onClick={rejectCall} className="flex-1 py-3 bg-black border-2 border-red-500 text-red-500 font-black uppercase text-xs">Decline</button>
              <button onClick={acceptCall} className="flex-1 py-3 bg-green-500 border-2 border-green-500 text-black font-black uppercase text-xs">Answer</button>
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
          
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 custom-scrollbar flex flex-col">
            {isLoadingHistory ? (
              <div className="flex items-center justify-center h-full text-zinc-500">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-500 font-bold uppercase tracking-widest text-[10px]">
                <p>No message history</p>
              </div>
            ) : (
              messages.map((msg) => {
                const isSystem = msg.sender === 'system';
                const isModel = msg.sender === 'model';
                const bubbleStyle = isModel 
                  ? 'bg-white border-white text-black shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)]' 
                  : `bg-black ${tier.color} text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]`;

                return (
                  <div key={msg.id} className={`flex flex-col max-w-[85%] md:max-w-[70%] ${isSystem ? 'self-center' : isModel ? 'self-end items-end ml-auto' : 'self-start items-start'}`}>
                    {!isSystem && (
                      <span className="text-[9px] text-zinc-500 font-black uppercase tracking-widest mb-1">
                        {isModel ? modelName : (chatData.user || chatData.name)} • {msg.time}
                      </span>
                    )}
                    <div className={`p-3 border-2 font-bold text-sm leading-relaxed tracking-wider flex flex-col gap-2 ${bubbleStyle}`}>
                      {msg.media && (
                        <div className="w-full max-w-[260px] border-2 border-black/20 overflow-hidden rounded-xl">
                          <img src={msg.media} alt="attachment" className="w-full h-auto object-cover" />
                        </div>
                      )}
                      {msg.text && <div>{msg.text}</div>}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Smart Suggestions Bar */}
          <div className="bg-black border-t-2 border-zinc-800 p-2 flex items-center gap-2 overflow-x-auto custom-scrollbar shrink-0">
            <button 
              onClick={() => setAutoPilot(!autoPilot)}
              className={`flex items-center gap-1 px-3 py-1.5 border-2 text-[9px] font-black uppercase tracking-widest transition-colors shrink-0 ${autoPilot ? 'bg-blue-500/20 border-blue-500 text-blue-500' : 'border-zinc-700 text-zinc-500 hover:text-white'}`}
            >
              <Bot className="w-3 h-3" /> Auto-Pilot {autoPilot ? 'ON' : 'OFF'}
            </button>
            <div className="w-0.5 h-4 bg-zinc-700 mx-1 shrink-0" />
            <Sparkles className="w-3 h-3 text-yellow-500 shrink-0" />
            {smartSuggestions.map((sug, i) => (
              <button 
                key={i} onClick={() => setInputText(sug)}
                className="whitespace-nowrap px-3 py-1 border border-zinc-700 bg-zinc-900 text-zinc-400 text-[10px] font-bold uppercase hover:bg-white hover:text-black transition-colors"
              >
                {sug}
              </button>
            ))}
          </div>

          {/* Chat Input */}
          <div className="p-4 bg-zinc-950 border-t-2 border-zinc-800 shrink-0 relative z-30">
            {showEmojiPicker && (
              <div className="absolute bottom-[calc(100%+10px)] left-16 z-50 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] border-2 border-zinc-700 bg-black">
                <EmojiPicker 
                  theme={theme}
                  onEmojiClick={handleEmojiSelect}
                  searchDisabled={true}
                  skinTonesDisabled={true}
                  height={350}
                  width={300}
                />
              </div>
            )}

            <div className="flex flex-col gap-2">
              {attachedMedia && (
                <div className="flex items-center gap-4 bg-black border-2 border-zinc-700 p-2 w-max">
                  <img src={attachedMedia} alt="preview" className="w-12 h-12 object-cover border-2 border-zinc-800" />
                  <div className="flex flex-col pr-2">
                    <span className="text-[9px] font-black uppercase text-zinc-400">Attached File</span>
                    <span className="text-[10px] font-bold text-white uppercase">Ready to send</span>
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
                  value={inputText} onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={autoPilot ? "BOT IS MANAGING THIS CONVERSATION..." : "TYPE A MESSAGE..."}
                  disabled={autoPilot}
                  className="flex-1 bg-black border-2 border-zinc-700 p-3 text-white font-bold text-sm resize-none outline-none focus:border-white transition-colors custom-scrollbar disabled:opacity-50"
                  rows="2"
                />
                <button 
                  onClick={() => handleSend()} disabled={(!inputText.trim() && !attachedMedia) || autoPilot}
                  className="w-24 bg-white border-2 border-white text-black flex flex-col items-center justify-center gap-1 font-black uppercase tracking-widest hover:bg-black hover:text-white disabled:opacity-50 transition-colors"
                >
                  <Send className="w-5 h-5" />
                  <span className="text-[10px]">SEND</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Profile Panel */}
        <div className="hidden lg:flex w-80 bg-black flex-col p-6 overflow-y-auto custom-scrollbar border-l-2 border-zinc-800">
          <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest border-b-2 border-zinc-800 pb-2 mb-6">Target Profile</h3>
          {chatData.avatar ? (
            <img src={chatData.avatar} alt="User" className={`w-full h-48 object-cover border-2 ${tier.color} grayscale mb-4`} />
          ) : (
            <div className={`w-full h-48 border-2 bg-zinc-900 ${tier.color} flex items-center justify-center text-xl font-bold text-white mb-4`}>
              {(chatData.user || chatData.name || 'U').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="text-[8px] text-zinc-500 font-black uppercase block">LIFETIME SPEND</label>
              <div className={`text-sm font-black uppercase tracking-widest ${tier.text}`}>${chatData.lifetimeSpend}</div>
            </div>
            <div>
              <label className="text-[8px] text-zinc-500 font-black uppercase block">BIO</label>
              <div className={`text-[10px] font-bold text-zinc-400 mt-1`}>{chatData.bio || 'No bio provided'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* MEDIA VAULT MODAL */}
      {showMediaVault && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowMediaVault(false)} />
          <div className="relative w-full max-w-2xl bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] flex flex-col animate-in zoom-in-95 duration-200 h-[80vh]">
            <div className="p-4 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center shrink-0">
              <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-zinc-400" /> [{modelName.toUpperCase()}] APPROVED MEDIA VAULT
              </h2>
              <button onClick={() => setShowMediaVault(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-6">Select an approved image from this profile's gallery to send in chat.</p>
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
                      <img src={mediaObj.url || mediaObj.media_url} alt="vault item" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-[10px] font-black text-white uppercase tracking-widest border-2 border-white px-3 py-1">SELECT</span>
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
    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 p-6 items-center justify-center max-w-6xl mx-auto w-full">
      <div className="col-span-full text-center text-xs font-semibold text-zinc-400">
        {callMode === 'video' ? 'Video call' : 'Audio call'} • {connectedCount} participant{connectedCount === 1 ? '' : 's'} • {formatDuration(callElapsedSec)}
      </div>
      
      <div className="w-full h-full max-h-[52vh] rounded-3xl flex flex-col items-center justify-center relative overflow-hidden shadow-2xl gap-4 bg-zinc-900 border border-zinc-800">
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
        <div className="text-sm font-semibold z-10 px-3 py-1.5 rounded-lg bg-black/50 text-white">You</div>
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
                        backgroundColor: active ? '#22c55e' : 'rgba(100,116,139,0.3)' 
                      }} 
                    />
                  );
                })}
              </div>
            </>
          ) : (
            <div className="inline-flex items-center gap-2 mt-2">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              <span>Mic off</span>
            </div>
          )}
        </div>
      </div>

      <div className="w-full h-full max-h-[52vh] rounded-3xl flex flex-col items-center justify-center relative overflow-hidden shadow-2xl gap-4 bg-zinc-900 border border-zinc-800">
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
            <div className="text-xs z-10 text-zinc-400">Ringing...</div>
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