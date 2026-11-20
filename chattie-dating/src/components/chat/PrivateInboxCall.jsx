import React, { useEffect, useRef } from 'react';
import { Track, LocalAudioTrack } from 'livekit-client';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useParticipants,
  useLocalParticipant,
  TrackToggle,
  useTracks,
  VideoTrack,
} from '@livekit/components-react';
import { PhoneOff } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '../../i18n';

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
          toast.error(t('microphonePermissionFailed'));
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

function InboxCallStage({ activeChat, callMode, callElapsedSec, micEnabled, micLevel }) {
  const { t } = useI18n();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const remoteParticipants = participants.filter((p) => p.identity !== localParticipant?.identity);
  const remotePrimary = remoteParticipants[0];
  const localCameraTrack = cameraTracks.find((track) => track.participant.identity === localParticipant?.identity);
  const remoteCameraTrack = cameraTracks.find((track) => track.participant.identity !== localParticipant?.identity);
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

export default function PrivateInboxCall({
  token,
  activeChat,
  callMode,
  callElapsedSec,
  micGain,
  setMicGain,
  micEnabled,
  setMicEnabled,
  micLevel,
  setMicLevel,
  endCall,
  onConnected,
}) {
  const { t } = useI18n();

  return (
    <div className="absolute inset-0 z-50 flex flex-col animate-in fade-in duration-300 bg-black">
      <LiveKitRoom
        serverUrl={import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880'}
        token={token}
        connect={true}
        audio={false}
        video={callMode === 'video'}
        onConnected={onConnected}
        onError={(error) => {
          console.error('Private LiveKit call failed:', error);
          toast.error(error.message || t('callConnectionFailed'));
          endCall();
        }}
        className="flex-1 flex flex-col"
      >
        <RoomAudioRenderer />
        <AutoPublishMic micGain={micGain} setMicEnabled={setMicEnabled} setMicLevel={setMicLevel} />
        <InboxCallStage activeChat={activeChat} callMode={callMode} callElapsedSec={callElapsedSec} micEnabled={micEnabled} micLevel={micLevel} />
        <div className="flex flex-wrap items-center justify-center gap-3 border-t-2 border-zinc-800 bg-black px-4 py-5 shrink-0 relative">
          <TrackToggle source={Track.Source.Microphone} aria-label={t('toggleMicrophone')} className="w-12 h-12 border-2 border-zinc-700 bg-zinc-950 flex items-center justify-center text-white hover:border-white" />
          {callMode === 'video' && <TrackToggle source={Track.Source.Camera} aria-label={t('toggleCamera')} className="w-12 h-12 border-2 border-zinc-700 bg-zinc-950 flex items-center justify-center text-white hover:border-white" />}
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-zinc-400">{t('microphoneGain')}</label>
            <input
              type="range"
              min="0.1"
              max="2"
              step="0.1"
              value={micGain}
              onChange={(event) => setMicGain(parseFloat(event.target.value))}
              className="w-[clamp(7rem,15vw,9rem)]"
              aria-label={t('microphoneGain')}
            />
          </div>
          <TrackToggle source={Track.Source.ScreenShare} aria-label={t('toggleScreenSharing')} className="w-12 h-12 border-2 border-zinc-700 bg-zinc-950 flex items-center justify-center text-white hover:border-white" />
          <button onClick={endCall} className="flex items-center gap-2 border-2 border-red-500 bg-red-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-red-400">
            <PhoneOff className="w-5 h-5" /> {t('endCall')}
          </button>
        </div>
      </LiveKitRoom>
    </div>
  );
}
