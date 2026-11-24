import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Camera, ArrowRight, ArrowLeft, Sparkles, MapPin, 
  Check, Loader2, Navigation, Heart, Gamepad2, Briefcase, 
  X, User, Calendar, Ruler, Sliders, ShieldCheck, ScanFace
} from 'lucide-react';
import Cropper from 'react-easy-crop';
import { toast } from 'sonner';
import { useAppStore } from '../../store/useAppStore';

// IMPORT THE SMART CROPPER
import { getCroppedImg, compressImageFile, smartFaceCrop } from '../../utils/cropImage'; 
import { profileService } from '../../api/profile.service'; 
import AIDraftAssistant from '../../components/AIDraftAssistant';
import { useI18n } from '../../i18n';

// ============================================================================
// CONSTANTS
// ============================================================================
const AVAILABLE_INTERESTS = [
  'Nightlife', 'Late Drives', 'Indie Rock', 'Sarcasm', 
  'Coffee', 'Gym', 'Startups', 'Thrifting', 'Vinyl', 
  'Gaming', 'Anime', 'Foodie', 'Photography', 'Art'
];

const GENDER_OPTIONS = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'other', label: 'Other' }
];

const INTEREST_TRANSLATION_KEYS = {
  Nightlife: 'interestNightlife', 'Late Drives': 'interestLateDrives', 'Indie Rock': 'interestIndieRock', Sarcasm: 'interestSarcasm',
  Coffee: 'interestCoffee', Gym: 'interestGym', Startups: 'interestStartups', Thrifting: 'interestThrifting', Vinyl: 'interestVinyl',
  Gaming: 'interestGaming', Anime: 'interestAnime', Foodie: 'interestFoodie', Photography: 'interestPhotography', Art: 'interestArt',
};

const getAgeFromDate = (dateValue) => {
  if (!dateValue) return null;
  const birthDate = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  if (
    today.getMonth() < birthDate.getMonth()
    || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }
  return age;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function Onboarding() {
  const navigate = useNavigate();
  const { t, formatNumber } = useI18n();
  
  const appToken = useAppStore((state) => state.token);

  const resendVerificationCode = async () => {
    if (isRequestingOtp) return;
    setIsRequestingOtp(true);
    try {
      await profileService.requestEmailOTP(appToken);
      toast.success(t('coreUiVerificationEmailSent'));
    } catch (error) {
      console.error('Could not resend onboarding verification code:', error);
      toast.error(error.message || t('coreUiVerificationCodeSendFailed'));
    } finally {
      setIsRequestingOtp(false);
    }
  };
  
  // --- CORE STATE ---
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  
  // --- AI SCANNER STATE ---
  const [isAnalyzingFace, setIsAnalyzingFace] = useState(false);
  
  const [profileData, setProfileData] = useState({
    // Step 1: Security
    otp: '',
    // Step 2: Basics
    displayName: '',
    dob: '',
    gender: '',
    heightCm: 170,
    avatarFile: null, 
    avatarUrl: null,  
    // Step 3: Vibe
    bio: '',
    interests: [],
    // Step 4: Preferences
    location: '',
    countryCode: '',
    locationCoordinates: null,
    intent: 'dating',
    showMe: 'Everyone',
    minAge: 18,
    maxAge: 40,
    maxDistanceKm: 50
  });

  // --- CROPPER STATE ---
  const [imageSrc, setImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const fileInputRef = useRef(null);

  // ============================================================================
  // HANDLERS: MAGIC AI UPLOAD & CROP
  // ============================================================================
  const onFileChange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setIsAnalyzingFace(true); // Trigger HUD Scanner
      
      try {
        const compressedFile = await compressImageFile(file, 1200, 0.8);
        
        try {
          // 1. ATTEMPT MAGIC AI CROP
          const autoCropped = await smartFaceCrop(compressedFile);
          
          setProfileData(prev => ({ 
            ...prev, 
            avatarFile: autoCropped.file, 
            avatarUrl: autoCropped.url 
          }));
          
          toast.success(t('faceDetectedCrop'));
          
        } catch (aiError) {
          // 3. AI FAILED: ENFORCE RULES OR FALLBACK TO MANUAL
          if (aiError.message === 'NO_FACE_DETECTED') {
            toast.error(t('noFaceDetected'));
            return; // Block upload entirely
          } 
          if (aiError.message === 'MULTIPLE_FACES_DETECTED') {
            toast.error(t('multipleFacesDetected'));
            return; // Block upload entirely
          }
          
          // Browser doesn't support FaceDetector: Fallback to manual cropper
          toast.info(t('adjustCropManually'));
          const imageDataUrl = URL.createObjectURL(compressedFile);
          setImageSrc(imageDataUrl);
          setZoom(1);
          setRotation(0);
          setCrop({ x: 0, y: 0 });
        }
      } catch (error) {
        toast.error(t('imageLoadFailed'));
      } finally {
        setIsAnalyzingFace(false);
      }
    }
  };

  const onCropComplete = useCallback((croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleSaveCrop = async () => {
    try {
      const croppedImage = await getCroppedImg(imageSrc, croppedAreaPixels, rotation);
      setProfileData(prev => ({ 
        ...prev, 
        avatarFile: croppedImage.file, 
        avatarUrl: croppedImage.url 
      }));
      setImageSrc(null);
      toast.success(t('photoSaved'));
      
    } catch (e) {
      toast.error(t('cropFailed'));
    }
  };

  // ============================================================================
  // HANDLERS: FORM DATA
  // ============================================================================
  const toggleInterest = (interest) => {
    setProfileData(prev => {
      const isSelected = prev.interests.includes(interest);
      if (isSelected) {
        return { ...prev, interests: prev.interests.filter(i => i !== interest) };
      }
      if (prev.interests.length >= 7) {
        toast.error(t('maxInterests'));
        return prev;
      }
      return { ...prev, interests: [...prev.interests, interest] };
    });
  };

  const handleGetLocation = () => {
    if (!window.isSecureContext) {
      toast.error(t('locationSecureContextRequired'));
      return;
    }

    if (!navigator.geolocation) {
      toast.error(t('locationUnavailable'));
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setProfileData(prev => ({
          ...prev,
          locationCoordinates: {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
          },
        }));
        setIsLocating(false);
        toast.success(t('locationUpdated'));
      },
      (error) => {
        setIsLocating(false);
        toast.error(error.code === error.PERMISSION_DENIED
          ? t('locationPermissionDenied')
          : error.code === error.TIMEOUT
            ? t('locationTimedOut')
            : t('locationUnavailable'));
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };

  const nextStep = async (e) => {
    e.preventDefault();

    // Step 1: OTP Verification
    if (step === 1) {
      if (profileData.otp.trim().length < 4) return toast.error(t('validOtpRequired'));
      setIsSubmitting(true);
      try {
        await profileService.verifyOTP(profileData.otp, appToken);
        toast.success(t('identityVerified'));
        setStep(2);
      } catch (error) {
        toast.error(error.message || t('invalidExpiredOtp'));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Step 2 Validation (Identity & Basics)
    if (step === 2) {
      if (!profileData.avatarUrl || !profileData.avatarFile) return toast.error(t('coreUiPhotoRequired'));
      if (profileData.displayName.trim().length < 2) return toast.error(t('coreUiValidNameRequired'));
      if (!profileData.dob) return toast.error(t('coreUiDateOfBirthRequired'));
      if (!profileData.gender) return toast.error(t('coreUiGenderRequired'));
      
      const age = getAgeFromDate(profileData.dob);
      if (age === null || age < 18) return toast.error(t('coreUiAgeRequired'));
      const heightCm = Number(profileData.heightCm);
      if (!Number.isInteger(heightCm) || heightCm < 100 || heightCm > 250) {
        return toast.error(t('heightRequired'));
      }
    }
    
    // Step 3 Validation (Vibe)
    if (step === 3) {
      if (profileData.interests.length < 3) return toast.error(t('selectThreeInterests'));
      if (profileData.bio.trim().length < 10) return toast.error(t('bioMinimumLength'));
    }

    // Step 4 Validation & Backend Submission
    if (step === 4) {
      const countryCode = profileData.countryCode.trim().toUpperCase();
      if (!profileData.location.trim()) return toast.error(t('locationRequired'));
      if (!/^[A-Z]{2}$/.test(countryCode) || countryCode === 'XX' || countryCode === 'T1') return toast.error(t('countryCodeRequired'));
      if (!profileData.locationCoordinates) return toast.error(t('locationCoordinatesRequired'));
      const minAge = Number(profileData.minAge);
      const maxAge = Number(profileData.maxAge);
      const maxDistanceKm = Number(profileData.maxDistanceKm);
      if (!Number.isInteger(minAge) || !Number.isInteger(maxAge) || minAge < 18 || maxAge > 99 || minAge > maxAge) {
        return toast.error(t('minAgeExceedsMax'));
      }
      if (!Number.isInteger(maxDistanceKm) || maxDistanceKm < 1 || maxDistanceKm > 500) {
        return toast.error(t('invalidDistance'));
      }

      setIsSubmitting(true);
      
      try {
        // 1. Submit Core Profile Demographics
        await profileService.setupBasics({
          display_name: profileData.displayName,
          date_of_birth: profileData.dob,
          gender: profileData.gender,
          bio: profileData.bio,
          height_cm: Number(profileData.heightCm),
          verified: false
        }, appToken);

        // 2. Upload Initial Media
        const formData = new FormData();
        formData.append('file', profileData.avatarFile);
        await profileService.uploadInitialMedia(formData, appToken);

        // 3. Submit Location
        await profileService.updateLocation({
          latitude: profileData.locationCoordinates.latitude,
          longitude: profileData.locationCoordinates.longitude,
          city: profileData.location,
          country: '',
          country_code: countryCode
        }, appToken);

        // 4. Submit Preferences
        await profileService.updatePreferences({
          interested_in: profileData.intent,
          show_me: profileData.showMe,
          min_age: minAge,
          max_age: maxAge,
          max_distance_km: maxDistanceKm,
          tags: profileData.interests
        }, appToken);

        // 5. Activate Account
        await profileService.activateAccount(appToken);
        
        toast.success(t('profileComplete'));
        navigate('/discover');
        
      } catch (error) {
        toast.error(error.message || t('saveProfileFailed'));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    
    setStep(step + 1);
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-black px-4 py-8 relative overflow-hidden font-mono text-zinc-300 rounded-none">

      {/* =====================================================================
          AI SCANNER HUD OVERLAY
          ===================================================================== */}
      {isAnalyzingFace && (
        <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-300">
          <div className="relative mb-6 flex size-[clamp(8rem,24vw,10rem)] items-center justify-center overflow-hidden border-2 border-zinc-800">
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-blue-500"></div>
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-blue-500"></div>
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-blue-500"></div>
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-blue-500"></div>
            
            <ScanFace className="w-12 h-12 text-blue-500 animate-pulse" />
            <style>{`
              @keyframes scan { 0% { top: 0%; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
            `}</style>
            <div className="absolute left-0 w-full h-[2px] bg-blue-400 shadow-[0_0_10px_rgba(var(--info-rgb), 1)] animate-[scan_1.5s_linear_infinite] z-20"></div>
          </div>
          <h3 className="text-white font-bold uppercase tracking-widest text-sm mb-2 animate-pulse">{t('analyzingBiometrics')}</h3>
          <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest text-center max-w-xs">
            {t('scanFaceDescription')}
          </p>
        </div>
      )}

      {/* =====================================================================
          MANUAL FULLSCREEN CROPPER MODAL (FALLBACK)
          ===================================================================== */}
      {imageSrc && !isAnalyzingFace && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center animate-in fade-in duration-200">
          <div className="relative h-[60dvh] w-full border-b-2 border-zinc-800 bg-zinc-950">
            <Cropper
              image={imageSrc} crop={crop} zoom={zoom} rotation={rotation}
              aspect={1} cropShape="rect" showGrid={false}
              onCropChange={setCrop} onZoomChange={setZoom}
              onRotationChange={setRotation} onCropComplete={onCropComplete}
            />
            <button 
              onClick={() => setImageSrc(null)}
              className="absolute top-6 right-6 p-2 bg-black border-2 border-white hover:bg-zinc-800 transition-colors z-50 text-white rounded-none"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 w-full max-w-md space-y-6 bg-black">
            <button 
              onClick={handleSaveCrop} 
              className="w-full py-4 bg-white text-black border-2 border-white font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-zinc-200 transition-colors rounded-none"
            >
              <Check className="w-4 h-4" /> Confirm & Crop
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          MAIN ONBOARDING CARD
          ===================================================================== */}
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col border-2 border-zinc-600 bg-black p-6 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] md:p-8 rounded-none">
        
        {/* Progress Stepper */}
        <div className="flex gap-2 mb-8 shrink-0">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex-1 relative">
              <div className={`h-2 w-full border-2 transition-colors duration-500 rounded-none ${step >= i ? 'bg-white border-white' : 'bg-black border-zinc-800'}`}></div>
            </div>
          ))}
        </div>

        <form onSubmit={nextStep} className="flex flex-col flex-1 overflow-hidden">
          
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-2">
            
            {/* -----------------------------------------------------------------
                STEP 1: OTP VERIFICATION
                ----------------------------------------------------------------- */}
            {step === 1 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500 flex flex-col justify-center h-full">
                <div className="text-center mb-4">
                  <ShieldCheck className="w-12 h-12 text-white mx-auto mb-4" />
                  <h2 className="text-2xl md:text-3xl font-bold text-white mb-1 uppercase tracking-widest">{t('securityCheck')}</h2>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{t('otpSentPrompt')}</p>
                </div>
                
                <div>
                  <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mb-2 text-center">{t('verificationCode')}</label>
                  <input 
                    type="text" 
                    value={profileData.otp}
                    onChange={(e) => setProfileData({...profileData, otp: e.target.value.toUpperCase()})}
                    placeholder="000000"
                    maxLength={6}
                    className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-4 text-[24px] text-center font-bold text-white uppercase tracking-[0.5em] focus:outline-none focus:border-white transition-colors placeholder:text-zinc-800"
                  />
                  <button
                    type="button"
                    onClick={resendVerificationCode}
                    disabled={isRequestingOtp || isSubmitting}
                    className="mt-3 w-full border border-zinc-700 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400 transition-colors hover:border-white hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isRequestingOtp ? 'Sending code...' : 'Resend verification code'}
                  </button>
                </div>
              </div>
            )}

            {/* -----------------------------------------------------------------
                STEP 2: IDENTITY & BASICS
                ----------------------------------------------------------------- */}
            {step === 2 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
                <div className="text-center">
                  <h2 className="text-2xl md:text-3xl font-bold text-white mb-1 uppercase tracking-widest">{t('buildProfile')}</h2>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{t('profileBasics')}</p>
                </div>
                
                <div className="flex justify-center py-2">
                  <input type="file" ref={fileInputRef} onChange={onFileChange} accept="image/jpeg, image/png, image/webp" className="hidden" />
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative flex size-[clamp(6rem,16vw,8rem)] cursor-pointer flex-col items-center justify-center overflow-hidden border-2 transition-colors group rounded-none ${profileData.avatarUrl ? 'bg-black border-zinc-500 hover:border-white' : 'bg-zinc-950 border-dashed border-zinc-700 hover:border-white'}`}
                  >
                    {profileData.avatarUrl ? (
                      <>
                        <img src={profileData.avatarUrl} alt={t('preview')} className="w-full h-full object-cover grayscale transition-transform group-hover:scale-105" />
                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Camera className="w-5 h-5 text-white mb-1" />
                          <span className="text-white text-[9px] font-bold uppercase tracking-widest">{t('swap')}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <Camera className="w-6 h-6 text-zinc-500 group-hover:text-white transition-colors mb-2" />
                        <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest group-hover:text-white transition-colors text-center px-2">{t('soloSelfie')}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('displayNameLabel')}</label>
                    <div className="relative">
                      <User className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" />
                      <input 
                        type="text" value={profileData.displayName}
                        onChange={(e) => setProfileData({...profileData, displayName: e.target.value})}
                        placeholder={t('displayNamePlaceholder')}
                        className="w-full bg-black border-2 border-zinc-800 rounded-none pl-11 pr-4 py-3 text-[10px] font-bold text-white uppercase tracking-widest focus:outline-none focus:border-white transition-colors placeholder:text-zinc-700"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('dateOfBirth')}</label>
                      <div className="relative">
                        <Calendar className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
                        <input 
                          type="date" value={profileData.dob}
                          onChange={(e) => setProfileData({...profileData, dob: e.target.value})}
                          className="w-full bg-black border-2 border-zinc-800 rounded-none pl-11 pr-2 py-3 text-[10px] font-bold text-white uppercase tracking-widest focus:outline-none focus:border-white transition-colors"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex justify-between">
                        <span>{t('heightLabel')}</span> <span className="text-white">{profileData.heightCm} CM</span>
                      </label>
                      <div className="relative">
                        <Ruler className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" />
                        <input 
                          type="number" min="100" max="250" value={profileData.heightCm}
                          onChange={(e) => setProfileData({...profileData, heightCm: e.target.value})}
                          className="w-full bg-black border-2 border-zinc-800 rounded-none pl-11 pr-4 py-3 text-[10px] font-bold text-white uppercase tracking-widest focus:outline-none focus:border-white transition-colors"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('identifyAs')}</label>
                    <div className="grid grid-cols-4 gap-2">
                      {GENDER_OPTIONS.map(g => (
                        <button
                          key={g.id} type="button"
                          onClick={() => setProfileData({...profileData, gender: g.id})}
                          className={`py-3 border-2 text-[9px] font-bold uppercase tracking-widest transition-colors rounded-none ${profileData.gender === g.id ? 'bg-white border-white text-black' : 'bg-black border-zinc-800 text-zinc-500 hover:border-zinc-500 hover:text-white'}`}
                        >
                          {t(g.id === 'male' ? 'male' : g.id === 'female' ? 'female' : 'other')}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* -----------------------------------------------------------------
                STEP 3: BIO & VIBE
                ----------------------------------------------------------------- */}
            {step === 3 && (
              <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-500 h-full flex flex-col justify-center">
                <div className="text-center mb-4">
                  <h2 className="text-2xl md:text-3xl font-bold text-white mb-2 uppercase tracking-widest">{t('profileVibe')}</h2>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{t('vibeDescription')}</p>
                </div>

                <div className="mb-6">
                  <div className="flex justify-between items-end mb-3">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">{t('interestsLabel')}</label>
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${profileData.interests.length >= 3 ? 'text-white' : 'text-zinc-600'}`}>[{profileData.interests.length}] {t('selected')}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center p-1">
                    {AVAILABLE_INTERESTS.map(interest => {
                      const isSelected = profileData.interests.includes(interest);
                      return (
                        <button
                          key={interest} type="button"
                          onClick={() => toggleInterest(interest)}
                          className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors border-2 rounded-none ${isSelected ? 'bg-white border-white text-black' : 'bg-black border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:border-zinc-600 hover:text-white'}`}
                        >
                          {t(INTEREST_TRANSLATION_KEYS[interest])}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex justify-between">
                    <span>{t('quickBio')}</span>
                    <span className="text-zinc-600">[{profileData.bio.length}/500]</span>
                  </label>
                  <textarea 
                    rows="5" maxLength={500} value={profileData.bio}
                    onChange={(e) => setProfileData({...profileData, bio: e.target.value})}
                    className="w-full bg-black border-2 border-zinc-800 rounded-none p-4 text-[10px] text-white uppercase tracking-widest font-bold focus:outline-none focus:border-white resize-none transition-colors placeholder:text-zinc-700" 
                    placeholder={t('bioPlaceholder')}
                  ></textarea>
                  <AIDraftAssistant
                    type="profile-bio"
                    draft={profileData.bio}
                    interests={profileData.interests}
                    disabled={isSubmitting}
                    onSelect={(bio) => setProfileData((current) => ({ ...current, bio }))}
                  />
                </div>
              </div>
            )}

            {/* -----------------------------------------------------------------
                STEP 4: LOCATION & FILTERS
                ----------------------------------------------------------------- */}
            {step === 4 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
                <div className="text-center">
                  <h2 className="text-2xl md:text-3xl font-bold text-white mb-2 uppercase tracking-widest">{t('matchSettings')}</h2>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{t('matchSettingsDescription')}</p>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">{t('locationLabel')}</label>
                  <div className="relative flex items-center">
                    <MapPin className="w-4 h-4 absolute left-4 text-zinc-500" />
                    <input 
                      type="text" value={profileData.location}
                      onChange={(e) => setProfileData({...profileData, location: e.target.value})}
                      placeholder={t('locationPlaceholder')}
                      className="w-full bg-black border-2 border-zinc-800 rounded-none pl-11 pr-28 py-3 text-[10px] text-white font-bold uppercase tracking-widest focus:outline-none focus:border-white transition-colors placeholder:text-zinc-700"
                    />
                    <button
                      type="button" onClick={handleGetLocation} disabled={isLocating}
                      className="absolute right-2 px-3 py-1.5 bg-zinc-900 border-2 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-500 hover:text-white text-zinc-400 text-[9px] font-bold uppercase tracking-widest rounded-none transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isLocating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Navigation className="w-3 h-3" />}
                      {t('locate')}
                    </button>
                  </div>
                  {profileData.locationCoordinates ? (
                    <div className="mt-2 space-y-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500" aria-live="polite">
                      <p>{t('locationCoordinatesCaptured')}</p>
                      <output className="block border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-zinc-300" aria-label={t('locationCoordinatesCaptured')}>
                        {formatNumber(profileData.locationCoordinates.latitude, { maximumFractionDigits: 5 })},{' '}
                        {formatNumber(profileData.locationCoordinates.longitude, { maximumFractionDigits: 5 })}
                        {' · ±'}
                        {formatNumber(Math.ceil(profileData.locationCoordinates.accuracy), { maximumFractionDigits: 0 })} m
                      </output>
                    </div>
                  ) : (
                    <p className="mt-2 text-[9px] font-bold uppercase tracking-widest text-zinc-500" aria-live="polite">
                      {t('locationCoordinatesHelp')}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="onboarding-country-code" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">{t('countryCodeLabel')}</label>
                  <input
                    id="onboarding-country-code"
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    maxLength={2}
                    value={profileData.countryCode}
                    onChange={(event) => setProfileData((previous) => ({ ...previous, countryCode: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') }))}
                    placeholder="KE"
                    aria-describedby="onboarding-country-help"
                    className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-xs text-white font-bold uppercase tracking-widest focus:outline-none focus:border-white transition-colors placeholder:text-zinc-700"
                  />
                  <p id="onboarding-country-help" className="mt-2 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                    {t('countryCodeHelp')}
                  </p>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 block">{t('lookingFor')}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'casual', icon: Sparkles, label: 'casualTexting' },
                      { id: 'dating', icon: Heart, label: 'datingMeetups' },
                      { id: 'friends', icon: Gamepad2, label: 'friendsGaming' },
                      { id: 'network', icon: Briefcase, label: 'networking' },
                    ].map(intent => {
                      const Icon = intent.icon;
                      const isSelected = profileData.intent === intent.id;
                      return (
                        <button 
                          key={intent.id} type="button"
                          onClick={() => setProfileData({...profileData, intent: intent.id})}
                          className={`p-3 rounded-none border-2 text-center transition-colors flex items-center justify-center gap-2 ${isSelected ? 'bg-white border-white text-black' : 'bg-black border-zinc-800 text-zinc-500 hover:border-zinc-500 hover:text-white'}`}
                        >
                          <Icon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-black' : 'text-zinc-500'}`} />
                          <span className="text-[9px] font-bold uppercase tracking-widest text-left leading-tight">{t(intent.label)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 block">{t('genderPreference')}</label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {['Men', 'Women', 'Other', 'Everyone'].map(option => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setProfileData({ ...profileData, showMe: option })}
                        className={`border-2 px-3 py-3 text-[9px] font-bold uppercase tracking-widest transition-colors ${profileData.showMe === option ? 'border-white bg-white text-black' : 'border-zinc-800 bg-black text-zinc-500 hover:border-zinc-500 hover:text-white'}`}
                      >
                        {option === 'Men' ? t('male') : option === 'Women' ? t('female') : option === 'Other' ? t('other') : t('everyone')}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('ageRange')}</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="number" min="18" max="99" value={profileData.minAge}
                        onChange={(e) => setProfileData({...profileData, minAge: e.target.value})}
                        className="w-full bg-black border-2 border-zinc-800 rounded-none px-2 py-3 text-[10px] text-center font-bold text-white uppercase tracking-widest focus:outline-none focus:border-white transition-colors"
                      />
                      <span className="text-zinc-600 text-[10px] font-bold uppercase tracking-widest">-</span>
                      <input 
                        type="number" min="18" max="99" value={profileData.maxAge}
                        onChange={(e) => setProfileData({...profileData, maxAge: e.target.value})}
                        className="w-full bg-black border-2 border-zinc-800 rounded-none px-2 py-3 text-[10px] text-center font-bold text-white uppercase tracking-widest focus:outline-none focus:border-white transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex justify-between">
                      <span>{t('maxDistance')}</span>
                      <span className="text-white">{profileData.maxDistanceKm} KM</span>
                    </label>
                    <div className="h-10.5 flex items-center bg-black border-2 border-zinc-800 px-3">
                      <Sliders className="w-4 h-4 text-zinc-600 mr-3" />
                      <input 
                        type="range" min="5" max="500" step="5" value={profileData.maxDistanceKm}
                        onChange={(e) => setProfileData({...profileData, maxDistanceKm: e.target.value})}
                        className="w-full accent-zinc-400 h-1 bg-zinc-800 appearance-none cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* -----------------------------------------------------------------
              NAVIGATION CONTROLS
              ----------------------------------------------------------------- */}
          <div className="flex gap-3 pt-6 mt-4 border-t-2 border-zinc-800 shrink-0 bg-black">
            {step > 1 && (
              <button 
                type="button" disabled={isSubmitting} onClick={() => setStep(step - 1)}
                className="px-5 py-4 bg-black border-2 border-zinc-700 hover:border-white hover:text-white text-zinc-400 rounded-none transition-colors disabled:opacity-50 flex items-center justify-center"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <button 
              type="submit" disabled={isSubmitting || isLocating}
              className="flex-1 py-4 bg-white text-black border-2 border-white hover:bg-zinc-200 disabled:opacity-50 disabled:bg-zinc-800 disabled:border-zinc-800 disabled:text-zinc-500 text-[10px] font-bold uppercase tracking-widest rounded-none flex items-center justify-center gap-2 transition-colors"
            >
              {isSubmitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> {step === 4 ? t('saving') : t('verifying')}</>
              ) : step === 4 ? (
                t('completeProfile')
              ) : step === 1 ? (
                t('verifyOtp')
              ) : (
                <>{t('continue')} <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}