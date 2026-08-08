import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Camera, ArrowRight, ArrowLeft, Sparkles, MapPin, 
  Check, Loader2, Navigation, Heart, Gamepad2, Briefcase, 
  X, User, Calendar, Ruler, Sliders
} from 'lucide-react';
import Cropper from 'react-easy-crop';
import { toast } from 'sonner';
import { useAppStore } from '../../store/useAppStore';

import { getCroppedImg, compressImageFile } from '../../utils/cropImage'; 
import { apiClient } from '../../api/client'; 

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
  { id: 'everyone', label: 'Other' }
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function Onboarding() {
  const navigate = useNavigate();
  
  // --- CORE STATE ---
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  
  const [profileData, setProfileData] = useState({
    // Step 1: Basics
    displayName: '',
    dob: '',
    gender: '',
    heightCm: 170,
    avatarFile: null, 
    avatarUrl: null,  
    // Step 2: Vibe
    bio: '',
    interests: [],
    // Step 3: Preferences
    location: '',
    intent: 'dating',
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
  // HANDLERS: IMAGE PROCESSING
  // ============================================================================
  const onFileChange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      try {
        const compressedFile = await compressImageFile(file, 1200, 0.8);
        const imageDataUrl = URL.createObjectURL(compressedFile);
        setImageSrc(imageDataUrl);
        setZoom(1);
        setRotation(0);
        setCrop({ x: 0, y: 0 });
      } catch (error) {
        toast.error('FAILED TO LOAD IMAGE.');
        const theme = useAppStore((state) => state.userPreferences.theme);
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
      toast.success('PHOTO SAVED.');
    } catch (e) {
      toast.error('FAILED TO CROP IMAGE.');
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
        toast.error('MAX 7 INTERESTS ALLOWED.');
        return prev;
      }
      return { ...prev, interests: [...prev.interests, interest] };
    });
  };

  const handleGetLocation = () => {
    setIsLocating(true);
    setTimeout(() => {
      setProfileData(prev => ({ ...prev, location: 'NAIROBI, KENYA' }));
      setIsLocating(false);
      toast.success('LOCATION UPDATED.');
    }, 1500);
  };

  const nextStep = async (e) => {
    e.preventDefault();
    
    // Step 1 Validation
    if (step === 1) {
      if (!profileData.avatarUrl) return toast.error("PLEASE UPLOAD A PHOTO.");
      if (profileData.displayName.trim().length < 2) return toast.error("ENTER A VALID DISPLAY NAME.");
      if (!profileData.dob) return toast.error("DATE OF BIRTH IS REQUIRED.");
      if (!profileData.gender) return toast.error("PLEASE SELECT A GENDER.");
      
      // Basic age check (18+)
      const age = new Date().getFullYear() - new Date(profileData.dob).getFullYear();
      if (age < 18) return toast.error("YOU MUST BE AT LEAST 18 YEARS OLD.");
    }
    
    // Step 2 Validation
    if (step === 2) {
      if (profileData.interests.length < 3) return toast.error("SELECT AT LEAST 3 INTERESTS.");
      if (profileData.bio.trim().length < 10) return toast.error("BIO MUST BE AT LEAST 10 CHARACTERS.");
    }

    // Step 3 Validation & Backend Submission
    if (step === 3) {
      if (!profileData.location.trim()) return toast.error("LOCATION IS REQUIRED.");
      if (profileData.minAge > profileData.maxAge) return toast.error("MIN AGE CANNOT EXCEED MAX AGE.");

      setIsSubmitting(true);
      
      try {
        // 1. Submit Core Profile Demographics
        await apiClient.post('/profile/setup', {
          display_name: profileData.displayName,
          date_of_birth: profileData.dob,
          gender: profileData.gender,
          bio: profileData.bio,
          height_cm: parseInt(profileData.heightCm),
          verified: false
        });

        // 2. Submit Location
        await apiClient.post('/profile/location', {
          latitude: 0.0,
          longitude: 0.0,
          city: profileData.location,
          country: 'Unspecified' // Can be parsed from location input later
        });

        // 3. Submit Preferences
        await apiClient.post('/profile/preferences', {
          interested_in: profileData.intent,
          min_age: parseInt(profileData.minAge),
          max_age: parseInt(profileData.maxAge),
          max_distance_km: parseInt(profileData.maxDistanceKm)
        });

        // 4. Activate Account
        await apiClient.post('/profile/activate');
        
        toast.success('PROFILE COMPLETE.');
        navigate('/discover');
        
      } catch (error) {
        toast.error(error.response?.data?.error || 'FAILED TO SAVE PROFILE.');
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
          FULLSCREEN CROPPER MODAL
          ===================================================================== */}
      {imageSrc && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center animate-in fade-in duration-200">
          <div className="relative w-full h-[60vh] bg-zinc-950 border-b-2 border-zinc-800">
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
      <div className="w-full max-w-lg bg-black border-2 border-zinc-600 p-6 md:p-8 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] z-10 relative rounded-none flex flex-col max-h-[90vh]">
        
        {/* Progress Stepper */}
        <div className="flex gap-2 mb-8 shrink-0">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex-1 relative">
              <div className={`h-2 w-full border-2 transition-colors duration-500 rounded-none ${step >= i ? 'bg-white border-white' : 'bg-black border-zinc-800'}`}></div>
            </div>
          ))}
        </div>

        <form onSubmit={nextStep} className="flex flex-col flex-1 overflow-hidden">
          
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-2">
            {/* -----------------------------------------------------------------
                STEP 1: IDENTITY & BASICS
                ----------------------------------------------------------------- */}
            {step === 1 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
                <div className="text-center">
                  <h2 className="text-2xl md:text-3xl font-bold text-white mb-1 uppercase tracking-widest">Verify Identity</h2>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">The basics to get you started.</p>
                </div>
                
                <div className="flex justify-center py-2">
                  <input type="file" ref={fileInputRef} onChange={onFileChange} accept="image/jpeg, image/png, image/webp" className="hidden" />
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={`w-32 h-32 flex flex-col items-center justify-center cursor-pointer transition-colors group overflow-hidden relative border-2 rounded-none ${profileData.avatarUrl ? 'bg-black border-zinc-500 hover:border-white' : 'bg-zinc-950 border-dashed border-zinc-700 hover:border-white'}`}
                  >
                    {profileData.avatarUrl ? (
                      <>
                        <img src={profileData.avatarUrl} alt="Preview" className="w-full h-full object-cover grayscale transition-transform group-hover:scale-105" />
                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Camera className="w-5 h-5 text-white mb-1" />
                          <span className="text-white text-[9px] font-bold uppercase tracking-widest">Swap</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <Camera className="w-6 h-6 text-zinc-500 group-hover:text-white transition-colors mb-2" />
                        <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest group-hover:text-white transition-colors text-center px-2">Upload Photo</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">Display Name</label>
                    <div className="relative">
                      <User className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" />
                      <input 
                        type="text" value={profileData.displayName}
                        onChange={(e) => setProfileData({...profileData, displayName: e.target.value})}
                        placeholder="HOW SHOULD WE CALL YOU?"
                        className="w-full bg-black border-2 border-zinc-800 rounded-none pl-11 pr-4 py-3 text-[10px] font-bold text-white uppercase tracking-widest focus:outline-none focus:border-white transition-colors placeholder:text-zinc-700"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">Date of Birth</label>
                      <div className="relative">
                        <Calendar className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
                        <input 
                          type="date" value={profileData.dob}
                          onChange={(e) => setProfileData({...profileData, dob: e.target.value})}
                          style={{ colorScheme: theme }}
                          className="w-full bg-black border-2 border-zinc-800 rounded-none pl-11 pr-2 py-3 text-[10px] font-bold text-white uppercase tracking-widest focus:outline-none focus:border-white transition-colors"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex justify-between">
                        <span>Height</span> <span className="text-white">{profileData.heightCm} CM</span>
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
                    <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">I Identify As</label>
                    <div className="grid grid-cols-3 gap-2">
                      {GENDER_OPTIONS.map(g => (
                        <button
                          key={g.id} type="button"
                          onClick={() => setProfileData({...profileData, gender: g.id})}
                          className={`py-3 border-2 text-[9px] font-bold uppercase tracking-widest transition-colors rounded-none ${profileData.gender === g.id ? 'bg-white border-white text-black' : 'bg-black border-zinc-800 text-zinc-500 hover:border-zinc-500 hover:text-white'}`}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* -----------------------------------------------------------------
                STEP 2: BIO & VIBE
                ----------------------------------------------------------------- */}
            {step === 2 && (
              <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-500 h-full flex flex-col justify-center">
                <div className="text-center mb-4">
                  <h2 className="text-2xl md:text-3xl font-bold text-white mb-2 uppercase tracking-widest">What's your vibe?</h2>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Tags and a bio so people know what you're into.</p>
                </div>

                <div className="mb-6">
                  <div className="flex justify-between items-end mb-3">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">Interests (Pick 3-7)</label>
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${profileData.interests.length >= 3 ? 'text-white' : 'text-zinc-600'}`}>[{profileData.interests.length}] Selected</span>
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
                          {interest}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex justify-between">
                    <span>Quick Bio</span>
                    <span className="text-zinc-600">[{profileData.bio.length}/500]</span>
                  </label>
                  <textarea 
                    rows="5" maxLength={500} value={profileData.bio}
                    onChange={(e) => setProfileData({...profileData, bio: e.target.value})}
                    className="w-full bg-black border-2 border-zinc-800 rounded-none p-4 text-[10px] text-white uppercase tracking-widest font-bold focus:outline-none focus:border-white resize-none transition-colors placeholder:text-zinc-700" 
                    placeholder="I'M THE KIND OF PERSON WHO..."
                  ></textarea>
                </div>
              </div>
            )}

            {/* -----------------------------------------------------------------
                STEP 3: LOCATION & FILTERS
                ----------------------------------------------------------------- */}
            {step === 3 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
                <div className="text-center">
                  <h2 className="text-2xl md:text-3xl font-bold text-white mb-2 uppercase tracking-widest">Match Settings</h2>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Configure who shows up in your feed.</p>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Location</label>
                  <div className="relative flex items-center">
                    <MapPin className="w-4 h-4 absolute left-4 text-zinc-500" />
                    <input 
                      type="text" value={profileData.location}
                      onChange={(e) => setProfileData({...profileData, location: e.target.value})}
                      placeholder="CITY OR ZIP CODE"
                      className="w-full bg-black border-2 border-zinc-800 rounded-none pl-11 pr-28 py-3 text-[10px] text-white font-bold uppercase tracking-widest focus:outline-none focus:border-white transition-colors placeholder:text-zinc-700"
                    />
                    <button
                      type="button" onClick={handleGetLocation} disabled={isLocating}
                      className="absolute right-2 px-3 py-1.5 bg-zinc-900 border-2 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-500 hover:text-white text-zinc-400 text-[9px] font-bold uppercase tracking-widest rounded-none transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isLocating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Navigation className="w-3 h-3" />}
                      LOCATE
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 block">Looking For</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'casual', icon: Sparkles, label: 'Casual Texting' },
                      { id: 'dating', icon: Heart, label: 'Dating & Meetups' },
                      { id: 'friends', icon: Gamepad2, label: 'Friends & Gaming' },
                      { id: 'network', icon: Briefcase, label: 'Networking' },
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
                          <span className="text-[9px] font-bold uppercase tracking-widest text-left leading-tight">{intent.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">Age Range</label>
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
                    <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex justify-between">
                      <span>Max Distance</span>
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
                <><Loader2 className="w-4 h-4 animate-spin" /> SAVING...</>
              ) : step === 3 ? (
                'COMPLETE PROFILE'
              ) : (
                <>CONTINUE <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}