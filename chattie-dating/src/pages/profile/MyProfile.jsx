import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Camera, Save, Settings, X, Plus, Image as ImageIcon, 
  MapPin, Briefcase, Heart, Shield, Bell, 
  CreditCard, LogOut, ChevronRight, Loader2
} from 'lucide-react';
import { toast } from 'sonner';

// Services
import { ChattieService } from '../../api/chattie.service';
import { settingsService } from '../../api/settings.service';
import AIDraftAssistant from '../../components/AIDraftAssistant';
import { useI18n } from '../../i18n';

// ============================================================================
// DEFAULT PROFILE SHAPE - used to normalize backend or mocked responses
// ============================================================================
const DEFAULT_PROFILE = {
  name: '',
  age: 18,
  job: '',
  location: '',
  bio: '',
  intent: 'Dating',
  tags: [],
  avatar: '',
  cover: '',
  photos: [null, null, null, null, null, null]
};

const AVAILABLE_TAGS = ['React', 'Spring Boot', 'Gaming', 'E-commerce', 'Hosting', 'Coffee', 'Late Drives', 'Nightlife', 'Gym', 'Art', 'Music', 'Outdoors'];

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function MyProfile() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [fullSettings, setFullSettings] = useState(DEFAULT_PROFILE); 
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [uploadTarget, setUploadTarget] = useState(null);
  const photoInputRef = useRef(null);
  const subscriptionPlan = String(fullSettings.plan || 'NONE').toUpperCase();
  const subscriptionStatus = String(fullSettings.sub_status || '').toUpperCase();
  const subscriptionExpiry = fullSettings.expires_at ? new Date(fullSettings.expires_at) : null;
  const hasActiveSubscription = ['ACTIVE', 'TRIALING'].includes(subscriptionStatus)
    && (!subscriptionExpiry || subscriptionExpiry.getTime() > Date.now());
  const formattedSubscriptionExpiry = subscriptionExpiry && !Number.isNaN(subscriptionExpiry.getTime())
    ? subscriptionExpiry.toLocaleDateString()
    : '';

  // ============================================================================
  // EFFECTS
  // ============================================================================
  useEffect(() => {
    const loadProfileData = async () => {
      setIsLoading(true);
      try {
          const data = await ChattieService.getSettings();
          // Normalize response against defaults so mocks or partial objects don't break the UI
          let normalized = { ...DEFAULT_PROFILE, ...data };

          // If backend returned an effectively-empty profile, try localStorage fallback
          try {
            const ls = localStorage.getItem('chattie-session');
            if (ls) {
              const parsed = JSON.parse(ls);
              const appearsEmpty = !normalized.name && !normalized.avatar && (!Array.isArray(normalized.photos) || normalized.photos.every(p => !p));
              if (appearsEmpty && parsed && typeof parsed === 'object') {
                normalized = {
                  ...DEFAULT_PROFILE,
                  ...parsed,
                  avatar: data.avatar || '',
                  cover: data.cover || '',
                  avatar_storage_url: data.avatar_storage_url || '',
                  cover_storage_url: data.cover_storage_url || '',
                  photos: Array.isArray(data.photos) ? data.photos : DEFAULT_PROFILE.photos,
                  plan: data.plan,
                  sub_status: data.sub_status,
                  expires_at: data.expires_at,
                };
              }
            }
          } catch (e) { /* ignore localStorage errors */ }

          setFullSettings(normalized);

          setProfile({
            name: normalized.name || DEFAULT_PROFILE.name,
            age: Number(normalized.age ?? DEFAULT_PROFILE.age),
            job: normalized.job || DEFAULT_PROFILE.job,
            location: normalized.location || DEFAULT_PROFILE.location,
            bio: normalized.bio || DEFAULT_PROFILE.bio,
            intent: normalized.intent || DEFAULT_PROFILE.intent,
            tags: Array.isArray(normalized.tags) ? normalized.tags : DEFAULT_PROFILE.tags,
            avatar: normalized.avatar || DEFAULT_PROFILE.avatar,
            cover: normalized.cover || DEFAULT_PROFILE.cover,
            photos: Array.isArray(normalized.photos) ? normalized.photos : [normalized.avatar || null, null, null, null, null, null]
          });
      } catch (error) {
        console.error("Failed to load profile:", error);
        toast.error(t('profileLoadFailed'));
      } finally {
        setIsLoading(false);
      }
    };

    loadProfileData();
  }, []);

  // ============================================================================
  // HANDLERS
  // ============================================================================
  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    
    try {
      const updatedPayload = {
        ...fullSettings,
        name: profile.name,
        age: profile.age,
        job: profile.job,
        location: profile.location,
        bio: profile.bio,
        intent: profile.intent,
        tags: profile.tags,
        avatar: profile.avatar,
        cover: profile.cover,
        photos: profile.photos
      };

      await ChattieService.updateSettings(updatedPayload);

      // Save to local fallback so UI survives refresh if backend didn't persist
      try { localStorage.setItem('chattie_profile', JSON.stringify(updatedPayload)); } catch (e) { /* ignore */ }

      // Re-fetch server state to verify persistence and update UI
      try {
        const fresh = await ChattieService.getSettings();
        const normalized = { ...DEFAULT_PROFILE, ...fresh };
        setFullSettings(normalized);
        setProfile(prev => ({
          ...prev,
          name: normalized.name || prev.name,
          job: normalized.job || prev.job,
          location: normalized.location || prev.location,
          bio: normalized.bio || prev.bio,
          intent: normalized.intent || prev.intent,
          tags: Array.isArray(normalized.tags) ? normalized.tags : prev.tags,
          avatar: normalized.avatar || prev.avatar,
          cover: normalized.cover || prev.cover
        }));
      } catch (fetchErr) {
        // If refetch fails, keep the optimistic UI and rely on localStorage fallback
        console.warn('Refetch after save failed, using optimistic data/local fallback', fetchErr);
        setFullSettings(updatedPayload);
      }

      toast.success(t('profileUpdated'));
    } catch (error) {
      console.error("Save error:", error);
      toast.error(t('profileSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleTag = (tag) => {
    setProfile(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) 
        ? prev.tags.filter(t => t !== tag)
        : [...prev.tags, tag]
    }));
  };

  const handlePhotoUpload = (target) => {
    setUploadTarget(target);
    photoInputRef.current?.click();
  };

  const refreshProfileFromServer = async () => {
    const fresh = await ChattieService.getSettings();
    const normalized = { ...DEFAULT_PROFILE, ...fresh };
    setFullSettings(normalized);
    setProfile(prev => ({
      ...prev,
      avatar: normalized.avatar || '',
      cover: normalized.cover || '',
      photos: Array.isArray(normalized.photos) ? normalized.photos : DEFAULT_PROFILE.photos,
    }));
  };

  const handlePhotoSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !uploadTarget) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Choose an image file.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Choose an image smaller than 10 MB.');
      return;
    }

    setIsUploadingPhoto(true);
    try {
      const uploaded = await settingsService.uploadMedia(file);
      if (!uploaded?.id || !uploaded?.url) {
        throw new Error('The image upload returned incomplete media details.');
      }

      if (uploadTarget.type === 'cover') {
        if (!uploaded.storage_url) {
          throw new Error('The image upload did not return its storage URL.');
        }
        await ChattieService.updateSettings({
          ...fullSettings,
          cover: uploaded.url,
          cover_storage_url: uploaded.storage_url,
        });
      } else if (uploadTarget.index === 0) {
        await settingsService.setPrimaryMedia(uploaded.id);
      }

      await refreshProfileFromServer();
      toast.success(uploadTarget.type === 'cover' ? 'Cover image updated.' : 'Profile image uploaded.');
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not upload this image.'));
    } finally {
      setIsUploadingPhoto(false);
      setUploadTarget(null);
    }
  };

  // ============================================================================
  // LOADING STATE
  // ============================================================================
  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col items-center justify-center bg-black p-6 text-center text-zinc-300" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 400 }}>
        <Loader2 className="w-10 h-10 text-white animate-spin mb-4" />
        <h2 className="text-sm text-white">{t('loadingProfile')}</h2>
      </div>
    );
  }

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-black w-full relative overflow-hidden text-zinc-300 rounded-none" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 400 }}>
      
      {/* =====================================================================
          HEADER
          ===================================================================== */}
      <header className="p-4 md:p-6 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center shrink-0 z-10 sticky top-0">
        <h1 className="text-xl md:text-2xl text-white">{t('myProfile')}</h1>
        <button 
          onClick={() => setShowSettings(true)}
          className="p-2 border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 text-zinc-500 hover:text-white transition-colors"
        >
          <Settings className="w-5 h-5" />
        </button>
      </header>

      {/* =====================================================================
          MAIN SCROLLABLE CONTENT
          ===================================================================== */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoSelected}
      />
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar bg-black">
        <div className="min-h-full w-full pb-4">
          
          {/* COVER & AVATAR SECTION */}
          <div className="relative mb-20 md:mb-24 border-b-2 border-zinc-800">
            {/* Cover Photo */}
            <button
              type="button"
              onClick={() => handlePhotoUpload({ type: 'cover' })}
              disabled={isUploadingPhoto}
              className="relative aspect-[3/1] w-full cursor-pointer border-b-2 border-zinc-800 bg-zinc-950 flex items-center justify-center group disabled:cursor-wait"
              aria-label="Upload or change cover image"
            >
              {profile.cover ? (
                <img src={profile.cover} alt="Cover" className="w-full h-full object-cover grayscale opacity-60 group-hover:opacity-40 transition-opacity" />
              ) : (
                <ImageIcon className="w-12 h-12 text-zinc-800" />
              )}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60">
                <div className="flex items-center gap-2 bg-black border-2 border-white px-4 py-2 text-white text-sm">
                  <Camera className="w-4 h-4" /> Change Cover
                </div>
              </div>
            </button>

            {/* Avatar Profile */}
            <div className="absolute -bottom-16 md:-bottom-20 left-6 md:left-10 flex items-end gap-4">
              <button
                type="button"
                onClick={() => handlePhotoUpload({ type: 'gallery', index: 0 })}
                disabled={isUploadingPhoto}
                className="relative group cursor-pointer disabled:cursor-wait"
                aria-label="Upload or change profile photo"
              >
                <div className="size-[clamp(7rem,16vw,10rem)] overflow-hidden border-4 border-black bg-zinc-950 flex items-center justify-center">
                  {profile.avatar ? (
                    <img src={profile.avatar} alt="Avatar" className="w-full h-full object-cover grayscale" />
                  ) : (
                    <Camera className="w-8 h-8 text-zinc-600 group-hover:scale-110 transition-transform" />
                  )}
                </div>
                <div className="absolute inset-0 bg-black/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border-4 border-transparent">
                  <Camera className="w-6 h-6 text-white" />
                </div>
              </button>
            </div>
          </div>

          <div className="px-4 md:px-10 space-y-10">
            
            {/* MEDIA GALLERY GRID */}
            <section>
              <h2 className="text-sm text-zinc-500 mb-4">{t('mediaGallery')}</h2>
              <div className="grid grid-cols-3 gap-3 md:gap-4">
                {profile.photos.map((photo, idx) => (
                  photo ? (
                    <div
                      key={idx}
                      className={`relative bg-black border-2 border-zinc-800 aspect-[3/4] ${idx === 0 ? 'col-span-2 row-span-2 aspect-auto' : ''}`}
                    >
                      <img src={photo} alt={`Gallery ${idx + 1}`} className="w-full h-full object-cover grayscale" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      key={idx}
                      onClick={() => handlePhotoUpload({ type: 'gallery', index: idx })}
                      disabled={isUploadingPhoto}
                      aria-label={`Add gallery photo ${idx + 1}`}
                      className={`relative bg-black border-2 border-dashed border-zinc-800 hover:border-zinc-500 cursor-pointer group aspect-[3/4] transition-colors disabled:cursor-wait ${idx === 0 ? 'col-span-2 row-span-2 aspect-auto' : ''}`}
                    >
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-600 hover:text-white hover:bg-zinc-900 transition-colors">
                        <Plus className="w-6 h-6 md:w-8 md:h-8 mb-2" />
                        <span className="text-sm hidden md:block">{t('addPhoto')}</span>
                      </div>
                    </button>
                  )
                ))}
              </div>
              <p className="text-xs text-zinc-500 mt-3">
                Choose an empty slot to add a gallery photo. Use your profile picture above to change the main photo. Maximum 10 MB per image.
              </p>
            </section>

            {/* BIO FORM */}
            <form onSubmit={handleSave} className="space-y-6">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="text-sm text-zinc-500 mb-2 flex items-center gap-2">
                    Display Name
                  </label>
                  <input 
                    type="text" 
                    value={profile.name}
                    onChange={(e) => setProfile({...profile, name: e.target.value})}
                    className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white transition-colors" 
                  />
                </div>
                <div>
                  <label className="text-sm text-zinc-500 mb-2 flex items-center gap-2">
                    Age
                  </label>
                  <input 
                    type="number" 
                    value={profile.age}
                    onChange={(e) => setProfile({...profile, age: Number(e.target.value)})}
                    className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white transition-colors" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="text-sm text-zinc-500 mb-2 flex items-center gap-2">
                    <Briefcase className="w-4 h-4" /> Job Title
                  </label>
                  <input 
                    type="text" 
                    value={profile.job}
                    onChange={(e) => setProfile({...profile, job: e.target.value})}
                    className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white transition-colors" 
                  />
                </div>
                <div>
                  <label className="text-sm text-zinc-500 mb-2 flex items-center gap-2">
                    <MapPin className="w-4 h-4" /> Location
                  </label>
                  <input 
                    type="text" 
                    value={profile.location}
                    onChange={(e) => setProfile({...profile, location: e.target.value})}
                    className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white transition-colors" 
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-zinc-500 mb-2 flex items-center gap-2">
                  <Heart className="w-4 h-4" /> Looking For
                </label>
                <select 
                  value={profile.intent}
                  onChange={(e) => setProfile({...profile, intent: e.target.value})}
                  className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white transition-colors appearance-none cursor-pointer"
                >
                  <option value="Dating">Dating & Relationships</option>
                  <option value="Casual">Casual Texting</option>
                  <option value="Friends">Friends & Networking</option>
                  <option value="Everyone">Everyone</option>
                </select>
              </div>

              <div>
                <label className="text-sm text-zinc-500 mb-2 flex items-center justify-between gap-2">
                  About Me
                  <span className="text-zinc-600">[{profile.bio.length} / 500]</span>
                </label>
                <textarea 
                  rows="4" 
                  value={profile.bio}
                  onChange={(e) => setProfile({...profile, bio: e.target.value})}
                  className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white resize-none transition-colors custom-scrollbar" 
                  placeholder="Write something..."
                  maxLength={500}
                ></textarea>
                <AIDraftAssistant
                  type="profile-bio"
                  draft={profile.bio}
                  interests={profile.tags}
                  disabled={isSaving}
                  onSelect={(bio) => setProfile((current) => ({ ...current, bio }))}
                />
              </div>

              <div>
                <label className="text-sm text-zinc-500 mb-3 block">
                  Interests & Tags
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_TAGS.map(tag => {
                    const isSelected = profile.tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`px-3 py-2 text-sm transition-colors border-2 rounded-none
                          ${isSelected 
                            ? 'bg-white border-white text-black' 
                            : 'bg-black border-zinc-800 text-zinc-500 hover:bg-zinc-900 hover:text-white'
                          }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-6 border-t-2 border-zinc-800">
                <button 
                  type="submit"
                  disabled={isSaving}
                  className="w-full py-4 bg-white hover:bg-zinc-200 text-black border-2 border-white text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:border-zinc-800 rounded-none"
                >
                  {isSaving ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> {t('savingChanges')}</>
                  ) : (
                    <><Save className="w-4 h-4" /> {t('saveProfile')}</>
                  )}
                </button>
              </div>

            </form>
          </div>
        </div>
      </div>

      {/* =====================================================================
          SETTINGS DRAWER 
          ===================================================================== */}
      {showSettings && (
        <>
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40" 
            onClick={() => setShowSettings(false)} 
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l-2 border-zinc-800 bg-black shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] animate-in slide-in-from-right-full duration-300 rounded-none md:w-[clamp(22rem,36vw,30rem)]">
            
            <div className="p-4 border-b-2 border-zinc-800 flex items-center justify-between bg-zinc-950 shrink-0">
              <h2 className="text-sm text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-zinc-500" /> Settings
              </h2>
              <button onClick={() => setShowSettings(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
              
              {/* VIP Status */}
              <div className="bg-black border-2 border-yellow-400 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm text-yellow-400 flex items-center gap-2">
                    Membership <Shield className="w-3.5 h-3.5" />
                  </h3>
                  <span className={`px-2 py-1 text-xs border-2 ${hasActiveSubscription ? 'bg-green-400 text-black border-green-400' : 'bg-black text-zinc-400 border-zinc-700'}`}>
                    {hasActiveSubscription ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                  Plan: {subscriptionPlan === 'NONE' ? 'No subscription' : subscriptionPlan}
                  {subscriptionStatus && ` · Status: ${subscriptionStatus.toLowerCase()}`}
                  {formattedSubscriptionExpiry && ` · Expires ${formattedSubscriptionExpiry}`}
                </p>
                <button
                  type="button"
                  onClick={() => { setShowSettings(false); navigate('/upgrade'); }}
                  className="w-full py-3 bg-black border-2 border-yellow-400 text-yellow-400 text-sm hover:bg-yellow-400 hover:text-black transition-colors"
                >
                  View Plans
                </button>
              </div>

              {/* Account Settings */}
              <section>
                <h3 className="text-sm text-zinc-500 mb-3">{t('account')}</h3>
                <div className="space-y-2">
                  <button onClick={() => { setShowSettings(false); navigate('/payment-methods'); }} className="w-full flex items-center justify-between p-4 bg-black border-2 border-zinc-800 hover:border-zinc-500 hover:bg-zinc-950 transition-colors group">
                    <div className="flex items-center gap-3 text-sm text-zinc-400 group-hover:text-white transition-colors">
                      <CreditCard className="w-4 h-4 text-zinc-600 group-hover:text-white" /> Payment Methods
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-600" />
                  </button>
                  <button className="w-full flex items-center justify-between p-4 bg-black border-2 border-zinc-800 hover:border-zinc-500 hover:bg-zinc-950 transition-colors group">
                    <div className="flex items-center gap-3 text-sm text-zinc-400 group-hover:text-white transition-colors">
                      <Bell className="w-4 h-4 text-zinc-600 group-hover:text-white" /> Push Notifications
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-600" />
                  </button>
                  <button className="w-full flex items-center justify-between p-4 bg-black border-2 border-zinc-800 hover:border-zinc-500 hover:bg-zinc-950 transition-colors group">
                    <div className="flex items-center gap-3 text-sm text-zinc-400 group-hover:text-white transition-colors">
                      <Shield className="w-4 h-4 text-zinc-600 group-hover:text-white" /> Privacy & Security
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-600" />
                  </button>
                </div>
              </section>

              {/* Danger Zone */}
              <section className="pt-4 border-t-2 border-zinc-800">
                <button className="w-full flex items-center justify-between p-4 bg-black border-2 border-red-900 hover:bg-red-950 hover:border-red-500 transition-colors group">
                  <div className="flex items-center gap-3 text-sm text-red-500">
                    <LogOut className="w-4 h-4" /> Log Out
                  </div>
                </button>
              </section>

            </div>
          </aside>
        </>
      )}

    </div>
  );
}