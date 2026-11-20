import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  ArrowLeft, MoreVertical, Phone, Video, Send, Image as ImageIcon, 
  Smile, CheckCircle2, Paperclip, Mic, ShieldAlert, Ban, 
  Trash2, BellOff, X, MapPin, ChevronRight, Info, Heart,
  MessageSquare, PhoneOff, Loader2, Headphones, MicOff
} from 'lucide-react';
import { toast } from 'sonner';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useParticipants,
  useLocalParticipant,
  TrackToggle,
  useTracks,
  VideoTrack,
} from '@livekit/components-react';
import { Track, LocalAudioTrack } from 'livekit-client';

// Services & Hooks
import { chatService } from '../../api/chat.service';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useAppStore } from '../../store/useAppStore';
import { apiClient } from '../../api/client';
import { useI18n } from '../../i18n';
import { LIVEKIT_URL } from '../../config/backend';

// ============================================================================
// FALLBACK MOCK DATA (For Partner Profile Info - Until User Service is Added)
// ============================================================================
const FALLBACK_PARTNER = {
  id: 'usr_001',
  name: 'ELENA',
  age: 24,
  location: 'BROOKLYN, NY',
  matchPct: 98,
  status: 'online',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
  bio: "LOOKING FOR SOMEONE TO EXPLORE THE CITY AND DRINK COFFEE AT 3 AM. IF YOU LOVE LATE NIGHT DRIVES, INDIE MUSIC, AND FINDING THE BEST TACOS IN TOWN, WE'LL GET ALONG PERFECTLY.",
  sharedMedia: [
    'https://images.unsplash.com/photo-1511746315387-c4a76990fdce?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1513360371669-4adf3dd7dff8?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=200&q=80'
  ]
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function DirectMessage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const fallbackPartnerBio = t('fallbackPartnerBio');
  const { userId } = useParams(); // DM Room ID or Target User ID
  
  // --- STORE & WEBSOCKET ---
  const currentUser = useAppStore(state => state.user);
  const messages = useAppStore(state => state.messages);
  const setMessages = useAppStore(state => state.setMessages);
  const addMessage = useAppStore(state => state.addMessage);
  
  // Initialize Live WebSocket Connection
  const { isConnected, publishMessage } = useWebSocket(userId);

  // --- CORE STATE ---
  const [messageInput, setMessageInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [chatPartner, setChatPartner] = useState(() => ({ ...FALLBACK_PARTNER, bio: fallbackPartnerBio }));

  useEffect(() => {
    setChatPartner((current) => current.id === FALLBACK_PARTNER.id
      ? { ...current, bio: fallbackPartnerBio }
      : current);
  }, [fallbackPartnerBio]);
  
  // --- UI TOGGLES ---
  const [showDrawer, setShowDrawer] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [callMode, setCallMode] = useState(null);
  const [callToken, setCallToken] = useState('');
  const [isConnectingCall, setIsConnectingCall] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState(null);
  const [callElapsedSec, setCallElapsedSec] = useState(0);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [swappedCamera, setSwappedCamera] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [micGain, setMicGain] = useState(1.0);
  const micGainRef = useRef(micGain);
  
  const messagesEndRef = useRef(null);
  const optionsRef = useRef(null);

  // Auto-publish microphone helper (placed inside LiveKitRoom children)
  function AutoPublishMic() {
    const { localParticipant } = useLocalParticipant();
    const publishedRef = useRef(null);
    const srcStreamRef = useRef(null);
    const gainNodeRef = useRef(null);
    useEffect(() => { micGainRef.current = micGain; }, [micGain]);

    useEffect(() => {
      if (!localParticipant) return;
      let mounted = true;
      let audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      const setup = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (!mounted) return;
          srcStreamRef.current = stream;
          const src = audioCtx.createMediaStreamSource(stream);
          const gainNode = audioCtx.createGain();
          gainNode.gain.value = micGainRef.current ?? 1.0;
          gainNodeRef.current = gainNode;
          const dest = audioCtx.createMediaStreamDestination();
          src.connect(gainNode);
          gainNode.connect(dest);

          const processedTrack = dest.stream.getAudioTracks()[0];

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
        if (gainNodeRef.current) {
          try { gainNodeRef.current.disconnect(); } catch (e) {}
          gainNodeRef.current = null;
        }
      };
    }, [localParticipant]);

    useEffect(() => {
      if (gainNodeRef.current) gainNodeRef.current.gain.value = micGain;
    }, [micGain]);

    return null;
  }

  // ============================================================================
  // EFFECTS & HANDLERS
  // ============================================================================
  
  // Fetch Historical Messages on Mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const history = await chatService.getChatHistory(userId);
        const formatted = history.map(msg => ({
          id: msg.id,
          text: msg.content,
          time: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isMe: msg.sender_id === currentUser?.id,
          status: msg.status || 'read',
          type: 'text'
        }));
        setMessages(formatted);
      } catch (error) {
        console.error("Failed to load DM history:", error);
        toast.error(t('chatHistoryFetchFailed'));
      }
    };
    
    if (userId) loadHistory();

    // Clear messages when leaving DM
    return () => setMessages([]);
  }, [userId, currentUser, setMessages, t]);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Click outside to close options menu
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (optionsRef.current && !optionsRef.current.contains(event.target)) {
        setShowOptions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!callStartedAt || !callMode) {
      setCallElapsedSec(0);
      return;
    }

    const id = setInterval(() => {
      setCallElapsedSec(Math.floor((Date.now() - callStartedAt) / 1000));
    }, 1000);

    return () => clearInterval(id);
  }, [callStartedAt, callMode]);

  const startCall = async (mode) => {
    setCallMode(mode);
    setIsConnectingCall(true);

    try {
      const roomSuffix = [String(currentUser?.id || 'me'), String(userId || 'peer')].sort().join('_');
      const roomId = `dm_call_${roomSuffix}`;
      const response = await apiClient.post('/rooms/voice-token', {
        room_id: roomId,
        participant_name: currentUser?.name || 'Guest',
      });

      if (!response?.data?.token) {
        throw new Error('No voice token returned');
      }

      setCallToken(response.data.token);
      setCallStartedAt(Date.now());
      toast.success(t('callConnected', { type: t(mode === 'video' ? 'video' : 'audio') }));
    } catch (error) {
      console.error('Failed to start call:', error);
      toast.error(t('callConnectFailed'));
      setCallMode(null);
      setCallToken('');
      setCallStartedAt(null);
    } finally {
      setIsConnectingCall(false);
    }
  };

  const endCall = () => {
    setCallMode(null);
    setCallToken('');
    setCallStartedAt(null);
    setCallElapsedSec(0);
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!messageInput.trim()) return;
    
    // 1. Send to Go WebSocket Hub
    publishMessage(messageInput);

    // 2. Optimistic UI Update locally
    addMessage({
      id: Date.now().toString(),
      text: messageInput,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMe: true,
      status: 'sent',
      type: 'text'
    });
    
    setMessageInput('');
  };

  // Group messages for strict bubble style
  const groupedMessages = (messages || []).reduce((acc, curr, i) => {
    const prev = messages[i - 1];
    if (prev && prev.isMe === curr.isMe) {
      acc[acc.length - 1].msgs.push(curr);
    } else {
      acc.push({ isMe: curr.isMe, msgs: [curr] });
    }
    return acc;
  }, []);

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-1 bg-black font-mono text-zinc-300 overflow-hidden relative rounded-none">
      
      {/* =====================================================================
          MAIN CHAT AREA (Pane 1)
          ===================================================================== */}
      <div className="flex-1 flex flex-col min-w-0 h-full basis-full md:basis-[60%] shrink-0 relative z-10 bg-black">
        
        {/* HEADER */}
        <header className="h-16 px-4 border-b-2 border-zinc-800 bg-zinc-950 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-3 md:gap-4">
            <button 
              onClick={() => navigate(-1)}
              className="p-2 -ml-2 text-zinc-500 hover:text-white rounded-none border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors md:hidden"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            
            <div 
              onClick={() => setShowDrawer(true)}
              className="flex items-center gap-3 cursor-pointer group"
            >
              <div className="relative">
                <img 
                  src={chatPartner.avatar} 
                  alt={chatPartner.name} 
                  className="w-10 h-10 rounded-none object-cover grayscale border-2 border-zinc-700 group-hover:border-white transition-colors" 
                />
                {chatPartner.status === 'online' && (
                  <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-black rounded-none"></span>
                )}
              </div>
              <div className="flex flex-col">
                <h2 className="text-xs font-bold text-white uppercase tracking-widest group-hover:text-white transition-colors">
                  {chatPartner.name}
                </h2>
                {isTyping ? (
                  <p className="text-[9px] text-zinc-300 font-bold uppercase tracking-widest">{t('typing')}</p>
                ) : (
                  <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">
                    {isConnected ? t('liveConnection') : (chatPartner.status === 'online' ? t('online') : t('offline'))}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 md:gap-2 text-zinc-500">
            <button 
              onClick={() => startCall('audio')}
              className="p-2.5 hover:text-white hover:bg-zinc-900 rounded-none border-2 border-transparent hover:border-zinc-700 transition-colors"
            >
              <Phone className="w-4 h-4" />
            </button>
            <button 
              onClick={() => startCall('video')}
              className="p-2.5 hover:text-white hover:bg-zinc-900 rounded-none border-2 border-transparent hover:border-zinc-700 transition-colors"
            >
              <Video className="w-4 h-4" />
            </button>
            
            <div className="relative" ref={optionsRef}>
              <button 
                onClick={() => setShowOptions(!showOptions)}
                className={`p-2.5 rounded-none transition-colors border-2 ${showOptions ? 'bg-zinc-900 text-white border-zinc-700' : 'hover:text-white hover:bg-zinc-900 border-transparent hover:border-zinc-700'}`}
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              
              {/* Dropdown Menu */}
              {showOptions && (
                <div className="absolute right-0 top-full z-30 mt-2 w-[clamp(12rem,24vw,16rem)] overflow-hidden border-2 border-zinc-700 bg-zinc-950 shadow-xl rounded-none animate-in fade-in slide-in-from-top-2 duration-200">
                  <button onClick={() => { setShowDrawer(true); setShowOptions(false); }} className="w-full text-left px-4 py-3 text-xs uppercase tracking-widest text-zinc-300 hover:bg-zinc-900 hover:text-white transition-colors flex items-center gap-2">
                    <Info className="w-4 h-4" /> {t('viewProfile')}
                  </button>
                  <button onClick={() => { toast(t('notificationsMuted')); setShowOptions(false); }} className="w-full text-left px-4 py-3 text-xs uppercase tracking-widest text-zinc-300 hover:bg-zinc-900 hover:text-white transition-colors flex items-center gap-2">
                    <BellOff className="w-4 h-4" /> {t('muteChat')}
                  </button>
                  <div className="h-0.5 bg-zinc-800 my-1" />
                  <button onClick={() => { toast.error(t('userReported')); setShowOptions(false); }} className="w-full text-left px-4 py-3 text-xs uppercase tracking-widest text-zinc-300 hover:bg-zinc-900 hover:text-white transition-colors flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4" /> {t('reportUser')}
                  </button>
                  <button onClick={() => { toast.error(t('userBlocked')); navigate(-1); }} className="w-full text-left px-4 py-3 text-xs uppercase tracking-widest text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-2 border-none">
                    <Ban className="w-4 h-4" /> {t('block')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* MESSAGE FEED */}
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-2 sm:p-3 lg:p-4 space-y-4">
          
          <div className="flex flex-col items-center justify-center py-6 border-b-2 border-dashed border-zinc-800">
            <div className="w-24 h-24 rounded-none p-1 border-2 border-zinc-800 mb-4 bg-zinc-950">
              <img src={chatPartner.avatar} alt={chatPartner.name} className="w-full h-full rounded-none object-cover grayscale" />
            </div>
            <h3 className="text-sm font-bold text-white mb-1 uppercase tracking-widest">{chatPartner.name}</h3>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-4">{t('encrypted')}</p>
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-300 bg-zinc-950 border-2 border-zinc-800 px-4 py-1.5 rounded-none">
              {t('secureTransmission')}
            </span>
          </div>
          
          {groupedMessages.map((group, groupIndex) => (
            <div key={groupIndex} className={`flex flex-col w-full ${group.isMe ? 'items-end' : 'items-start'}`}>
              
              <div className={`flex flex-col gap-1 max-w-[85%] md:max-w-[70%] ${group.isMe ? 'items-end' : 'items-start'}`}>
                {group.msgs.map((msg, msgIdx) => {
                  const isLast = msgIdx === group.msgs.length - 1;
                  
                  return (
                    <div key={msg.id} className={`flex items-end gap-2 ${group.isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                      
                      {/* Avatar for their messages (only on last message of block) */}
                      {!group.isMe && isLast && (
                        <img src={chatPartner.avatar} alt={t('profilePhotoAlt')} className="w-6 h-6 rounded-none object-cover grayscale border-2 border-zinc-700 shrink-0 mb-1" />
                      )}
                      {!group.isMe && !isLast && (
                        <div className="w-6 h-6 shrink-0" /> // Spacer
                      )}

                      <div className={`chat-bubble ${group.isMe ? 'chat-bubble--mine' : 'chat-bubble--other'} max-w-full border px-4 py-2.5 text-xs leading-relaxed shadow-lg md:text-sm
                        ${group.isMe 
                          ? 'border-white/80 bg-gradient-to-br from-white to-zinc-100 text-zinc-950 shadow-white/5'
                          : 'border-zinc-700 bg-gradient-to-br from-zinc-900 to-black text-zinc-100 shadow-black/30'
                        }
                      `}>
                        {msg.text}
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* Timestamp & Status (Rendered once per group at the bottom) */}
              <div className={`flex items-center gap-1.5 mt-1.5 px-8 ${group.isMe ? 'justify-end' : 'justify-start'}`}>
                <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest">{group.msgs[group.msgs.length - 1].time}</span>
                {group.isMe && (
                  group.msgs[group.msgs.length - 1].status === 'read' 
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                    : <CheckCircle2 className="w-3.5 h-3.5 text-zinc-700" />
                )}
              </div>

            </div>
          ))}

          {/* Incoming Typing Indicator */}
          {isTyping && (
            <div className="flex items-end gap-2">
              <img src={chatPartner.avatar} alt={t('profilePhotoAlt')} className="w-6 h-6 rounded-none grayscale object-cover shrink-0 mb-1 border-2 border-zinc-700" />
              <div className="chat-bubble chat-bubble--other flex items-center gap-1 border border-zinc-800 bg-gradient-to-br from-zinc-900 to-black px-4 py-3.5 text-zinc-300">
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-none animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-none animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-none animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} className="h-2" />
        </div>

        {/* INPUT AREA */}
        <div className="p-3 md:p-4 bg-zinc-950 border-t-2 border-zinc-800 shrink-0">
          <form 
            onSubmit={handleSend}
            className="flex items-end gap-2 bg-black border-2 border-zinc-800 focus-within:border-white rounded-none p-1.5 transition-colors shadow-lg"
          >
            <div className="flex items-center gap-1 pb-1 px-1 shrink-0 bg-black">
              <button type="button" className="p-2.5 text-zinc-500 hover:text-white rounded-none border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <Paperclip className="w-4 h-4" />
              </button>
              <button type="button" className="hidden sm:block p-2.5 text-zinc-500 hover:text-white rounded-none border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <ImageIcon className="w-4 h-4" />
              </button>
            </div>

            <textarea
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(e);
                }
              }}
              placeholder={t('typeMessage')}
              rows={1}
              className="flex-1 bg-black border-2 border-zinc-800 focus:border-white outline-none text-white text-[10px] md:text-xs uppercase tracking-widest py-3 px-4 placeholders:text-zinc-700 resize-none max-h-[35dvh] custom-scrollbar rounded-none leading-relaxed"
              style={{ minHeight: '44px' }}
            />

            <div className="flex items-center gap-1 pb-1 pr-1 shrink-0 bg-black">
              {messageInput.trim() ? (
                <button 
                  type="submit"
                  className="p-3 bg-white text-black rounded-none border-2 border-white hover:bg-zinc-200 disabled:opacity-50 disabled:bg-zinc-800 transition-all scale-in flex items-center justify-center"
                >
                  <Send className="w-4 h-4" />
                </button>
              ) : (
                <button type="button" className="p-2.5 text-zinc-500 hover:text-white rounded-none border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                  <Mic className="w-4 h-4" />
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* =====================================================================
          RIGHT DRAWER: PARTNER PROFILE (Pane 2)
          ===================================================================== */}
      {showDrawer && (
        <>
          {/* Mobile Overlay visually structured as pane, but functions as drawer */}
          <div 
            className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm z-30 lg:hidden" 
            onClick={() => setShowDrawer(false)} 
          />
          
          <aside className="fixed md:relative inset-y-0 right-0 z-40 basis-full md:basis-[40%] bg-zinc-950 border-l-2 border-zinc-800 flex flex-col h-full shadow-2xl animate-in slide-in-from-right-full duration-300 rounded-none">
            
            {/* Drawer Header */}
            <div className="relative aspect-[2/1] max-h-[35dvh] shrink-0 border-b-2 border-zinc-800 bg-zinc-950">
              <img src={chatPartner.avatar} alt={chatPartner.name} className="w-full h-full object-cover grayscale opacity-60 rounded-none" />
              
              <button 
                onClick={() => setShowDrawer(false)}
                className="absolute top-4 right-4 w-8 h-8 bg-zinc-900 border-2 border-zinc-700 hover:border-white transition-colors rounded-none flex items-center justify-center text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
              
              <div className="absolute bottom-4 left-6 bg-black/80 p-2 border-2 border-zinc-800 rounded-none">
                <h2 className="text-lg font-bold text-white uppercase tracking-widest">{chatPartner.name}, {chatPartner.age}</h2>
                <div className="flex items-center gap-1.5 text-[9px] font-bold text-zinc-400 uppercase tracking-widest mt-1 rounded-none">
                  <MapPin className="w-3.5 h-3.5 text-red-400 rounded-none" /> {chatPartner.location}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
              
              {/* Actions */}
              <div className="flex justify-around border-b-2 border-zinc-800 pb-6 rounded-none">
                <button onClick={() => setShowDrawer(false)} className="flex flex-col items-center gap-2 group border-none">
                  <div className="w-12 h-12 rounded-none bg-zinc-950 group-hover:bg-zinc-900 border-2 border-zinc-800 group-hover:border-zinc-700 flex items-center justify-center text-zinc-300 transition-colors">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{t('messageSingular')}</span>
                </button>
                <button onClick={() => startCall('audio')} className="flex flex-col items-center gap-2 group border-none">
                  <div className="w-12 h-12 rounded-none bg-zinc-950 group-hover:bg-green-500/10 border-2 border-zinc-800 group-hover:border-green-700 flex items-center justify-center text-zinc-300 group-hover:text-green-400 transition-colors">
                    <Phone className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 group-hover:text-green-400">{t('audio')}</span>
                </button>
                <button onClick={() => startCall('video')} className="flex flex-col items-center gap-2 group border-none">
                  <div className="w-12 h-12 rounded-none bg-zinc-950 group-hover:bg-blue-500/10 border-2 border-zinc-800 group-hover:border-blue-700 flex items-center justify-center text-zinc-300 group-hover:text-blue-400 transition-colors">
                    <Video className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 group-hover:text-blue-400">{t('video')}</span>
                </button>
              </div>

              {/* Bio */}
              <div>
                <h3 className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-3">ABOUT {chatPartner.name}</h3>
                <p className="text-[10px] text-zinc-300 leading-relaxed bg-black p-4 border-2 border-zinc-800 rounded-none uppercase tracking-widest">
                  {chatPartner.bio}
                </p>
              </div>

              {/* Shared Media */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">{t('sharedMedia')}</h3>
                  <button className="text-[10px] text-white font-bold hover:text-zinc-300 border-none uppercase tracking-widest">{t('seeAll')}</button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {chatPartner.sharedMedia.map((url, i) => (
                    <div key={i} className="aspect-square rounded-none overflow-hidden border-2 border-zinc-800 cursor-pointer hover:opacity-80 transition-opacity">
                      <img src={url} alt={t('sharedMedia')} className="w-full h-full object-cover grayscale rounded-none" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </>
      )}

      {/* =====================================================================
          CALL MODALS (Audio/Video Engine Simulation)
          ===================================================================== */}
      {(callMode || isConnectingCall) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950 rounded-none">
          <div className="absolute inset-0 z-0 border-none rounded-none">
            <img src={chatPartner.avatar} alt="" className="w-full h-full object-cover grayscale opacity-10 blur-sm rounded-none border-none" />
            <div className="absolute inset-0 bg-black/70 rounded-none border-none" />
          </div>

          <div className="relative z-10 flex min-h-[70dvh] w-full max-w-5xl flex-col border-2 border-zinc-700 bg-black shadow-2xl">
            <div className="p-4 md:p-5 border-b-2 border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm md:text-base font-bold text-white uppercase tracking-widest">
                  {callMode === 'video' ? 'Video Call' : 'Audio Call'} with {chatPartner.name}
                </h3>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">
                  {isConnectingCall ? 'Connecting secure channel...' : `Call time ${formatCallDuration(callElapsedSec)}`}
                </p>
              </div>
              <button
                onClick={endCall}
                className="px-4 py-2 border-2 border-red-500 text-red-500 hover:bg-red-500 hover:text-black transition-colors text-[10px] font-black uppercase tracking-widest"
              >
                End
              </button>
            </div>

            {isConnectingCall && !callToken ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-zinc-400">
                  <Loader2 className="w-10 h-10 animate-spin" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Dialing {chatPartner.name}...</span>
                </div>
              </div>
            ) : callToken ? (
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
                <DirectMessageCallStage chatPartner={chatPartner} callMode={callMode} callElapsedSec={callElapsedSec} />

                <div className="p-5 border-t-2 border-zinc-800 flex items-center justify-center gap-4 bg-zinc-950">
                  <TrackToggle
                    source={Track.Source.Microphone}
                    className="w-14 h-14 rounded-full flex items-center justify-center border-2 border-zinc-700 text-zinc-200 hover:border-white hover:text-white transition-colors"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-zinc-400">{t('mic')}</label>
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
                  {callMode === 'video' && (
                    <TrackToggle
                      source={Track.Source.Camera}
                      className="w-14 h-14 rounded-full flex items-center justify-center border-2 border-zinc-700 text-zinc-200 hover:border-white hover:text-white transition-colors"
                    />
                  )}

                  <button
                    onClick={() => { setIsScreenSharing(!isScreenSharing); toast(t(isScreenSharing ? 'coreUiScreenShareStopped' : 'coreUiScreenShareStarted')); }}
                    className={`w-12 h-12 rounded-full flex items-center justify-center border-2 ${isScreenSharing ? 'bg-green-500 text-black border-green-500' : 'border-zinc-700 text-zinc-200'}`}
                    title={t('toggleScreenShare')}
                  >
                    <ImageIcon className="w-5 h-5" />
                  </button>

                  <button
                    onClick={() => { setSwappedCamera(!swappedCamera); toast(t('coreUiCameraSwitched')); }}
                    className="w-12 h-12 rounded-full flex items-center justify-center border-2 border-zinc-700 text-zinc-200"
                    title={t('swapCamera')}
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => { setSpeakerOn(!speakerOn); toast(t(speakerOn ? 'coreUiSpeakerOff' : 'coreUiSpeakerOn')); }}
                    className={`w-12 h-12 rounded-full flex items-center justify-center border-2 ${speakerOn ? 'border-white text-white' : 'border-zinc-700 text-zinc-200'}`}
                    title={t('toggleSpeaker')}
                  >
                    <Headphones className="w-5 h-5" />
                  </button>

                  <button
                    onClick={() => { setShowReactions(!showReactions); }}
                    className="w-12 h-12 rounded-full flex items-center justify-center border-2 border-zinc-700 text-zinc-200"
                    title={t('reactions')}
                  >
                    <Smile className="w-5 h-5" />
                  </button>

                  <button
                    onClick={() => {
                      // best-effort mute all request to backend
                      publishMessage && publishMessage(JSON.stringify({ type: 'mute_all', room_id: userId }));
                      toast(t('coreUiMuteAllRequested'));
                    }}
                    className="w-12 h-12 rounded-full flex items-center justify-center border-2 border-zinc-700 text-zinc-200"
                    title={t('muteAll')}
                  >
                    <MicOff className="w-5 h-5" />
                  </button>

                  <button
                    onClick={endCall}
                    className="w-14 h-14 rounded-full bg-red-500 text-white border-2 border-red-500 hover:bg-red-600 transition-colors flex items-center justify-center"
                  >
                    <PhoneOff className="w-6 h-6" />
                  </button>

                  {/* Reactions popover */}
                  {showReactions && (
                    <div className="absolute bottom-20 right-12 bg-black border-2 border-zinc-800 p-2 rounded-xl flex gap-2 z-40">
                      {['👍','❤️','🔥','😂','🎉'].map((emo) => (
                        <button key={emo} onClick={() => { publishMessage && publishMessage(emo); toast.success(t('reacted', { emoji: emo })); setShowReactions(false); }} className="p-2 text-xl">{emo}</button>
                      ))}
                    </div>
                  )}
                </div>
              </LiveKitRoom>
            ) : null}
          </div>
        </div>
      )}

    </div>
  );
}

function DirectMessageCallStage({ chatPartner, callMode, callElapsedSec }) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false });

  const remoteParticipants = participants.filter((p) => p.identity !== localParticipant?.identity);
  const primaryRemote = remoteParticipants[0] || null;
  const localCameraTrack = cameraTracks.find((t) => t.participant.identity === localParticipant?.identity);
  const remoteCameraTrack = cameraTracks.find((t) => t.participant.identity !== localParticipant?.identity);
  const connectedCount = remoteParticipants.length + 1;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-2 sm:gap-4 sm:p-3 md:grid-cols-2 lg:p-4">
      <div className="col-span-full flex items-center justify-between text-[10px] uppercase tracking-widest text-zinc-500 pb-1">
        <span>{connectedCount} participant{connectedCount === 1 ? '' : 's'} connected</span>
        <span>{callMode === 'video' ? 'Video session' : 'Audio session'} • {formatCallDuration(callElapsedSec)}</span>
      </div>

      <div className="relative flex min-h-[35dvh] flex-col items-center justify-center gap-4 overflow-hidden border-2 border-zinc-800 bg-zinc-950 p-6">
        {callMode === 'video' && localCameraTrack ? (
          <>
            <VideoTrack trackRef={localCameraTrack} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(var(--shadow-rgb), 0.7), transparent)' }} />
          </>
        ) : (
          <div className="w-24 h-24 rounded-full border-2 border-zinc-700 bg-black flex items-center justify-center text-2xl text-zinc-400 font-bold z-10">
            {(localParticipant?.name || 'You').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="text-center z-10 px-3 py-1.5 bg-black/50 border border-zinc-700">
          <p className="text-xs font-black uppercase tracking-widest text-white">{t('you')}</p>
          <p className="text-[10px] uppercase tracking-widest text-zinc-300">Microphone {localParticipant?.isMicrophoneEnabled ? 'on' : 'off'}</p>
          <div className="mt-2 inline-block h-2 w-[clamp(6rem,15vw,9rem)] overflow-hidden bg-zinc-800 rounded">
            <span className="block h-full bg-emerald-400" style={{ width: `${Math.min(100, Math.round((localParticipant?.audioLevel ?? localParticipant?.audio_level ?? 0) * 200))}%`, transition: 'width 120ms linear' }} />
          </div>
        </div>
      </div>

      <div className="relative flex min-h-[35dvh] flex-col items-center justify-center gap-4 overflow-hidden border-2 border-zinc-800 bg-zinc-950 p-6">
        {callMode === 'video' && remoteCameraTrack && (
          <>
            <VideoTrack trackRef={remoteCameraTrack} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
          </>
        )}
        {primaryRemote ? (
          <>
            {(!remoteCameraTrack || callMode !== 'video') && (
              <div className="w-24 h-24 rounded-full border-2 bg-black flex items-center justify-center text-2xl font-bold z-10" style={{ borderColor: primaryRemote.isSpeaking ? 'rgba(var(--success-rgb), 0.9)' : undefined, boxShadow: primaryRemote.isSpeaking ? '0 0 30px rgba(var(--success-rgb), 0.25)' : undefined, transform: primaryRemote.isSpeaking ? 'scale(1.04)' : undefined }}>
                {(primaryRemote.name || chatPartner.name || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="text-center z-10 px-3 py-1.5 bg-black/50 border border-zinc-700">
              <p className="text-xs font-black uppercase tracking-widest text-white">{primaryRemote.name || chatPartner.name}</p>
              <p className="text-[10px] uppercase tracking-widest text-zinc-300">
                {primaryRemote.isSpeaking ? 'Speaking' : 'Connected'} • Mic {primaryRemote.isMicrophoneEnabled ? 'on' : 'off'}
              </p>
              <div className="mt-2 inline-block h-2 w-[clamp(6rem,15vw,9rem)] overflow-hidden bg-zinc-800 rounded">
                <span className="block h-full bg-emerald-400" style={{ width: `${Math.min(100, Math.round(((primaryRemote?.audioLevel ?? primaryRemote?.audio_level) || 0) * 200))}%`, transition: 'width 120ms linear' }} />
              </div>
            </div>
          </>
        ) : (
          <>
            <img src={chatPartner.avatar} alt={chatPartner.name} className="w-24 h-24 rounded-full border-2 border-zinc-700 object-cover grayscale z-10" />
            <div className="text-center z-10 px-3 py-1.5 bg-black/50 border border-zinc-700">
              <p className="text-xs font-black uppercase tracking-widest text-white">{chatPartner.name}</p>
              <p className="text-[10px] uppercase tracking-widest text-zinc-300">{t('ringing')}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatCallDuration(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const secs = (totalSeconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}