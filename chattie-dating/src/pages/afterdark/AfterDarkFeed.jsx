import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Flame, Filter, Search, TrendingUp, Crown, Lock, 
  Unlock, Star, ChevronRight, Loader2, AlertTriangle,
  RefreshCcw, SlidersHorizontal, Plus, Radio, Video,
  VideoOff, Mic, MicOff, X, Users
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate, useSearchParams } from 'react-router-dom';

import LockedPostCard from '../../components/afterdark/LockedPostCard';
import MpesaPaystackModal from '../../components/afterdark/MpesaPaystackModal';
import AfterDarkLiveViewingModal from '../../components/afterdark/AfterDarkLiveViewingModal';
import { normalizeMediaType } from '../../utils/mediaType';
import AfterDarkChatHub from './AfterDarkChatHub';
import { useAppStore } from '../../store/useAppStore';
import { afterDarkService } from '../../api/afterdark.service';
import { PagePrivacyShield, usePageFocus } from '../../hooks/usePageFocus';
import {
  ConnectionQuality, ConnectionState, LocalAudioTrack, LocalVideoTrack, Room, RoomEvent, Track,
} from 'livekit-client';

// ============================================================================
// DATA NORMALIZATION
// ============================================================================
const normalizeLiveSession = (rawSession, creatorId) => rawSession ? {
  ...rawSession,
  creatorId: rawSession.creatorId || rawSession.creator_id || creatorId,
  sessionId: rawSession.sessionId || rawSession.session_id || rawSession.id,
  hostId: rawSession.hostId || rawSession.host_id,
} : null;

const normalizeCreator = (creator = {}) => {
  const liveSession = normalizeLiveSession(
    creator.liveSession || creator.live_session,
    creator.id || creator.creator_id
  );
  const subscriptionPriceCents = Number(creator.subscription_price_cents);
  const livePassPriceCents = Number(creator.live_pass_price_cents ?? creator.price_cents);
  const creatorName = [creator.name, creator.display_name, creator.displayName, creator.username, creator.alias]
    .find(value => typeof value === 'string' && value.trim());
  return {
    ...creator,
    id: creator.id || creator.creator_id,
    name: creatorName?.trim() || 'Creator',
    avatar: creator.avatar || creator.avatar_url || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&q=80',
    cover: creator.cover || creator.cover_url || '',
    isVerified: Boolean(creator.isVerified ?? creator.is_verified),
    subs: Number(creator.subs ?? creator.subscriber_count ?? 0),
    tier: creator.tier || creator.access_tier || 'Standard',
    subPrice: creator.subPrice ?? (subscriptionPriceCents > 0 ? subscriptionPriceCents / 100 : 1500),
    livePassPrice: creator.livePassPrice ?? (livePassPriceCents > 0 ? livePassPriceCents / 100 : 250),
    isLive: Boolean(creator.isLive ?? creator.is_live) || creator.status === 'live' || Boolean(liveSession),
    hasStory: Boolean(creator.hasStory ?? creator.has_story),
    liveSession,
  };
};

const normalizeFeedPost = post => {
  const creator = normalizeCreator(post.creator || {});
  return {
    ...post,
    id: post.id || post.post_id,
    creator,
    mediaUrl: post.mediaUrl || post.media_url || post.preview_url || '',
    mediaType: normalizeMediaType(post.mediaType || post.media_type),
    pricingStrategy: post.pricingStrategy || post.pricing_strategy || 'ppv',
    price: Number(post.price ?? post.price_cents ?? 0) / (post.price_cents !== undefined ? 100 : 1),
    timestamp: post.timestamp || post.created_at || 'Just now',
    watermark: post.watermark !== false,
    isExplicit: Boolean(post.isExplicit ?? post.is_explicit),
    isUnlocked: Boolean(post.isUnlocked ?? post.is_unlocked),
    isLiked: Boolean(post.isLiked ?? post.is_liked),
    likesCount: Number(post.likesCount ?? post.like_count ?? 0),
    commentsCount: Number(post.commentsCount ?? post.comment_count ?? post.comments_count ?? 0),
    isFollowing: Boolean(post.isFollowing ?? post.is_following),
    comments: Array.isArray(post.comments) ? post.comments : [],
    tags: Array.isArray(post.tags) ? post.tags : [],
  };
};

const liveSessionKey = creatorId => `afterdark-live-session:${creatorId}`;
const liveChannelName = session => `afterdark-live:${session.creatorId}:${session.sessionId}`;
const livePassEntitlementKey = (creatorId, sessionId) => `live-pass:${creatorId}:${sessionId}`;
const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';
const liveRoomOptions = { adaptiveStream: true, dynacast: true };

const broadcastLivePresence = message => {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('afterdark-live-presence');
  try {
    channel.postMessage(message);
  } finally {
    channel.close();
  }
};

// ============================================================================
// INLINE SUB-COMPONENTS (MATCHING USERSETTINGS BLUEPRINT)
// ============================================================================
const FeedSkeleton = () => (
  <div className="w-full bg-black border-2 border-zinc-800 p-4 mb-6 flex flex-col rounded-none animate-pulse">
    <div className="flex items-center gap-3 mb-4 border-b-2 border-zinc-800 pb-4 rounded-none">
      <div className="w-10 h-10 bg-zinc-900 border-2 border-zinc-700 rounded-none shrink-0" />
      <div className="space-y-2 flex-1">
        <div className="h-3 bg-zinc-900 w-1/4 rounded-none" />
        <div className="h-2 bg-zinc-900 w-1/6 rounded-none" />
      </div>
    </div>
    <div className="w-full aspect-video bg-zinc-950 border-2 border-zinc-800 mb-4 flex items-center justify-center rounded-none">
      <Loader2 className="w-8 h-8 text-zinc-600 animate-spin" />
    </div>
    <div className="space-y-2 mb-4">
      <div className="h-3 bg-zinc-900 w-3/4 rounded-none" />
      <div className="h-3 bg-zinc-900 w-1/2 rounded-none" />
    </div>
    <div className="flex gap-4 border-t-2 border-zinc-800 pt-4 rounded-none">
      <div className="h-6 bg-zinc-900 w-16 rounded-none" />
      <div className="h-6 bg-zinc-900 w-16 rounded-none" />
      <div className="ml-auto h-[clamp(1.25rem,3vh,1.5rem)] w-[clamp(4rem,9vw,6rem)] bg-zinc-900 rounded-none" />
    </div>
  </div>
);

const StoryCircle = ({ creator, isMe = false, onClick }) => (
  <button 
    type="button" 
    onClick={onClick} 
    className="flex flex-col items-center gap-2 cursor-pointer shrink-0 group w-16 rounded-none focus:outline-none"
  >
    <div className={`relative w-14 h-14 flex items-center justify-center border-2 p-0.5 transition-colors rounded-none bg-black
      ${isMe ? 'border-zinc-600 border-dashed hover:border-white' : creator.isLive ? 'border-red-500' : 'border-yellow-400'}
    `}>
      <img 
        src={creator.avatar || 'https://via.placeholder.com/150'} 
        alt={creator.name} 
        className={`w-full h-full object-cover rounded-none ${isMe && !creator.isLive ? 'grayscale opacity-60 group-hover:grayscale-0 group-hover:opacity-100 transition-all' : ''}`} 
      />
      {isMe && !creator.isLive && (
        <div className="absolute -bottom-1.5 -right-1.5 w-5 h-5 bg-white text-black border-2 border-black flex items-center justify-center rounded-none">
          <Plus className="w-3 h-3" />
        </div>
      )}
      {creator.isLive && (
        <div className="absolute -bottom-2 px-1.5 py-0.5 bg-red-600 text-white text-[8px] font-bold uppercase tracking-widest border-2 border-black rounded-none">
          LIVE
        </div>
      )}
    </div>
    <span className="text-[9px] font-bold text-zinc-400 group-hover:text-white uppercase tracking-widest truncate w-full text-center transition-colors">
      {isMe ? (creator.isLive ? 'Watch Live' : 'Go Live') : creator.name}
    </span>
  </button>
);

const TrendingCreatorCard = ({ creator, onClick }) => (
  <div 
    onClick={onClick} 
    className="w-full flex items-center justify-between p-3 bg-black border-2 border-zinc-800 hover:bg-zinc-950 hover:border-zinc-600 transition-colors group cursor-pointer rounded-none"
  >
    <div className="flex items-center gap-3 min-w-0">
      <div className="relative shrink-0">
        <img 
          src={creator.avatar || 'https://via.placeholder.com/150'} 
          alt={creator.name} 
          className="w-10 h-10 object-cover border-2 border-zinc-700 grayscale group-hover:grayscale-0 transition-all rounded-none" 
        />
        {creator.isVerified && (
          <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-yellow-400 border-2 border-black flex items-center justify-center rounded-none">
            <Star className="w-2 h-2 text-black" />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <h4 className="text-xs font-bold text-white uppercase tracking-widest truncate mb-0.5">{creator.name}</h4>
        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1">
          <Crown className="w-3 h-3 text-yellow-400" /> {creator.subs} VIPs
        </span>
      </div>
    </div>
    <div className="w-7 h-7 shrink-0 bg-black border-2 border-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-white group-hover:border-white transition-colors rounded-none">
      <ChevronRight className="w-4 h-4" />
    </div>
  </div>
);

const LiveKitGuestTile = ({ track, name }) => {
  const videoRef = useRef(null);
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return undefined;
    track.attach(element);
    return () => track.detach(element);
  }, [track]);

  return (
    <div className="relative w-[clamp(7rem,18vw,10rem)] overflow-hidden border-2 border-zinc-700 bg-black rounded-none">
      <video ref={videoRef} autoPlay playsInline className="aspect-video w-full object-cover rounded-none" />
      <div className="bg-zinc-950 border-t-2 border-zinc-800 px-2 py-1 flex justify-between items-center rounded-none">
        <span className="text-[9px] font-bold text-white uppercase tracking-widest truncate">{name}</span>
        <span className="text-[8px] font-bold text-yellow-400 uppercase tracking-widest">GUEST</span>
      </div>
    </div>
  );
};

// ============================================================================
// LIVE STUDIO MODAL
// ============================================================================
const LiveStudioModal = ({ isOpen, onClose, creator, initialLiveSession, onLiveSessionChange }) => {
  const [localStream, setLocalStream] = useState(null);
  const [liveSession, setLiveSession] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [error, setError] = useState('');
  const [guestRequests, setGuestRequests] = useState([]);
  const [, setGuestStreams] = useState({});
  const [guestTracks, setGuestTracks] = useState([]);
  const [liveChat, setLiveChat] = useState([]);
  const [watcherIds, setWatcherIds] = useState([]);
  const [liveKitRoom, setLiveKitRoom] = useState(null);
  const [liveConnectionState, setLiveConnectionState] = useState(ConnectionState.Disconnected);
  const [connectionQuality, setConnectionQuality] = useState(ConnectionQuality.Unknown);
  const [hostMessage, setHostMessage] = useState('');
  const [announcementDraft, setAnnouncementDraft] = useState('');
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [broadcastMode, setBroadcastMode] = useState('both');
  const [liveAccess, setLiveAccess] = useState('free');
  const [livePassPrice, setLivePassPrice] = useState('250');
  const [isAutoCaptionsOn, setIsAutoCaptionsOn] = useState(false);
  const [captionLanguage, setCaptionLanguage] = useState('en-US');
  const [captionDraft, setCaptionDraft] = useState('');
  const [tipAlert, setTipAlert] = useState(null);
  
  const videoRef = useRef(null);
  const requestIdRef = useRef(0);
  const signalingChannelRef = useRef(null);
  const localStreamRef = useRef(null);
  const liveSessionRef = useRef(null);
  const liveKitRoomRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const speechRecognitionActiveRef = useRef(false);
  const tipAlertTimerRef = useRef(null);

  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { liveSessionRef.current = liveSession; }, [liveSession]);

  useEffect(() => {
    if (!liveKitRoom) return undefined;

    const updateViewers = () => setWatcherIds([...liveKitRoom.remoteParticipants.keys()]);
    const syncGuestTracks = () => {
      const tracks = [...liveKitRoom.remoteParticipants.values()].flatMap(participant =>
        [...participant.videoTrackPublications.values()]
          .filter(publication => publication.source === Track.Source.Camera && publication.track)
          .map(publication => ({
            id: participant.identity,
            name: participant.name || 'Guest',
            track: publication.track,
          }))
      );
      setGuestTracks(tracks);
    };
    const handleConnectionState = state => setLiveConnectionState(state);
    const handleConnectionQuality = (quality, participant) => {
      if (participant.isLocal) setConnectionQuality(quality);
    };
    const handleDataReceived = (payload, participant, _kind, topic) => {
      if (topic !== 'chat' && topic !== 'live-control' && topic !== 'live-tip') return;

      let data;
      try {
        data = JSON.parse(new TextDecoder().decode(payload));
      } catch (parseError) {
        console.warn('Ignoring an invalid LiveKit data message.', parseError);
        return;
      }

      if (topic === 'chat' && data?.type === 'chat' && data.message) {
        setLiveChat(current => current.some(message => message.id === data.message.id)
          ? current
          : [...current.slice(-49), data.message]);
      } else if (topic === 'live-tip' && data?.type === 'tip' && !participant) {
        setTipAlert(data);
        if (tipAlertTimerRef.current) window.clearTimeout(tipAlertTimerRef.current);
        tipAlertTimerRef.current = window.setTimeout(() => setTipAlert(null), 6500);
      } else if (
        topic === 'live-control'
        && data?.type === 'stage-request'
        && data.identity
        && data.identity === participant?.identity
      ) {
        setGuestRequests(current => current.some(request => request.id === data.identity)
          ? current
          : [...current, { id: data.identity, name: data.name || 'Viewer' }]);
      }
    };

    liveKitRoom.on(RoomEvent.DataReceived, handleDataReceived);
    liveKitRoom.on(RoomEvent.ParticipantConnected, updateViewers);
    liveKitRoom.on(RoomEvent.ParticipantDisconnected, updateViewers);
    liveKitRoom.on(RoomEvent.TrackSubscribed, syncGuestTracks);
    liveKitRoom.on(RoomEvent.TrackUnsubscribed, syncGuestTracks);
    liveKitRoom.on(RoomEvent.ConnectionStateChanged, handleConnectionState);
    liveKitRoom.on(RoomEvent.ConnectionQualityChanged, handleConnectionQuality);
    liveKitRoom.on(RoomEvent.Reconnected, updateViewers);
    updateViewers();
    syncGuestTracks();
    setLiveConnectionState(liveKitRoom.state);

    return () => {
      liveKitRoom.off(RoomEvent.DataReceived, handleDataReceived);
      liveKitRoom.off(RoomEvent.ParticipantConnected, updateViewers);
      liveKitRoom.off(RoomEvent.ParticipantDisconnected, updateViewers);
      liveKitRoom.off(RoomEvent.TrackSubscribed, syncGuestTracks);
      liveKitRoom.off(RoomEvent.TrackUnsubscribed, syncGuestTracks);
      liveKitRoom.off(RoomEvent.ConnectionStateChanged, handleConnectionState);
      liveKitRoom.off(RoomEvent.ConnectionQualityChanged, handleConnectionQuality);
      liveKitRoom.off(RoomEvent.Reconnected, updateViewers);
    };
  }, [liveKitRoom]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    speechRecognitionActiveRef.current = isAutoCaptionsOn;
    if (!isAutoCaptionsOn || !liveKitRoom || liveConnectionState !== ConnectionState.Connected) return undefined;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsAutoCaptionsOn(false);
      setError('Automatic captions are not supported in this browser. You can still send captions manually.');
      return undefined;
    }

    const recognition = new SpeechRecognition();
    let active = true;
    let restartTimer;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = captionLanguage;
    recognition.onresult = event => {
      const text = Array.from(event.results)
        .slice(event.resultIndex)
        .filter(result => result.isFinal)
        .map(result => result[0]?.transcript || '')
        .join(' ')
        .trim()
        .slice(0, 240);
      if (!text || liveKitRoom.state !== ConnectionState.Connected) return;
      liveKitRoom.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ type: 'caption', text })),
        { reliable: true, topic: 'chat' }
      ).catch(captionError => {
        setError(captionError instanceof Error ? captionError.message : 'Could not publish the live caption.');
      });
    };
    recognition.onerror = event => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setError(`Automatic captions stopped: ${event.error}.`);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') setIsAutoCaptionsOn(false);
    };
    recognition.onend = () => {
      if (!active || !speechRecognitionActiveRef.current || liveKitRoomRef.current !== liveKitRoom) return;
      restartTimer = window.setTimeout(() => {
        if (!active || !speechRecognitionActiveRef.current) return;
        try {
          recognition.start();
        } catch (error) {
          setError(error instanceof Error ? `Could not restart automatic captions: ${error.message}` : 'Could not restart automatic captions.');
        }
      }, 500);
    };
    speechRecognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (error) {
      setIsAutoCaptionsOn(false);
      setError(error instanceof Error ? `Could not start automatic captions: ${error.message}` : 'Could not start automatic captions.');
    }

    return () => {
      active = false;
      if (restartTimer) window.clearTimeout(restartTimer);
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      try {
        recognition.stop();
      } catch (error) {
        console.warn('Unable to stop browser speech recognition cleanly.', error);
      }
      if (speechRecognitionRef.current === recognition) speechRecognitionRef.current = null;
    };
  }, [captionLanguage, isAutoCaptionsOn, liveConnectionState, liveKitRoom]);

  useEffect(() => () => {
    if (tipAlertTimerRef.current) window.clearTimeout(tipAlertTimerRef.current);
    speechRecognitionActiveRef.current = false;
    try {
      speechRecognitionRef.current?.stop();
    } catch (error) {
      console.warn('Unable to stop browser speech recognition during cleanup.', error);
    }
  }, []);

  useEffect(() => {
    if (!localStream || !liveSession || !('BroadcastChannel' in window) || !('RTCPeerConnection' in window)) return undefined;

    const channel = new BroadcastChannel(liveChannelName(liveSession));
    const peers = new Map();
    const pendingCandidates = new Map();
    const guestMediaTracks = new Map();
    const handshakeComplete = new Set();
    const viewerIds = new Set();
    signalingChannelRef.current = channel;

    const removeGuestTracks = viewerId => {
      const guestTracks = guestMediaTracks.get(viewerId);
      if (!guestTracks) return;
      const trackIds = new Set([...guestTracks.keys()]);
      guestMediaTracks.delete(viewerId);
      peers.forEach((peer, targetId) => {
        if (targetId === viewerId) return;
        peer.getSenders().forEach(sender => {
          if (sender.track && trackIds.has(sender.track.id)) peer.removeTrack(sender);
        });
      });
    };

    const notifyGuestLeft = viewerId => {
      const tracks = guestMediaTracks.get(viewerId);
      const streamIds = [...new Set([...(tracks?.values() || [])].map(({ stream }) => stream.id))];
      peers.forEach((_, targetId) => {
        if (targetId !== viewerId) {
          channel.postMessage({
            type: 'stage-guest-left',
            from: liveSession.hostId,
            to: targetId,
            streamIds,
          });
        }
      });
      removeGuestTracks(viewerId);
    };

    const addQueuedCandidates = async (peer, viewerId) => {
      const candidates = pendingCandidates.get(viewerId) || [];
      pendingCandidates.delete(viewerId);
      for (const candidate of candidates) {
        await peer.addIceCandidate(candidate);
      }
    };

    channel.onmessage = async ({ data }) => {
      if (!data || data.from === liveSession.hostId) return;

      if (data.type === 'chat' && data.message) {
        setLiveChat(current => [...current.slice(-49), data.message]);
        return;
      }

      if (data.type === 'guest-request') {
        setGuestRequests(current => current.some(request => request.id === data.from)
          ? current
          : [...current, { id: data.from, name: data.name || 'Viewer' }]);
        return;
      }

      if (data.type === 'viewer-count' && data.from) {
        viewerIds.add(data.from);
        setWatcherIds([...viewerIds]);
        channel.postMessage({ type: 'viewer-count', count: viewerIds.size });
        return;
      }

      if (data.type === 'join' && !peers.has(data.from)) {
        const viewerId = data.from;
        viewerIds.add(viewerId);
        setWatcherIds([...viewerIds]);
        channel.postMessage({ type: 'viewer-count', count: viewerIds.size });
        
        const peer = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        peers.set(viewerId, peer);
        
        localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
        
        guestMediaTracks.forEach(tracks => {
          tracks.forEach(({ track, stream }) => peer.addTrack(track, stream));
        });
        
        peer.ontrack = event => {
          const stream = event.streams[0] || new MediaStream([event.track]);
          setGuestStreams(current => ({ ...current, [viewerId]: { stream, name: 'Guest' } }));
          const tracks = guestMediaTracks.get(viewerId) || new Map();
          if (!tracks.has(event.track.id)) {
            tracks.set(event.track.id, { track: event.track, stream });
            guestMediaTracks.set(viewerId, tracks);
            peers.forEach((targetPeer, targetId) => {
              if (targetId !== viewerId) targetPeer.addTrack(event.track, stream);
            });
          }
        };
        
        peer.onnegotiationneeded = async () => {
          if (!handshakeComplete.has(viewerId) || peer.signalingState !== 'stable') return;
          try {
            const stageOffer = await peer.createOffer();
            await peer.setLocalDescription(stageOffer);
            channel.postMessage({
              type: 'stage-offer',
              from: liveSession.hostId,
              to: viewerId,
              description: peer.localDescription,
            });
          } catch (negotiationError) {
            setError(negotiationError instanceof Error ? negotiationError.message : 'Could not update the shared guest stage.');
          }
        };
        
        peer.onicecandidate = event => {
          if (event.candidate) {
            channel.postMessage({
              type: 'candidate',
              from: liveSession.hostId,
              to: viewerId,
              candidate: event.candidate.toJSON(),
            });
          }
        };
        
        peer.onconnectionstatechange = () => {
          if (!['failed', 'closed'].includes(peer.connectionState) || !peers.has(viewerId)) return;
          if (peer.connectionState === 'failed') {
            notifyGuestLeft(viewerId);
            pendingCandidates.delete(viewerId);
            handshakeComplete.delete(viewerId);
            viewerIds.delete(viewerId);
            setWatcherIds([...viewerIds]);
            setGuestStreams(current => {
              const next = { ...current };
              delete next[viewerId];
              return next;
            });
          }
          peer.close();
          peers.delete(viewerId);
        };

        try {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          channel.postMessage({
            type: 'offer',
            from: liveSession.hostId,
            to: viewerId,
            description: peer.localDescription,
          });
        } catch (connectionError) {
          setError(connectionError instanceof Error ? connectionError.message : 'Could not connect to the viewer.');
          peer.close();
          peers.delete(viewerId);
        }
        return;
      }

      const peer = peers.get(data.from);
      if (!peer || data.to !== liveSession.hostId) return;

      try {
        if (data.type === 'answer') {
          await peer.setRemoteDescription(data.description);
          await addQueuedCandidates(peer, data.from);
          handshakeComplete.add(data.from);
        } else if (data.type === 'guest-offer') {
          if (peer.signalingState === 'have-local-offer') {
            await peer.setLocalDescription({ type: 'rollback' });
          }
          await peer.setRemoteDescription(data.description);
          await addQueuedCandidates(peer, data.from);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          channel.postMessage({
            type: 'guest-answer',
            from: liveSession.hostId,
            to: data.from,
            description: peer.localDescription,
          });
        } else if (data.type === 'stage-answer') {
          await peer.setRemoteDescription(data.description);
          await addQueuedCandidates(peer, data.from);
        } else if (data.type === 'guest-stage-left') {
          notifyGuestLeft(data.from);
          setGuestStreams(current => {
            const next = { ...current };
            delete next[data.from];
            return next;
          });
        } else if (data.type === 'candidate') {
          if (peer.remoteDescription) {
            await peer.addIceCandidate(data.candidate);
          } else {
            pendingCandidates.set(data.from, [...(pendingCandidates.get(data.from) || []), data.candidate]);
          }
        } else if (data.type === 'leave') {
          notifyGuestLeft(data.from);
          peer.close();
          peers.delete(data.from);
          pendingCandidates.delete(data.from);
          handshakeComplete.delete(data.from);
          viewerIds.delete(data.from);
          setWatcherIds([...viewerIds]);
          setGuestStreams(current => {
            const next = { ...current };
            delete next[data.from];
            return next;
          });
        }
      } catch (connectionError) {
        setError(connectionError instanceof Error ? connectionError.message : 'The viewer connection failed.');
      }
    };

    return () => {
      peers.forEach(peer => peer.close());
      peers.clear();
      guestMediaTracks.clear();
      handshakeComplete.clear();
      viewerIds.clear();
      channel.close();
      if (signalingChannelRef.current === channel) signalingChannelRef.current = null;
    };
  }, [liveSession, localStream]);

  useEffect(() => {
    if (!localStream || !liveSession) return undefined;
    const heartbeat = window.setInterval(() => {
      const nextSession = { ...liveSession, lastSeen: Date.now() };
      try {
        localStorage.setItem(liveSessionKey(creator.id), JSON.stringify(nextSession));
        broadcastLivePresence({ type: 'live', session: nextSession });
        onLiveSessionChange(nextSession);
      } catch (storageError) {
        setError(storageError instanceof Error ? storageError.message : 'Could not keep your live session active.');
      }
    }, 3000);
    return () => window.clearInterval(heartbeat);
  }, [creator.id, liveSession, localStream, onLiveSessionChange]);

  useEffect(() => () => {
    const activeSession = liveSessionRef.current;
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    const room = liveKitRoomRef.current;
    liveKitRoomRef.current = null;
    if (room) {
      room.disconnect().catch(error => {
        console.error('Unable to disconnect from the After Dark LiveKit room.', error);
      });
    }
    if (!activeSession) return;
    afterDarkService.endLiveSession(activeSession.sessionId).catch(error => {
      console.error('Unable to end the After Dark live session.', error);
    });
    signalingChannelRef.current?.postMessage({ type: 'ended', from: activeSession.hostId });
    try {
      localStorage.removeItem(liveSessionKey(activeSession.creatorId));
      broadcastLivePresence({ type: 'ended', creatorId: activeSession.creatorId, sessionId: activeSession.sessionId });
    } catch (cleanupError) {
      console.error('Unable to close the local After Dark live session.', cleanupError);
    }
  }, []);

  const startStream = async () => {
    setError('');
    if (!creator.id) {
      setError('Your account ID is unavailable. Sign in again before going live.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not supported in this browser.');
      return;
    }
    const passPrice = Number(livePassPrice);
    if (liveAccess === 'paid' && (!Number.isFinite(passPrice) || passPrice < 1)) {
      setError('Enter a live pass price of at least KES 1.');
      return;
    }

    setIsStarting(true);
    const requestId = ++requestIdRef.current;
    let acquiredStream = null;
    let publishedSession = null;
    let publishingRoom = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: broadcastMode !== 'audio'
          ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
          : false,
        audio: broadcastMode !== 'video'
          ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : false,
      });
      acquiredStream = stream;
      if (requestId !== requestIdRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const startResponse = await afterDarkService.startLiveSession({
        title: creator.name,
        price_cents: liveAccess === 'paid' ? Math.round(passPrice * 100) : 0,
      });
      if (requestId !== requestIdRef.current) {
        await afterDarkService.endLiveSession(startResponse?.session_id);
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const sessionResponse = startResponse?.session || startResponse?.live_session || startResponse;
      const sessionId = sessionResponse?.session_id || sessionResponse?.sessionId || sessionResponse?.id
        || startResponse?.session_id || startResponse?.sessionId;
      if (!sessionId) throw new Error('The live service did not return a session ID.');
      publishedSession = { sessionId };

      const hostToken = startResponse?.sfu_token || startResponse?.livekit_token;
      if (typeof hostToken !== 'string' || !hostToken) {
        throw new Error('The live service did not return a valid host access token.');
      }

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      if ((broadcastMode !== 'video' && !audioTrack) || (broadcastMode !== 'audio' && !videoTrack)) {
        throw new Error(broadcastMode === 'both'
          ? 'Camera and microphone access are required for a video and audio broadcast.'
          : broadcastMode === 'video'
            ? 'Camera access is required for a video-only broadcast.'
            : 'Microphone access is required for an audio-only broadcast.');
      }

      publishingRoom = new Room(liveRoomOptions);
      await publishingRoom.connect(LIVEKIT_URL, hostToken, { maxRetries: 5 });
      if (videoTrack) {
        await publishingRoom.localParticipant.publishTrack(
          new LocalVideoTrack(videoTrack),
          { source: Track.Source.Camera }
        );
      }
      if (audioTrack) {
        await publishingRoom.localParticipant.publishTrack(
          new LocalAudioTrack(audioTrack),
          { source: Track.Source.Microphone }
        );
      }
      if (requestId !== requestIdRef.current) {
        await publishingRoom.disconnect();
        publishingRoom = null;
        await afterDarkService.endLiveSession(sessionId);
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      
      const session = {
        ...sessionResponse,
        creatorId: creator.id,
        creatorName: creator.name,
        creatorAvatar: creator.avatar,
        hostId: startResponse?.host_id || startResponse?.hostId || creator.id,
        sessionId,
        mediaMode: broadcastMode,
        lastSeen: Date.now(),
      };
      
      publishedSession = session;
      localStorage.setItem(liveSessionKey(creator.id), JSON.stringify(session));
      broadcastLivePresence({ type: 'live', session });
      
      liveKitRoomRef.current = publishingRoom;
      setLiveKitRoom(publishingRoom);
      publishingRoom = null;
      setLiveSession(session);
      setLocalStream(stream);
      setIsCameraEnabled(broadcastMode !== 'audio');
      setIsMicEnabled(broadcastMode !== 'video');
      onLiveSessionChange(session);
    } catch (streamError) {
      if (requestId === requestIdRef.current) {
        if (publishingRoom) {
          try {
            await publishingRoom.disconnect();
          } catch (cleanupError) {
            console.error('Unable to disconnect the failed After Dark LiveKit room.', cleanupError);
          }
        }
        acquiredStream?.getTracks().forEach(track => track.stop());
        if (publishedSession) {
          afterDarkService.endLiveSession(publishedSession.sessionId).catch(cleanupError => {
            console.error('Unable to close the failed After Dark live session.', cleanupError);
          });
          try {
            localStorage.removeItem(liveSessionKey(creator.id));
          } catch (cleanupError) {
            console.error('Unable to clear the failed local After Dark live session.', cleanupError);
          }
        }
        setError(streamError?.response?.data?.error || (streamError instanceof Error ? streamError.message : 'Could not start your camera and microphone.'));
      }
    } finally {
      if (requestId === requestIdRef.current) setIsStarting(false);
    }
  };

  const restoreLiveSession = async () => {
    const sessionId = initialLiveSession?.sessionId || initialLiveSession?.session_id || initialLiveSession?.id;
    if (!sessionId || !creator.id || isStarting) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera and microphone access are not supported in this browser.');
      return;
    }

    setError('');
    setIsStarting(true);
    let stream;
    let room;
    try {
      let savedSession = {};
      try {
        const saved = localStorage.getItem(liveSessionKey(creator.id));
        if (saved) savedSession = JSON.parse(saved);
      } catch (storageError) {
        throw new Error(`Could not restore saved broadcast details: ${storageError instanceof Error ? storageError.message : 'invalid local data'}`);
      }

      const mediaMode = savedSession.sessionId === sessionId && ['video', 'audio', 'both'].includes(savedSession.mediaMode)
        ? savedSession.mediaMode
        : 'both';
      stream = await navigator.mediaDevices.getUserMedia({
        video: mediaMode !== 'audio'
          ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
          : false,
        audio: mediaMode !== 'video'
          ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : false,
      });

      const response = await afterDarkService.refreshHostToken(sessionId);
      const token = response?.sfu_token || response?.livekit_token;
      if (typeof token !== 'string' || !token) {
        throw new Error('The server did not return a host access token. Your broadcast may have ended.');
      }

      room = new Room(liveRoomOptions);
      await room.connect(LIVEKIT_URL, token, { maxRetries: 5 });
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      if (videoTrack) await room.localParticipant.publishTrack(new LocalVideoTrack(videoTrack), { source: Track.Source.Camera });
      if (audioTrack) await room.localParticipant.publishTrack(new LocalAudioTrack(audioTrack), { source: Track.Source.Microphone });

      const session = {
        ...savedSession,
        ...initialLiveSession,
        creatorId: creator.id,
        creatorName: creator.name,
        creatorAvatar: creator.avatar,
        sessionId,
        hostId: initialLiveSession.hostId || initialLiveSession.host_id || creator.id,
        mediaMode,
        lastSeen: Date.now(),
      };
      localStorage.setItem(liveSessionKey(creator.id), JSON.stringify(session));
      broadcastLivePresence({ type: 'live', session });
      liveKitRoomRef.current = room;
      setLiveKitRoom(room);
      setLiveSession(session);
      setLocalStream(stream);
      setIsCameraEnabled(mediaMode !== 'audio');
      setIsMicEnabled(mediaMode !== 'video');
      onLiveSessionChange(session);
      stream = null;
      room = null;
    } catch (restoreError) {
      if (room) {
        try {
          await room.disconnect();
        } catch (disconnectError) {
          console.error('Unable to disconnect from the failed After Dark broadcast recovery.', disconnectError);
        }
      }
      stream?.getTracks().forEach(track => track.stop());
      setError(restoreError?.response?.data?.error || (restoreError instanceof Error ? restoreError.message : 'Could not reconnect to your live broadcast.'));
    } finally {
      setIsStarting(false);
    }
  };

  const reconnectStream = async () => {
    if (!liveSession || !localStream || isReconnecting) return;
    setIsReconnecting(true);
    setError('');
    let reconnectRoom = null;
    let reconnectSourceStream = null;
    let reconnectMediaStream = null;
    try {
      const response = await afterDarkService.refreshHostToken(liveSession.sessionId);
      const token = response?.sfu_token || response?.livekit_token;
      if (typeof token !== 'string' || !token) {
        throw new Error('The live service did not return a valid host access token.');
      }

      reconnectSourceStream = localStream.getTracks().every(track => track.readyState === 'live')
        ? localStream
        : await navigator.mediaDevices.getUserMedia({
          video: liveSession.mediaMode === 'audio'
            ? false
            : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
          audio: liveSession.mediaMode === 'video'
            ? false
            : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      reconnectMediaStream = new MediaStream(reconnectSourceStream.getTracks().map(track => track.clone()));
      const videoTrack = reconnectMediaStream.getVideoTracks()[0];
      const audioTrack = reconnectMediaStream.getAudioTracks()[0];
      const needsAudio = liveSession.mediaMode !== 'video';
      const needsVideo = liveSession.mediaMode !== 'audio';
      if ((needsAudio && !audioTrack) || (needsVideo && !videoTrack)) {
        throw new Error(liveSession.mediaMode === 'both'
          ? 'Camera and microphone access are required to reconnect.'
          : needsVideo ? 'Camera access is required to reconnect.' : 'Microphone access is required to reconnect.');
      }
      if (videoTrack) videoTrack.enabled = isCameraEnabled;
      if (audioTrack) audioTrack.enabled = isMicEnabled;
      reconnectRoom = new Room(liveRoomOptions);
      await reconnectRoom.connect(LIVEKIT_URL, token, { maxRetries: 5 });
      if (videoTrack) {
        await reconnectRoom.localParticipant.publishTrack(
          new LocalVideoTrack(videoTrack),
          { source: Track.Source.Camera }
        );
      }
      if (audioTrack) {
        await reconnectRoom.localParticipant.publishTrack(
          new LocalAudioTrack(audioTrack),
          { source: Track.Source.Microphone }
        );
      }

      const previousRoom = liveKitRoomRef.current;
      const previousStream = localStream;
      liveKitRoomRef.current = reconnectRoom;
      setLiveKitRoom(reconnectRoom);
      setLocalStream(reconnectMediaStream);
      reconnectRoom = null;
      reconnectMediaStream = null;
      previousStream.getTracks().forEach(track => track.stop());
      if (reconnectSourceStream !== previousStream) {
        reconnectSourceStream.getTracks().forEach(track => track.stop());
      }
      if (previousRoom) {
        try {
          await previousRoom.disconnect();
        } catch (cleanupError) {
          console.error('Unable to disconnect the previous After Dark LiveKit room.', cleanupError);
        }
      }
    } catch (reconnectError) {
      if (reconnectRoom) {
        try {
          await reconnectRoom.disconnect();
        } catch (cleanupError) {
          console.error('Unable to disconnect the failed After Dark reconnect room.', cleanupError);
        }
      }
      reconnectMediaStream?.getTracks().forEach(track => track.stop());
      if (reconnectSourceStream && reconnectSourceStream !== localStream) {
        reconnectSourceStream.getTracks().forEach(track => track.stop());
      }
      setError(reconnectError?.response?.data?.error || (reconnectError instanceof Error ? reconnectError.message : 'Could not reconnect to the live room.'));
    } finally {
      setIsReconnecting(false);
    }
  };

  const sendHostMessage = async event => {
    event.preventDefault();
    const text = hostMessage.trim();
    if (!text || !liveKitRoom || liveConnectionState !== ConnectionState.Connected) return;

    const message = {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
      senderId: liveKitRoom.localParticipant.identity,
      name: creator.name || 'Host',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    try {
      await liveKitRoom.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ type: 'chat', message })),
        { reliable: true, topic: 'chat' }
      );
      setLiveChat(current => current.some(item => item.id === message.id)
        ? current
        : [...current.slice(-49), message]);
      setHostMessage('');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send your message.');
    }
  };

  const sendLiveAnnouncement = async event => {
    event.preventDefault();
    const text = announcementDraft.trim().slice(0, 180);
    if (!text || !liveKitRoom || liveConnectionState !== ConnectionState.Connected) return;
    try {
      await liveKitRoom.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ type: 'announcement', text })),
        { reliable: true, topic: 'chat' }
      );
      setAnnouncementDraft('');
    } catch (announcementError) {
      setError(announcementError instanceof Error ? announcementError.message : 'Could not pin the live announcement.');
    }
  };

  const sendLiveCaption = async event => {
    event.preventDefault();
    const text = captionDraft.trim().slice(0, 240);
    if (!text || !liveKitRoom || liveConnectionState !== ConnectionState.Connected) return;
    try {
      await liveKitRoom.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ type: 'caption', text })),
        { reliable: true, topic: 'chat' }
      );
      setCaptionDraft('');
    } catch (captionError) {
      setError(captionError instanceof Error ? captionError.message : 'Could not publish the live caption.');
    }
  };

  const toggleAutomaticCaptions = () => {
    if (!isAutoCaptionsOn && liveSession?.mediaMode === 'video') {
      setError('Automatic captions need a microphone. Use manual captions for this video-only stream.');
      return;
    }
    if (!isAutoCaptionsOn && !(window.SpeechRecognition || window.webkitSpeechRecognition)) {
      setError('Automatic captions are not supported in this browser. You can still send captions manually.');
      return;
    }
    setError('');
    setIsAutoCaptionsOn(enabled => !enabled);
  };

  const endStream = async () => {
    requestIdRef.current += 1;
    if (liveSession?.sessionId) {
      try {
        await afterDarkService.endLiveSession(liveSession.sessionId);
      } catch (error) {
        setError(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not end the live session on the server.'));
        return;
      }
    }
    const room = liveKitRoomRef.current;
    liveKitRoomRef.current = null;
    speechRecognitionActiveRef.current = false;
    speechRecognitionRef.current?.stop();
    setIsAutoCaptionsOn(false);
    setLiveKitRoom(null);
    if (room) {
      try {
        await room.disconnect();
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not disconnect from the live room.');
      }
    }
    signalingChannelRef.current?.postMessage({ type: 'ended', from: liveSession?.hostId });
    localStream?.getTracks().forEach(track => track.stop());
    if (liveSession) {
      try {
        localStorage.removeItem(liveSessionKey(creator.id));
        broadcastLivePresence({ type: 'ended', creatorId: creator.id, sessionId: liveSession.sessionId });
      } catch (storageError) {
        setError(storageError instanceof Error ? storageError.message : 'Could not end the live session cleanly.');
      }
    }
    setLocalStream(null);
    setLiveSession(null);
    onLiveSessionChange(null);
    setIsStarting(false);
  };

  const toggleCamera = () => {
    const enabled = !isCameraEnabled;
    localStream?.getVideoTracks().forEach(track => { track.enabled = enabled; });
    setIsCameraEnabled(enabled);
  };

  const toggleMic = () => {
    const enabled = !isMicEnabled;
    localStream?.getAudioTracks().forEach(track => { track.enabled = enabled; });
    setIsMicEnabled(enabled);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 font-mono sm:p-6">
      <div className="absolute inset-0 bg-black/90" onClick={onClose} />
      <section 
        role="dialog" 
        aria-modal="true" 
        aria-labelledby="live-studio-title" 
        className="relative flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden border-2 border-yellow-400 bg-black shadow-[8px_8px_0px_rgba(var(--warning-rgb), 0.2)] rounded-none animate-in zoom-in-95 duration-200 z-10"
      >
        <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-zinc-950 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-1.5 border-2 border-yellow-400 bg-black">
              <Radio className="w-4 h-4 text-yellow-400" />
            </div>
            <div>
              <h2 id="live-studio-title" className="text-sm font-bold uppercase tracking-widest text-white">Creator Live Studio</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-yellow-400">
                {liveSession ? 'On air · creator control room' : initialLiveSession ? 'Broadcast detected · reconnect to reclaim the stage' : 'Broadcast direct to followers'}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close live studio" className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors rounded-none">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto p-4 md:p-6 flex flex-col md:flex-row gap-6 bg-black">
          <div className="flex-1 flex flex-col gap-4">
            <div className="relative aspect-video overflow-hidden border-2 border-zinc-800 bg-zinc-950 flex items-center justify-center rounded-none">
              {localStream?.getVideoTracks().length > 0 ? (
                <video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-cover rounded-none ${isCameraEnabled ? '' : 'hidden'}`} />
              ) : null}
              
              {(!localStream || localStream.getVideoTracks().length === 0 || !isCameraEnabled) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-zinc-500 bg-zinc-950">
                  {localStream?.getAudioTracks().length && localStream.getVideoTracks().length === 0
                    ? <Mic className="w-10 h-10 text-zinc-600" />
                    : <VideoOff className="w-10 h-10 text-zinc-600" />}
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    {!localStream ? initialLiveSession ? 'Broadcast is active · this device needs to reconnect' : 'Camera Preview Offline' :
                      localStream.getVideoTracks().length === 0 ? 'Audio-only broadcast' : 'Camera Muted'}
                  </span>
                </div>
              )}
              
              {localStream && (
                <span className="absolute left-3 top-3 flex items-center gap-2 bg-yellow-400 border-2 border-black px-2.5 py-1 text-[10px] font-bold text-black uppercase tracking-widest rounded-none">
                  <span className={`h-2 w-2 bg-black rounded-none ${liveConnectionState === ConnectionState.Connected ? 'animate-pulse' : ''}`} />
                  {liveConnectionState === ConnectionState.Reconnecting || liveConnectionState === ConnectionState.SignalReconnecting
                    ? 'RECONNECTING'
                    : liveConnectionState === ConnectionState.Connected ? 'LIVE' : 'CONNECTION LOST'}
                </span>
              )}
              {localStream && (
                <span className="absolute right-3 top-3 border border-black bg-zinc-950/80 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-white">
                  {liveSession?.mediaMode === 'audio' ? 'Audio only' :
                    liveSession?.mediaMode === 'video' ? 'Video only' :
                      `Network: ${connectionQuality}`}
                </span>
              )}
              {tipAlert && (
                <div role="status" className="absolute left-1/2 top-16 z-20 w-[min(90%,24rem)] -translate-x-1/2 border-2 border-black bg-yellow-400 p-3 text-black shadow-[4px_4px_0px_rgba(var(--shadow-rgb), 0.6)]">
                  <p className="text-xs font-extrabold uppercase">
                    {tipAlert.sender_name || 'A viewer'} tipped KES {(Number(tipAlert.amount_cents) / 100).toLocaleString()}
                  </p>
                  {tipAlert.message && <p className="mt-1 truncate text-xs font-medium">{tipAlert.message}</p>}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {!localStream && initialLiveSession ? (
                <div className="flex w-full flex-col gap-3 border-2 border-yellow-400 bg-zinc-950 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-yellow-400">Your broadcast is still live</p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-zinc-400">Reconnect camera and microphone to resume hosting. Your viewers can stay in the room.</p>
                  </div>
                  <button
                    type="button"
                    onClick={restoreLiveSession}
                    disabled={isStarting}
                    className="flex shrink-0 items-center justify-center gap-2 border-2 border-yellow-400 bg-yellow-400 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-black hover:text-yellow-400 disabled:opacity-50"
                  >
                    <RefreshCcw className={`h-4 w-4 ${isStarting ? 'animate-spin' : ''}`} />
                    {isStarting ? 'Reconnecting…' : 'Reconnect to broadcast'}
                  </button>
                </div>
              ) : !localStream ? (
                <>
                  <div className="flex flex-wrap border border-zinc-700">
                    <button type="button" onClick={() => setBroadcastMode('video')} className={`px-3 py-2 text-[10px] font-bold uppercase ${broadcastMode === 'video' ? 'bg-white text-black' : 'bg-black text-zinc-300'}`}>
                      <Video className="mr-1 inline h-3.5 w-3.5" /> Video only
                    </button>
                    <button type="button" onClick={() => setBroadcastMode('both')} className={`px-3 py-2 text-[10px] font-bold uppercase ${broadcastMode === 'both' ? 'bg-white text-black' : 'bg-black text-zinc-300'}`}>
                      <Radio className="mr-1 inline h-3.5 w-3.5" /> Video + audio
                    </button>
                    <button type="button" onClick={() => setBroadcastMode('audio')} className={`px-3 py-2 text-[10px] font-bold uppercase ${broadcastMode === 'audio' ? 'bg-white text-black' : 'bg-black text-zinc-300'}`}>
                      <Mic className="mr-1 inline h-3.5 w-3.5" /> Audio only
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    Live access
                    <select
                      value={liveAccess}
                      onChange={event => setLiveAccess(event.target.value)}
                      className="border border-zinc-700 bg-black px-2 py-2 text-white"
                    >
                      <option value="free">Free</option>
                      <option value="paid">Subscribers or live pass</option>
                    </select>
                  </label>
                  {liveAccess === 'paid' && (
                    <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                      Live pass (KES)
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={livePassPrice}
                        onChange={event => setLivePassPrice(event.target.value)}
                        className="w-[clamp(5rem,10vw,7rem)] border border-zinc-700 bg-black px-2 py-2 text-white"
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={startStream}
                    disabled={isStarting}
                    className="px-6 py-3 bg-white text-black border-2 border-white text-xs font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors disabled:opacity-50 flex items-center gap-2 rounded-none"
                  >
                    <Radio className="w-4 h-4 text-yellow-500" /> {isStarting ? 'Starting...' : 'Start Broadcast'}
                  </button>
                </>
              ) : (
                <>
                  {liveSession?.mediaMode !== 'audio' && (
                    <button type="button" onClick={toggleCamera} className="px-4 py-3 bg-black border-2 border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center gap-2 rounded-none">
                      {isCameraEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                      {isCameraEnabled ? 'Hide Cam' : 'Show Cam'}
                    </button>
                  )}
                  {liveSession?.mediaMode !== 'video' && (
                    <button type="button" onClick={toggleMic} className="px-4 py-3 bg-black border-2 border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center gap-2 rounded-none">
                      {isMicEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                      {isMicEnabled ? 'Mute Mic' : 'Unmute Mic'}
                    </button>
                  )}
                  {liveConnectionState === ConnectionState.Disconnected && (
                    <button
                      type="button"
                      onClick={reconnectStream}
                      disabled={isReconnecting}
                      className="px-4 py-3 bg-black border-2 border-yellow-500 text-yellow-400 hover:bg-yellow-500 hover:text-black text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center gap-2 rounded-none disabled:opacity-50"
                    >
                      <RefreshCcw className={`w-4 h-4 ${isReconnecting ? 'animate-spin' : ''}`} />
                      {isReconnecting ? 'Rejoining...' : 'Reconnect'}
                    </button>
                  )}
                  <button type="button" onClick={endStream} className="ml-auto px-6 py-3 bg-black border-2 border-yellow-400 hover:bg-yellow-400 text-yellow-400 hover:text-black text-[10px] font-bold uppercase tracking-widest transition-colors rounded-none">
                    End Live
                  </button>
                </>
              )}
            </div>

            {error && (
              <p role="alert" className="text-[10px] font-bold text-yellow-400 uppercase tracking-widest border-2 border-yellow-900 bg-black p-3 rounded-none">
                {error}
              </p>
            )}
          </div>

          <div className="flex w-full min-h-0 flex-col gap-4 md:w-[clamp(14rem,22vw,18rem)]">
            <div className="flex h-[35dvh] min-h-0 flex-col overflow-hidden border-2 border-zinc-800 bg-zinc-950 p-4 rounded-none md:h-auto md:flex-1">
              <div className="mb-3 flex items-center justify-between border-b-2 border-zinc-800 pb-2">
                <h3 className="text-[10px] font-bold text-white uppercase tracking-widest">Live Chat</h3>
                <span className="text-[9px] font-bold text-zinc-500 uppercase flex items-center gap-1">
                  <Users className="w-3 h-3" /> {watcherIds.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                {liveChat.map(message => (
                  <p key={message.id} className="text-[10px] leading-relaxed break-words">
                    <span className="font-bold text-yellow-400 uppercase tracking-wider">{message.name}: </span>
                    <span className="text-zinc-300">{message.text}</span>
                  </p>
                ))}
                {liveChat.length === 0 && (
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-4 text-center">No messages yet.</p>
                )}
              </div>
              <form onSubmit={sendHostMessage} className="mt-3 flex gap-2 border-t border-zinc-800 pt-3">
                <input
                  value={hostMessage}
                  onChange={event => setHostMessage(event.target.value)}
                  maxLength={150}
                  placeholder="Message viewers..."
                  aria-label="Message viewers"
                  className="min-w-0 flex-1 border border-zinc-700 bg-black px-2 py-2 text-[10px] text-white outline-none focus:border-white"
                />
                <button
                  type="submit"
                  disabled={!hostMessage.trim() || liveConnectionState !== ConnectionState.Connected}
                  className="border border-white bg-white px-3 text-[9px] font-bold uppercase text-black disabled:opacity-40"
                >
                  Send
                </button>
              </form>
              <form onSubmit={sendLiveAnnouncement} className="mt-2 flex gap-2">
                <input
                  value={announcementDraft}
                  onChange={event => setAnnouncementDraft(event.target.value)}
                  maxLength={180}
                  placeholder="Pin an announcement for viewers..."
                  aria-label="Live announcement"
                  className="min-w-0 flex-1 border border-zinc-700 bg-black px-2 py-2 text-[10px] text-white outline-none focus:border-yellow-400"
                />
                <button
                  type="submit"
                  disabled={!announcementDraft.trim() || liveConnectionState !== ConnectionState.Connected}
                  className="border border-yellow-400 bg-yellow-400 px-3 text-[9px] font-bold uppercase text-black disabled:opacity-40"
                >
                  Pin
                </button>
              </form>
            </div>

            <div className="border-2 border-zinc-800 bg-zinc-950 p-4 rounded-none">
              <h3 className="mb-3 border-b-2 border-zinc-800 pb-2 text-[10px] font-bold uppercase tracking-widest text-white">Live captions</h3>
              <div className="mb-3 flex items-center gap-2">
                <select
                  value={captionLanguage}
                  onChange={event => setCaptionLanguage(event.target.value)}
                  disabled={!localStream || isAutoCaptionsOn}
                  aria-label="Automatic caption language"
                  className="min-w-0 flex-1 border border-zinc-700 bg-black px-2 py-2 text-[10px] text-white disabled:opacity-50"
                >
                  <option value="en-US">English (US)</option>
                  <option value="en-GB">English (UK)</option>
                  <option value="sw-KE">Kiswahili (Kenya)</option>
                  <option value="fr-FR">French</option>
                  <option value="es-ES">Spanish</option>
                </select>
                <button
                  type="button"
                  onClick={toggleAutomaticCaptions}
                  disabled={!localStream || liveConnectionState !== ConnectionState.Connected || liveSession?.mediaMode === 'video'}
                  className={`border px-2 py-2 text-[9px] font-bold uppercase disabled:opacity-40 ${isAutoCaptionsOn ? 'border-yellow-400 bg-yellow-400 text-black' : 'border-zinc-700 text-zinc-300'}`}
                >
                  {isAutoCaptionsOn ? 'Auto on' : 'Auto captions'}
                </button>
              </div>
              <form onSubmit={sendLiveCaption} className="flex gap-2">
                <input
                  value={captionDraft}
                  onChange={event => setCaptionDraft(event.target.value)}
                  maxLength={240}
                  placeholder="Type a caption..."
                  aria-label="Type a live caption"
                  className="min-w-0 flex-1 border border-zinc-700 bg-black px-2 py-2 text-[10px] text-white outline-none focus:border-white"
                />
                <button
                  type="submit"
                  disabled={!captionDraft.trim() || liveConnectionState !== ConnectionState.Connected}
                  className="border border-white bg-white px-3 text-[9px] font-bold uppercase text-black disabled:opacity-40"
                >
                  Send
                </button>
              </form>
              <p className="mt-2 text-[9px] text-zinc-500">Automatic caption availability depends on your browser. Manual captions work in every browser.</p>
            </div>

            <div className="border-2 border-zinc-800 bg-zinc-950 p-4 rounded-none">
              <h3 className="mb-3 text-[10px] font-bold text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-2">Guest Requests</h3>
              {guestRequests.length === 0 && guestTracks.length === 0 && (
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-center py-2">No guests on stage.</p>
              )}
              
              <div className="flex flex-col gap-2">
                {guestRequests.map(request => (
                  <div key={request.id} className="flex w-full items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-widest bg-black border-2 border-zinc-800 p-2 rounded-none">
                    <span className="text-white truncate">{request.name}</span>
                    <span className="flex gap-1">
                      <button type="button" onClick={async () => {
                        try {
                          await afterDarkService.approveGuest(liveSession.sessionId, request.id);
                          await liveKitRoom.localParticipant.publishData(
                            new TextEncoder().encode(JSON.stringify({ type: 'stage-approved', identity: request.id })),
                            { reliable: true, topic: 'live-control' }
                          );
                          setGuestRequests(current => current.filter(item => item.id !== request.id));
                        } catch (err) {
                          setError(err?.response?.data?.error || (err instanceof Error ? err.message : 'Could not approve guest.'));
                        }
                      }} className="bg-white text-black border-2 border-white px-2 py-1 text-[9px] font-bold uppercase hover:bg-zinc-200 rounded-none">Allow</button>
                      
                      <button type="button" onClick={async () => {
                        try {
                          await afterDarkService.denyGuest(liveSession.sessionId, request.id);
                          await liveKitRoom.localParticipant.publishData(
                            new TextEncoder().encode(JSON.stringify({ type: 'stage-denied', identity: request.id })),
                            { reliable: true, topic: 'live-control' }
                          );
                          setGuestRequests(current => current.filter(item => item.id !== request.id));
                        } catch (err) {
                          setError(err?.response?.data?.error || (err instanceof Error ? err.message : 'Could not deny guest.'));
                        }
                      }} className="bg-black border-2 border-zinc-700 text-zinc-400 px-2 py-1 text-[9px] font-bold uppercase hover:text-white rounded-none">Deny</button>
                    </span>
                  </div>
                ))}

                <div className="flex flex-wrap gap-2 mt-2">
                  {guestTracks.map(guest => (
                    <div key={guest.id} className="flex flex-col gap-2 w-full">
                      <LiveKitGuestTile track={guest.track} name={guest.name} />
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await afterDarkService.removeGuest(liveSession.sessionId, guest.id);
                            await liveKitRoom.localParticipant.publishData(
                              new TextEncoder().encode(JSON.stringify({ type: 'stage-removed', identity: guest.id })),
                              { reliable: true, topic: 'live-control' }
                            );
                          } catch (err) {
                            setError(err?.response?.data?.error || (err instanceof Error ? err.message : 'Could not remove guest.'));
                          }
                        }}
                        className="w-full border-2 border-yellow-400 bg-black py-1.5 text-[9px] font-bold uppercase tracking-widest text-yellow-400 hover:bg-yellow-400 hover:text-black rounded-none"
                      >
                        Remove Guest
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT: AFTER DARK FEED
// ============================================================================
export default function AfterDarkFeed() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isPageFocused = usePageFocus();
  
  const currentUser = useAppStore(state => state.user) || { name: 'You', avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&q=80' };
  const isCreator = useAppStore(state => state.isCreator || state.user?.isCreator || false);
  const creatorAlias = useAppStore(state => state.afterDarkCreatorAlias);
  const afterDarkSubscriptions = useAppStore(state => state.afterDarkSubscriptions || {});
  const afterDarkLivePasses = useAppStore(state => state.afterDarkLivePasses || {});
  const grantAfterDarkSubscription = useAppStore(state => state.grantAfterDarkSubscription);
  const grantAfterDarkLivePass = useAppStore(state => state.grantAfterDarkLivePass);
  const storeWalletBalance = useAppStore(state => state.walletBalance);
  const setWalletBalance = useAppStore(state => state.setWalletBalance);
  const updateUser = useAppStore(state => state.updateUser);
  
  const availableWalletBalance = Number(storeWalletBalance || currentUser?.walletBalance || 0);
  const liveCreatorId = String(currentUser?.id || currentUser?.userId || '');
  
  const liveCreator = {
    ...currentUser,
    id: liveCreatorId,
    name: creatorAlias || currentUser?.name || currentUser?.username || 'Your channel',
    avatar: currentUser?.avatar || '',
  };
  
  const [posts, setPosts] = useState([]);
  const [showExplicitContent, setShowExplicitContent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  
  const [stories, setStories] = useState([]);
  const [trendingCreators, setTrendingCreators] = useState([]);
  const [feedError, setFeedError] = useState('');
  
  const [activeFilter, setActiveFilter] = useState('all');
  const [feedScope, setFeedScope] = useState('discover');
  const [mediaTypeFilter, setMediaTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const [selectedPaymentPost, setSelectedPaymentPost] = useState(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isLiveStudioOpen, setIsLiveStudioOpen] = useState(false);
  const [selectedLiveCreator, setSelectedLiveCreator] = useState(null);
  const [ownLiveSession, setOwnLiveSession] = useState(null);

  const observerTarget = useRef(null);
  const feedRequestVersion = useRef(0);
  const loadingMoreRef = useRef(false);
  const searchInitialized = useRef(false);
  const lastSearchQuery = useRef(searchQuery);

  useEffect(() => {
    const intentId = searchParams.get('ad_payment_intent');
    if (!intentId) return undefined;

    let active = true;
    let attempts = 0;
    let retryTimer;
    const clearPaymentReturnParams = () => {
      setSearchParams(params => {
        const nextParams = new URLSearchParams(params);
        nextParams.delete('ad_payment_intent');
        nextParams.delete('session_id');
        return nextParams;
      }, { replace: true });
    };
    const checkPayment = async () => {
      attempts += 1;
      try {
        const result = await afterDarkService.getPaymentStatus(intentId);
        if (!active) return;
        const status = String(result?.status || '').toLowerCase();
        if (status === 'completed') {
          toast.success('After Dark payment confirmed.');
          clearPaymentReturnParams();
        } else if (status === 'failed') {
          toast.error('After Dark payment failed. You can try again.');
          clearPaymentReturnParams();
        } else if (attempts < 10) {
          retryTimer = window.setTimeout(checkPayment, 3000);
        } else {
          toast.info('Payment is still processing. Check your After Dark wallet or retry later.');
          clearPaymentReturnParams();
        }
      } catch (error) {
        if (!active) return;
        if (attempts < 10) {
          retryTimer = window.setTimeout(checkPayment, 3000);
        } else {
          toast.error(error?.response?.data?.error || 'Could not confirm the After Dark payment.');
          clearPaymentReturnParams();
        }
      }
    };
    checkPayment();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  }, [searchParams, setSearchParams]);

  // ==========================================
  // INITIAL DISCOVERY FETCH
  // ==========================================
  useEffect(() => {
    let active = true;
    Promise.all([
      afterDarkService.getStories(),
      afterDarkService.getDirectory({ sort: 'popular', limit: 6 }),
      liveCreatorId ? afterDarkService.getLiveSessions({ creator_id: liveCreatorId, status: 'live' }) : Promise.resolve([]),
      afterDarkService.getWallet(),
    ]).then(([storiesResponse, directoryResponse, liveResponse, walletResponse]) => {
      if (!active) return;
      
      const storyRecords = Array.isArray(storiesResponse) ? storiesResponse : storiesResponse?.stories || storiesResponse?.items || [];
      const creatorRecords = Array.isArray(directoryResponse) ? directoryResponse : directoryResponse?.creators || directoryResponse?.items || [];
      const liveRecords = Array.isArray(liveResponse) ? liveResponse : liveResponse?.sessions || liveResponse?.items || [];
      
      if (![storyRecords, creatorRecords, liveRecords].every(Array.isArray)) {
        throw new Error('After Dark discovery returned an invalid response format.');
      }

      setStories(storyRecords.map(item => {
        const creator = normalizeCreator(item.creator || {
          ...item,
          id: item.creator_id || item.creatorId,
          user_id: item.host_id || item.hostId,
        });
        const liveSession = normalizeLiveSession(
          item.live_session || item.liveSession || item.session || creator.liveSession || item,
          creator.id
        );
        return { ...creator, liveSession, isLive: true, hasStory: true };
      }));

      setTrendingCreators(creatorRecords.map(normalizeCreator));
      
      const ownSession = liveRecords.find(session =>
        String(session.host_id || session.hostId || session.creator_id || session.creator?.id) === liveCreatorId
      );
      if (ownSession) {
        const sessionId = ownSession.session_id || ownSession.sessionId || ownSession.id;
        let savedSession = {};
        try {
          const saved = localStorage.getItem(liveSessionKey(liveCreatorId));
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.sessionId === sessionId) savedSession = parsed;
          }
        } catch (storageError) {
          console.warn('Could not restore saved After Dark broadcast details.', storageError);
        }
        const restoredSession = {
          ...savedSession,
          ...ownSession,
          creatorId: liveCreatorId,
          sessionId,
          hostId: ownSession.host_id || ownSession.hostId || liveCreatorId,
          creatorName: liveCreator.name,
          creatorAvatar: liveCreator.avatar,
        };
        setOwnLiveSession(restoredSession);
        setIsLiveStudioOpen(true);
      }
      
      const wallet = walletResponse?.wallet || walletResponse || {};
      const balance = Number(wallet.available_balance ?? wallet.available_balance_cents ?? 0) /
        (wallet.available_balance_cents !== undefined ? 100 : 1);
      setWalletBalance(balance);
      updateUser({ walletBalance: balance });
      
    }).catch(error => {
      if (active) {
        const message = error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load After Dark discovery data.');
        setFeedError(message);
      }
    });
    return () => { active = false; };
  }, [liveCreatorId, liveCreator.name, liveCreator.avatar, setWalletBalance, updateUser]);

  useEffect(() => {
    let active = true;
    afterDarkService.getMySettings()
      .then(response => {
        if (!active) return;
        const settings = response?.settings || response || {};
        setShowExplicitContent(Boolean(settings.show_explicit_content ?? settings.showExplicitContent));
      })
      .catch(error => {
        if (active) {
          toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load After Dark viewing preferences.'));
        }
      });
    return () => { active = false; };
  }, []);

  // ==========================================
  // DATA FETCHING & PAGINATION ENGINE
  // ==========================================
  const loadPosts = useCallback(async (pageNumber, reset = false, filter = activeFilter, query = searchQuery, mediaType = mediaTypeFilter, scope = feedScope) => {
    if (!reset && loadingMoreRef.current) return;
    const requestVersion = reset ? ++feedRequestVersion.current : feedRequestVersion.current;

    if (reset) {
      loadingMoreRef.current = false;
      setLoading(true);
      setLoadingMore(false);
      setPosts([]);
      setHasMore(true);
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }

    try {
      setFeedError('');
      const response = await afterDarkService.getFeed({
        access: filter,
        feed_scope: scope,
        media_type: mediaType === 'all' ? undefined : mediaType,
        q: query.trim() || undefined,
        page: pageNumber,
        limit: 8,
      });
      if (requestVersion !== feedRequestVersion.current) return;
      
      const records = Array.isArray(response) ? response : response?.posts || response?.items || [];
      if (!Array.isArray(records)) throw new Error('The feed service returned an invalid response.');
      
      const newPosts = await Promise.all(records.map(async record => {
        const post = normalizeFeedPost(record);
        if (!post.id || !post.isUnlocked || post.mediaUrl) return post;

        try {
          const mediaResponse = await afterDarkService.getPostMediaUrl(post.id);
          return { ...post, mediaUrl: mediaResponse?.url || '' };
        } catch (mediaError) {
          console.error(`Could not load authorized media for After Dark post ${post.id}.`, mediaError);
          return post;
        }
      }));
      if (requestVersion !== feedRequestVersion.current) return;
      setPosts(prev => reset ? newPosts : [...prev, ...newPosts]);
      setHasMore(Boolean(response?.has_more ?? response?.hasMore ?? newPosts.length === 8));

    } catch (error) {
      if (requestVersion !== feedRequestVersion.current) return;
      const message = error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load the feed.');
      setFeedError(message);
      if (reset) toast.error(message);
    } finally {
      if (requestVersion === feedRequestVersion.current) {
        setLoading(false);
        setLoadingMore(false);
        setIsSearching(false);
        loadingMoreRef.current = false;
      }
    }
  }, [activeFilter, searchQuery, mediaTypeFilter, feedScope]);

  useEffect(() => {
    setPage(0);
    loadPosts(0, true, activeFilter, searchQuery, mediaTypeFilter, feedScope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, feedScope, mediaTypeFilter]);

  useEffect(() => {
    if (!searchInitialized.current) {
      searchInitialized.current = true;
      lastSearchQuery.current = searchQuery;
      return undefined;
    }
    if (lastSearchQuery.current === searchQuery) return undefined;
    lastSearchQuery.current = searchQuery;
    const timeoutId = setTimeout(() => {
      setIsSearching(Boolean(searchQuery));
      setPage(0);
      loadPosts(0, true, activeFilter, searchQuery, mediaTypeFilter, feedScope);
    }, 600);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, activeFilter, mediaTypeFilter, feedScope, loadPosts]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore && !feedError) {
          const nextPage = page + 1;
          setPage(nextPage);
          loadPosts(nextPage, false);
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, feedError, page, loadPosts]);

  // ==========================================
  // HANDLERS
  // ==========================================
  const handleTriggerPayment = (post) => {
    setSelectedPaymentPost(post);
    setIsPaymentModalOpen(true);
  };

  const handlePaymentSuccess = async (payment) => {
    if (payment?.payment_type === 'live_tip') {
      toast.success(`KES ${(payment.amount_cents / 100).toLocaleString()} live tip sent.`);
      return;
    }
    if (selectedLiveCreator && (payment?.payment_type === 'subscription' || payment === `live-subscription-${selectedLiveCreator.id}`)) {
      grantAfterDarkSubscription(selectedLiveCreator.id);
      return;
    }
    if (selectedLiveCreator?.liveSession?.sessionId
      && (payment?.payment_type === 'live_pass' || payment === `live-pass-${selectedLiveCreator.id}-${selectedLiveCreator.liveSession.sessionId}`)) {
      grantAfterDarkLivePass(selectedLiveCreator.id, selectedLiveCreator.liveSession.sessionId);
      return;
    }
    const paymentPostId = payment?.target_id || payment?.targetId || payment?.post_id || payment?.postId;
    const postId = String(paymentPostId || selectedPaymentPost?.id || '');
    if (!postId || !posts.some(post => String(post.id) === postId)) return;
    setPosts(prev => prev.map(p => 
      String(p.id) === postId ? { ...p, isUnlocked: true } : p
    ));
    try {
      const mediaResponse = await afterDarkService.getPostMediaUrl(postId);
      const mediaUrl = mediaResponse?.url || mediaResponse?.media_url;
      if (!mediaUrl) throw new Error('The server did not return authorized post media.');
      setPosts(prev => prev.map(post => String(post.id) === postId ? { ...post, mediaUrl } : post));
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Payment is confirmed, but the post media could not be opened. Refresh the feed to retry.');
    }
  };

  const openCreator = (creator) => {
    navigate(`/afterdark/cprofile/${encodeURIComponent(creator.id)}`, { state: { creator } });
  };

  const handleCreatorClick = creator => creator.isLive ? openLive(creator) : openCreator(creator);

  const openPaidChat = async creator => {
    if (!creator?.id) return;
    const targetUserId = creator.standardProfileId || creator.user_id || creator.id;
    try {
      const chatAccess = await afterDarkService.initConversation(targetUserId);
      navigate(`/afterdark/chats?creator=${encodeURIComponent(chatAccess.other_user_id || targetUserId)}`, {
        state: { creator, chatAccess },
      });
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not open this creator’s chat.'));
    }
  };
  
  const handleCreatorAction = () => {
    navigate('/afterdark/channel');
  };

  const openLive = async creator => {
    let session = creator.id === liveCreatorId
      ? ownLiveSession
      : creator.liveSession || stories.find(story => story.id === creator.id)?.liveSession;
      
    if (!session) {
      try {
        const response = await afterDarkService.getLiveSessions({ creator_id: creator.id, status: 'live' });
        const sessions = Array.isArray(response) ? response : response?.sessions || response?.items || [];
        const record = sessions[0];
        if (record) {
          session = {
            ...record,
            creatorId: creator.id,
            sessionId: record.session_id || record.id,
            hostId: record.host_id || record.hostId,
          };
        }
      } catch (error) {
        toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load this live session.'));
        return;
      }
    }
    if (!session?.sessionId) {
      toast.info(`${creator.name} is not currently live.`);
      return;
    }
    setSelectedLiveCreator({ ...creator, liveSession: session });
  };

  const openLiveCheckout = (creator, accessType, price, message = '') => {
    const isSubscription = accessType === 'subscription';
    const isLiveTip = accessType === 'live_tip';
    const itemType = isLiveTip ? 'live-tip' : isSubscription ? 'subscription' : 'live-pass';
    const targetId = isLiveTip || !isSubscription
      ? creator.liveSession.sessionId
      : creator.id;
    setSelectedPaymentPost({
      id: isLiveTip ? `live-tip-${creator.liveSession.sessionId}` : isSubscription
        ? `live-subscription-${creator.id}`
        : `live-pass-${creator.id}-${creator.liveSession.sessionId}`,
      paymentType: isLiveTip ? 'live_tip' : itemType === 'live-pass' ? 'live_pass' : 'subscription',
      targetId,
      amountCents: isLiveTip ? Math.round(price * 100) : undefined,
      message,
      price,
      resourceId: targetId,
      caption: isLiveTip ? `Live tip for ${creator.name}` : isSubscription
        ? `Monthly VIP subscription for ${creator.name}`
        : `One-time live pass for ${creator.name}`,
    });
    setIsPaymentModalOpen(true);
  };

  const handleLiveWalletPurchase = async (creator, accessType, price) => {
    if (price > availableWalletBalance) {
      toast.error('Your wallet balance is too low. Continue to checkout to use another payment method.');
      return;
    }

    try {
      if (accessType === 'subscription') {
        await afterDarkService.subscribeToCreator(creator.id);
        grantAfterDarkSubscription(creator.id);
      } else {
        await afterDarkService.unlockPostWithWallet({
          item_type: 'live_pass',
          live_session_id: creator.liveSession.sessionId,
          creator_id: creator.id,
          amount_cents: Math.round(price * 100),
        });
        grantAfterDarkLivePass(creator.id, creator.liveSession.sessionId);
      }
      const walletResponse = await afterDarkService.getWallet();
      const wallet = walletResponse?.wallet || walletResponse || {};
      const nextBalance = Number(wallet.available_balance ?? wallet.available_balance_cents ?? 0) /
        (wallet.available_balance_cents !== undefined ? 100 : 1);
      setWalletBalance(nextBalance);
      updateUser({ walletBalance: nextBalance });
      toast.success('Live access unlocked securely using your wallet balance.');
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not process live access transaction.'));
    }
  };

  const refreshAfterLiveTip = async () => {
    try {
      const walletResponse = await afterDarkService.getWallet();
      const wallet = walletResponse?.wallet || walletResponse || {};
      const nextBalance = Number(wallet.available_balance ?? wallet.available_balance_cents ?? 0) /
        (wallet.available_balance_cents !== undefined ? 100 : 1);
      setWalletBalance(nextBalance);
      updateUser({ walletBalance: nextBalance });
      return true;
    } catch (error) {
      console.error('Live tip succeeded, but wallet balance refresh failed.', error);
      return false;
    }
  };

  if (searchParams.get('view') === 'chats') {
    return <AfterDarkChatHub />;
  }

  const visiblePosts = posts.filter(post => showExplicitContent || !post.isExplicit);

  // ==========================================
  // RENDER - MAIN UI (USERSETTINGS BLUEPRINT)
  // ==========================================
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 bg-black w-full relative overflow-hidden text-zinc-300 rounded-none font-mono">
      
      {/* LEFT/MAIN COLUMN: FEED */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative z-10 lg:border-r-2 border-zinc-800 rounded-none">
        
        {/* TOP STICKY HEADER (Matches UserSettings Header) */}
        <header className="border-b-2 border-zinc-800 bg-zinc-950 flex flex-col shrink-0 z-20 rounded-none">
          
          <div className="p-2 md:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
            <div className="hidden items-center gap-3 md:flex">
              <div className="p-2 border-2 border-zinc-600 bg-black rounded-none">
                <Flame className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold uppercase tracking-widest text-white leading-none">
                  Creator Feed
                </h1>
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mt-1 flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-green-500 inline-block rounded-none" /> Moderated creator posts
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:w-[clamp(12rem,26vw,20rem)]">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  {isSearching ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Search className="w-4 h-4 text-zinc-500" />}
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search creators, posts, or tags"
                  placeholder="Search posts..."
                  className="w-full bg-black border-2 border-zinc-800 rounded-none pl-9 pr-3 py-2 text-xs font-bold text-white uppercase tracking-widest placeholder:text-zinc-600 focus:outline-none focus:border-white transition-colors"
                />
              </div>
              <button 
                type="button"
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                aria-label="Toggle filters"
                className={`p-2 border-2 transition-colors rounded-none focus:outline-none ${
                  showAdvancedFilters 
                    ? 'bg-white text-black border-white' 
                    : 'bg-black text-zinc-400 border-zinc-800 hover:text-white hover:border-zinc-600'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Expandable Advanced Filters */}
          {showAdvancedFilters && (
            <div className="px-4 md:px-6 py-3 border-t-2 border-zinc-800 bg-black flex flex-wrap items-center justify-between gap-4 rounded-none">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Media Type</span>
                <div className="flex border-2 border-zinc-800 bg-black rounded-none">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'video', label: 'Videos' },
                    { id: 'image', label: 'Photos' },
                  ].map(type => (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => setMediaTypeFilter(type.id)}
                      className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors border-r-2 border-zinc-800 last:border-r-0 rounded-none ${
                        mediaTypeFilter === type.id
                          ? 'bg-white text-black'
                          : 'text-zinc-500 hover:text-white hover:bg-zinc-950'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>
              <button 
                type="button"
                onClick={() => { setActiveFilter('all'); setFeedScope('discover'); setSearchQuery(''); setMediaTypeFilter('all'); }}
                className="px-3 py-1.5 bg-black border-2 border-zinc-700 text-[10px] font-bold uppercase tracking-widest text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors rounded-none"
              >
                Reset Filters
              </button>
            </div>
          )}

          {/* Stories / Live Bar */}
          {(isCreator || stories.length > 0) && (
            <div className="w-full border-t-2 border-zinc-800 bg-black overflow-x-auto custom-scrollbar rounded-none">
              <div className="flex items-start gap-4 px-4 md:px-6 py-3 min-w-max">
                {isCreator && (
                  <StoryCircle
                    creator={{ ...liveCreator, isLive: Boolean(ownLiveSession) }}
                    isMe={true}
                    onClick={() => setIsLiveStudioOpen(true)}
                  />
                )}
                {stories.filter(creator => creator.id !== liveCreatorId && creator.user_id !== liveCreatorId).map(creator => (
                  <StoryCircle
                    key={creator.id}
                    creator={creator}
                    onClick={() => creator.isLive ? openLive(creator) : openCreator(creator)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Sharp Segmented Filter Tabs (Exact match to UserSettings 'Show Me' group) */}
          <div className="flex border-t-2 border-zinc-800 bg-black rounded-none">
            {[
              { id: 'all', label: 'All Content', mobileLabel: 'All', icon: Filter },
              { id: 'subscriber', label: 'Subscriber', mobileLabel: 'VIP', icon: Crown },
              { id: 'ppv', label: 'One-Time Unlocks', mobileLabel: 'PPV', icon: Lock },
              { id: 'free', label: 'Free Teasers', mobileLabel: 'Free', icon: Unlock },
            ].map(tab => {
              const Icon = tab.icon;
              const isSelected = activeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveFilter(tab.id)}
                  className={`flex-1 py-3 px-2 text-xs font-bold uppercase tracking-widest transition-colors border-r-2 border-zinc-800 last:border-r-0 flex items-center justify-center gap-2 rounded-none focus:outline-none ${
                    isSelected 
                      ? 'bg-white text-black' 
                      : 'bg-black text-zinc-500 hover:text-white hover:bg-zinc-950'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden truncate sm:inline">{tab.label}</span>
                  <span className="truncate sm:hidden">{tab.mobileLabel}</span>
                </button>
              );
            })}
          </div>
          <div className="flex border-t-2 border-zinc-800 bg-zinc-950">
            {[
              { id: 'discover', label: 'For You' },
              { id: 'following', label: 'Following' },
            ].map(scope => (
              <button
                key={scope.id}
                type="button"
                onClick={() => setFeedScope(scope.id)}
                aria-pressed={feedScope === scope.id}
                className={`flex-1 px-3 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  feedScope === scope.id ? 'text-white' : 'text-zinc-500 hover:text-white'
                }`}
              >
                {scope.label}
              </button>
            ))}
          </div>
        </header>

        {/* SCROLLABLE FEED BODY */}
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar bg-black">
          <div className="flex min-h-full w-full flex-col p-0 pb-4 sm:p-3 lg:p-4 space-y-4 sm:space-y-6">

            {/* Feed Posts or States */}
            {loading && posts.length === 0 ? (
              <div className="space-y-6">
                <FeedSkeleton />
                <FeedSkeleton />
              </div>
            ) : visiblePosts.length === 0 ? (
              <div className="bg-black border-2 border-dashed border-zinc-800 p-12 text-center flex flex-col items-center justify-center rounded-none">
                <div className="w-12 h-12 bg-zinc-950 border-2 border-zinc-700 flex items-center justify-center mb-4 rounded-none">
                  <AlertTriangle className="w-6 h-6 text-zinc-400" />
                </div>
                <h3 className="text-sm font-bold uppercase tracking-widest text-white mb-2">
                  {feedError ? 'Feed Unavailable' : 'No Content Found'}
                </h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 max-w-sm mb-6 leading-relaxed">
                  {feedError || (!showExplicitContent
                    ? 'Explicit posts are hidden by your viewing preference. Enable them in After Dark Settings if you want to see them. Posts awaiting moderation and region-restricted posts remain hidden.'
                    : feedScope === 'following' && !searchQuery && activeFilter === 'all' && mediaTypeFilter === 'all'
                      ? 'No posts from followed creators are available right now. Follow creators or switch to For You. Posts awaiting moderation and region-restricted posts remain hidden.'
                      : 'No posts match these filters. Clear your search or filters. Posts awaiting moderation, region restrictions, and creator visibility settings can also keep posts out of the feed.')}
                </p>
                <button 
                  type="button"
                  onClick={() => {
                    if (feedError) {
                      setFeedError('');
                      loadPosts(0, true, activeFilter, searchQuery, mediaTypeFilter, feedScope);
                    } else if (!showExplicitContent) {
                      navigate('/afterdark/settings?tab=viewing');
                    } else {
                      setActiveFilter('all');
                      setFeedScope('discover');
                      setSearchQuery('');
                      setMediaTypeFilter('all');
                    }
                  }}
                  className="px-6 py-3 bg-white text-black border-2 border-white text-xs font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors rounded-none"
                >
                  {feedError ? 'Retry Feed' : !showExplicitContent ? 'Viewing Settings' : 'Clear All Filters'}
                </button>
              </div>
            ) : (
              <div className="space-y-4 sm:space-y-6">
                {visiblePosts.map(post => (
                  <LockedPostCard 
                    key={post.id} 
                    post={post} 
                    onTriggerMpesa={handleTriggerPayment}
                    onOpenCreator={handleCreatorClick}
                    onMessageCreator={() => openPaidChat(post.creator)}
                  />
                ))}
                
                {/* Infinite Scroll Footer */}
                <div ref={observerTarget} className="pt-4 flex justify-center">
                  {feedError ? (
                    <div className="flex w-full flex-col items-center gap-3 border-2 border-red-900 bg-zinc-950 p-4 text-center">
                      <p role="status" className="text-[10px] font-bold uppercase tracking-widest text-red-300">{feedError}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setFeedError('');
                          loadPosts(page, false);
                        }}
                        className="border-2 border-zinc-600 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white hover:border-white"
                      >
                        Retry loading posts
                      </button>
                    </div>
                  ) : loadingMore ? (
                    <div className="w-full py-4 bg-zinc-950 border-2 border-zinc-800 flex items-center justify-center gap-3 text-xs font-bold uppercase tracking-widest text-white rounded-none">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading More Content...
                    </div>
                  ) : hasMore ? (
                    <div className="w-full py-4 border-t-2 border-dashed border-zinc-800 text-center">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Scroll to load more</span>
                    </div>
                  ) : (
                    <div className="w-full py-4 border-t-2 border-zinc-800 text-center">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">End of Feed</span>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: STICKY SIDEBAR (Desktop Only) */}
      <aside className="relative z-10 hidden w-[clamp(17rem,24vw,22rem)] shrink-0 flex-col overflow-y-auto bg-black custom-scrollbar rounded-none xl:flex">
        
        <div className="p-4 md:p-6 border-b-2 border-zinc-800 bg-zinc-950 flex items-center justify-between sticky top-0 z-20 rounded-none">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-yellow-400" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-white">Trending Now</h2>
          </div>
          <button 
            type="button"
            onClick={() => { setPage(0); loadPosts(0, true); }} 
            aria-label="Refresh feed" 
            className="p-1.5 bg-black border-2 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors rounded-none"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-4 md:p-6 space-y-8">
          
          {/* Rising Creators Section */}
          <section className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Rising Creators</h3>
            <div className="space-y-2">
              {trendingCreators.length === 0 ? (
                <div className="border-2 border-dashed border-zinc-800 p-6 text-center rounded-none">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">No creators loaded.</p>
                </div>
              ) : (
                trendingCreators.slice(0, 4).map((creator) => (
                  <TrendingCreatorCard key={creator.id} creator={creator} onClick={() => handleCreatorClick(creator)} />
                ))
              )}
            </div>
            <button 
              type="button"
              onClick={() => navigate('/afterdark/directory')} 
              className="w-full py-3 bg-black border-2 border-zinc-700 text-zinc-300 font-bold uppercase tracking-widest hover:text-white hover:border-zinc-500 transition-colors text-xs rounded-none"
            >
              View All Creators
            </button>
          </section>

          {/* Creator Studio Banner (Matches Chattie Gold VIP Banner in UserSettings) */}
          {isCreator && (
            <section className="bg-black border-2 border-yellow-400 p-5 flex flex-col justify-between group shadow-[4px_4px_0px_rgba(var(--warning-rgb), 0.1)] hover:shadow-[6px_6px_0px_rgba(var(--warning-rgb), 0.2)] transition-all rounded-none">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 bg-black border-2 border-yellow-400 flex items-center justify-center shrink-0 rounded-none">
                  <Crown className="w-5 h-5 text-yellow-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-widest text-yellow-400 mb-1">
                    Monetize Your Dark Room
                  </h3>
                  <p className="text-[10px] uppercase font-bold text-zinc-400 leading-relaxed">
                    Access your creator dashboard to upload PPV media and manage VIPs.
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={handleCreatorAction} 
                className="w-full py-3 bg-white text-black border-2 border-white text-xs font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors rounded-none"
              >
                Open My Channel
              </button>
            </section>
          )}

          {/* Footer Links */}
          <section className="pt-6 border-t-2 border-zinc-800 space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              <a href="#terms" onClick={e => e.preventDefault()} className="hover:text-white transition-colors">Terms</a>
              <a href="#privacy" onClick={e => e.preventDefault()} className="hover:text-white transition-colors">Privacy</a>
              <a href="#guidelines" onClick={e => e.preventDefault()} className="hover:text-white transition-colors">Guidelines</a>
              <a href="#dmca" onClick={e => e.preventDefault()} className="hover:text-white transition-colors">DMCA</a>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
              © 2026 Chattie After Dark
            </p>
          </section>

        </div>
      </aside>

      {/* MODALS */}
      <MpesaPaystackModal 
        isOpen={isPaymentModalOpen}
        onClose={() => {
          setIsPaymentModalOpen(false);
          setSelectedPaymentPost(null);
        }}
        postItem={selectedPaymentPost}
        onSuccess={handlePaymentSuccess}
      />
      <LiveStudioModal
        isOpen={isLiveStudioOpen}
        creator={liveCreator}
        initialLiveSession={ownLiveSession}
        onLiveSessionChange={setOwnLiveSession}
        onClose={() => setIsLiveStudioOpen(false)}
      />
      <AfterDarkLiveViewingModal
        creator={selectedLiveCreator}
        hasAccess={Boolean(selectedLiveCreator && (
          selectedLiveCreator.id === liveCreatorId
          || afterDarkSubscriptions[selectedLiveCreator.id]
          || afterDarkLivePasses[livePassEntitlementKey(selectedLiveCreator.id, selectedLiveCreator.liveSession?.sessionId)]
          || Number(selectedLiveCreator.liveSession?.price_cents ?? selectedLiveCreator.liveSession?.priceCents ?? 0) <= 0
        ))}
        walletBalance={availableWalletBalance}
        isOwnBroadcast={selectedLiveCreator?.id === liveCreatorId}
        isCheckoutOpen={isPaymentModalOpen}
        onClose={() => setSelectedLiveCreator(null)}
        onManageBroadcast={() => {
          setSelectedLiveCreator(null);
          setIsLiveStudioOpen(true);
        }}
        onTipSent={refreshAfterLiveTip}
        onUseBalance={handleLiveWalletPurchase}
        onCheckout={openLiveCheckout}
        userAlias={creatorAlias || currentUser?.name || currentUser?.username || 'You'}
      />
      <PagePrivacyShield active={!isPageFocused && !isPaymentModalOpen} />
    </div>
  );
}