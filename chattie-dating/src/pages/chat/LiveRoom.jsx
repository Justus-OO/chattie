import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  Send, Image as ImageIcon, Smile, Paperclip, MoreVertical, 
  Users, ChevronLeft, Info, Bell, BellOff, MapPin, Star,
  Heart, X, ShieldAlert, Circle, Activity, Mic, MicOff, 
  Headphones, Lock, MessageSquare, Crown, Upload, Loader2,
  Reply, Phone, PhoneOff, Video, Share2, ShieldCheck, UserCheck, Copy, Check, KeyRound
} from 'lucide-react';
import { toast } from 'sonner';
import EmojiPicker from 'emoji-picker-react';

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
import { Track, LocalAudioTrack } from 'livekit-client';

// Services & Hooks
import { useAppStore } from '../../store/useAppStore';
import { chatService } from '../../api/chat.service';
import { apiClient } from '../../api/client';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || "ws://localhost:7880";

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

// Fallbacks for empty rooms
const FALLBACK_PARTICIPANTS = [
  { id: 'usr_1', name: 'Elena', role: 'admin', status: 'online', isSpeaking: true, avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80', age: 24, location: 'Brooklyn, NY', matchPct: 98, bio: 'Coffee addict and late-night coder.' }
];

const ActiveVoiceGrid = () => {
  const participants = useParticipants();
  return (
    <div className="flex flex-wrap justify-center gap-6">
      {participants.map(p => (
        <div key={p.identity} className="flex flex-col items-center gap-2">
          <div className={`w-20 h-20 rounded-full border-4 ${p.isSpeaking ? 'border-green-500 animate-pulse' : 'border-zinc-700'} flex items-center justify-center bg-zinc-900 overflow-hidden`}>
            {p.metadata ? (
              <img src={JSON.parse(p.metadata)?.avatar} alt={p.identity} className="w-full h-full object-cover grayscale" />
            ) : (
              <Users className="w-8 h-8 text-zinc-500" />
            )}
          </div>
          <span className="text-[10px] font-black uppercase text-zinc-300 tracking-widest">{p.name || p.identity}</span>
        </div>
      ))}
    </div>
  );
};

export default function LiveRoom() {
  const navigate = useNavigate();
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

  // --- CORE STATE ---
  const [messages, setMessages] = useState([]);
  const wsRef = useRef(null);
  const [roomParticipants, setRoomParticipants] = useState([]);
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

  // --- PRIVATE CALL STATE ---
  const [privateCallToken, setPrivateCallToken] = useState("");
  const [isInPrivateCall, setIsInPrivateCall] = useState(false);
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

  // --- AUDIO LOGIC PRESERVATION ---
  const audioCtxRef = useRef(null);
  const [ringtoneProfile, setRingtoneProfile] = useState('sweet');
  const [micGain, setMicGain] = useState(1.0);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const micGainRef = useRef(micGain);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);

  const participantsForSidebar = roomParticipants.length > 0 ? roomParticipants : FALLBACK_PARTICIPANTS;
  const onlineCount = participantsForSidebar.filter((p) => (p.status || '').toLowerCase() === 'online').length;
  const isUserAdmin = roomAdminData?.userRole === 'creator' || roomAdminData?.userRole === 'admin';

  const userTier = currentUser?.tier || 'PREMIUM';
  const canViewFullProfiles = userTier === 'PREMIUM' || userTier === 'VIP';
  const canUseVoiceChannel = userTier === 'PREMIUM' || userTier === 'VIP';
  const canSendMedia = userTier === 'PREMIUM' || userTier === 'VIP';
  
  // Conditionally render the voice/text tabs only if the room has voice enabled
  const roomHasVoiceFeatures = selectedRoom?.hasVoice !== false;

  // ============================================================================
  // INITIALIZATION & MEMBERSHIP CHECK
  // ============================================================================
  useEffect(() => {
    const initializeRoomAccess = async () => {
      try {
        const res = await chatService.getRoomAdminDetails(roomId);
        setRoomAdminData(res);
        setSelectedRoom(res);
        
        if (res.userRole && res.userRole !== 'guest') {
          setMembershipStatus('member');
        } else if (res.isPrivate) {
          setMembershipStatus('locked');
        } else {
          setMembershipStatus('member');
        }
      } catch (err) {
        console.error("Access verification failed:", err);
        try {
          const rooms = await chatService.getAllRooms();
          const found = rooms.find(r => String(r.id) === String(roomId));
          if (found) {
            setSelectedRoom(found);
            setMembershipStatus(found.isPrivate ? 'locked' : 'member');
          } else {
            setMembershipStatus('locked');
          }
        } catch (e) {
          setMembershipStatus('locked');
        }
      }
    };
    if (roomId) initializeRoomAccess();
  }, [roomId]);

  // ============================================================================
  // EFFECTS: LOAD HISTORY & CONNECT TEXT WEBSOCKET
  // ============================================================================
  useEffect(() => {
    if (membershipStatus !== 'member') return;

    const loadHistory = async () => {
      try {
        const history = await chatService.getChatHistory(roomId, 'room');
        const historyArray = Array.isArray(history) ? history : [];
        const formatted = historyArray.map(msg => ({
          id: msg.id,
          sender: msg.sender_id === currentUser?.id ? 'You' : (msg.sender_name || 'User'),
          text: msg.content || msg.text,
          media: msg.media || null,
          time: new Date(msg.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isMe: msg.sender_id === currentUser?.id,
          avatar: msg.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80'
        }));
        setMessages(formatted);
      } catch (error) {}
    };
    
    loadHistory();

    let token = appToken || '';
    if (!token) {
      try {
        const storedData = localStorage.getItem('chattie-session-storage');
        if (storedData) token = JSON.parse(storedData)?.state?.token || '';
      } catch (err) {}
    }

    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host || 'localhost:8080'}/ws?room_id=${roomId}&token=${encodeURIComponent(cleanToken)}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const incomingMsg = JSON.parse(event.data);
        if (incomingMsg.sender_id === currentUser?.id) return;

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
              text: incomingMsg.content || incomingMsg.text,
              media: incomingMsg.media || null,
              time: formatChatTimestamp(incomingMsg.created_at || Date.now()),
              isMe: false,
              avatar: incomingMsg.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80'
            }
          ];
        });
      } catch (err) { }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    };
  }, [roomId, membershipStatus, currentUser?.id, appToken]);

  // ============================================================================
  // GLOBAL NOTIFICATION SOCKET (For 1-on-1 Calls)
  // ============================================================================
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
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const notifyUrl = `${wsProtocol}//${window.location.host || 'localhost:8080'}/ws?token=${encodeURIComponent(cleanToken)}`;

    try {
      const nws = new WebSocket(notifyUrl);
      notificationSocketRef.current = nws;

      nws.onmessage = (ev) => {
        try {
          const incoming = JSON.parse(ev.data);
          if (incoming.type === 'incoming_call') {
            if (isInPrivateCall) {
              stopRingtone();
              return;
            }
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
            toast.error('Call was rejected');
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
  }, [appToken, isInPrivateCall]);

  useEffect(() => {
    if (incomingCallData) playRingtone(ringtoneProfile);
    else stopRingtone();
    return () => stopRingtone();
  }, [incomingCallData, ringtoneProfile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeMode, attachedMedia, typingUsers, replyingTo]);

  // ============================================================================
  // ADMIN MANAGEMENT SUITE HANDLERS
  // ============================================================================
  const handleKnockToJoin = async () => {
    try {
      await chatService.requestRoomAccess(selectedRoom.roomCode);
      setMembershipStatus('pending');
      toast.success('Access request sent! Waiting for admin approval.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to request room access.');
    }
  };

  const copyInviteLink = () => {
    if (!roomAdminData?.inviteLink) return;
    navigator.clipboard.writeText(roomAdminData.inviteLink);
    setCopiedLink(true);
    toast.success('Invite link copied to clipboard!');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // ============================================================================
  // REAL MEDIA VAULT LOGIC (Connected directly to backend)
  // ============================================================================
  const fetchVaultImages = async () => {
    setIsLoadingVault(true);
    try {
      const res = await apiClient.get('/settings/media');
      // The backend returns models.MediaItem { id, url, is_primary }
      if (Array.isArray(res.data)) {
        setVaultImages(res.data);
      } else {
        setVaultImages([]);
      }
    } catch (err) {
      console.error("Failed to fetch media vault", err);
      toast.error('Failed to load media vault.');
    } finally {
      setIsLoadingVault(false);
    }
  };

  // Fetch images whenever the modal is opened
  useEffect(() => {
    if (showMediaVault) {
      fetchVaultImages();
    }
  }, [showMediaVault]);

  const handleUploadMedia = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoadingVault(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      // Upload to backend user_media table
      await apiClient.post('/settings/media', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      // Immediately refresh the vault to show the newly uploaded image
      await fetchVaultImages();
      toast.success('Photo securely saved to your vault.');
    } catch (err) {
      toast.error('Upload failed. Check backend connection.');
    } finally {
      setIsLoadingVault(false);
      // Reset input so the user can upload the same file again if they want
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleMediaClick = () => {
    if (!canSendMedia) {
      toast.error('PREMIUM REQUIRED: Upgrade to send images and files.');
      return;
    }
    setShowMediaVault(true);
  };

  // ============================================================================
  // CHAT HANDLERS
  // ============================================================================
  const connectToVoice = async () => {
    setIsConnectingVoice(true);
    try {
      const res = await apiClient.post('/rooms/voice-token', {
        room_id: roomId,
        participant_name: currentUser.name
      });
      setVoiceToken(res.data.token);
    } catch (err) {
      toast.error("Failed to fetch Voice Token. Check your backend.");
    } finally {
      setIsConnectingVoice(false);
    }
  };

  const disconnectVoice = () => {
    setVoiceToken("");
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
      toast.error("Chat connection offline. Try refreshing the page.");
      return;
    }

    let finalContent = messageInput;
    if (replyingTo) {
      finalContent = `[REPLY]${replyingTo.text || 'Media'}[/REPLY]\n${messageInput}`;
    }

    const uniqueMsgId = `local-${Date.now()}-${Math.random()}`;
    const messagePayload = {
      id: uniqueMsgId,
      room_id: roomId,
      content: finalContent,
      text: finalContent,
      media: attachedMedia 
    };

    wsRef.current.send(JSON.stringify(messagePayload));

    setMessages(prev => [...prev, {
      id: uniqueMsgId,
      sender: 'You',
      text: finalContent,
      media: attachedMedia,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMe: true,
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
  // PRIVATE CALL HANDLERS 
  // ============================================================================
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
      toast.error('Failed to join private call.');
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
            if (!micEnabled && value > 0.001) setMicEnabled(true);
            rafRef.current = requestAnimationFrame(updateLevel);
          };
          updateLevel();
  
          if (LocalAudioTrack && localParticipant.publishTrack) {
            try {
              const localAudioTrack = new LocalAudioTrack(processedTrack);
              const publication = await localParticipant.publishTrack(localAudioTrack);
              publishedRef.current = { publication, localAudioTrack };
              return;
            } catch (e) {}
          }
  
          if (localParticipant.setMicrophoneEnabled) {
            await localParticipant.setMicrophoneEnabled(true);
          }
        } catch (e) {}
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

  // ============================================================================
  // RENDERING
  // ============================================================================
  if (membershipStatus === 'checking') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-black p-6 text-center font-mono text-zinc-300 w-full h-full">
        <Loader2 className="w-10 h-10 text-white animate-spin mb-4" />
        <h2 className="text-sm font-black text-white uppercase tracking-widest">VERIFYING LOUNGE ACCESS...</h2>
      </div>
    );
  }

  if (membershipStatus === 'locked' || membershipStatus === 'pending') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-black p-6 text-center font-mono text-zinc-300 w-full h-full">
        <div className="w-20 h-20 bg-zinc-950 border-2 border-zinc-800 flex items-center justify-center text-4xl mb-6 shadow-[8px_8px_0px_rgba(255,255,255,0.05)]">
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
              className="py-4 bg-white text-black border-2 border-white font-black uppercase tracking-widest text-xs hover:bg-zinc-200 transition-colors shadow-[4px_4px_0px_rgba(255,255,255,0.2)] flex items-center justify-center gap-2"
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
    <div className="flex w-full h-full bg-black text-zinc-300 font-mono overflow-hidden relative rounded-none" style={{ fontFamily: 'Roboto, sans-serif' }}>
      
      <div className="flex-1 flex flex-col min-w-0 h-full relative z-10">
        
        <header className="flex flex-col border-b-2 border-zinc-800 bg-black shrink-0 shadow-[0_4px_20px_rgba(0,0,0,0.5)] z-20">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => navigate('/rooms')}
                className="md:hidden p-2 border-2 border-zinc-800 hover:border-white hover:text-white transition-colors bg-zinc-950"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 border-2 bg-zinc-900 border-zinc-500 flex items-center justify-center font-bold text-white text-xl">
                  {selectedRoom.icon}
                </div>
                <div>
                  <h2 className="text-lg font-black text-white uppercase tracking-widest flex items-center gap-2">
                    {selectedRoom.name}
                  </h2>
                  <span className="text-[9px] font-bold text-green-400 uppercase tracking-widest flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-green-500 animate-pulse rounded-full" /> {onlineCount} ONLINE
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button 
                onClick={() => setShowShareModal(true)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 border-2 border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-white hover:text-white transition-colors text-[10px] font-black uppercase tracking-widest"
              >
                <Share2 className="w-3.5 h-3.5" /> Invite
              </button>

              {isUserAdmin && (
                <button 
                  onClick={() => setShowAdminModal(true)}
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
                onClick={() => setShowSidebar(!showSidebar)}
                className={`p-2 border-2 transition-colors flex items-center gap-2 ${showSidebar ? 'bg-white text-black border-white' : 'text-zinc-400 border-transparent hover:border-zinc-700 hover:bg-zinc-900 hover:text-white'}`}
              >
                <Users className="w-5 h-5" />
                <span className="hidden lg:inline text-[10px] font-black uppercase tracking-widest">PARTICIPANTS ({onlineCount})</span>
              </button>
            </div>
          </div>

          {roomHasVoiceFeatures && (
            <div className="flex border-t-2 border-zinc-800 px-4">
              <button 
                onClick={() => setActiveMode('text')}
                className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-colors flex items-center justify-center gap-2
                  ${activeMode === 'text' ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'}
                `}
              >
                <MessageSquare className="w-4 h-4" /> Text Lounge
              </button>
              <button 
                onClick={() => setActiveMode('voice')}
                className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-colors flex items-center justify-center gap-2
                  ${activeMode === 'voice' ? 'border-yellow-400 text-yellow-400' : 'border-transparent text-zinc-500 hover:text-yellow-400/50 hover:border-yellow-400/50'}
                `}
              >
                <Mic className="w-4 h-4" /> Voice Channel
                {!canUseVoiceChannel && <Lock className="w-3 h-3 ml-1" />}
              </button>
            </div>
          )}
        </header>

        {activeMode === 'text' && (
          <>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 space-y-6 bg-black relative">
              <div className="flex flex-col items-center justify-center py-8 text-center border-2 border-dashed border-zinc-800 mb-8 bg-zinc-950/50 mx-auto max-w-2xl">
                <div className="w-16 h-16 bg-black border-2 border-zinc-700 flex items-center justify-center text-3xl mb-4">
                  {selectedRoom.icon}
                </div>
                <h3 className="text-lg font-black text-white uppercase tracking-widest mb-2">WELCOME TO {selectedRoom.name}</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 max-w-sm leading-relaxed">
                  End-to-end encrypted session. Be respectful to others.
                </p>
              </div>

              {messages.map((msg, idx) => {
                const { quote, text } = parseMessageContent(msg.text);
                const showAvatar = !msg.isMe && (idx === 0 || messages[idx - 1]?.sender !== msg.sender);

                return (
                  <div key={msg.id} className={`flex gap-3 md:gap-4 w-full group ${msg.isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                    
                    {!msg.isMe && (
                      <div className="shrink-0 flex flex-col justify-end pb-1 w-10">
                        {showAvatar && (
                          <div className="relative">
                            <img 
                              src={msg.avatar} alt="avatar"
                              onClick={() => setSelectedProfile({ name: msg.sender, avatar: msg.avatar, role: 'member' })} 
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
                      {showAvatar && (
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                            {msg.sender}
                          </span>
                        </div>
                      )}
                      
                      <div className={`p-3 border-2 font-bold text-sm leading-relaxed tracking-wider flex flex-col gap-2
                        ${msg.isMe ? 'bg-white border-white text-black shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] rounded-[20px] rounded-br-sm' 
                                   : 'bg-black border-zinc-600 text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded-[20px] rounded-bl-sm'}
                      `}>
                        {quote && (
                          <div className={`pl-3 border-l-2 mb-2 italic text-xs ${msg.isMe ? 'border-black/20 text-black/70' : 'border-white/20 text-white/70'}`}>
                            {quote}
                          </div>
                        )}
                        {msg.media && <img src={msg.media} alt="attachment" className="max-w-[250px] border-2 border-black/20 overflow-hidden object-cover" />}
                        {text && <div>{text}</div>}
                      </div>
                      <span className="text-[9px] font-black tracking-widest text-zinc-500 mt-1">{msg.time}</span>
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

            <div className="p-4 bg-zinc-950 border-t-2 border-zinc-800 shrink-0 relative z-30">
              
              {showEmojiPicker && (
                <div className="absolute bottom-[calc(100%+10px)] left-16 bg-black border-2 border-zinc-700 p-2 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] z-50">
                  <EmojiPicker theme={theme} onEmojiClick={handleEmojiSelect} searchDisabled={true} skinTonesDisabled={true} height={350} width={300} />
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
                  <div className="hidden md:flex items-center gap-1 shrink-0 bg-black border-2 border-zinc-800 p-1">
                    <button onClick={handleMediaClick} className={`p-2 transition-colors border-2 relative ${canSendMedia ? 'text-zinc-500 hover:text-white border-transparent hover:border-zinc-700 hover:bg-zinc-900' : 'text-zinc-800 border-transparent cursor-not-allowed'}`}>
                      <ImageIcon className="w-4 h-4" />
                      {!canSendMedia && <Lock className="w-2.5 h-2.5 absolute top-1 right-1 text-zinc-600" />}
                    </button>
                    <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="p-2 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                      <Smile className="w-4 h-4" />
                    </button>
                  </div>

                  <textarea
                    value={messageInput}
                    onChange={handleTyping}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                    placeholder="TYPE A MESSAGE..."
                    className="flex-1 bg-black border-2 border-zinc-700 p-3 text-white font-bold text-sm resize-none outline-none focus:border-white transition-colors custom-scrollbar"
                    rows="2"
                  />

                  <button 
                    onClick={handleSendMessage}
                    disabled={(!messageInput.trim() && !attachedMedia)}
                    className="w-24 bg-white border-2 border-white text-black flex flex-col items-center justify-center gap-1 font-black uppercase tracking-widest hover:bg-black hover:text-white disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-black transition-colors"
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
          <div className="flex-1 bg-zinc-950 flex flex-col relative">
            {!canUseVoiceChannel ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <Crown className="w-16 h-16 text-yellow-500 mb-6 drop-shadow-[0_0_15px_rgba(234,179,8,0.5)]" />
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
                  className="px-10 py-4 bg-white text-black border-2 border-white font-black uppercase tracking-widest text-[10px] hover:bg-zinc-200 transition-colors shadow-[4px_4px_0px_rgba(255,255,255,0.2)] disabled:opacity-50"
                >
                  {isConnectingVoice ? 'CONNECTING...' : 'Connect to Audio'}
                </button>
              </div>
            ) : (
              <LiveKitRoom
                serverUrl={LIVEKIT_URL}
                token={voiceToken}
                connect={true}
                audio={true}
                className="flex-1 flex flex-col"
              >
                <RoomAudioRenderer />
                <AutoPublishMic />
                
                <div className="flex-1 p-6 md:p-12 overflow-y-auto custom-scrollbar">
                  <ActiveVoiceGrid />
                </div>

                <div className="p-6 bg-black border-t-2 border-zinc-800 flex items-center justify-center gap-6 z-20">
                  <TrackToggle 
                    source={Track.Source.Microphone} 
                    className="w-16 h-16 rounded-full flex items-center justify-center border-4 bg-black border-white text-white hover:bg-white hover:text-black transition-colors focus:outline-none" 
                  />

                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-zinc-400 font-black uppercase tracking-widest">Mic</label>
                    <input
                      type="range"
                      min="0.1" max="2" step="0.1" value={micGain}
                      onChange={(e) => setMicGain(parseFloat(e.target.value))}
                      className="w-24"
                    />
                  </div>

                  <button onClick={disconnectVoice} className="px-8 py-4 bg-black text-red-500 border-2 border-red-500 font-black uppercase tracking-widest text-[10px] hover:bg-red-500 hover:text-black transition-colors">
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
          <div className="relative w-full max-w-lg bg-black border-2 border-yellow-500/50 shadow-[8px_8px_0px_rgba(234,179,8,0.2)] flex flex-col z-10">
            <div className="p-4 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center">
              <h2 className="text-sm font-black text-yellow-400 uppercase tracking-widest flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> Room Admin Suite
              </h2>
              <button onClick={() => setShowAdminModal(false)} className="p-1 text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
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
                {!roomAdminData.pendingCount ? (
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest p-4 border-2 border-dashed border-zinc-800 text-center">No pending requests.</p>
                ) : (
                  <div className="space-y-2">
                    {/* Add approve/reject buttons mapping over pending requests if available */}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showShareModal && roomAdminData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowShareModal(false)} />
          <div className="relative w-full max-w-sm bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] flex flex-col z-10 p-6 text-center">
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
          <div className="w-full max-w-md p-6 bg-black border-2 border-white shadow-[8px_8px_0px_rgba(255,255,255,1)]">
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

      <aside className={`fixed inset-y-0 right-0 z-40 w-72 bg-black border-l-2 border-zinc-800 transform transition-transform duration-300 ease-in-out flex flex-col lg:relative lg:translate-x-0 lg:z-10 ${showSidebar ? 'translate-x-0' : 'translate-x-full lg:hidden'}`}>
        <div className="p-4 border-b-2 border-zinc-800 flex items-center justify-between shrink-0 bg-zinc-950">
          <h3 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
            <Users className="w-4 h-4 text-zinc-400" /> MEMBERS ({onlineCount})
          </h3>
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
                      {maskName(user.name)} {user.role === 'admin' && '⭐'}
                    </h5>
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
          
          <div className="relative w-full md:w-[400px] h-[85vh] md:h-full bg-black md:border-l-2 border-t-2 md:border-t-0 border-zinc-800 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] flex flex-col animate-in slide-in-from-bottom-full md:slide-in-from-right-full duration-300">
            
            <div className="h-48 relative shrink-0 bg-zinc-950 border-b-2 border-zinc-800 overflow-hidden">
              <img src={selectedProfile.avatar} alt="cover" className={`w-full h-full object-cover opacity-60 transition-all ${canViewFullProfiles ? 'grayscale' : 'blur-xl scale-110'}`} />
              
              <button onClick={() => setSelectedProfile(null)} className="absolute top-4 right-4 p-2 bg-black border-2 border-zinc-800 hover:bg-zinc-900 text-white transition-colors z-10">
                <X className="w-4 h-4" />
              </button>
              
              <div className="absolute bottom-4 left-6 bg-black/80 p-2 border-2 border-zinc-800">
                <h2 className="text-lg font-black text-white uppercase tracking-widest">{maskName(selectedProfile.name)}, {canViewFullProfiles ? selectedProfile.age : '??'}</h2>
                <div className="flex items-center gap-1.5 text-[9px] font-black text-zinc-400 uppercase tracking-widest mt-1">
                  <MapPin className="w-3 h-3 text-zinc-500" /> {canViewFullProfiles ? selectedProfile.location : '[LOCATION HIDDEN]'}
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
                    <p className="text-[10px] font-black uppercase tracking-widest">YOU ARE A {selectedProfile.matchPct}% MATCH.</p>
                  </div>
                  <div className="bg-zinc-950 p-4 border-2 border-zinc-800">
                    <h3 className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-3">ABOUT</h3>
                    <p className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest leading-relaxed">{selectedProfile.bio}</p>
                  </div>
                  <div className="pt-4 space-y-3">
                    <button onClick={() => { toast.success(`INVITE SENT TO ${selectedProfile.name.toUpperCase()}`); setSelectedProfile(null); }} className="w-full py-3 bg-white hover:bg-zinc-200 text-black text-[10px] font-black uppercase tracking-widest border-2 border-white transition-colors flex items-center justify-center gap-2">
                      <Heart className="w-4 h-4" /> INVITE TO PRIVATE CHAT
                    </button>
                    <button onClick={() => { toast('SYS: RECORD REPORTED.'); setSelectedProfile(null); }} className="w-full py-3 bg-black text-red-500 hover:bg-zinc-900 border-2 border-transparent hover:border-red-900 text-[10px] font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2">
                      <ShieldAlert className="w-4 h-4" /> REPORT USER
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* REAL MEDIA VAULT MODAL (Synced cleanly with backend) */}
      {showMediaVault && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowMediaVault(false)} />
          
          <div className="relative w-full max-w-2xl bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] flex flex-col animate-in zoom-in-95 duration-200 h-[80vh]">
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