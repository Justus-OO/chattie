import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Ban, CheckCheck, Flag, ImagePlus, Lock, MessageCircle,
  Paperclip, Search, Send, Settings2, ShieldCheck, Smile, Video, X, Phone, PhoneOff,
  Pin, PinOff, Reply, Loader2
} from 'lucide-react';
import { LiveKitRoom, RoomAudioRenderer, TrackToggle, useLocalParticipant, useParticipants, useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { toast } from 'sonner';
import MpesaPaystackModal from '../../components/afterdark/MpesaPaystackModal';
import { useAppDialogs } from '../../components/modals/useAppDialogs';
import { useAppStore } from '../../store/useAppStore';
import { afterDarkService } from '../../api/afterdark.service';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';
const CALL_REACTIONS = ['❤️', '👍', '😂', '🔥', '😮', '🙏'];
const getAfterDarkCallRoomId = (firstUserId, secondUserId) =>
  `ad_call_${[String(firstUserId), String(secondUserId)].sort().join('_')}`;

const normalizeConversation = conversation => {
  const participant = conversation.other_user || conversation.participant || conversation.creator || conversation.customer || {};
  const rawLastMessage = conversation.last_message;
  return {
    ...conversation,
    id: conversation.other_user_id || participant.user_id || participant.standardProfileId || participant.id || conversation.creator_id || conversation.customer_id,
    name: participant.display_name || participant.username || participant.name || 'After Dark member',
    avatar: participant.avatar_url || participant.avatar || '',
    online: Boolean(participant.is_online || participant.online),
    chatPrice: Number(conversation.chat_price ?? participant.chat_price ?? 0),
    conversationId: conversation.conversation_id || conversation.id,
    hasAccess: Boolean(conversation.has_access || conversation.is_unlocked || conversation.chat_access),
    dmControl: conversation.dm_control || participant.dm_control || 'all',
    chatPriceCents: Number(conversation.chat_price_cents || participant.chat_price_cents || 1000),
    lastMessage: rawLastMessage
      ? typeof rawLastMessage === 'string'
        ? { content: rawLastMessage, created_at: conversation.last_message_at }
        : rawLastMessage
      : null,
    blockedByMe: Boolean(conversation.blocked_by_me),
    blockedMe: Boolean(conversation.blocked_me),
  };
};

const normalizeMessage = (message, currentUserId) => ({
  ...message,
  id: message.id || message.message_id,
  text: message.text || message.content || '',
  isMine: message.is_mine ?? (message.sender_id
    ? message.sender_id === currentUserId
    : Boolean(message.sender === 'mine')),
  isExplicit: Boolean(message.isExplicit ?? message.is_explicit),
  isRead: Boolean(message.isRead ?? message.is_read),
  messageKind: message.messageKind || message.message_kind || 'chat',
  callMode: message.callMode || message.call_mode || '',
  replyToMessageId: message.replyToMessageId || message.reply_to_message_id || '',
  isPinned: Boolean(message.isPinned ?? message.is_pinned),
  reactions: Array.isArray(message.reactions) ? message.reactions : [],
  createdAt: message.createdAt || message.created_at || new Date().toISOString(),
  media: message.media || (message.media_url ? {
    url: message.media_url,
    type: message.media_type,
    name: message.media_name,
  } : null),
});

const mergeMessages = (currentMessages, incomingMessages) => {
  const messagesById = new Map(currentMessages.map(message => [message.id, message]));
  incomingMessages.forEach(message => {
    if (!message.id) return;
    messagesById.set(message.id, { ...messagesById.get(message.id), ...message });
  });
  return [...messagesById.values()].sort(
    (first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt),
  );
};

function MessageBubble({ message, isMine, revealExplicitByDefault, fontSize, theme, replyPreview, onReply, onPin, onReact, pinning }) {
  const [revealed, setRevealed] = useState(!message.isExplicit || revealExplicitByDefault);
  const hasMedia = Boolean(message.media?.url || message.media?.dataUrl);

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
      <article
        className={`group relative max-w-[min(82%,560px)] border-2 px-3 py-2 ${isMine ? 'border-zinc-600' : 'border-zinc-800'}`}
        style={{ backgroundColor: isMine ? theme.mine : theme.other, color: theme.text }}
      >
        {message.replyToMessageId && (
          <div className="mb-2 border-l-2 border-yellow-400 bg-black/30 px-2 py-1 text-[10px] text-zinc-400">
            <span className="block font-bold text-yellow-400">{replyPreview?.isMine ? 'You' : replyPreview?.senderName || 'Reply'}</span>
            <span className="block max-w-[clamp(10rem,45vw,18rem)] truncate">{replyPreview?.text || 'Replied to a message'}</span>
          </div>
        )}
        {message.isExplicit && !revealed && (
          <button type="button" onClick={() => setRevealed(true)} className="mb-2 flex w-full items-center gap-2 border-2 border-zinc-700 bg-black p-3 text-left text-[10px] font-bold text-zinc-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Explicit media hidden. Tap to reveal.
          </button>
        )}
        {hasMedia && (
          <div className="relative mb-2 overflow-hidden">
            {message.media.type === 'video' || message.media.type?.startsWith('video/') ? (
              <video src={message.media.url || message.media.dataUrl} controls={revealed} className={`max-h-[65dvh] max-w-full ${!revealed ? 'blur-xl' : ''}`} />
            ) : (
              <img src={message.media.url || message.media.dataUrl} alt={message.media.name || 'Shared media'} className={`max-h-[65dvh] max-w-full object-contain ${!revealed ? 'blur-xl' : ''}`} />
            )}
            {!revealed && <button type="button" onClick={() => setRevealed(true)} className="absolute inset-0" aria-label="Reveal explicit media" />}
          </div>
        )}
        {message.text && <p className={`whitespace-pre-wrap break-words ${fontSize} ${message.isExplicit && !revealed ? 'select-none blur-sm' : ''}`}>{message.text}</p>}
        {message.isExplicit && revealed && <p className="mt-1 text-[8px] font-bold uppercase tracking-widest text-zinc-500">18+ content</p>}
        {message.messageKind === 'call_event' && (
          <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-yellow-400">
            {message.callMode === 'video' ? 'Video call' : 'Voice call'}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-1 text-[8px] text-zinc-500">
          <time>{new Date(message.createdAt).toLocaleString()}</time>
          {isMine && <CheckCheck className={`h-3 w-3 ${message.isRead ? 'text-green-400' : ''}`} />}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-zinc-700/70 pt-1.5">
          {CALL_REACTIONS.map(emoji => {
            const reaction = message.reactions.find(item => item.emoji === emoji);
            return (
              <button key={emoji} type="button" onClick={() => onReact(message.id, emoji)} aria-label={`React ${emoji}`} className={`px-1.5 py-0.5 text-[10px] transition-colors ${reaction?.reacted ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:bg-zinc-800 hover:text-white'}`}>
                {emoji}{reaction?.count > 0 ? ` ${reaction.count}` : ''}
              </button>
            );
          })}
          <span className="flex-1" />
          <button type="button" onClick={() => onReply(message)} title="Reply" aria-label="Reply" className="p-1 text-zinc-500 hover:text-white"><Reply className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={pinning} onClick={() => onPin(message)} title={message.isPinned ? 'Unpin message' : 'Pin message'} aria-label={message.isPinned ? 'Unpin message' : 'Pin message'} className={`p-1 disabled:opacity-50 ${message.isPinned ? 'text-yellow-400' : 'text-zinc-500 hover:text-white'}`}>
            {pinning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : message.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
        </div>
      </article>
    </div>
  );
}

function AfterDarkCallStage({ peerName, mode }) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const remote = participants.find(participant => participant.identity !== localParticipant?.identity);
  const localCamera = cameraTracks.find(track => track.participant.identity === localParticipant?.identity);
  const remoteCamera = cameraTracks.find(track => track.participant.identity !== localParticipant?.identity);

  const tile = (participant, track, name, local = false) => (
    <div className="relative flex min-h-[35dvh] items-center justify-center overflow-hidden border-2 border-zinc-700 bg-zinc-950">
      {mode === 'video' && track ? (
        <VideoTrack trackRef={track} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className={`flex h-20 w-20 items-center justify-center border-2 ${local ? 'border-yellow-400' : 'border-green-400'} bg-black text-2xl font-black text-white`}>
          {(participant?.name || name || '?').charAt(0).toUpperCase()}
        </div>
      )}
      <span className="absolute bottom-3 left-3 bg-black/75 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-white">
        {local ? 'You' : participant?.name || name}
      </span>
      {!local && !participant && <span className="absolute top-3 right-3 text-[9px] uppercase tracking-widest text-yellow-400">Connecting…</span>}
    </div>
  );

  return (
    <div className={`grid w-full min-w-0 flex-1 gap-2 p-2 sm:gap-3 sm:p-3 ${mode === 'video' ? 'md:grid-cols-2' : 'md:grid-cols-2'}`}>
      {tile(localParticipant, localCamera, 'You', true)}
      {tile(remote, remoteCamera, peerName)}
    </div>
  );
}

export default function AfterDarkChatHub() {
  const { confirm, prompt } = useAppDialogs();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isCreator = useAppStore(state => state.isCreator || state.user?.isCreator || false);
  const currentUserId = useAppStore(state => state.user?.id || '');
  const currentUserName = useAppStore(state => state.user?.display_name || state.user?.name || state.user?.username || '');
  const appToken = useAppStore(state => state.token || '');
  const [selectedId, setSelectedId] = useState(searchParams.get('creator') || '');
  const [contacts, setContacts] = useState([]);
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [isExplicit, setIsExplicit] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [revealExplicitByDefault, setRevealExplicitByDefault] = useState(false);
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [chatPreferences, setChatPreferences] = useState({ theme: 'midnight', fontSize: 'normal', enterToSend: true });
  const [replyingTo, setReplyingTo] = useState(null);
  const [pinningMessageId, setPinningMessageId] = useState('');
  const [isConnectingCall, setIsConnectingCall] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [outgoingCall, setOutgoingCall] = useState(null);
  const [callToken, setCallToken] = useState('');
  const [callMode, setCallMode] = useState('audio');
  const [callPeerId, setCallPeerId] = useState('');
  const [callPeerName, setCallPeerName] = useState('');
  const [activeCallConversationId, setActiveCallConversationId] = useState('');
  const fileInputRef = useRef(null);
  const historyRef = useRef(null);
  const socketRef = useRef(null);
  const callSocketRef = useRef(null);
  const callTimeoutRef = useRef(null);
  const conversationIdRef = useRef(conversationId);
  const selectedIdRef = useRef(selectedId);
  const currentUserIdRef = useRef(currentUserId);
  const contactsRef = useRef(contacts);
  const incomingCallRef = useRef(incomingCall);
  const outgoingCallRef = useRef(outgoingCall);
  const callRoomIdRef = useRef('');
  const callTokenRef = useRef(callToken);
  const callConversationRef = useRef(activeCallConversationId);
  const callSignalHandlerRef = useRef(null);
  conversationIdRef.current = conversationId;
  selectedIdRef.current = selectedId;
  currentUserIdRef.current = currentUserId;
  contactsRef.current = contacts;
  incomingCallRef.current = incomingCall;
  outgoingCallRef.current = outgoingCall;
  callTokenRef.current = callToken;
  callConversationRef.current = activeCallConversationId;

  const selectedContact = contacts.find(contact => contact.id === selectedId);
  const routeCreator = useMemo(
    () => {
      if (!location.state?.creator) return null;
      const creator = location.state.creator;
      const access = location.state.chatAccess || {};
      return normalizeConversation({
        ...access,
        other_user_id: access.other_user_id || creator.standardProfileId || creator.user_id,
        other_user: creator,
      });
    },
    [location.state?.creator, location.state?.chatAccess],
  );
  const selectedCreator = isCreator ? null : selectedContact || (routeCreator?.id === selectedId ? routeCreator : null);
  const selectedName = selectedContact?.name;
  const selectedAvatar = selectedContact?.avatar;
  const hasChatAccess = Boolean(selectedContact?.hasAccess);
  const isBlocked = Boolean(selectedContact?.blockedByMe || selectedContact?.blockedMe);
  const fontSizeClass = { small: 'text-xs', normal: 'text-sm', large: 'text-base' }[chatPreferences.fontSize] || 'text-sm';
  const themeStyle = {
    midnight: { page: 'var(--app-bg)', panel: 'var(--surface)', mine: 'var(--surface-muted)', other: 'var(--surface-strong)', text: 'var(--text-primary)' },
    plum: { page: 'var(--app-bg)', panel: 'var(--surface)', mine: 'var(--accent-soft)', other: 'var(--surface-alt)', text: 'var(--text-primary)' },
    light: { page: 'var(--app-bg)', panel: 'var(--surface-strong)', mine: 'var(--accent-soft)', other: 'var(--surface)', text: 'var(--text-primary)' },
  }[chatPreferences.theme] || { page: 'var(--app-bg)', panel: 'var(--surface)', mine: 'var(--accent-soft)', other: 'var(--surface-strong)', text: 'var(--text-primary)' };
  const filteredContacts = contacts.filter(contact => contact.name.toLowerCase().includes(search.trim().toLowerCase()));
  const latestMessage = contact => contact.lastMessage;

  const openConversation = useCallback(async contact => {
    setIsLoadingMessages(true);
    setLoadError('');
    try {
      const thread = contact.conversationId
        ? { conversation_id: contact.conversationId }
        : await afterDarkService.initConversation(contact.id);
      const id = thread?.conversation_id || thread?.id;
      if (!id) throw new Error('The conversation service did not return a conversation ID.');
      const response = await afterDarkService.getMessages(id);
      const records = Array.isArray(response) ? response : response?.messages || response?.items || [];
      if (!Array.isArray(records)) throw new Error('The message service returned invalid history.');
      setConversationId(id);
      setMessages(records.map(message => normalizeMessage(message, currentUserId)).reverse());
      setContacts(current => current.map(item => item.id === contact.id ? {
        ...item,
        conversationId: id,
        hasAccess: thread.has_access ?? item.hasAccess,
        dmControl: thread.dm_control || item.dmControl,
        chatPriceCents: Number(thread.chat_price_cents || item.chatPriceCents || 1000),
      } : item));
      await afterDarkService.markConversationRead(id);
    } catch (error) {
      setLoadError(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load this conversation.'));
    } finally {
      setIsLoadingMessages(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    let active = true;
    Promise.all([
      afterDarkService.getConversations(),
      afterDarkService.getMySettings(),
    ]).then(([conversationResponse, settingsResponse]) => {
      if (!active) return;
      const records = Array.isArray(conversationResponse)
        ? conversationResponse
        : conversationResponse?.conversations || conversationResponse?.items || [];
      if (!Array.isArray(records)) throw new Error('The conversation list returned invalid data.');
      const normalized = records.map(normalizeConversation);
      const routeId = searchParams.get('creator');
      if (routeId && routeCreator && !normalized.some(contact => contact.id === routeId)) {
        normalized.unshift(routeCreator);
      }
      setContacts(normalized);
      const settings = settingsResponse?.settings || settingsResponse || {};
      setRevealExplicitByDefault(Boolean(settings.show_explicit_content ?? settings.showExplicitContent));
    }).catch(error => {
      if (active) setLoadError(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load conversations.'));
    }).finally(() => {
      if (active) setIsLoadingContacts(false);
    });
    return () => { active = false; };
  }, [routeCreator, searchParams]);

  useEffect(() => {
    const preferenceKey = `afterdark-chat-preferences:${currentUserId || 'guest'}`;
    try {
      const saved = localStorage.getItem(preferenceKey);
      if (saved) setChatPreferences(current => ({ ...current, ...JSON.parse(saved) }));
    } catch (error) {
      console.warn('Could not load After Dark chat preferences.', error);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;
    try {
      localStorage.setItem(`afterdark-chat-preferences:${currentUserId}`, JSON.stringify(chatPreferences));
    } catch (error) {
      console.warn('Could not save After Dark chat preferences.', error);
    }
  }, [chatPreferences, currentUserId]);

  useEffect(() => {
    if (!conversationId) return undefined;
    let active = true;
    let socket;
    let reconnectTimer;
    let pollTimer;
    let reconnectAttempts = 0;
    let manuallyClosed = false;
    const refreshMessages = async () => {
      try {
        const response = await afterDarkService.getMessages(conversationId);
        const records = Array.isArray(response) ? response : response?.messages || response?.items || [];
        if (active && Array.isArray(records)) {
          const normalized = records.map(message => normalizeMessage(message, currentUserId)).reverse();
          setMessages(current => mergeMessages(current, normalized));
          await afterDarkService.markConversationRead(conversationId);
        }
      } catch (error) {
        if (active) setLoadError(error?.response?.data?.error || 'Could not refresh this conversation.');
      }
    };
    const connect = () => {
      if (!active || manuallyClosed) return;
      let token = appToken;
      if (!token) {
        try {
          token = JSON.parse(localStorage.getItem('chattie-session-storage') || '{}')?.state?.token || '';
        } catch (error) {
          console.warn('Could not read the chat session token.', error);
        }
      }
      if (!token) return;
      const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
      const query = `?token=${encodeURIComponent(cleanToken)}`;
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = import.meta.env.VITE_WS_URL
        ? `${import.meta.env.VITE_WS_URL}${query}`
        : `${wsProtocol}//${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'localhost:8080' : window.location.host}/ws${query}`;
      try {
        socket = new WebSocket(wsUrl);
        socketRef.current = socket;
        socket.onopen = () => { reconnectAttempts = 0; };
        socket.onmessage = event => {
          try {
            const incoming = JSON.parse(event.data);
            if (incoming.type === 'ad_message' && incoming.conversation_id === conversationId) {
              void refreshMessages();
            } else if (incoming.type === 'ad_message_pin' && incoming.conversation_id === conversationId) {
              setMessages(current => current.map(message => message.id === incoming.message_id
                ? { ...message, isPinned: Boolean(incoming.is_pinned) }
                : message));
            } else if (incoming.type === 'ad_message_reaction' && incoming.conversation_id === conversationId) {
              setMessages(current => current.map(message => message.id === incoming.message_id
                ? { ...message, reactions: incoming.reactions || [] }
                : message));
            }
          } catch (error) {
            console.warn('Received an invalid After Dark chat event.', error);
          }
        };
        socket.onclose = () => {
          if (!active || manuallyClosed) return;
          reconnectAttempts += 1;
          reconnectTimer = window.setTimeout(connect, Math.min(1000 * (2 ** reconnectAttempts), 30000));
        };
        socket.onerror = () => socket?.close();
      } catch (error) {
        console.warn('Could not connect to After Dark chat updates.', error);
      }
    };
    connect();
    pollTimer = window.setInterval(() => { void refreshMessages(); }, 12000);
    return () => {
      active = false;
      manuallyClosed = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(pollTimer);
      socket?.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [conversationId, appToken, currentUserId]);

  useEffect(() => {
    const creatorId = searchParams.get('creator');
    if (creatorId) setSelectedId(creatorId);
  }, [searchParams]);

  useEffect(() => {
    if (!selectedId) {
      setConversationId('');
      setMessages([]);
      return;
    }
    const contact = contacts.find(item => item.id === selectedId) ||
      (routeCreator?.id === selectedId ? routeCreator : null);
    if (contact && contact.conversationId !== conversationId) void openConversation(contact);
  }, [selectedId, contacts, conversationId, routeCreator, openConversation]);

  useEffect(() => {
    if (attachment?.previewUrl) return () => URL.revokeObjectURL(attachment.previewUrl);
    return undefined;
  }, [attachment?.previewUrl]);

  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    if (selectedCreator && conversationId && selectedContact?.dmControl === 'subscribers' && !selectedContact.hasAccess) {
      setShowPayment(true);
    }
    else setShowPayment(false);
  }, [selectedCreator, conversationId, selectedContact?.dmControl, selectedContact?.hasAccess]);

  const handleSelectContact = contact => {
    setSelectedId(contact.id);
    setAttachment(null);
    setDraft('');
    setReplyingTo(null);
    setContacts(current => current.some(item => item.id === contact.id)
      ? current.map(item => item.id === contact.id ? { ...item, ...contact } : item)
      : [contact, ...current]);
    if (!isCreator) navigate(`/afterdark/chats?creator=${encodeURIComponent(contact.id)}`, { replace: true, state: { creator: contact } });
  };

  const handleAttachment = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      toast.error('Please choose an image or video file.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('Attachments must be 20 MB or smaller.');
      return;
    }
    setAttachment({
      file,
      previewUrl: URL.createObjectURL(file),
      name: file.name,
      type: file.type.startsWith('video/') ? 'video' : 'image',
    });
    setIsExplicit(true);
  };

  const handleSend = async event => {
    event.preventDefault();
    if (!selectedId || !conversationId || (!draft.trim() && !attachment) || !hasChatAccess) return;
    setIsSending(true);
    try {
      let mediaAssetId;
      if (attachment) {
        const upload = await afterDarkService.uploadMessageAttachment(conversationId, attachment.file);
        mediaAssetId = upload?.media_asset_id || upload?.asset_id || upload?.id;
        if (!mediaAssetId) throw new Error('The media service did not return an attachment ID.');
      }
      const message = await afterDarkService.sendMessage(conversationId, {
        content: draft.trim(),
        is_explicit: isExplicit,
        media_asset_id: mediaAssetId,
        reply_to_message_id: replyingTo?.id || '',
      });
      const sentMessage = normalizeMessage(message, currentUserId);
      setMessages(current => mergeMessages(current, [sentMessage]));
      setContacts(current => current.map(contact => contact.id === selectedId ? { ...contact, lastMessage: sentMessage } : contact));
      setDraft('');
      setAttachment(null);
      setIsExplicit(false);
      setReplyingTo(null);
    } catch (error) {
      setLoadError(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not send this message.'));
    } finally {
      setIsSending(false);
    }
  };

  const handlePaymentSuccess = () => {
    if (!selectedCreator) return;
    setContacts(current => current.map(contact => contact.id === selectedId ? { ...contact, hasAccess: true } : contact));
    setShowPayment(false);
  };

  const pinnedMessages = useMemo(() => messages.filter(message => message.isPinned), [messages]);
  const latestPinnedMessage = pinnedMessages[pinnedMessages.length - 1];

  const handlePinMessage = async message => {
    if (!conversationId || pinningMessageId) return;
    const pinned = !message.isPinned;
    setPinningMessageId(message.id);
    try {
      await afterDarkService.pinMessage(conversationId, message.id, pinned);
      setMessages(current => current.map(item => item.id === message.id ? { ...item, isPinned: pinned } : item));
    } catch (error) {
      setLoadError(error?.response?.data?.error || 'Could not update the pinned message.');
    } finally {
      setPinningMessageId('');
    }
  };

  const handleReaction = async (messageId, emoji) => {
    if (!conversationId) return;
    try {
      const result = await afterDarkService.toggleMessageReaction(conversationId, messageId, emoji);
      setMessages(current => current.map(message => message.id === messageId
        ? { ...message, reactions: result.reactions || [] }
        : message));
    } catch (error) {
      setLoadError(error?.response?.data?.error || 'Could not update this reaction.');
    }
  };

  const appendCallEvent = message => {
    const normalized = normalizeMessage(message, currentUserIdRef.current);
    if (conversationIdRef.current === normalized.conversationId) {
      setMessages(current => current.some(item => item.id === normalized.id) ? current : [...current, normalized]);
    }
    setContacts(current => current.map(contact => contact.conversationId === normalized.conversationId
      ? { ...contact, lastMessage: normalized }
      : contact));
  };

  const recordCallEvent = async (targetConversationId, event, mode) => {
    const message = await afterDarkService.recordConversationCallEvent(targetConversationId, event, mode);
    appendCallEvent(message);
  };

  const waitForCallSocket = () => new Promise((resolve, reject) => {
    const socket = callSocketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      resolve(socket);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const currentSocket = callSocketRef.current;
      if (currentSocket?.readyState === WebSocket.OPEN) {
        window.clearInterval(timer);
        resolve(currentSocket);
      } else if (Date.now() - startedAt > 8000) {
        window.clearInterval(timer);
        reject(new Error('Call signaling is not connected. Please retry.'));
      }
    }, 100);
  });

  const sendCallSignal = async (type, targetId, extra = {}) => {
    const socket = await waitForCallSocket();
    socket.send(JSON.stringify({ type, target_id: targetId, from: currentUserIdRef.current, ...extra }));
  };

  const clearCallTimeout = () => {
    if (callTimeoutRef.current) {
      window.clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  };

  const resetCallState = () => {
    clearCallTimeout();
    incomingCallRef.current = null;
    outgoingCallRef.current = null;
    callRoomIdRef.current = '';
    callTokenRef.current = '';
    callConversationRef.current = '';
    setIncomingCall(null);
    setOutgoingCall(null);
    setCallToken('');
    setCallPeerId('');
    setCallPeerName('');
    setActiveCallConversationId('');
  };

  const handleCallSignal = incoming => {
    if (incoming.type === 'incoming_call') {
      const callerId = incoming.from || incoming.sender_id;
      if (!callerId || callerId === currentUserIdRef.current || !incoming.conversation_id) return;
      if (incoming.room_id !== getAfterDarkCallRoomId(callerId, currentUserIdRef.current)) return;
      if (incomingCallRef.current?.roomId === incoming.room_id) return;
      if (callTokenRef.current || outgoingCallRef.current || incomingCallRef.current) {
        void sendCallSignal('call_rejected', callerId, { room_id: incoming.room_id, reason: 'busy' })
          .catch(error => console.warn('Could not decline a busy call:', error));
        return;
      }
      const knownContact = contactsRef.current.find(contact => contact.id === callerId);
      const callerName = incoming.from_name || knownContact?.name || 'After Dark member';
      const call = {
        fromId: callerId,
        fromName: callerName,
        roomId: incoming.room_id,
        conversationId: incoming.conversation_id,
        mode: incoming.mode === 'video' ? 'video' : 'audio',
      };
      incomingCallRef.current = call;
      callRoomIdRef.current = call.roomId;
      setContacts(current => current.some(contact => contact.id === callerId)
        ? current.map(contact => contact.id === callerId ? { ...contact, conversationId: call.conversationId } : contact)
        : [{ id: callerId, conversationId: call.conversationId, name: callerName, avatar: '', hasAccess: true }, ...current]);
      setSelectedId(callerId);
      void openConversation({
        ...(knownContact || {}),
        id: callerId,
        name: callerName,
        conversationId: call.conversationId,
      });
      setIncomingCall(call);
      return;
    }

    if (incoming.type === 'call_answered') {
      const pending = outgoingCallRef.current;
      if (!pending || pending.roomId !== incoming.room_id) return;
      clearCallTimeout();
      outgoingCallRef.current = null;
      setOutgoingCall(null);
      callRoomIdRef.current = pending.roomId;
      setCallToken(pending.token);
      callTokenRef.current = pending.token;
      setCallMode(pending.mode);
      setCallPeerId(pending.targetId);
      setCallPeerName(pending.targetName);
      setActiveCallConversationId(pending.conversationId);
      void recordCallEvent(pending.conversationId, 'connected', pending.mode)
        .catch(error => console.error('Could not save After Dark call history:', error));
      return;
    }

    if (incoming.type === 'call_rejected' || incoming.type === 'call_cancelled') {
      if (outgoingCallRef.current?.roomId === incoming.room_id) {
        resetCallState();
      }
      if (incomingCallRef.current?.roomId === incoming.room_id) {
        resetCallState();
      }
      return;
    }

    if (incoming.type === 'call_ended' && callRoomIdRef.current === incoming.room_id) {
      resetCallState();
    }
  };

  callSignalHandlerRef.current = handleCallSignal;

  useEffect(() => {
    let active = true;
    let socket;
    let reconnectTimer;
    let attempts = 0;
    const connect = () => {
      if (!active) return;
      let token = appToken;
      if (!token) {
        try {
          token = JSON.parse(localStorage.getItem('chattie-session-storage') || '{}')?.state?.token || '';
        } catch (error) {
          console.warn('Could not read the call signaling token.', error);
        }
      }
      if (!token) return;
      const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
      const query = `?token=${encodeURIComponent(cleanToken)}`;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = import.meta.env.VITE_WS_URL
        ? `${import.meta.env.VITE_WS_URL}${query}`
        : `${protocol}//${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'localhost:8080' : window.location.host}/ws${query}`;
      socket = new WebSocket(url);
      callSocketRef.current = socket;
      socket.onopen = () => { attempts = 0; };
      socket.onmessage = event => {
        try {
          const incoming = JSON.parse(event.data);
          if (['incoming_call', 'call_answered', 'call_rejected', 'call_ended', 'call_cancelled'].includes(incoming.type)) {
            callSignalHandlerRef.current?.(incoming);
          }
        } catch (error) {
          console.warn('Received an invalid private-call event.', error);
        }
      };
      socket.onclose = () => {
        if (!active) return;
        attempts += 1;
        reconnectTimer = window.setTimeout(connect, Math.min(1000 * (2 ** attempts), 30000));
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      active = false;
      window.clearTimeout(reconnectTimer);
      socket?.close();
      if (callSocketRef.current === socket) callSocketRef.current = null;
    };
  }, [appToken]);

  const startCall = async mode => {
    if (!conversationId || !selectedContact || !hasChatAccess || isBlocked || callTokenRef.current || outgoingCallRef.current) return;
    setIsConnectingCall(true);
    setCallMode(mode);
    try {
      const response = await afterDarkService.getConversationCallToken(conversationId, currentUserName || 'After Dark member');
      const targetId = response?.target_user_id || selectedContact.id;
      if (!response?.token || response.room_id !== getAfterDarkCallRoomId(currentUserId, targetId)) {
        throw new Error('The secure call token did not match this conversation.');
      }
      const pending = {
        roomId: response.room_id,
        mode,
        token: response.token,
        targetId,
        targetName: selectedContact.name,
        conversationId,
      };
      outgoingCallRef.current = pending;
      callRoomIdRef.current = pending.roomId;
      setOutgoingCall(pending);
      await sendCallSignal('incoming_call', pending.targetId, {
        room_id: pending.roomId,
        conversation_id: conversationId,
        from_name: currentUserName || 'After Dark member',
        mode,
      });
      void recordCallEvent(conversationId, 'started', mode)
        .catch(error => console.error('Could not save After Dark call history:', error));
      clearCallTimeout();
      if (outgoingCallRef.current?.roomId === pending.roomId) {
        callTimeoutRef.current = window.setTimeout(() => {
          if (outgoingCallRef.current?.roomId !== pending.roomId) return;
          void sendCallSignal('call_cancelled', pending.targetId, { room_id: pending.roomId })
            .catch(error => console.warn('Could not notify the recipient about the missed call:', error));
          void recordCallEvent(conversationId, 'missed', mode)
            .catch(error => console.error('Could not save missed-call history:', error));
          resetCallState();
        }, 45000);
      }
    } catch (error) {
      resetCallState();
      setLoadError(error?.response?.data?.error || error.message || 'Could not start this call.');
    } finally {
      setIsConnectingCall(false);
    }
  };

  const acceptCall = async () => {
    const call = incomingCallRef.current;
    if (!call || isConnectingCall) return;
    setIsConnectingCall(true);
    try {
      const response = await afterDarkService.getConversationCallToken(call.conversationId, currentUserName || 'After Dark member');
      if (!response?.token || response.room_id !== call.roomId) {
        throw new Error('The secure call token did not match the incoming call.');
      }
      await sendCallSignal('call_answered', call.fromId, { room_id: call.roomId });
      setCallMode(call.mode);
      setCallToken(response.token);
      callTokenRef.current = response.token;
      setCallPeerId(call.fromId);
      setCallPeerName(call.fromName);
      setActiveCallConversationId(call.conversationId);
      incomingCallRef.current = null;
      setIncomingCall(null);
    } catch (error) {
      setLoadError(error?.response?.data?.error || error.message || 'Could not answer this call.');
    } finally {
      setIsConnectingCall(false);
    }
  };

  const rejectCall = () => {
    const call = incomingCallRef.current;
    if (!call) return;
    void sendCallSignal('call_rejected', call.fromId, { room_id: call.roomId })
      .catch(error => console.warn('Could not decline this call:', error));
    void recordCallEvent(call.conversationId, 'declined', call.mode)
      .catch(error => console.error('Could not save declined-call history:', error));
    resetCallState();
  };

  const endCall = () => {
    const peerId = callPeerId || incomingCallRef.current?.fromId || outgoingCallRef.current?.targetId;
    const targetConversationId = activeCallConversationId || incomingCallRef.current?.conversationId || outgoingCallRef.current?.conversationId;
    if (peerId && callRoomIdRef.current) {
      void sendCallSignal('call_ended', peerId, { room_id: callRoomIdRef.current })
        .catch(error => console.warn('Could not notify the other participant that the call ended:', error));
    }
    if (targetConversationId) {
      void recordCallEvent(targetConversationId, 'ended', callMode)
        .catch(error => console.error('Could not save ended-call history:', error));
    }
    resetCallState();
  };

  const handleBlock = async () => {
    if (!conversationId || !selectedContact || selectedContact.blockedMe) return;
    const shouldBlock = !selectedContact.blockedByMe;
    if (shouldBlock && !await confirm(`Block ${selectedContact.name}? They will no longer be able to message you.`, {
      title: 'Block contact',
      confirmLabel: 'Block',
      tone: 'danger',
    })) return;
    try {
      await afterDarkService.setConversationBlock(conversationId, shouldBlock);
      setContacts(current => current.map(contact => contact.id === selectedId
        ? { ...contact, blockedByMe: shouldBlock }
        : contact));
    } catch (error) {
      setLoadError(error?.response?.data?.error || 'Could not update the block setting.');
    }
  };

  const handleReport = async () => {
    if (!selectedContact) return;
    const reason = await prompt(`Why are you reporting ${selectedContact.name}?`, {
      title: 'Report contact',
      inputLabel: 'Reason',
      placeholder: 'Enter the reason for this report',
      defaultValue: 'Harassment',
    });
    if (!reason?.trim()) return;
    const details = (await prompt('Add any helpful details (optional).', {
      title: 'Report details',
      inputLabel: 'Details',
      placeholder: 'Optional',
    })) || '';
    try {
      await afterDarkService.submitReport({
        target_type: 'user',
        target_id: selectedContact.id,
        reason: reason.trim(),
        details: details.trim(),
      });
      toast.success('Your report has been sent to Trust & Safety.');
    } catch (error) {
      setLoadError(error?.response?.data?.error || 'Could not submit your report.');
    }
  };

  return (
    <div className="chat-theme-sharp flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-mono text-zinc-300" style={{ backgroundColor: themeStyle.page, color: themeStyle.text }}>
      <header className="flex shrink-0 flex-col justify-between gap-4 border-b-2 border-zinc-800 bg-zinc-950 px-4 py-4 sm:flex-row sm:items-center md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="border-2 border-zinc-600 bg-black p-2.5"><MessageCircle className="h-5 w-5 text-white" /></div>
          <div>
            <h1 className="text-lg font-black uppercase tracking-widest text-white">{isCreator ? 'Customer messages' : 'After Dark chats'}</h1>
            <p className="mt-0.5 text-[10px] uppercase tracking-widest text-zinc-500">{isCreator ? 'Private conversations with your subscribers' : 'Conversations with creators'}</p>
          </div>
        </div>
        <button type="button" onClick={() => navigate('/afterdark/feed')} className="flex shrink-0 items-center gap-2 border-2 border-zinc-800 px-3 py-2 text-xs font-bold uppercase tracking-widest text-zinc-400 transition-colors hover:border-white hover:text-white">
          <ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Back to feed</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className={`${selectedId ? 'hidden md:flex' : 'flex'} min-h-0 w-full shrink-0 flex-col border-r-2 border-zinc-800 bg-black md:w-[clamp(16rem,24vw,22rem)]`}>
          <div className="p-4">
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search conversations..." className="w-full border-2 border-zinc-800 bg-black py-3 pl-10 pr-3 text-xs text-white outline-none placeholder:text-zinc-600 focus:border-white" />
            </label>
          </div>
          <div className="flex gap-5 border-b-2 border-zinc-800 px-5 text-[10px] font-bold uppercase tracking-widest">
            <span className="border-b-2 border-white pb-3 text-white">All chats</span>
            <span className="pb-3 text-zinc-500">{isCreator ? 'Customers' : 'Creators'}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoadingContacts ? (
              <p role="status" className="p-6 text-center text-sm text-zinc-500">Loading conversations…</p>
            ) : filteredContacts.map(contact => {
              const last = latestMessage(contact);
              const isSelected = selectedId === contact.id;
              return (
                <button key={contact.id} type="button" onClick={() => handleSelectContact(contact)} className={`flex w-full items-center gap-3 border-b-2 border-zinc-900 px-4 py-3.5 text-left transition-colors hover:bg-zinc-950 ${isSelected ? 'bg-zinc-950' : 'bg-black'}`}>
                  <div className="relative shrink-0">
                    <img src={contact.avatar} alt="" className="h-12 w-12 border-2 border-zinc-700 bg-zinc-950 object-cover" />
                    {contact.online && <span className="absolute bottom-0 right-0 h-3 w-3 border-2 border-black bg-white" />}
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-white">{contact.name}</span>
                      <span className="shrink-0 text-[10px] text-zinc-600">{last?.created_at || last?.createdAt ? new Date(last.created_at || last.createdAt).toLocaleDateString() : ''}</span>
                    </span>
                    <span className="mt-1 block truncate text-xs text-zinc-500">{last ? `${last.isMine || last.is_mine ? 'You: ' : ''}${last.text || last.content || 'Shared media'}` : 'Start a conversation'}</span>
                  </span>
                </button>
              );
            })}
            {!isLoadingContacts && filteredContacts.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">No conversations found.</p>}
          </div>
          <div className="flex items-center gap-2 border-t-2 border-zinc-800 p-3 text-[10px] uppercase tracking-widest text-zinc-500"><ShieldCheck className="h-4 w-4 text-zinc-400" /> Adult chat space · 18+</div>
        </aside>

        <section className={`${selectedId ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-1 flex-col bg-black`}>
          {selectedName ? (
            <>
              <header className="flex shrink-0 items-center gap-3 border-b-2 border-zinc-800 px-4 py-3 md:px-6" style={{ backgroundColor: themeStyle.panel }}>
                <button type="button" onClick={() => { setSelectedId(''); navigate('/afterdark/chats', { replace: true }); }} className="mr-1 border-2 border-zinc-800 p-2 text-zinc-400 transition-colors hover:border-white hover:text-white md:hidden" aria-label="Back to conversations"><ArrowLeft className="h-4 w-4" /></button>
                <img src={selectedAvatar} alt="" className="h-10 w-10 border-2 border-zinc-700 bg-black object-cover" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold text-white">{selectedName}</h2>
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500">{isCreator ? 'Subscriber conversation' : selectedCreator?.online ? 'Online now' : 'Creator'}</p>
                </div>
                <button type="button" onClick={() => void startCall('audio')} disabled={!hasChatAccess || isBlocked || isConnectingCall || Boolean(outgoingCall)} aria-label="Start voice call" title="Voice call" className="border-2 border-zinc-800 p-2 text-zinc-400 hover:border-green-500 hover:text-green-400 disabled:cursor-not-allowed disabled:opacity-40"><Phone className="h-4 w-4" /></button>
                <button type="button" onClick={() => void startCall('video')} disabled={!hasChatAccess || isBlocked || isConnectingCall || Boolean(outgoingCall)} aria-label="Start video call" title="Video call" className="border-2 border-zinc-800 p-2 text-zinc-400 hover:border-green-500 hover:text-green-400 disabled:cursor-not-allowed disabled:opacity-40"><Video className="h-4 w-4" /></button>
                <button type="button" onClick={() => setShowChatSettings(value => !value)} aria-label="Chat preferences" title="Chat preferences" className="border-2 border-zinc-800 p-2 text-zinc-400 hover:border-white hover:text-white"><Settings2 className="h-4 w-4" /></button>
                <button type="button" onClick={handleReport} aria-label="Report conversation partner" title="Report" className="border-2 border-zinc-800 p-2 text-zinc-400 hover:border-amber-500 hover:text-amber-400"><Flag className="h-4 w-4" /></button>
                <button type="button" onClick={handleBlock} disabled={!conversationId || selectedContact?.blockedMe} aria-label={selectedContact?.blockedByMe ? 'Unblock conversation partner' : 'Block conversation partner'} title={selectedContact?.blockedByMe ? 'Unblock' : 'Block'} className="border-2 border-zinc-800 p-2 text-zinc-400 hover:border-red-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"><Ban className="h-4 w-4" /></button>
                <span className="hidden shrink-0 border-2 border-zinc-700 bg-black px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-300 sm:inline">18+ chat</span>
              </header>

              {showChatSettings && (
                <div className="flex flex-wrap items-center gap-4 border-b border-zinc-800 px-4 py-3 text-xs" style={{ backgroundColor: themeStyle.panel }}>
                  <label className="flex items-center gap-2 text-zinc-400">Theme
                    <select value={chatPreferences.theme} onChange={event => setChatPreferences(current => ({ ...current, theme: event.target.value }))} className="border border-zinc-700 bg-black px-2 py-1 text-white">
                      <option value="midnight">Midnight</option><option value="plum">Plum</option><option value="light">Light</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-zinc-400">Text size
                    <select value={chatPreferences.fontSize} onChange={event => setChatPreferences(current => ({ ...current, fontSize: event.target.value }))} className="border border-zinc-700 bg-black px-2 py-1 text-white">
                      <option value="small">Small</option><option value="normal">Normal</option><option value="large">Large</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-zinc-400"><input type="checkbox" checked={chatPreferences.enterToSend} onChange={event => setChatPreferences(current => ({ ...current, enterToSend: event.target.checked }))} /> Enter to send</label>
                </div>
              )}
              {selectedContact?.blockedByMe && <p role="status" className="border-b border-amber-900 bg-amber-950/30 p-3 text-xs text-amber-200">You blocked this person. Unblock them to resume messaging.</p>}
              {selectedContact?.blockedMe && <p role="status" className="border-b border-amber-900 bg-amber-950/30 p-3 text-xs text-amber-200">This person has blocked messaging in this conversation.</p>}
              {loadError && <p role="alert" className="border-b-2 border-red-900 bg-black p-3 text-xs text-red-500">{loadError}</p>}
              {latestPinnedMessage && (
                <button type="button" onClick={() => document.getElementById(`ad-message-${latestPinnedMessage.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="flex shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-4 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-900">
                  <Pin className="h-3.5 w-3.5 text-yellow-400" />
                  <span className="font-bold uppercase tracking-widest text-yellow-400">{pinnedMessages.length > 1 ? `${pinnedMessages.length} pinned` : 'Pinned'}</span>
                  <span className="truncate">{latestPinnedMessage.text || 'Attachment'}</span>
                </button>
              )}
              {outgoingCall && (
                <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-4 py-2 text-xs text-yellow-400">
                  <Phone className="h-3.5 w-3.5 animate-pulse" /> Calling {outgoingCall.targetName} · waiting for answer
                  <button type="button" onClick={() => {
                    void sendCallSignal('call_cancelled', outgoingCall.targetId, { room_id: outgoingCall.roomId })
                      .catch(error => console.warn('Could not cancel the outgoing call:', error));
                    void recordCallEvent(outgoingCall.conversationId, 'missed', outgoingCall.mode)
                      .catch(error => console.error('Could not save cancelled-call history:', error));
                    resetCallState();
                  }} className="ml-auto border border-zinc-700 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-300 hover:border-red-500 hover:text-red-400">Cancel</button>
                </div>
              )}
              <div ref={historyRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-8" style={{ backgroundColor: themeStyle.page }}>
                {isLoadingMessages ? (
                  <p role="status" className="text-center text-xs text-zinc-500">Loading messages…</p>
                ) : messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <MessageCircle className="mb-3 h-9 w-9 text-zinc-700" />
                    <h3 className="text-sm font-semibold text-zinc-300">No messages yet</h3>
                    <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">{isCreator ? 'Say hello to your subscriber. Your conversation history will stay here.' : 'Unlock this private conversation to message this creator.'}</p>
                  </div>
                ) : messages.map(message => (
                  <div key={message.id} id={`ad-message-${message.id}`}>
                    <MessageBubble
                      message={message}
                      isMine={message.isMine}
                      revealExplicitByDefault={revealExplicitByDefault}
                      fontSize={fontSizeClass}
                      theme={themeStyle}
                      replyPreview={messages.find(item => item.id === message.replyToMessageId)}
                      onReply={setReplyingTo}
                      onPin={handlePinMessage}
                      onReact={handleReaction}
                      pinning={pinningMessageId === message.id}
                    />
                  </div>
                ))}
              </div>

              {hasChatAccess && !isBlocked ? (
                <form onSubmit={handleSend} className="shrink-0 border-t border-zinc-800 bg-black/70 p-3 md:p-4">
                  {replyingTo && (
                    <div className="mb-2 flex items-center gap-2 border-l-2 border-yellow-400 bg-zinc-950 px-3 py-2">
                      <Reply className="h-4 w-4 text-yellow-400" />
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">Replying to {replyingTo.isMine ? 'your message' : selectedName}: {replyingTo.text || 'Attachment'}</span>
                      <button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply" className="p-1 text-zinc-500 hover:text-white"><X className="h-4 w-4" /></button>
                    </div>
                  )}
                  {attachment && (
                    <div className="mb-3 flex items-center gap-3 border-2 border-zinc-800 bg-zinc-950 p-2">
                      {attachment.type === 'video' ? <Video className="h-8 w-8 text-zinc-500" /> : <img src={attachment.previewUrl} alt="Attachment preview" className="h-12 w-12 object-cover" />}
                      <div className="min-w-0 flex-1"><p className="truncate text-xs text-white">{attachment.name}</p><p className="text-[10px] text-zinc-500">Marked as explicit · recipient sees a reveal warning</p></div>
                      <button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment" className="p-2 text-zinc-500 hover:text-white"><X className="h-4 w-4" /></button>
                    </div>
                  )}
                  <div className="flex items-end gap-2 border-2 border-zinc-800 bg-zinc-950 p-2">
                    <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach image or video" className="border-2 border-transparent p-2 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"><Paperclip className="h-5 w-5" /></button>
                    <input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={handleAttachment} className="hidden" />
                    <textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (chatPreferences.enterToSend && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} rows={1} placeholder="Write a message..." className={`max-h-[35dvh] min-h-[clamp(2.5rem,7vh,4rem)] flex-1 resize-y bg-transparent px-2 py-2 ${fontSizeClass} text-white outline-none placeholder:text-zinc-600`} />
                    <button type="button" onClick={() => setIsExplicit(value => !value)} aria-pressed={isExplicit} title="Mark message as explicit" className={`border-2 border-transparent p-2.5 transition-colors ${isExplicit ? 'border-zinc-600 bg-zinc-900 text-white' : 'text-zinc-500 hover:border-zinc-700 hover:text-white'}`}><AlertTriangle className="h-5 w-5" /></button>
                    <button type="submit" disabled={isSending || (!draft.trim() && !attachment)} aria-label="Send message" className="border-2 border-white bg-white p-2.5 text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-800 disabled:text-zinc-500">{isSending ? '…' : <Send className="h-5 w-5" />}</button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-zinc-600">
                    <span>{isExplicit ? 'Explicit content warning enabled' : 'Tap the warning icon to mark this message 18+'}</span>
                    <span>Image/video attachment limit: 20 MB</span>
                  </div>
                </form>
              ) : isBlocked ? (
                <div className="border-t border-zinc-800 p-4 text-center text-xs text-zinc-400">Messaging is unavailable while either person has blocked the other.</div>
              ) : selectedContact?.dmControl === 'none' ? (
                <div className="border-t border-zinc-800 p-4 text-center text-xs text-zinc-400">This creator is not accepting direct messages.</div>
              ) : (
                <div className="border-t border-zinc-800 bg-black/80 p-4 text-center">
                  <p className="mb-3 flex items-center justify-center gap-2 text-xs text-zinc-400"><Lock className="h-4 w-4 text-white" /> Subscribe or unlock chat for a one-time KES ${(selectedContact?.chatPriceCents || 1000) / 100}.</p>
                  <button type="button" onClick={() => setShowPayment(true)} className="border-2 border-white bg-white px-5 py-3 text-xs font-bold uppercase tracking-widest text-black transition-colors hover:bg-zinc-200">Unlock private chat</button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <div className="mb-4 border-2 border-zinc-800 bg-black p-4"><MessageCircle className="h-8 w-8 text-white" /></div>
              <h2 className="text-base font-black uppercase tracking-widest text-white">Your After Dark inbox</h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">{isCreator ? 'Choose a subscriber to see your message history or start a conversation.' : 'Choose a creator to view your history or unlock a private chat.'}</p>
              <div className="mt-5 flex items-center gap-2 text-[10px] text-zinc-600"><ImagePlus className="h-4 w-4" /><Smile className="h-4 w-4" /> Text, images, and video supported</div>
            </div>
          )}
        </section>
      </div>

      {incomingCall && !callToken && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-4">
          <div className="w-full max-w-sm border-2 border-zinc-600 bg-zinc-950 p-6 shadow-2xl">
            <p className="text-[9px] font-black uppercase tracking-widest text-yellow-400">Incoming {incomingCall.mode} call</p>
            <h2 className="mt-2 text-lg font-black uppercase tracking-widest text-white">{incomingCall.fromName}</h2>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" onClick={rejectCall} className="flex items-center justify-center gap-2 border-2 border-red-500 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-red-400 hover:bg-red-500 hover:text-black"><PhoneOff className="h-4 w-4" /> Decline</button>
              <button type="button" onClick={() => void acceptCall()} disabled={isConnectingCall} className="flex items-center justify-center gap-2 border-2 border-green-500 bg-green-500 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-green-400 disabled:opacity-50">{isConnectingCall ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />} Answer</button>
            </div>
          </div>
        </div>
      )}
      {callToken && (
        <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black">
          <div className="flex w-full shrink-0 items-center justify-between border-b-2 border-zinc-800 px-4 py-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-green-400">Connected {callMode} call</p>
              <p className="text-sm font-bold text-white">{callPeerName}</p>
            </div>
            <button type="button" onClick={endCall} className="flex items-center gap-2 border-2 border-red-500 bg-red-500 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-black hover:bg-red-400"><PhoneOff className="h-4 w-4" /> End call</button>
          </div>
          <LiveKitRoom
            serverUrl={LIVEKIT_URL}
            token={callToken}
            connect
            audio
            video={callMode === 'video'}
            onError={error => {
              console.error('After Dark LiveKit call failed:', error);
              setLoadError(error.message || 'The call connection failed.');
              endCall();
            }}
            className="flex min-h-0 flex-1 flex-col items-center"
          >
            <RoomAudioRenderer />
            <AfterDarkCallStage peerName={callPeerName} mode={callMode} />
            <div className="flex shrink-0 items-center justify-center gap-3 border-t-2 border-zinc-800 bg-black px-4 py-4">
              <TrackToggle source={Track.Source.Microphone} aria-label="Toggle microphone" className="border-2 border-zinc-700 bg-zinc-950 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white hover:border-white" />
              {callMode === 'video' && <TrackToggle source={Track.Source.Camera} aria-label="Toggle camera" className="border-2 border-zinc-700 bg-zinc-950 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white hover:border-white" />}
            </div>
          </LiveKitRoom>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-center gap-2 border-t-2 border-zinc-800 bg-black px-3 py-2 text-[9px] uppercase tracking-widest text-zinc-600"><ShieldCheck className="h-3.5 w-3.5" /> Messages and payments are handled by After Dark.</div>
      {selectedCreator && (
        <MpesaPaystackModal
          isOpen={showPayment}
          onClose={() => setShowPayment(false)}
          postItem={{
            id: `chat-${conversationId}`,
            resourceId: conversationId,
            price: (selectedContact?.chatPriceCents || 1000) / 100,
            caption: `Private chat access with ${selectedCreator.name}`,
          }}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  );
}
