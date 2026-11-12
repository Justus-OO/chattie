import React, { useEffect, useRef, useState } from 'react';
import { BadgeCheck, Camera, RefreshCw, ShieldCheck, Sparkles, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { settingsService } from '../../api/settings.service';
import { useI18n } from '../../i18n';

const FACE_MODEL_URL = '/face_landmarker.task';
const FACE_WASM_URL = 'https://unpkg.com/@mediapipe/tasks-vision@0.10.3/wasm';
const REQUIRED_STABLE_FRAMES = 10;

const getPromptAction = (prompt) => {
  const value = typeof prompt === 'string' ? prompt : `${prompt?.label || ''} ${prompt?.id || ''}`;
  const repetitionMatch = value.match(/\b(?:blink|turn|smile)\s+(?:x|for\s+)?(\d+|twice|three times)\b/i);
  const repetitionText = repetitionMatch?.[1]?.toLowerCase();
  const repetitions = repetitionText === 'twice' ? 2 : repetitionText === 'three times' ? 3 : Number(repetitionText || 1);
  if (/left/i.test(value)) return 'left';
  if (/right/i.test(value)) return 'right';
  if (/smil|grin/i.test(value)) return 'smile';
  if (/blink|close.*eye/i.test(value)) return { type: 'blink', repetitions };
  if (/center|forward|straight|front/i.test(value)) return 'center';
  return null;
};

const formatPrompt = (prompt, t) => {
  const action = getPromptAction(prompt);
  if (action === 'left') return t('poseTurnLeft');
  if (action === 'right') return t('poseTurnRight');
  if (action === 'center') return t('poseCenter');
  if (action === 'smile') return t('poseSmile');
  if (action?.type === 'blink') return action.repetitions > 1 ? t('poseBlinkRepeat', { count: action.repetitions }) : t('poseBlink');
  return typeof prompt === 'string' ? prompt : prompt?.label || '';
};

const matchesPromptAction = (landmarks, blendshapes, action) => {
  if (!landmarks || landmarks.length < 468) return { matched: false, blinking: false };
  const point = (index) => landmarks[index];
  const nose = point(1);
  const leftEye = point(33);
  const rightEye = point(263);
  const noseRatio = (nose.x - leftEye.x) / (rightEye.x - leftEye.x);
  const scores = Object.fromEntries((blendshapes || []).map(({ categoryName, score }) => [categoryName, score]));
  const blinking = (scores.eyeBlinkLeft || 0) > 0.65 && (scores.eyeBlinkRight || 0) > 0.65;

  let matched = false;
  if (action === 'left') matched = noseRatio < 0.42;
  else if (action === 'right') matched = noseRatio > 0.58;
  else if (action === 'center') matched = noseRatio >= 0.44 && noseRatio <= 0.56;
  else if (action === 'blink') matched = blinking;
  else if (action === 'smile') matched = (scores.mouthSmileLeft || 0) > 0.5 && (scores.mouthSmileRight || 0) > 0.5;

  return { matched, blinking, noseRatio };
};

export default function IdentityVerificationModal({ isOpen, onClose, onVerified, zIndex = 50 }) {
  const { t } = useI18n();
  const [config, setConfig] = useState(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);

  const [step, setStep] = useState(1);
  const [country, setCountry] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [frontImage, setFrontImage] = useState(null);
  const [backImage, setBackImage] = useState(null);
  const [frontPreview, setFrontPreview] = useState('');
  const [backPreview, setBackPreview] = useState('');
  const [selfieFrames, setSelfieFrames] = useState([]);
  const [challengeIndex, setChallengeIndex] = useState(0);
  const [hasConsent, setHasConsent] = useState(false);
  const [pose, setPose] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [motionStatus, setMotionStatus] = useState('');
  const [isFaceTrackerReady, setIsFaceTrackerReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [poseAttempt, setPoseAttempt] = useState(0);
  
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const captureLockRef = useRef(false);
  const stableFramesRef = useRef(0);
  const wasBlinkingRef = useRef(false);
  const blinkStartedRef = useRef(false);
  const completedBlinksRef = useRef(0);
  const challengeIndexRef = useRef(0);
  const selfieFramesRef = useRef([]);
  const neutralNoseRatioRef = useRef(null);
  const movementStartedRef = useRef(false);

  const close = () => {
    if (step === 6) return;
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      setIsLoadingConfig(true);
      settingsService.getVerificationConfig()
        .then(data => {
          setConfig(data);
          setCountry(data.countries[0]);
          setDocumentType(data.document_types[data.countries[0]][0]);
          setPose(data.poses[0]);
          setIsLoadingConfig(false);
        })
        .catch(() => {
          toast.error(t('secureRulesFailed'));
          onClose();
        });
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && config) {
      setStep(1);
      setCountry(config.countries[0]);
      setDocumentType(config.document_types[config.countries[0]][0]);
      setFrontImage(null);
      setBackImage(null);
      setFrontPreview('');
      setBackPreview('');
      setSelfieFrames([]);
      selfieFramesRef.current = [];
      setChallengeIndex(0);
      challengeIndexRef.current = 0;
      setPose(config.poses[0]);
      setHasConsent(false);
    }
  }, [isOpen, config]);

  useEffect(() => () => {
    if (frontPreview) URL.revokeObjectURL(frontPreview);
    if (backPreview) URL.revokeObjectURL(backPreview);
  }, [frontPreview, backPreview]);

  useEffect(() => {
    if (!isOpen || ![3, 4, 5].includes(step)) return undefined;
    let cancelled = false;
    setCameraReady(false);
    setCameraError('');

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not supported in this browser.');
        const preferredFacingMode = step === 5 ? 'user' : 'environment';
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: preferredFacingMode } },
            audio: false
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch (error) {
        setCameraError(error.message || t('cameraUnavailable'));
      }
    };

    startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [isOpen, step, cameraAttempt]);

  useEffect(() => {
    if (!isOpen || step !== 5 || !cameraReady || !config) return undefined;

    let cancelled = false;
    let lastVideoTime = -1;
    captureLockRef.current = false;
    stableFramesRef.current = 0;
    wasBlinkingRef.current = false;
    blinkStartedRef.current = false;
    completedBlinksRef.current = 0;
    neutralNoseRatioRef.current = null;
    movementStartedRef.current = false;
    setIsFaceTrackerReady(false);
    setMotionStatus(t('verificationLoading'));

    const initializeAndTrack = async () => {
      try {
        const initPromise = (async () => {
          const vision = await FilesetResolver.forVisionTasks(FACE_WASM_URL);
          return await FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'CPU' },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: true
          });
        })();

        // FULL UPGRADE: Increased to 30 seconds for slower networks
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("AI Model download timed out. Check your network or disable adblockers.")), 30000);
        });

        const landmarker = await Promise.race([initPromise, timeoutPromise]);

        if (cancelled) {
          landmarker.close();
          return;
        }

        faceLandmarkerRef.current = landmarker;
        setIsFaceTrackerReady(true);
        setMotionStatus(t('moveFaceIntoGuide'));

        const trackFrame = async () => {
          if (cancelled) return;
          const video = videoRef.current;
          if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.currentTime === lastVideoTime) {
            animationFrameRef.current = requestAnimationFrame(trackFrame);
            return;
          }

          lastVideoTime = video.currentTime;
          
          try {
            const result = landmarker.detectForVideo(video, performance.now());
            const face = result.faceLandmarks?.[0];
            const prompt = config.poses[challengeIndexRef.current];
            const challenge = getPromptAction(prompt);
            const action = typeof challenge === 'string' ? challenge : challenge?.type;

            if (!action) {
              setMotionStatus(t('unsupportedPose'));
              animationFrameRef.current = requestAnimationFrame(trackFrame);
              return;
            }

            if (!face) {
              stableFramesRef.current = 0;
              blinkStartedRef.current = false;
              setMotionStatus(t('moveFaceIntoGuide'));
              animationFrameRef.current = requestAnimationFrame(trackFrame);
              return;
            }

            const detection = matchesPromptAction(face, result.faceBlendshapes?.[0]?.categories, action);
            let matched = detection.matched;

            if (action === 'left' || action === 'right' || action === 'center') {
              const noseRatio = detection.noseRatio;
              if (neutralNoseRatioRef.current === null && noseRatio >= 0.44 && noseRatio <= 0.56) {
                neutralNoseRatioRef.current = noseRatio;
                setMotionStatus(t('faceCentered'));
                animationFrameRef.current = requestAnimationFrame(trackFrame);
                return;
              }

              const baseline = neutralNoseRatioRef.current;
              if (baseline !== null) {
                if (action === 'left') {
                  movementStartedRef.current ||= noseRatio < baseline - 0.07;
                  matched = movementStartedRef.current && noseRatio < 0.42;
                } else if (action === 'right') {
                  movementStartedRef.current ||= noseRatio > baseline + 0.07;
                  matched = movementStartedRef.current && noseRatio > 0.58;
                } else {
                  movementStartedRef.current ||= noseRatio < baseline - 0.07 || noseRatio > baseline + 0.07;
                  matched = movementStartedRef.current && noseRatio >= 0.44 && noseRatio <= 0.56;
                }
              } else {
                matched = false;
              }
            } else if (action === 'blink') {
              if (detection.blinking) blinkStartedRef.current = true;
              matched = blinkStartedRef.current && !detection.blinking;
              if (matched) {
                blinkStartedRef.current = false;
                completedBlinksRef.current += 1;
                setMotionStatus(t('blinkDetected', { count: completedBlinksRef.current, total: challenge.repetitions }));
                if (completedBlinksRef.current < challenge.repetitions) {
                  animationFrameRef.current = requestAnimationFrame(trackFrame);
                  return;
                }
                stableFramesRef.current = REQUIRED_STABLE_FRAMES;
              }
            }
            
            wasBlinkingRef.current = detection.blinking;

            if (!matched) {
              stableFramesRef.current = 0;
              setMotionStatus(action === 'blink' ? t('blinkThenOpen') : (action === 'left' || action === 'right' || action === 'center') && neutralNoseRatioRef.current === null ? t('centerFaceToBegin') : t('followPose', { prompt: formatPrompt(prompt, t) }));
              animationFrameRef.current = requestAnimationFrame(trackFrame);
              return;
            }

            if (action !== 'blink') stableFramesRef.current += 1;
            if (stableFramesRef.current === 1) setMotionStatus(t('poseMatched'));
            
            if (stableFramesRef.current < REQUIRED_STABLE_FRAMES || captureLockRef.current) {
              animationFrameRef.current = requestAnimationFrame(trackFrame);
              return;
            }

            captureLockRef.current = true;
            setMotionStatus(t('actionMatchedCapturing'));
            
            try {
              const frame = await captureFrame(`selfie-${challengeIndexRef.current + 1}`);
              const frames = [...selfieFramesRef.current, frame];
              selfieFramesRef.current = frames;
              setSelfieFrames(frames);

              const nextIndex = challengeIndexRef.current + 1;
              if (nextIndex < config.poses.length) {
                challengeIndexRef.current = nextIndex;
                setChallengeIndex(nextIndex);
                setPose(config.poses[nextIndex]);
                stableFramesRef.current = 0;
                wasBlinkingRef.current = false;
                blinkStartedRef.current = false;
                completedBlinksRef.current = 0;
                neutralNoseRatioRef.current = null;
                movementStartedRef.current = false;
                captureLockRef.current = false;
                setMotionStatus(t('followNextPose'));
                animationFrameRef.current = requestAnimationFrame(trackFrame);
              } else {
                await submitVerification(frames);
              }
            } catch (error) {
              captureLockRef.current = false;
              stableFramesRef.current = 0;
              setMotionStatus(t('captureFailedRetry'));
              animationFrameRef.current = requestAnimationFrame(trackFrame);
            }
          } catch (detectionError) {
            animationFrameRef.current = requestAnimationFrame(trackFrame);
          }
        };

        animationFrameRef.current = requestAnimationFrame(trackFrame);
      } catch (error) {
        if (!cancelled) {
          console.error("MediaPipe Initialization Error:", error);
          const details = error instanceof Error ? error.message : String(error);
          setCameraError(`Face tracking could not start: ${details}`);
          setMotionStatus(`Error: ${details}`);
        }
      }
    };

    initializeAndTrack();
    return () => {
      cancelled = true;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      faceLandmarkerRef.current?.close();
      faceLandmarkerRef.current = null;
      setIsFaceTrackerReady(false);
    };
  }, [isOpen, step, cameraReady, cameraAttempt, poseAttempt, config]);

  const captureFrame = (name) => new Promise((resolve, reject) => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return reject(new Error(t('cameraNotReady')));
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) return reject(new Error(t('capturePrepareFailed')));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error(t('captureImageFailed')));
      resolve(new File([blob], `${name}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.86);
  });

  const submitVerification = async (selfie) => {
    if (!frontImage || (documentType !== 'passport' && !backImage)) {
      toast.error(t('requiredDocumentSides'));
      setStep(frontImage ? 4 : 3);
      return;
    }

    setStep(6);
    try {
      const formData = new FormData();
      formData.append('id_card', frontImage);
      formData.append('id_front', frontImage);
      if (backImage) formData.append('id_back', backImage);
      formData.append('document_type', documentType);
      formData.append('country', country);
      formData.append('selfie', selfie[0], selfie[0].name);
      selfie.forEach((frame, index) => formData.append('liveness_frames', frame, `liveness-${index + 1}.jpg`));
      formData.append('liveness_challenge', JSON.stringify(config.poses));
      formData.append('verification_consent', 'true');
      formData.append('verification_consent_at', new Date().toISOString());
      
      const result = await settingsService.verifyIdentityKYC(formData);
      const verified = result?.verified === true || result?.status === 'verified';
      setStep(verified ? 7 : 11);
      if (verified && onVerified) onVerified();
    } catch (error) {
      toast.error(error.response?.data?.error || t('verificationFailed'));
      setStep(10);
    }
  };

  const changeCountry = (nextCountry) => {
    setCountry(nextCountry);
    setDocumentType(config.document_types[nextCountry][0]);
    setFrontImage(null);
    setBackImage(null);
    setFrontPreview('');
    setBackPreview('');
  };

  const changeDocumentType = (nextType) => {
    setDocumentType(nextType);
    setFrontImage(null);
    setBackImage(null);
    setFrontPreview('');
    setBackPreview('');
  };

  const continueAfterFrontReview = () => {
    setChallengeIndex(0);
    challengeIndexRef.current = 0;
    setSelfieFrames([]);
    selfieFramesRef.current = [];
    if (documentType === 'passport') {
      setPose(config.poses[0]);
      setStep(5);
    } else {
      setStep(4);
    }
  };

  const continueAfterBackReview = () => {
    setChallengeIndex(0);
    challengeIndexRef.current = 0;
    setSelfieFrames([]);
    selfieFramesRef.current = [];
    setPose(config.poses[0]);
    setStep(5);
  };

  const captureDocument = async (side) => {
    try {
      const image = await captureFrame(`document-${side}`);
      const preview = URL.createObjectURL(image);
      if (side === 'front') {
        setFrontImage(image);
        setFrontPreview(preview);
        setStep(8);
      } else {
        setBackImage(image);
        setBackPreview(preview);
        setStep(9);
      }
    } catch (error) {
      toast.error(error.message || t('captureImageFailed'));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono" style={{ zIndex }}>
      <div className="absolute inset-0 bg-black/95 backdrop-blur-md" onClick={close} />
      <style>{`
        @keyframes scanLine { 0% { top: 0%; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
        .animate-scan { animation: scanLine 2s linear infinite; }
      `}</style>

      <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[0_0_30px_rgba(59,130,246,0.15)] flex flex-col overflow-hidden rounded-none animate-in zoom-in-95 duration-300">
        <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-zinc-950 shrink-0">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-white flex items-center gap-2">
            <BadgeCheck className="w-4 h-4 text-blue-500" /> {t('verificationTitle')}
          </h2>
          {step !== 6 && (
            <button onClick={close} className="p-1 text-zinc-500 hover:text-red-500 transition-colors" aria-label={t('verificationClose')}>
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* LOADING CONFIG STATE */}
        {isLoadingConfig && (
          <div className="p-16 flex flex-col items-center justify-center bg-black min-h-[300px]">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{t('verificationLoading')}</p>
          </div>
        )}

        {!isLoadingConfig && config && (
          <>
            {step === 1 && (
              <div className="p-6 flex flex-col space-y-6 bg-black">
                <div className="border-2 border-blue-500/50 p-4 bg-blue-950/20">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-2 flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5" /> {t('highSecurityVerification')}</h4>
                  <p className="text-[10px] text-zinc-400 leading-relaxed font-bold">{t('verificationIntro')}</p>
                </div>
                <div className="space-y-3 p-4 border border-zinc-800 bg-zinc-950/50 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  <p>{t('verificationStepOne')}</p><p>{t('verificationStepTwo')}</p><p>{t('verificationStepThree')}</p>
                </div>
                <label className="flex items-start gap-3 text-[10px] text-zinc-400 leading-relaxed">
                  <input type="checkbox" checked={hasConsent} onChange={(event) => setHasConsent(event.target.checked)} className="mt-0.5 accent-blue-500" />
                  <span>{t('verificationConsent')}</span>
                </label>
                <button disabled={!hasConsent} onClick={() => setStep(2)} className="w-full py-4 bg-blue-600 text-white border-2 border-blue-500 text-xs font-bold uppercase tracking-widest hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">{t('startVerification')}</button>
              </div>
            )}

            {step === 2 && (
              <div className="p-6 space-y-5 bg-black">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-blue-400">{t('chooseDocument')}</h4>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400">{t('countryRegion')}
                  <select value={country} onChange={(event) => changeCountry(event.target.value)} className="mt-2 w-full bg-zinc-950 border-2 border-zinc-700 p-3 text-white">
                    {config.countries.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400">{t('documentType')}
                  <select value={documentType} onChange={(event) => changeDocumentType(event.target.value)} className="mt-2 w-full bg-zinc-950 border-2 border-zinc-700 p-3 text-white">
                    {config.document_types[country]?.map((option) => (
                      <option key={option} value={option}>{config.document_labels[option]}</option>
                    ))}
                  </select>
                </label>
                <p className="text-[10px] text-zinc-500">{t('documentTypeHint')}</p>
                <div className="flex gap-3">
                  <button onClick={() => setStep(1)} className="flex-1 py-3 border-2 border-zinc-700 text-zinc-300 text-[10px] font-bold uppercase">Back</button>
                  <button onClick={() => setStep(3)} className="flex-2 py-3 bg-white text-black text-[10px] font-bold uppercase">{t('continueToCamera')}</button>
                </div>
              </div>
            )}

            {(step === 3 || step === 4) && (
              <div className="p-6 flex flex-col items-center bg-black">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-3 w-full">{t('captureDocument', { side: step === 3 ? 'front' : 'back' })}</h4>
                <p className="text-[10px] text-zinc-400 mb-4 text-center">{t('documentCaptureHint', { document: config.document_labels[documentType]?.toLowerCase() })}</p>
                <div className="relative w-full aspect-[4/3] max-h-64 bg-zinc-950 border-2 border-blue-500/60 overflow-hidden">
                  <video ref={videoRef} autoPlay muted playsInline aria-label="Live document camera preview" className="w-full h-full object-cover" />
                  <div className="absolute inset-[8%] border-2 border-dashed border-white/80 pointer-events-none" />
                </div>
                {cameraError && <div role="alert" className="mt-3 text-center"><p className="text-xs text-red-400">{cameraError} Camera access requires HTTPS or localhost.</p><button onClick={() => setCameraAttempt((attempt) => attempt + 1)} className="mt-2 text-[10px] font-bold uppercase text-blue-300 underline">{t('retryCameraAccess')}</button></div>}
                <div className="flex gap-3 w-full mt-5">
                  <button onClick={() => setStep(step === 3 ? 2 : 3)} className="flex-1 py-3 border-2 border-zinc-700 text-zinc-300 text-[10px] font-bold uppercase">Back</button>
                  <button disabled={!cameraReady} onClick={() => captureDocument(step === 3 ? 'front' : 'back')} className="flex-2 py-3 bg-white text-black text-[10px] font-bold uppercase disabled:opacity-50"><Camera className="inline w-4 h-4 mr-2" />{t('captureDocument', { side: step === 3 ? 'front' : 'back' })}</button>
                </div>
              </div>
            )}

            {(step === 8 || step === 9) && (
              <div className="p-6 flex flex-col items-center bg-black">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-3 w-full">{t('reviewDocument', { side: step === 8 ? 'front' : 'back' })}</h4>
                <p className="text-[10px] text-zinc-400 mb-4 text-center">{t('documentReviewHint')}</p>
                <img src={step === 8 ? frontPreview : backPreview} alt={`Captured document ${step === 8 ? 'front' : 'back'}`} className="w-full max-h-64 object-contain bg-zinc-950 border-2 border-zinc-700" />
                <div className="flex gap-3 w-full mt-5">
                  <button onClick={() => setStep(step === 8 ? 3 : 4)} className="flex-1 py-3 border-2 border-zinc-700 text-zinc-300 text-[10px] font-bold uppercase">{t('retake')}</button>
                  <button onClick={step === 8 ? continueAfterFrontReview : continueAfterBackReview} className="flex-2 py-3 bg-white text-black text-[10px] font-bold uppercase">{t('looksGoodContinue')}</button>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="p-6 flex flex-col items-center text-center bg-black">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-3 w-full text-left">{t('liveSelfieCheck')}</h4>
                <p className="text-sm font-bold text-white mb-3">{formatPrompt(pose, t)}</p>
                <p className="text-[10px] text-zinc-400 mb-4">{t('selfieInstructions')}</p>
                <div className="relative w-full aspect-[4/3] max-h-64 bg-zinc-950 border-2 border-blue-500/60 overflow-hidden">
                  <video ref={videoRef} autoPlay muted playsInline aria-label={t('liveSelfieCheck')} className="w-full h-full object-cover" />
                  <div className="absolute inset-y-[8%] left-[25%] right-[25%] rounded-full border-2 border-dashed border-white/80 pointer-events-none" />
                  
                  <span className="absolute bottom-3 left-3 right-3 border border-white/30 bg-black/75 px-3 py-2 text-[10px] font-bold uppercase text-white shadow-lg z-30" aria-live="polite">
                    {motionStatus}
                  </span>
                </div>
                
                {cameraError && <p role="alert" className="mt-3 text-xs text-red-400">{cameraError}</p>}
                {cameraError && <button onClick={() => setCameraAttempt((attempt) => attempt + 1)} className="mt-2 text-[10px] font-bold uppercase text-blue-300 underline">{t('retryCameraAccess')}</button>}
                
                <button disabled={!cameraReady} onClick={() => { 
                  challengeIndexRef.current = 0;
                  selfieFramesRef.current = [];
                  stableFramesRef.current = 0;
                  neutralNoseRatioRef.current = null;
                  movementStartedRef.current = false;
                  completedBlinksRef.current = 0;
                  setChallengeIndex(0);
                  setSelfieFrames([]);
                  setPose(config.poses[0]);
                  setPoseAttempt((attempt) => attempt + 1); 
                }} className="mt-4 w-full py-3 border border-zinc-700 text-zinc-300 text-[10px] font-bold uppercase disabled:opacity-50">{t('retrySelfieCheck')}</button>
              </div>
            )}

            {step === 6 && (
              <div className="p-10 flex flex-col items-center justify-center bg-black min-h-[350px]">
                <div className="relative mb-10 flex items-center justify-center w-32 h-32">
                  <div className="absolute inset-0 border-2 border-zinc-800 border-t-yellow-400 rounded-full animate-spin" />
                  <Sparkles className="w-8 h-8 text-yellow-400 animate-pulse" />
                </div>
                <div className="w-full bg-zinc-950/80 p-4 border border-zinc-800">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-white mb-3 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" /> {t('secureKycAnalysis')}</h3>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-yellow-400 animate-pulse">{t('uploadingCheckingMatch')}</p>
                </div>
              </div>
            )}

            {step === 7 && (
              <div className="p-8 flex flex-col items-center text-center bg-black space-y-6">
                <div className="w-24 h-24 bg-blue-950/20 border-2 border-blue-500 flex items-center justify-center"><BadgeCheck className="w-12 h-12 text-blue-400" /></div>
                <div className="w-full">
                  <h3 className="text-base font-bold uppercase tracking-widest text-white mb-2">{t('identityConfirmed')}</h3>
                  <p className="p-4 bg-blue-950/10 border border-blue-500/20 text-[10px] font-bold uppercase tracking-widest text-zinc-400">{t('identityMatch')}<br /><span className="text-blue-400">{t('securelyVerified')}</span></p>
                </div>
                <button onClick={close} className="w-full py-4 bg-white text-black border-2 border-white text-xs font-bold uppercase tracking-widest hover:bg-zinc-200">Done</button>
              </div>
            )}

            {step === 11 && (
              <div className="p-8 flex flex-col items-center text-center bg-black space-y-5">
                <ShieldCheck className="w-12 h-12 text-blue-400" />
                <h3 className="text-sm font-bold uppercase tracking-widest text-white">{t('verificationSubmitted')}</h3>
                <p className="text-[10px] text-zinc-400">{t('verificationPendingReview')}</p>
                <button onClick={close} className="w-full py-4 bg-white text-black border-2 border-white text-xs font-bold uppercase tracking-widest">Done</button>
              </div>
            )}

            {step === 10 && (
              <div className="p-8 flex flex-col items-center text-center bg-black space-y-5">
                <ShieldCheck className="w-12 h-12 text-yellow-400" />
                <h3 className="text-sm font-bold uppercase tracking-widest text-white">{t('verificationIncomplete')}</h3>
                <p className="text-[10px] text-zinc-400">{t('verificationCouldNotConfirm')}</p>
                <button onClick={() => { selfieFramesRef.current = []; challengeIndexRef.current = 0; setSelfieFrames([]); setChallengeIndex(0); setPose(config.poses[0]); setStep(5); }} className="w-full py-4 bg-white text-black border-2 border-white text-xs font-bold uppercase tracking-widest">{t('retrySelfieCheck')}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}