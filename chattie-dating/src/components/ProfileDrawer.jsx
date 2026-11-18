import React, { useState } from 'react';
import { 
  Sparkles, Heart, X, MapPin, Briefcase, 
  Star, ShieldAlert, MessageSquare, Info, 
  Music, Camera, Zap, Ban
} from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '../i18n';

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function ProfileDrawer({ selectedProfile, onClose }) {
  const { t } = useI18n();
  // --- STATE ---
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  // If no profile is selected, don't render the drawer
  if (!selectedProfile) return null;

  // --- MOCK DATA FALLBACKS ---
  // Ensuring the drawer always looks rich even if the parent passes a sparse object
  const profileDetails = {
    ...selectedProfile,
    bio: selectedProfile.bio || t('profileBioFallback'),
    intent: selectedProfile.intent || t('datingMeetups'),
    job: selectedProfile.job || 'Creative Director',
    zodiac: selectedProfile.zodiac || 'Scorpio',
    height: selectedProfile.height || '5\'8"',
    interests: selectedProfile.tags || selectedProfile.interests || ['Nightlife 🍸', 'Late Drives 🚗', 'Indie Rock 🎸', 'Sarcasm 💬', 'Coffee ☕'],
    photos: selectedProfile.photos || [selectedProfile.avatar],
    status: selectedProfile.status || 'online',
    matchPct: selectedProfile.matchPct || 92
  };

  // --- HANDLERS ---
  const handleAction = (action) => {
    if (action === 'wink') toast.success(t('winkSent', { name: profileDetails.name }));
    if (action === 'superlike') toast.success(t('superLikeSentTo', { name: profileDetails.name }));
    if (action === 'report') {
      toast(t('userReported'), { icon: '🛡️' });
      if (onClose) onClose();
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <>
      {/* 
        Mobile/Tablet Backdrop 
        (Hidden on xl screens if you prefer it to push content, but active here for a modal feel)
      */}
      <div 
        className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-40 xl:hidden transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Container */}
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-slate-800 bg-slate-900 shadow-2xl animate-in slide-in-from-right-full duration-300 ease-out md:w-[clamp(22rem,36vw,30rem)]">
        
        {/* =====================================================================
            HERO HEADER & PHOTO GALLERY
            ===================================================================== */}
        <div className="relative aspect-[4/3] max-h-[45dvh] shrink-0 bg-slate-950 group">
          <img 
            src={profileDetails.photos[activePhotoIdx]} 
            alt={profileDetails.name} 
            className="w-full h-full object-cover opacity-90 transition-all duration-500" 
          />
          
          {/* Gradients for text readability */}
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/60 via-transparent to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent" />
          
          {/* Close Button */}
          {onClose && (
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 bg-black/40 hover:bg-black/70 backdrop-blur-md rounded-full flex items-center justify-center text-white transition-colors z-10"
            >
              <X className="w-5 h-5" />
            </button>
          )}

          {/* Photo Navigation (If multiple photos) */}
          {profileDetails.photos.length > 1 && (
            <div className="absolute top-4 left-4 right-16 flex gap-1.5 z-10">
              {profileDetails.photos.map((_, idx) => (
                <div 
                  key={idx} 
                  onClick={() => setActivePhotoIdx(idx)}
                  className={`h-1 flex-1 rounded-full cursor-pointer transition-all ${idx === activePhotoIdx ? 'bg-white' : 'bg-white/30 hover:bg-white/50'}`}
                />
              ))}
            </div>
          )}

          {/* User Identify Header */}
          <div className="absolute bottom-4 left-6 right-6">
            <div className="flex items-end justify-between gap-4">
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-3xl font-black text-white drop-shadow-lg truncate">
                    {profileDetails.name}
                  </h2>
                  <span className="text-2xl font-medium text-slate-300 drop-shadow-md">
                    {profileDetails.age}
                  </span>
                  {profileDetails.status === 'online' && (
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-slate-900 shadow-sm shrink-0 mt-1" />
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 drop-shadow-md">
                  <MapPin className="w-3.5 h-3.5 text-rose-400" /> 
                  <span className="truncate">{profileDetails.location || t('unknownLocation')}</span>
                </div>
              </div>

              {/* Match Badge */}
              <div className="shrink-0 flex flex-col items-center justify-center px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/30 backdrop-blur-md rounded-xl shadow-lg">
                <Star className="w-4 h-4 text-emerald-400 fill-emerald-400 mb-0.5" />
                <span className="text-[10px] font-bold text-emerald-300 tracking-wider">
                  {profileDetails.matchPct}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* =====================================================================
            SCROLLABLE DETAILS
            ===================================================================== */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8 pb-32">
          
          {/* Intent Highlight */}
          <div className="p-4 bg-gradient-to-r from-rose-500/10 to-violet-500/5 border border-rose-500/20 rounded-2xl flex items-start gap-3">
            <div className="p-2 bg-rose-500/20 rounded-xl shrink-0">
              <Sparkles className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider mb-1">{t('datingIntent')}</h4>
              <p className="text-sm text-slate-300 font-medium leading-relaxed">
                {profileDetails.intent}
              </p>
            </div>
          </div>

          {/* About Me */}
          <section>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Info className="w-4 h-4" /> {t('aboutProfile', { name: profileDetails.name })}
            </h3>
            <p className="text-sm text-slate-200 leading-relaxed bg-slate-950/50 p-4 rounded-2xl border border-slate-800/80">
              {profileDetails.bio}
            </p>
          </section>

          {/* The Basics Grid */}
          <section>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Briefcase className="w-4 h-4" /> {t('basics')}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-800/40 border border-slate-700/50 p-3 rounded-xl">
                <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">{t('profession')}</span>
                <span className="text-sm font-semibold text-slate-200 truncate block">{profileDetails.job}</span>
              </div>
              <div className="bg-slate-800/40 border border-slate-700/50 p-3 rounded-xl">
                <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">{t('height')}</span>
                <span className="text-sm font-semibold text-slate-200 truncate block">{profileDetails.height}</span>
              </div>
              <div className="bg-slate-800/40 border border-slate-700/50 p-3 rounded-xl col-span-2">
                <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">{t('zodiacSign')}</span>
                <span className="text-sm font-semibold text-slate-200 truncate block">{profileDetails.zodiac}</span>
              </div>
            </div>
          </section>

          {/* Interests & Tags */}
          <section>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Music className="w-4 h-4" /> {t('interests')}
            </h3>
            <div className="flex flex-wrap gap-2">
              {profileDetails.interests.map((interest, idx) => (
                <span 
                  key={idx} 
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-medium text-slate-300 shadow-sm"
                >
                  {interest}
                </span>
              ))}
            </div>
          </section>

          {/* Trust & Safety Zone */}
          <section className="pt-6 border-t border-slate-800/60 space-y-3">
            <button 
              onClick={() => handleAction('report')}
              className="w-full py-3 px-4 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white text-sm font-bold rounded-xl transition-all flex items-center justify-between group"
            >
              <span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-slate-500 group-hover:text-amber-500 transition-colors" /> {t('reportProfile')}</span>
            </button>
            <button 
              onClick={() => handleAction('report')}
              className="w-full py-3 px-4 bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 text-red-500 text-sm font-bold rounded-xl transition-all flex items-center justify-between"
            >
              <span className="flex items-center gap-2"><Ban className="w-4 h-4" /> {t('blockUser')}</span>
            </button>
          </section>

        </div>

        {/* =====================================================================
            STICKY ACTION FOOTER
            ===================================================================== */}
        <div className="absolute bottom-0 inset-x-0 p-4 md:p-6 bg-slate-900/90 backdrop-blur-xl border-t border-slate-800 shadow-[0_-10px_40px_rgba(0,0,0,0.3)] z-20">
          <div className="flex gap-3">
            <button 
              onClick={() => handleAction('superlike')}
              className="w-14 h-14 shrink-0 bg-slate-800 border border-amber-500/30 hover:border-amber-500 hover:bg-amber-500/10 rounded-2xl flex items-center justify-center transition-all group shadow-lg"
              title={t('superLike')}
            >
              <Zap className="w-6 h-6 text-amber-500 group-hover:scale-110 transition-transform" />
            </button>
            
            <button 
              onClick={() => handleAction('wink')}
              className="flex-1 bg-gradient-to-r from-rose-500 to-violet-600 hover:opacity-90 text-white font-bold rounded-2xl flex items-center justify-center gap-2 transition-all shadow-xl shadow-rose-500/20 hover:scale-[1.02]"
            >
              <Heart className="w-5 h-5 fill-white/20" /> {t('sendWink')}
            </button>
          </div>
        </div>

      </aside>
    </>
  );
}