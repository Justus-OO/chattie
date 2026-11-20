import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Heart, Lock, Sparkles, Star, MapPin, 
  X, Filter, ChevronDown, CheckCircle2, MessageCircle, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { discoveryService } from '../../api/discovery.service';
import './discovery.css';
import { useI18n } from '../../i18n';

export default function Likes() {
  const navigate = useNavigate();
  const { t } = useI18n();
  // --- CORE STATE ---
  const [isPremium, setIsPremium] = useState(false);
  const [likes, setLikes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all', 'new', 'nearby'
  
  // --- UI STATE ---
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // --- FETCH SECRET ADMIRERS FROM BACKEND ---
  const fetchAdmirers = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const data = await discoveryService.getSecretAdmirers();
      // data returns { is_premium: boolean, admirers: [...] }
      setIsPremium(data.is_premium === true);
      setLikes(Array.isArray(data.admirers) ? data.admirers : []);
    } catch (error) {
      setLoadError(true);
      toast.error(error.message || t('failedLoadAdmirers'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchAdmirers();
  }, [fetchAdmirers]);

  // ============================================================================
  // FILTERING LOGIC
  // ============================================================================
  const filteredLikes = (filter === 'new'
    ? [...likes].sort((a, b) => Number(Boolean(b.is_new)) - Number(Boolean(a.is_new)))
    : likes
  ).filter(user => filter !== 'nearby' || user.distance <= 2.0);

  // ============================================================================
  // HANDLERS
  // ============================================================================
  const handleProfileClick = async (user) => {
    if (!isPremium) {
      setShowUpgradeModal(true);
    } else {
      // Optimistically open modal with summary data
      setSelectedProfile(user);
      setIsLoadingProfile(true);

      try {
        // Fetch full profile to get all images, bio, tags, and trigger backend view tracker
        const fullData = await discoveryService.getFullProfile(user.id);
        setSelectedProfile(fullData);
      } catch (err) {
        console.error("Failed to load full profile data", err);
        toast.error(err.message || t('profileLoadFailed'));
      } finally {
        setIsLoadingProfile(false);
      }
    }
  };

  const handleMatch = async (user) => {
    try {
      const response = await discoveryService.sendInteraction(user.id, 'LIKE');
      setLikes(prev => prev.filter(u => u.id !== user.id));
      setSelectedProfile(null);
      if (response.is_match) {
        toast.success(t('matchedWith', { name: user.display_name }));
        navigate(`/messages/${user.id}`);
      } else {
        toast.success(t('likeSent', { name: user.display_name }));
      }
    } catch (error) {
      handleInteractionError(error, user, t('failedMatch'));
    }
  };

  const handlePass = async (user) => {
    try {
      await discoveryService.sendInteraction(user.id, 'PASS');
      setLikes(prev => prev.filter(u => u.id !== user.id));
      setSelectedProfile(null);
    } catch (error) {
      handleInteractionError(error, user, t('failedPass'));
    }
  };

  const handleInteractionError = (error, user, fallbackMessage) => {
    if (error.status === 402 || error.code === 'UPGRADE_REQUIRED') {
      navigate('/upgrade');
      return;
    }
    if (error.code === 'ALREADY_INTERACTED' || error.code === 'USER_UNAVAILABLE') {
      setLikes(prev => prev.filter(profile => profile.id !== user.id));
      setSelectedProfile(null);
      toast.info(t('profileNoLongerAvailable'));
      return;
    }
    toast.error(error.message || fallbackMessage);
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="discovery-shell flex h-full min-h-0 min-w-0 flex-1 flex-col w-full relative overflow-hidden font-mono text-zinc-300 rounded-none">
      
      {/* =====================================================================
          HEADER
          ===================================================================== */}
      <header className="discovery-header shrink-0 border-b-2 p-2 sm:p-3 lg:p-4 z-10 sticky top-0 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-zinc-100 border-2 border-zinc-100">
            <Heart className="w-5 h-5 text-black fill-black" />
          </div>
          <div>
            <p className="discovery-kicker mb-1">{t('incomingEnergy')}</p>
            <h1 className="discovery-title font-bold flex items-center gap-2">
              {t('secretAdmirers')}
            </h1>
            <p className="discovery-subtitle">
              {t('swipedRight', { count: likes.length })}
            </p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 w-full md:w-auto mt-2 md:mt-0">
          {/* Filter Dropdown */}
          {isPremium && (
            <div className="relative w-full md:w-auto">
            <button 
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className="w-full md:w-auto px-4 py-2.5 bg-black border-2 border-zinc-800 rounded-none text-[10px] font-bold uppercase tracking-widest text-zinc-300 hover:bg-zinc-900 transition-colors flex items-center justify-between md:justify-center gap-4"
            >
              <span className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5" />
                  {filter === 'all' ? t('allLikes') : filter === 'new' ? t('newFirst') : t('nearby')}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFilterDropdown ? 'rotate-180' : ''}`} />
            </button>
            
            {showFilterDropdown && (
              <div className="absolute right-0 top-full z-20 mt-2 w-full overflow-hidden border-2 border-zinc-600 bg-black shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] animate-in fade-in duration-200 md:w-[clamp(12rem,24vw,16rem)]">
                {[
                  { id: 'all', label: t('allLikes') },
                  { id: 'new', label: t('newFirst') },
                  { id: 'nearby', label: t('nearby') }
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => { setFilter(f.id); setShowFilterDropdown(false); }}
                    className={`w-full text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center justify-between border-b-2 border-zinc-800 last:border-b-0
                      ${filter === f.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900'}
                    `}
                  >
                    {f.label}
                    {filter === f.id && <CheckCircle2 className="w-3.5 h-3.5" />}
                  </button>
                ))}
                </div>
              )}
            </div>
          )}

          {/* Premium Status Button */}
          {!isPremium && (
            <button 
              onClick={() => setShowUpgradeModal(true)}
              className="hidden md:flex items-center justify-center gap-2 px-6 py-2.5 bg-white border-2 border-white text-black font-bold uppercase tracking-widest text-[10px] hover:bg-zinc-200 transition-colors"
            >
              <Sparkles className="w-4 h-4" /> {t('seeWhoLikes')}
            </button>
          )}
        </div>
      </header>

      {/* =====================================================================
          GRID CONTENT
          ===================================================================== */}
      <div className="discovery-content min-h-0 flex-1 overflow-y-auto p-2 sm:p-3 lg:p-4 custom-scrollbar relative">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-zinc-500 text-xs uppercase tracking-widest animate-pulse flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> {t('loadingAdmirers')}
            </p>
          </div>
        ) : loadError ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto space-y-4 border-2 border-dashed border-zinc-800 p-8">
            <h2 className="text-sm font-bold text-white uppercase tracking-widest">{t('failedLoadAdmirers')}</h2>
            <button
              onClick={fetchAdmirers}
              className="px-6 py-3 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors"
            >
              {t('refresh')}
            </button>
          </div>
        ) : filteredLikes.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto space-y-4 border-2 border-dashed border-zinc-800 p-8">
            <div className="w-16 h-16 bg-zinc-950 flex items-center justify-center border-2 border-zinc-800 mb-2">
              <Heart className="w-6 h-6 text-zinc-600" />
            </div>
            <h2 className="text-sm font-bold text-white uppercase tracking-widest">{t('noLikes')}</h2>
            <p className="text-zinc-500 text-[10px] uppercase tracking-widest leading-relaxed">
              {t('adjustFilters')}
            </p>
            <button 
              onClick={() => setFilter('all')}
              className="px-6 py-3 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors mt-4"
            >
              {t('clearFilters')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {filteredLikes.map((user, index) => (
              <div 
                key={user.id || `hidden-${index}`}
                onClick={() => handleProfileClick(user)}
                className="discovery-card relative cursor-pointer group transition-colors p-3 flex flex-col"
              >
                {/* Profile Image Container */}
                <div className="discovery-card-image aspect-[3/4] relative border-2 mb-3 overflow-hidden">
                  {user.images?.[0] ? (
                    <img
                      src={user.images[0]}
                      alt={isPremium ? user.display_name : t('hiddenIdentity')}
                      className="w-full h-full object-cover transition-all duration-500 grayscale group-hover:scale-105 opacity-100"
                    />
                  ) : (
                    <div className="w-full h-full bg-zinc-950" aria-hidden="true" />
                  )}
                  
                  {/* Locked State Overlay */}
                  {!isPremium && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 group-hover:bg-black/60 transition-colors">
                      <div className="w-12 h-12 bg-black border-2 border-white flex items-center justify-center transition-transform group-hover:scale-110">
                        <Lock className="w-5 h-5 text-white" />
                      </div>
                    </div>
                  )}

                  {/* New Badge */}
                  {user.is_new && (
                    <div className="absolute top-2 left-2 bg-white text-black text-[9px] font-bold uppercase tracking-widest px-2 py-1 border-2 border-black z-10">
                      NEW
                    </div>
                  )}

                  {/* Premium Match Badge */}
                  {isPremium && (
                    <div className="absolute top-2 right-2 bg-black border-2 border-zinc-800 px-2 py-1 flex items-center gap-1.5 z-10">
                      <Star className="w-3 h-3 text-white" />
                      <span className="text-[10px] font-bold text-white tracking-widest">{user.match_pct}%</span>
                    </div>
                  )}
                </div>

                {/* Info block */}
                {isPremium ? (
                  <div className="flex-1 flex flex-col">
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest truncate mb-1">
                      {user.display_name}, {user.age}
                    </h3>
                    <p className="text-[9px] text-zinc-500 uppercase tracking-widest flex items-center gap-1.5 font-bold truncate">
                      <MapPin className="w-3 h-3 text-zinc-400 shrink-0" /> {user.city} ({user.distance} KM)
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center border-t-2 border-dashed border-zinc-800 pt-2">
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{t('hiddenIdentity')}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating Mobile Upgrade Button */}
      {!isPremium && (
        <div className="md:hidden absolute bottom-6 inset-x-4 z-20">
          <button 
            onClick={() => setShowUpgradeModal(true)}
            className="w-full py-4 bg-white text-black border-2 border-white font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)]"
          >
            <Sparkles className="w-4 h-4" /> {t('seeWhoLikes')}
          </button>
        </div>
      )}

      {/* ============================================================================
          UPGRADE / PAYWALL MODAL
          ============================================================================ */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm cursor-pointer" onClick={() => setShowUpgradeModal(false)} />
          
          <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] flex flex-col animate-in zoom-in-95 duration-200 rounded-none">
            
            <div className="p-4 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center shrink-0">
              <h2 className="font-bold text-sm uppercase tracking-widest text-white flex items-center gap-2">
                <Star className="w-4 h-4 text-zinc-400" /> UPGRADE ACCOUNT
              </h2>
              <button onClick={() => setShowUpgradeModal(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 md:p-8 text-center bg-black">
              <h2 className="text-xl font-bold text-white uppercase tracking-widest mb-3">CHATTIE VIP</h2>
              <p className="text-zinc-500 text-[10px] uppercase tracking-widest leading-relaxed mb-6">
                STOP GUESSING. SEE EXACTLY WHO LIKES YOU, MATCH INSTANTLY, AND UNLOCK UNLIMITED ACCESS.
              </p>

              <div className="space-y-4 mb-8 text-left border-2 border-zinc-800 p-4 bg-zinc-950">
                {['SEE ALL ADMIRERS IN ONE PLACE', 'MATCH AND MESSAGE INSTANTLY', 'UNLIMITED SWIPES & REWINDS'].map((feature, i) => (
                  <div key={i} className="flex items-start gap-3 text-[10px] font-bold text-zinc-300 uppercase tracking-widest">
                    <CheckCircle2 className="w-4 h-4 text-white shrink-0" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>

              {/* Pricing Cards */}
              <button
                onClick={() => navigate('/upgrade')}
                className="w-full py-4 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors"
              >
                {t('upgradeUnlock')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================
          EXPANDED PROFILE MODAL (Only available when unlocked)
          ============================================================================ */}
      {selectedProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 lg:p-16">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm cursor-pointer" onClick={() => setSelectedProfile(null)} />
          
          <div className="relative z-10 w-full h-full sm:h-auto max-h-full max-w-5xl bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] flex flex-col md:flex-row overflow-hidden animate-in zoom-in-95 duration-200 rounded-none">
            
            {/* Mobile Close Button */}
            <button 
              onClick={() => setSelectedProfile(null)}
              className="md:hidden absolute top-4 right-4 z-20 p-2 bg-black border-2 border-zinc-800 flex items-center justify-center text-white"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Profile Image Area (Now Supports Gallery Layout) */}
            <div className="relative flex h-[40dvh] w-full flex-col overflow-y-auto border-b-2 border-zinc-800 bg-zinc-950 custom-scrollbar md:h-[70dvh] md:w-1/2 md:border-b-0 md:border-r-2">
              {(selectedProfile.images && selectedProfile.images.length > 0) ? (
                selectedProfile.images.map((img, idx) => (
                  <img 
                    key={idx}
                    src={img} 
                    alt={`${selectedProfile.display_name} - ${idx + 1}`} 
                    className="min-h-[40dvh] w-full border-b-2 border-zinc-800 object-cover grayscale last:border-b-0 md:min-h-[70dvh]"
                  />
                ))
              ) : (
                <img 
                  src="https://images.unsplash.com/photo-1500000000000?auto=format&fit=crop&w=400&q=80" 
                  alt="placeholder" 
                  className="w-full h-full object-cover grayscale"
                />
              )}
              
              <div className="absolute top-4 left-4 bg-black border-2 border-zinc-800 px-3 py-1.5 flex items-center gap-2 z-10">
                <Star className="w-4 h-4 text-white" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-white">{selectedProfile.match_pct}% MATCH</span>
              </div>
            </div>

            {/* Profile Data Area */}
            <div className="flex-1 flex flex-col p-6 md:p-8 overflow-y-auto custom-scrollbar bg-black relative">
              
              {/* Desktop Close */}
              <button 
                onClick={() => setSelectedProfile(null)}
                className="hidden md:flex self-end items-center gap-2 p-2 bg-black border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors mb-2"
              >
                CLOSE <X className="w-4 h-4" />
              </button>

              <div className="mb-6 border-b-2 border-zinc-800 pb-6">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-3xl md:text-4xl font-bold text-white uppercase tracking-widest">{selectedProfile.display_name}</h2>
                  <span className="text-2xl md:text-3xl text-zinc-500 font-light">{selectedProfile.age}</span>
                  {/* Loading Spinner for high-res fetch */}
                  {isLoadingProfile && <Loader2 className="w-5 h-5 animate-spin text-zinc-500 ml-2" />}
                </div>
                
                <p className="text-zinc-400 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
                  <MapPin className="w-3.5 h-3.5 text-zinc-500" /> {selectedProfile.city} ({selectedProfile.distance} KM AWAY)
                </p>
              </div>

              <div className="space-y-6 mb-8 flex-1">
                {/* Tags block */}
                {selectedProfile.tags && selectedProfile.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedProfile.tags.map(tag => (
                      <span key={tag} className="px-2 py-1 bg-zinc-950 border-2 border-zinc-800 text-zinc-400 text-[9px] font-bold uppercase tracking-widest">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                <section>
                  <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-3">{t('aboutMe')}</h3>
                  <p className="text-zinc-300 text-[10px] md:text-xs leading-relaxed uppercase tracking-widest bg-zinc-950 p-4 border-2 border-zinc-800">
                    {selectedProfile.bio || "No bio provided."}
                  </p>
                </section>
              </div>

              {/* Action Buttons */}
              <div className="mt-auto grid grid-cols-2 gap-4 pt-6 border-t-2 border-zinc-800">
                <button 
                  onClick={() => handlePass(selectedProfile)}
                  className="py-4 bg-black border-2 border-zinc-700 text-zinc-300 text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-900 transition-colors"
                >
                  PASS
                </button>
                <button 
                  onClick={() => handleMatch(selectedProfile)}
                  className="py-4 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-4 h-4" /> MATCH NOW
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}