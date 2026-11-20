import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Heart, Loader2, MessageCircle, Send, Volume2, VolumeX,
  Wallet, X, Eye, ShieldAlert, Share2, Radio, Gift
} from 'lucide-react';
import { toast } from 'sonner';
import { 
  LiveKitRoom, useTracks, VideoTrack, AudioTrack, 
  useConnectionState, useRoomContext, useDataChannel 
} from '@livekit/components-react';
import { ConnectionState, DisconnectReason, RoomEvent, Track } from 'livekit-client';
import { afterDarkService } from '../../api/afterdark.service';
import { useI18n } from '../../i18n';

// Inner component that renders tracks once connected to LiveKit
function LiveKitRenderer({ creator, isMuted, onConnectionStateChanged, onViewerCountChanged }) {
  const { t } = useI18n();
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const tracks = useTracks([Track.Source.Camera, Track.Source.Microphone], { onlySubscribed: true });
  const hostId = creator.liveSession?.hostId || creator.liveSession?.host_id || creator.id;
  const hostVideoTrack = tracks.find(t => t.participant.identity === hostId && t.source === Track.Source.Camera);
  const hostAudioTrack = tracks.find(t => t.participant.identity === hostId && t.source === Track.Source.Microphone);
  const guestVideoTracks = tracks.filter(t => t.participant.identity !== hostId && t.source === Track.Source.Camera);

  useEffect(() => {
    onConnectionStateChanged(connectionState);
  }, [connectionState, onConnectionStateChanged]);

  useEffect(() => {
    const updateViewerCount = () => onViewerCountChanged(
      [...room.remoteParticipants.values()].filter(participant => participant.identity !== hostId).length
    );
    room.on(RoomEvent.ParticipantConnected, updateViewerCount);
    room.on(RoomEvent.ParticipantDisconnected, updateViewerCount);
    updateViewerCount();
    return () => {
      room.off(RoomEvent.ParticipantConnected, updateViewerCount);
      room.off(RoomEvent.ParticipantDisconnected, updateViewerCount);
    };
  }, [hostId, room, onViewerCountChanged]);

  return (
    <>
      {/* Host Video - Full Screen Background */}
      {hostVideoTrack ? (
        <VideoTrack trackRef={hostVideoTrack} className="absolute inset-0 h-full w-full object-cover" />
      ) : hostAudioTrack ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-zinc-900 to-black">
          <div className="flex size-[clamp(5rem,12vw,6rem)] items-center justify-center rounded-full border border-white/15 bg-white/10">
            <Radio className="h-10 w-10 text-[var(--accent)]" />
          </div>
          <div className="text-center">
            <p className="text-xl font-semibold text-white">{creator.name}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-zinc-400">{t('afterDarkUiAudioLive')}</p>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 bg-zinc-900" />
      )}
      
      {/* Host Audio (conditionally muted by user) */}
      {hostAudioTrack && !isMuted && (
        <AudioTrack trackRef={hostAudioTrack} />
      )}

      {/* Guest Stage Video Tracks (Picture-in-Picture) */}
      <div className="absolute right-3 top-20 flex flex-col gap-3 z-20">
        {guestVideoTracks.map((track, index) => (
          <div key={track.participant.identity} className="relative w-[clamp(5rem,10vw,7rem)] overflow-hidden rounded-xl border border-white/20 bg-black/50 shadow-lg backdrop-blur-sm" style={{ aspectRatio: '3/4' }}>
            <VideoTrack trackRef={track} className="h-full w-full object-cover" />
            <span className="absolute bottom-1 left-1 max-w-[80%] truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {track.participant.name || t('afterDarkUiGuestNumber', { number: index + 1 })}
            </span>
          </div>
        ))}
      </div>

      {connectionState !== 'connected' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/60 px-6 text-center backdrop-blur-md">
          <Loader2 className={`h-10 w-10 text-[var(--accent)] ${connectionState === 'connecting' ? 'animate-spin' : ''}`} />
          <p className="font-semibold text-white drop-shadow-md">
            {connectionState === ConnectionState.Connecting ? t('afterDarkUiConnectingToCreator', { name: creator.name }) :
              connectionState === ConnectionState.Reconnecting || connectionState === ConnectionState.SignalReconnecting
                ? t('afterDarkUiNetworkInterrupted')
                : connectionState === ConnectionState.Disconnected ? t('afterDarkUiConnectionLost') : t('afterDarkUiLiveUnavailable')}
          </p>
        </div>
      )}
    </>
  );
}

// Data channel message handler (Chat & Reactions)
function ChatDataHandler({ onMessageReceived }) {
  useDataChannel('chat', (msg) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.payload));
      if (data.type === 'chat' || data.type === 'reaction' || data.type === 'caption' || data.type === 'announcement') {
        onMessageReceived(data, msg.from);
      }
    } catch (error) {
      console.warn('Ignoring an invalid LiveKit chat message.', error);
    }
  });
  return null;
}

function LiveTipDataHandler({ onTipReceived }) {
  useDataChannel('live-tip', msg => {
    if (msg.from) return;
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.payload));
      if (data.type === 'tip') onTipReceived(data);
    } catch (error) {
      console.warn('Ignoring an invalid LiveKit tip notification.', error);
    }
  });
  return null;
}

function LiveStageControls({ sessionId, stageState, setStageState, onError }) {
  const { t } = useI18n();
  const room = useRoomContext();

  useEffect(() => {
    const handleData = (payload, _participant, _kind, topic) => {
      if (topic !== 'live-control') return;
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.identity !== room.localParticipant.identity) return;
        if (data.type === 'stage-denied') setStageState('denied');
        if (data.type === 'stage-removed') setStageState('removed');
      } catch (error) {
        console.warn('Ignoring an invalid LiveKit stage message.', error);
      }
    };
    const handlePermissions = (_previous, participant) => {
      if (!participant.isLocal) return;
      if (participant.permissions?.canPublish) {
        Promise.all([
          room.localParticipant.setCameraEnabled(true),
          room.localParticipant.setMicrophoneEnabled(true),
        ]).then(() => setStageState('on-stage')).catch(onError);
      } else if (stageState === 'on-stage') {
        Promise.all([
          room.localParticipant.setCameraEnabled(false),
          room.localParticipant.setMicrophoneEnabled(false),
        ]).then(() => setStageState('removed')).catch(onError);
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    room.on(RoomEvent.ParticipantPermissionsChanged, handlePermissions);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
      room.off(RoomEvent.ParticipantPermissionsChanged, handlePermissions);
    };
  }, [onError, room, setStageState, stageState]);

  const requestStage = async () => {
    try {
      if (!sessionId) throw new Error(t('afterDarkUiLiveSessionUnavailable'));
      await afterDarkService.requestStage(sessionId);
      await room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({
          type: 'stage-request',
          identity: room.localParticipant.identity,
          name: room.localParticipant.name || t('afterDarkUiViewer'),
        })),
        { reliable: true, topic: 'live-control' }
      );
      setStageState('requested');
    } catch (error) {
      onError(error);
    }
  };

  if (stageState === 'on-stage') {
    return <span className="text-xs font-semibold text-emerald-300">{t('afterDarkUiYoureOnStage')}</span>;
  }
  return (
    <button
      type="button"
      onClick={requestStage}
      disabled={!sessionId || ['requested', 'approved'].includes(stageState)}
      className="absolute bottom-24 left-4 z-30 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-50"
    >
      {stageState === 'requested' ? t('afterDarkUiRequestSent') : stageState === 'denied' ? t('afterDarkUiRequestDenied') :
        stageState === 'removed' ? t('afterDarkUiRequestStageAgain') : t('afterDarkUiRequestToJoinStage')}
    </button>
  );
}

// Nested component to safely access LiveKit room for sending messages
function ChatInputControls({ messageText, setMessageText, sendMessage, sendReaction, connectionEnded }) {
  const { t } = useI18n();
  const room = useRoomContext();

  return (
    <form onSubmit={e => sendMessage(e, room)} className="flex items-center gap-2">
      <input 
        value={messageText} 
        onChange={event => setMessageText(event.target.value)} 
        maxLength={150} 
        disabled={connectionEnded} 
        placeholder={t('afterDarkUiAddComment')}
        className="min-w-0 flex-1 rounded-full border border-white/20 bg-black/40 px-4 py-2.5 text-sm text-white placeholder-white/60 outline-none backdrop-blur-md focus:border-white/50 focus:bg-black/60 disabled:opacity-50" 
      />
      <button 
        type="submit" 
        disabled={!messageText.trim() || connectionEnded} 
        aria-label={t('afterDarkUiSendMessage')}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-on-accent)] transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
      >
        <Send className="h-4 w-4 ml-0.5" />
      </button>
      <button 
        type="button" 
        disabled={connectionEnded} 
        onClick={() => sendReaction(room)} 
        aria-label={t('afterDarkUiSendHeartReaction')}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/20 text-[var(--accent)] backdrop-blur-md transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 lg:hidden"
      >
        <Heart className="h-5 w-5 fill-current" />
      </button>
    </form>
  );
}

export default function LiveViewer({
  creator, hasAccess, walletBalance, isOwnBroadcast, isCheckoutOpen, onClose, onManageBroadcast, onUseBalance, onCheckout, onTipSent, userAlias
}) {
  const { t } = useI18n();
  const [accessType, setAccessType] = useState('pass');
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [viewerCount, setViewerCount] = useState(1);
  const [reactionCount, setReactionCount] = useState(0);
  const [connectionEnded, setConnectionEnded] = useState(false);
  const [connectionState, setConnectionState] = useState(ConnectionState.Connecting);
  const [stageState, setStageState] = useState('idle');
  
  // LiveKit State
  const [liveKitToken, setLiveKitToken] = useState(null);
  const [joinState, setJoinState] = useState('idle');
  const [joinError, setJoinError] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [roomGeneration, setRoomGeneration] = useState(0);
  const [tipOpen, setTipOpen] = useState(false);
  const [tipAmount, setTipAmount] = useState('100');
  const [tipMessage, setTipMessage] = useState('');
  const [isSendingTip, setIsSendingTip] = useState(false);
  const [tipAlert, setTipAlert] = useState(null);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [liveCaption, setLiveCaption] = useState('');
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const chatEndRef = useRef(null);
  const retryTimerRef = useRef(null);
  const tipAlertTimerRef = useRef(null);
  const captionTimerRef = useRef(null);
  const announcementTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectGenerationRef = useRef(0);

  const handleStageError = useCallback(error => {
    const message = error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiStageStatusChangeFailed'));
    toast.error(message);
  }, [t]);

  useEffect(() => {
    setAccessType('pass');
    setMessages([]);
    setConnectionEnded(false);
    setConnectionState(ConnectionState.Connecting);
    setJoinState('idle');
    setJoinError('');
    setLiveKitToken(null);
    setStageState('idle');
    setRoomGeneration(0);
    setTipOpen(false);
    setTipAlert(null);
    setLiveCaption('');
    setLiveAnnouncement('');
    setCaptionsEnabled(false);
    reconnectAttemptsRef.current = 0;
    reconnectGenerationRef.current += 1;
    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
  }, [creator?.id, creator?.liveSession?.sessionId]);

  // Fetch LiveKit Token
  useEffect(() => {
    const sessionId = creator?.liveSession?.sessionId;
    if (!sessionId && hasAccess && !isOwnBroadcast) {
      setJoinError(t('afterDarkUiBroadcastNoLongerAvailable'));
      setJoinState('ended');
      return;
    }
    if (!sessionId || !hasAccess || isOwnBroadcast) return;

    let active = true;
    setJoinState('joining');
    
    afterDarkService.joinLiveSession(sessionId).then((data) => {
      if (!active) return;
      const token = data?.sfu_token || data?.livekit_token;
      if (typeof token === 'string' && token.length > 0) {
         setLiveKitToken(token);
         setJoinState('joined');
      } else {
         setJoinError(t('afterDarkUiLiveAccessTokenInvalid'));
         setJoinState('failed');
      }
    }).catch(error => {
      if (!active) return;
      const message = error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiLiveJoinFailed'));
      setJoinError(message);
      setJoinState('failed');
    });

    return () => { active = false; };
  }, [creator?.liveSession?.sessionId, hasAccess, isOwnBroadcast, t]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const hostIdentity = creator?.liveSession?.hostId || creator?.liveSession?.host_id || creator?.id;

  const handleIncomingDataMessage = useCallback((data, participant) => {
     if (data.type === 'chat') {
       setMessages(current => current.some(message => message.id === data.message.id)
         ? current
         : [...current.slice(-99), data.message]);
     }
     if (data.type === 'reaction') {
        setReactionCount(c => c + 1);
     }
     if (data.type === 'caption' && participant?.identity === hostIdentity && typeof data.text === 'string') {
        setLiveCaption(data.text);
        if (captionTimerRef.current) window.clearTimeout(captionTimerRef.current);
        captionTimerRef.current = window.setTimeout(() => setLiveCaption(''), 6500);
     }
     if (data.type === 'announcement' && participant?.identity === hostIdentity && typeof data.text === 'string') {
        setLiveAnnouncement(data.text);
        if (announcementTimerRef.current) window.clearTimeout(announcementTimerRef.current);
        announcementTimerRef.current = window.setTimeout(() => setLiveAnnouncement(''), 15000);
     }
  }, [hostIdentity]);

  const handleIncomingTip = useCallback(data => {
    if (!data.id || !Number.isFinite(Number(data.amount_cents))) return;
    setTipAlert(data);
    if (tipAlertTimerRef.current) window.clearTimeout(tipAlertTimerRef.current);
    tipAlertTimerRef.current = window.setTimeout(() => setTipAlert(null), 6500);
  }, []);

  const handleConnected = useCallback(() => {
    reconnectGenerationRef.current += 1;
    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    reconnectAttemptsRef.current = 0;
    setConnectionEnded(false);
    setJoinState('joined');
    setJoinError('');
  }, []);

  const handleDisconnected = useCallback((reason) => {
    if (reason === DisconnectReason.CLIENT_INITIATED) {
      reconnectGenerationRef.current += 1;
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
      return;
    }
    if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.PARTICIPANT_REMOVED) {
      reconnectGenerationRef.current += 1;
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
      setConnectionEnded(true);
      setJoinState('ended');
      return;
    }

    if (reconnectAttemptsRef.current >= 3) {
      setJoinState('failed');
      setJoinError(t('afterDarkUiLiveConnectionLostRetry'));
      return;
    }

    const attempt = ++reconnectAttemptsRef.current;
    const generation = ++reconnectGenerationRef.current;
    setJoinState('joining');
    setJoinError(t('afterDarkUiLiveConnectionRejoining', { attempt }));
    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = window.setTimeout(async () => {
      try {
        const data = await afterDarkService.joinLiveSession(creator?.liveSession?.sessionId);
        if (generation !== reconnectGenerationRef.current) return;
        const token = data?.sfu_token || data?.livekit_token;
        if (typeof token !== 'string' || !token) {
          throw new Error(t('afterDarkUiLiveAccessTokenInvalid'));
        }
        setLiveKitToken(token);
        setRoomGeneration(current => current + 1);
      } catch (error) {
        if (generation !== reconnectGenerationRef.current) return;
        const message = error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiLiveRejoinFailed'));
        setJoinError(message);
        setJoinState('failed');
      }
    }, Math.min(1000 * (2 ** (attempt - 1)), 4000));
  }, [creator?.liveSession?.sessionId, t]);

  const retryJoin = async () => {
    reconnectGenerationRef.current += 1;
    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    const generation = reconnectGenerationRef.current;
    reconnectAttemptsRef.current = 0;
    setJoinState('joining');
    setJoinError('');
    setConnectionEnded(false);
    try {
      const data = await afterDarkService.joinLiveSession(creator?.liveSession?.sessionId);
      if (generation !== reconnectGenerationRef.current) return;
      const token = data?.sfu_token || data?.livekit_token;
      if (typeof token !== 'string' || !token) {
        throw new Error(t('afterDarkUiLiveAccessTokenInvalid'));
      }
      setLiveKitToken(token);
      setRoomGeneration(current => current + 1);
    } catch (error) {
      if (generation !== reconnectGenerationRef.current) return;
      const message = error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiLiveRejoinFailed'));
      setJoinError(message);
      setJoinState('failed');
    }
  };

  useEffect(() => () => {
    reconnectGenerationRef.current += 1;
    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    if (tipAlertTimerRef.current) window.clearTimeout(tipAlertTimerRef.current);
    if (captionTimerRef.current) window.clearTimeout(captionTimerRef.current);
    if (announcementTimerRef.current) window.clearTimeout(announcementTimerRef.current);
  }, []);

  if (!creator || isCheckoutOpen) return null;

  const subscriptionPrice = creator.subPrice ?? 1500;
  const sessionPriceCents = Number(creator.liveSession?.price_cents ?? creator.liveSession?.priceCents);
  const livePassPrice = sessionPriceCents > 0
    ? sessionPriceCents / 100
    : creator.livePassPrice ?? 250;
  const price = accessType === 'subscription' ? subscriptionPrice : livePassPrice;
  const hasEnoughBalance = walletBalance >= price;
  const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';

  const checkoutTip = () => {
    const amount = Number(tipAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      toast.error(t('afterDarkUiValidTipAmount'));
      return;
    }
    onCheckout?.(creator, 'live_tip', amount, tipMessage.trim());
    setTipOpen(false);
  };

  const sendMessage = async (event, room) => {
    event.preventDefault();
    const text = messageText.trim();
    if (!text || !room) return;
    
    const message = {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
      senderId: room.localParticipant.identity,
      name: userAlias || t('afterDarkUiYou'),
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    try {
      const payload = new TextEncoder().encode(JSON.stringify({ type: 'chat', message }));
      await room.localParticipant.publishData(payload, { reliable: true, topic: 'chat' });
      setMessages(current => current.some(item => item.id === message.id)
        ? current
        : [...current.slice(-99), message]);
      setMessageText('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('afterDarkUiSendMessageFailed'));
    }
  };

  const sendReaction = async (room) => {
    if (!room) return;
    try {
      const payload = new TextEncoder().encode(JSON.stringify({ type: 'reaction' }));
      await room.localParticipant.publishData(payload, { reliable: false, topic: 'chat' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('afterDarkUiSendReactionFailed'));
    }
  };

  const sendTip = async event => {
    event.preventDefault();
    const amount = Number(tipAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      toast.error(t('afterDarkUiValidTipAmount'));
      return;
    }
    const sessionId = creator?.liveSession?.sessionId;
    if (!sessionId) {
      toast.error(t('afterDarkUiLiveSessionUnavailable'));
      return;
    }

    if (amount > Number(walletBalance || 0)) {
      toast.error(t('afterDarkUiLowBalanceAddFunds'));
      return;
    }

    setIsSendingTip(true);
    try {
      const response = await afterDarkService.tipLiveSession(sessionId, {
        amount_cents: Math.round(amount * 100),
        message: tipMessage.trim(),
      });
      setTipOpen(false);
      setTipMessage('');
      toast.success(t('afterDarkUiLiveTipSent', { name: creator.name, amount: amount.toLocaleString() }));
      if (response?.live_alert_published === false) {
        toast.info(t('afterDarkUiTipAlertUnavailable'));
      }
      if (onTipSent) {
        const walletRefreshed = await onTipSent();
        if (walletRefreshed === false) toast.info(t('afterDarkUiTipWalletRefreshDelayed'));
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiSendTipFailed')));
    } finally {
      setIsSendingTip(false);
    }
  };

  const toggleCaptions = () => {
    setCaptionsEnabled(enabled => !enabled);
  };

  const shareLive = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${creator.name} is live`, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success(t('afterDarkUiLiveLinkCopied'));
      }
    } catch (error) {
      if (error?.name !== 'AbortError') toast.error(t('afterDarkUiShareLiveFailed'));
    }
  };

  return (
    <div className="after-dark-live-viewer fixed inset-0 z-[100] flex h-[100dvh] w-full overflow-hidden bg-black text-white [&_*]:!rounded-none">
      {/* FULL SCREEN PAYWALL OVERLAY */}
      {!hasAccess ? (
        <div className="relative flex h-full w-full flex-col items-center justify-center p-6">
          {/* Blurred Background */}
          <div className="absolute inset-0 bg-zinc-950">
            <img src={creator.avatar} alt="" className="h-full w-full object-cover opacity-20 blur-2xl" />
          </div>
          
          <button type="button" onClick={onClose} className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white backdrop-blur-md hover:bg-white/20">
            <X className="h-6 w-6" />
          </button>

          <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl bg-black/60 p-6 backdrop-blur-xl border border-white/10 shadow-2xl">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="relative">
                <img src={creator.avatar} alt="" className="size-[clamp(5rem,12vw,6rem)] rounded-full border-2 border-[var(--accent)] object-cover shadow-[0_0_20px_rgba(var(--accent-rgb),0.4)]" />
                <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-on-accent)]">
                  LIVE NOW
                </span>
              </div>
              <h2 className="text-xl font-bold text-white mt-2">{creator.name}'s Live Room</h2>
              <p className="text-sm text-zinc-300">{t('afterDarkUiUnlockToJoinConversation')}</p>
            </div>

            <div className="w-full space-y-3">
              <div className="grid grid-cols-2 gap-3 rounded-2xl bg-white/5 p-1.5">
                <button type="button" onClick={() => setAccessType('pass')} className={`flex flex-col items-center rounded-xl px-2 py-3 transition-colors ${accessType === 'pass' ? 'bg-white/15 text-white shadow-sm' : 'text-white/60 hover:text-white'}`}>
                  <span className="text-sm font-semibold">{t('afterDarkUiLivePass')}</span>
                  <span className="mt-0.5 text-[11px]">KES {livePassPrice.toLocaleString()}</span>
                </button>
                <button type="button" onClick={() => setAccessType('subscription')} className={`flex flex-col items-center rounded-xl px-2 py-3 transition-colors ${accessType === 'subscription' ? 'bg-white/15 text-white shadow-sm' : 'text-white/60 hover:text-white'}`}>
                  <span className="text-sm font-semibold">{t('afterDarkUiMonthlySub')}</span>
                  <span className="mt-0.5 text-[11px]">KES {subscriptionPrice.toLocaleString()}</span>
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
                <span className="text-sm text-zinc-400">{t('afterDarkUiWalletBalance')}</span>
                <span className="text-sm font-semibold text-white">KES {walletBalance.toLocaleString()}</span>
              </div>

              <div className="flex flex-col gap-3 pt-2">
                <button type="button" disabled={!hasEnoughBalance} onClick={() => onUseBalance(creator, accessType, price)} className="w-full rounded-full bg-[var(--accent)] py-3.5 text-sm font-bold text-[var(--text-on-accent)] transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50">
                  <Wallet className="mr-2 inline h-4 w-4" /> Unlock for KES {price.toLocaleString()}
                </button>
                <button type="button" onClick={() => onCheckout(creator, accessType, price)} className="w-full rounded-full bg-white/10 py-3.5 text-sm font-bold text-white transition-colors hover:bg-white/20">
                  Add Funds & Checkout
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : isOwnBroadcast ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-zinc-950 p-5 text-center">
          <div className="border-2 border-yellow-400 bg-black p-4">
            <Radio className="h-8 w-8 text-yellow-400" />
          </div>
          <div>
            <p className="text-lg font-black uppercase tracking-widest text-white">{t('afterDarkUiChannelOnAir')}</p>
            <p className="mt-1 text-xs font-bold uppercase tracking-wide text-zinc-400">{t('afterDarkUiBroadcastActive')}</p>
          </div>
          <button type="button" onClick={onManageBroadcast} className="border-2 border-yellow-400 bg-yellow-400 px-5 py-3 text-xs font-black uppercase tracking-widest text-[var(--text-on-warning)] hover:bg-black hover:text-yellow-400">
            Return to Creator Studio
          </button>
          <button type="button" onClick={onClose} className="border-2 border-zinc-700 bg-black px-5 py-3 text-xs font-bold uppercase tracking-widest text-white hover:border-white">
            Close
          </button>
        </div>
      ) : (
        !liveKitToken || joinState === 'failed' || joinState === 'ended'
      ) ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-zinc-950 p-5 text-center">
           <button type="button" onClick={onClose} className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white backdrop-blur-md">
            <X className="h-6 w-6" />
          </button>
          {joinState === 'failed' ? <ShieldAlert className="h-12 w-12 text-red-400" /> :
            joinState === 'ended' ? <Radio className="h-12 w-12 text-zinc-400" /> :
              <Loader2 className="h-12 w-12 animate-spin text-[var(--accent)]" />}
          <div>
            <p className="text-lg font-semibold text-white">{joinState === 'failed' ? t('afterDarkUiConnectionFailed') :
              joinState === 'ended' ? t('afterDarkUiLiveSessionEnded') : t('afterDarkUiJoiningLiveRoom')}</p>
            {joinError && <p role="alert" className="mt-2 text-sm text-red-400">{joinError}</p>}
          </div>
          {joinState === 'failed' && (
            <button type="button" onClick={retryJoin} className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-[var(--text-on-accent)]">
              Retry connection
            </button>
          )}
        </div>
      ) : (
        <LiveKitRoom
          key={roomGeneration}
          serverUrl={LIVEKIT_URL}
          token={liveKitToken}
          connect={!!liveKitToken}
          options={{ adaptiveStream: true, dynacast: true }}
          connectOptions={{ maxRetries: 5 }}
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onError={error => {
            reconnectGenerationRef.current += 1;
            if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
            setJoinError(error.message);
            setJoinState('failed');
          }}
          className="flex h-full w-full flex-col min-h-0 bg-black"
        >
          <div className="grid h-full w-full lg:grid-cols-[minmax(0,1fr)_360px]">
            
            {/* MAIN VIDEO AREA */}
            <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black">
              
              <LiveKitRenderer
                creator={creator}
                isMuted={isMuted}
                onConnectionStateChanged={setConnectionState}
                onViewerCountChanged={setViewerCount}
              />
              <ChatDataHandler onMessageReceived={handleIncomingDataMessage} />
              <LiveTipDataHandler onTipReceived={handleIncomingTip} />
              <LiveStageControls
                sessionId={creator.liveSession?.sessionId}
                stageState={stageState}
                setStageState={setStageState}
                onError={handleStageError}
              />
              {tipAlert && (
                <div role="status" className="absolute left-1/2 top-20 z-40 w-[min(90%,24rem)] -translate-x-1/2 animate-in slide-in-from-top-3 rounded-2xl border border-amber-300/40 bg-gradient-to-r from-amber-500/95 to-orange-500/95 p-3 text-[var(--text-on-warning)] shadow-xl">
                  <div className="flex items-center gap-2">
                    <Gift className="h-6 w-6 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold">
                        {t('afterDarkUiViewerTippedKes', { name: tipAlert.sender_name || t('afterDarkUiAViewer'), amount: (Number(tipAlert.amount_cents) / 100).toLocaleString() })}
                      </p>
                      {tipAlert.message && <p className="truncate text-xs font-medium">{tipAlert.message}</p>}
                    </div>
                  </div>
                </div>
              )}
              {captionsEnabled && liveCaption && (
                <div aria-live="polite" className="pointer-events-none absolute bottom-28 left-1/2 z-30 w-[90%] -translate-x-1/2 rounded-lg bg-black/75 px-4 py-2 text-center text-base font-semibold text-white shadow-lg">
                  {liveCaption}
                </div>
              )}
              {liveAnnouncement && (
                <div role="status" className="absolute left-1/2 top-24 z-30 w-[90%] max-w-2xl -translate-x-1/2 border-2 border-yellow-400 bg-black/90 px-4 py-3 text-center text-sm font-bold text-yellow-300 shadow-lg">
                  {liveAnnouncement}
                </div>
              )}
              {tipOpen && (
                <form onSubmit={sendTip} className="absolute bottom-20 right-4 z-40 w-[min(90%,20rem)] space-y-3 rounded-2xl border border-white/15 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-white">{t('afterDarkUiSendLiveTip')}</p>
                      <p className="text-xs text-zinc-400">Wallet: KES {Number(walletBalance || 0).toLocaleString()}</p>
                    </div>
                    <button type="button" onClick={() => setTipOpen(false)} aria-label={t('afterDarkUiCloseTipForm')} className="rounded-full bg-white/10 p-1.5 text-white">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[50, 100, 250, 500].map(amount => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setTipAmount(String(amount))}
                        className={`rounded-lg px-2 py-2 text-xs font-bold ${Number(tipAmount) === amount ? 'bg-[var(--accent)] text-[var(--text-on-accent)]' : 'bg-white/10 text-white'}`}
                      >
                        {amount}
                      </button>
                    ))}
                  </div>
                  <label className="block text-xs font-semibold text-zinc-300">
                    Tip amount (KES)
                    <input
                      type="number"
                      min="1"
                      max="100000"
                      step="1"
                      required
                      value={tipAmount}
                      onChange={event => setTipAmount(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                  <input
                    value={tipMessage}
                    onChange={event => setTipMessage(event.target.value)}
                    maxLength={120}
                    placeholder={t('afterDarkUiOptionalTipMessage')}
                    aria-label={t('afterDarkUiTipMessage')}
                    className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="submit"
                    disabled={isSendingTip || connectionState !== ConnectionState.Connected || Number(tipAmount) > Number(walletBalance || 0)}
                    className="flex w-full items-center justify-center gap-2 border-2 border-yellow-400 bg-yellow-400 py-2.5 text-sm font-bold text-[var(--text-on-warning)] disabled:opacity-50"
                  >
                    <Gift className="h-4 w-4" />
                    {isSendingTip ? t('afterDarkUiSending') : Number(tipAmount) > Number(walletBalance || 0) ? t('afterDarkUiInsufficientWalletBalance') : t('afterDarkUiTipFromWalletKes', { amount: Number(tipAmount || 0).toLocaleString() })}
                  </button>
                  {onCheckout && Number(tipAmount) > Number(walletBalance || 0) && (
                    <button
                      type="button"
                      onClick={checkoutTip}
                      className="w-full border-2 border-zinc-600 bg-black py-2.5 text-sm font-bold text-white hover:border-yellow-400"
                    >
                      Pay another way
                    </button>
                  )}
                </form>
              )}

              {/* TOP OVERLAY: Creator Info & Stats */}
              <div className="absolute left-0 top-0 z-30 flex w-full items-start justify-between bg-gradient-to-b from-black/60 to-transparent p-4 pt-safe-top">
                <div className="flex items-center gap-2 rounded-full bg-black/40 p-1 pr-4 backdrop-blur-md">
                  <img src={creator.avatar} alt="" className="h-8 w-8 rounded-full border border-white/20 object-cover" />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-white leading-tight">{creator.name}</span>
                    <span className="text-[10px] text-zinc-300 flex items-center gap-1">
                      <span className={`h-1.5 w-1.5 rounded-full ${connectionEnded ? 'bg-zinc-500' : 'animate-pulse bg-[var(--accent)]'}`} />
                      {connectionEnded || joinState === 'ended' ? t('afterDarkUiEnded') :
                        connectionState === ConnectionState.Reconnecting || connectionState === ConnectionState.SignalReconnecting
                          ? t('afterDarkUiReconnecting') : connectionState === ConnectionState.Connected ? t('afterDarkUiLive') : t('afterDarkUiConnecting')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur-md">
                    <Eye className="h-3.5 w-3.5 text-white/80" />
                    <span className="text-xs font-semibold text-white">{viewerCount}</span>
                  </div>
                  <button type="button" onClick={onClose} aria-label={t('afterDarkUiLeaveLiveRoom')} className="flex items-center justify-center rounded-full bg-black/40 p-1.5 text-white backdrop-blur-md transition-colors hover:bg-white/20">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* RIGHT SIDE FLOATING CONTROLS (Mobile) */}
              <div className="absolute right-3 bottom-24 z-30 flex flex-col items-center gap-4 lg:hidden">
                <button type="button" onClick={() => setIsMuted(m => !m)} className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md">
                  {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </button>
                <button type="button" onClick={shareLive} className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md">
                  <Share2 className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => setTipOpen(open => !open)} aria-label={t('afterDarkUiSendATip')} className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400 text-[var(--text-on-warning)] shadow-lg">
                  <Gift className="h-5 w-5" />
                </button>
                <button type="button" onClick={toggleCaptions} aria-label={t(captionsEnabled ? 'afterDarkUiTurnCaptionsOff' : 'afterDarkUiTurnCaptionsOn')} className={`flex h-10 w-10 items-center justify-center rounded-full backdrop-blur-md ${captionsEnabled ? 'bg-[var(--accent)] text-[var(--text-on-accent)]' : 'bg-black/40 text-white'}`}>
                  <span className="text-xs font-black">CC</span>
                </button>
                <span className="rounded-full bg-black/40 px-2 py-1 text-[10px] text-white">♥ {reactionCount}</span>
              </div>

              {/* BOTTOM OVERLAY: Mobile Chat & Inputs */}
              <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col justify-end bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pb-safe-bottom lg:hidden">
                
                {/* Mobile Chat Area - TikTok fade style */}
                <div 
                  className="pointer-events-none mb-4 flex max-h-[30dvh] w-[85%] flex-col gap-2 overflow-hidden"
                  style={{ maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 100%)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 100%)' }}
                >
                  <div className="flex flex-col justify-end flex-1 gap-2 overflow-y-auto pb-1 scrollbar-hide">
                    {messages.slice(-50).map(message => (
                      <div key={message.id} className={`chat-bubble ${message.name === userAlias ? 'chat-bubble--mine self-end border border-[var(--accent)]/35 bg-[var(--accent)]/15' : 'chat-bubble--other self-start border border-white/10 bg-black/45'} inline-flex w-fit max-w-full px-3 py-1.5 text-[13px] leading-snug text-white backdrop-blur-sm`}>
                        <span className={`font-semibold mr-1.5 ${message.name === userAlias ? 'text-[var(--accent)]' : 'text-white/80'}`}>
                          {message.name}:
                        </span>
                        <span className="text-white drop-shadow-md">{message.text}</span>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                </div>

                {/* Input Area */}
                <div className="pointer-events-auto w-full">
                  <ChatInputControls 
                    messageText={messageText} 
                    setMessageText={setMessageText} 
                    sendMessage={sendMessage} 
                    sendReaction={sendReaction}
                    connectionEnded={connectionEnded}
                  />
                </div>
              </div>
            </div>

            {/* DESKTOP SIDEBAR CHAT */}
            <aside className="hidden h-full min-h-0 flex-col border-l border-white/10 bg-zinc-950 lg:flex">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <h3 className="flex items-center gap-2 font-semibold text-white">
                  <MessageCircle className="h-5 w-5 text-[var(--accent)]" /> Live Chat
                </h3>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setIsMuted(m => !m)} className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
                    {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={shareLive} aria-label={t('afterDarkUiShareLive')} className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
                    <Share2 className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setTipOpen(open => !open)} aria-label={t('afterDarkUiSendATip')} className="rounded-full bg-amber-400 p-2 text-[var(--text-on-warning)] hover:bg-amber-300">
                    <Gift className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={toggleCaptions} aria-label={t(captionsEnabled ? 'afterDarkUiTurnCaptionsOff' : 'afterDarkUiTurnCaptionsOn')} className={`rounded-full p-2 ${captionsEnabled ? 'bg-[var(--accent)] text-[var(--text-on-accent)]' : 'bg-white/10 text-white'}`}>
                    <span className="text-[10px] font-black">CC</span>
                  </button>
                  <span className="text-xs text-white">♥ {reactionCount}</span>
                </div>
              </div>
              
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                <div className="rounded-lg bg-[var(--accent)]/10 p-3 text-xs text-[var(--accent)] border border-[var(--accent)]/20">
                  Welcome to {creator.name}'s Live! Be respectful and follow community guidelines.
                </div>
                {messages.map(message => (
                  <div key={message.id} className={`flex w-full flex-col text-sm leading-relaxed ${message.name === userAlias ? 'items-end' : 'items-start'}`}>
                    <div className={`mb-1 flex items-center gap-2 ${message.name === userAlias ? 'flex-row-reverse' : ''}`}>
                      <span className={`font-bold ${message.name === userAlias ? 'text-[var(--accent)]' : 'text-white/90'}`}>{message.name}</span>
                      <span className="text-[10px] text-zinc-500">{message.time}</span>
                    </div>
                    <div className={`chat-bubble ${message.name === userAlias ? 'chat-bubble--mine border border-[var(--accent)]/30 bg-[var(--accent)]/15' : 'chat-bubble--other border border-white/10 bg-black/45'} max-w-[90%] px-3 py-2 text-zinc-100 backdrop-blur-sm`}>
                      {message.text}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <div className="border-t border-white/10 p-4">
                <ChatInputControls 
                    messageText={messageText} 
                    setMessageText={setMessageText} 
                    sendMessage={sendMessage} 
                    sendReaction={sendReaction}
                    connectionEnded={connectionEnded}
                  />
              </div>
            </aside>
          </div>
        </LiveKitRoom>
      )}
    </div>
  );
}