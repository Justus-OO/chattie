import React, { useState, useEffect } from 'react';
import { 
  Heart, Lock, Sparkles, Star, MapPin, 
  X, Filter, ChevronDown, CheckCircle2, MessageCircle, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { discoveryService } from '../../api/discovery.service';

export default function Likes() {
  // --- CORE STATE ---
  const [isPremium, setIsPremium] = useState(false);
  const [likes, setLikes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'new', 'nearby'
  
  // --- UI STATE ---
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // --- FETCH SECRET ADMIRERS FROM BACKEND ---
  useEffect(() => {
    fetchAdmirers();
  }, []);

  const fetchAdmirers = async () => {
    try {
      setLoading(true);
      const data = await discoveryService.getSecretAdmirers();
      // data returns { is_premium: boolean, admirers: [...] }
      setIsPremium(data.is_premium);
      setLikes(data.admirers || []);
    } catch (error) {
      toast.error(error.message || 'Failed to load secret admirers');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // FILTERING LOGIC
  // ============================================================================
  const filteredLikes = likes.filter(user => {
    if (filter === 'new') return user.isNew;
    if (filter === 'nearby') return user.distance <= 2.0; // Less than 2km away
    return true;
  });

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
      } finally {
        setIsLoadingProfile(false);
      }
    }
  };

  const handleMatch = async (user) => {
    try {
      // Send a LIKE interaction to form an instant match
      await discoveryService.sendInteraction(user.id, 'LIKE');
      setLikes(prev => prev.filter(u => u.id !== user.id));
      setSelectedProfile(null);
      toast.success(`MATCHED WITH ${user.display_name.toUpperCase()}`);
    } catch (error) {
      toast.error(error.message || 'Failed to match');
    }
  };

  const handlePass = async (user) => {
    try {
      await discoveryService.sendInteraction(user.id, 'PASS');
      setLikes(prev => prev.filter(u => u.id !== user.id));
      setSelectedProfile(null);
    } catch (error) {
      toast.error(error.message || 'Failed to pass');
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="flex-1 flex flex-col bg-black w-full h-full relative overflow-hidden font-mono text-zinc-300 rounded-none">
      
      {/* =====================================================================
          HEADER
          ===================================================================== */}
      <header className="p-4 md:p-6 border-b-2 border-zinc-800 bg-zinc-950 shrink-0 z-10 sticky top-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-zinc-100 border-2 border-zinc-100">
            <Heart className="w-5 h-5 text-black fill-black" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2 uppercase tracking-widest leading-none mb-1">
              Secret Admirers
            </h1>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
              {likes.length} PEOPLE HAVE SWIPED RIGHT ON YOU.
            </p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 w-full md:w-auto mt-2 md:mt-0">
          {/* Filter Dropdown */}
          <div className="relative w-full md:w-auto">
            <button 
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className="w-full md:w-auto px-4 py-2.5 bg-black border-2 border-zinc-800 rounded-none text-[10px] font-bold uppercase tracking-widest text-zinc-300 hover:bg-zinc-900 transition-colors flex items-center justify-between md:justify-center gap-4"
            >
              <span className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5" />
                {filter === 'all' ? 'ALL LIKES' : filter === 'new' ? 'NEW FIRST' : 'NEARBY'}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFilterDropdown ? 'rotate-180' : ''}`} />
            </button>
            
            {showFilterDropdown && (
              <div className="absolute top-full right-0 mt-2 w-full md:w-48 bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] overflow-hidden z-20 animate-in fade-in duration-200">
                {[
                  { id: 'all', label: 'ALL LIKES' },
                  { id: 'new', label: 'NEW FIRST' },
                  { id: 'nearby', label: 'NEARBY' }
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

          {/* Premium Status Button */}
          {!isPremium && (
            <button 
              onClick={() => setShowUpgradeModal(true)}
              className="hidden md:flex items-center justify-center gap-2 px-6 py-2.5 bg-white border-2 border-white text-black font-bold uppercase tracking-widest text-[10px] hover:bg-zinc-200 transition-colors"
            >
              <Sparkles className="w-4 h-4" /> SEE WHO LIKES YOU
            </button>
          )}
        </div>
      </header>

      {/* =====================================================================
          GRID CONTENT
          ===================================================================== */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar bg-black relative">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-zinc-500 text-xs uppercase tracking-widest animate-pulse flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> LOADING ADMIRERS...
            </p>
          </div>
        ) : filteredLikes.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto space-y-4 border-2 border-dashed border-zinc-800 p-8">
            <div className="w-16 h-16 bg-zinc-950 flex items-center justify-center border-2 border-zinc-800 mb-2">
              <Heart className="w-6 h-6 text-zinc-600" />
            </div>
            <h2 className="text-sm font-bold text-white uppercase tracking-widest">NO LIKES FOUND</h2>
            <p className="text-zinc-500 text-[10px] uppercase tracking-widest leading-relaxed">
              We couldn't find any admirers matching this filter. Try adjusting your settings.
            </p>
            <button 
              onClick={() => setFilter('all')}
              className="px-6 py-3 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors mt-4"
            >
              CLEAR FILTERS
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {filteredLikes.map((user) => (
              <div 
                key={user.id}
                onClick={() => handleProfileClick(user)}
                className="relative bg-black border-2 border-zinc-800 cursor-pointer group hover:border-zinc-500 transition-colors p-3 flex flex-col"
              >
                {/* Profile Image Container */}
                <div className="aspect-[3/4] relative border-2 border-zinc-800 mb-3 overflow-hidden bg-zinc-950">
                  <img 
                    src={user.images?.[0] || 'https://images.unsplash.com/photo-1500000000000?auto=format&fit=crop&w=400&q=80'} 
                    alt="Secret Admirer" 
                    className={`w-full h-full object-cover transition-all duration-500 grayscale
                      ${!isPremium ? 'blur-md opacity-30' : 'group-hover:scale-105 opacity-100'}
                    `} 
                  />
                  
                  {/* Locked State Overlay */}
                  {!isPremium && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 group-hover:bg-black/60 transition-colors">
                      <div className="w-12 h-12 bg-black border-2 border-white flex items-center justify-center transition-transform group-hover:scale-110">
                        <Lock className="w-5 h-5 text-white" />
                      </div>
                    </div>
                  )}

                  {/* New Badge */}
                  {user.isNew && (
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
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">HIDDEN IDENTITY</p>
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
            className="w-full py-4 bg-white text-black border-2 border-white font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 shadow-[8px_8px_0px_rgba(255,255,255,0.1)]"
          >
            <Sparkles className="w-4 h-4" /> REVEAL ALL MATCHES
          </button>
        </div>
      )}

      {/* ============================================================================
          UPGRADE / PAYWALL MODAL
          ============================================================================ */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm cursor-pointer" onClick={() => setShowUpgradeModal(false)} />
          
          <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] flex flex-col animate-in zoom-in-95 duration-200 rounded-none">
            
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
              <div className="grid grid-cols-2 gap-3 mb-6">
                <button 
                  onClick={() => { setIsPremium(true); setShowUpgradeModal(false); fetchAdmirers(); }}
                  className="p-4 bg-black border-2 border-zinc-800 hover:border-zinc-500 hover:bg-zinc-950 flex flex-col items-center transition-colors text-left"
                >
                  <span className="text-zinc-500 text-[9px] font-bold uppercase tracking-widest mb-2">1 MONTH</span>
                  <span className="text-xl font-bold text-white">$14.99</span>
                  <span className="text-zinc-600 text-[9px] font-bold uppercase mt-1">/MO</span>
                </button>
                
                <button 
                  onClick={() => { setIsPremium(true); setShowUpgradeModal(false); fetchAdmirers(); }}
                  className="p-4 bg-zinc-900 border-2 border-white flex flex-col items-center relative text-left hover:bg-zinc-800 transition-colors"
                >
                  <div className="absolute -top-3 inset-x-0 mx-auto w-max px-2 py-0.5 bg-white text-black border-2 border-black text-[9px] font-bold uppercase">
                    POPULAR
                  </div>
                  <span className="text-white text-[9px] font-bold uppercase tracking-widest mb-2 mt-1">6 MONTHS</span>
                  <span className="text-xl font-bold text-white">$8.99</span>
                  <span className="text-zinc-400 text-[9px] font-bold uppercase mt-1">/MO</span>
                </button>
              </div>

              <p className="text-[9px] text-zinc-600 uppercase tracking-widest font-bold">
                BY TAPPING CONTINUE, YOUR ACCOUNT WILL BE CHARGED. CANCEL ANYTIME IN SETTINGS.
              </p>
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
          
          <div className="relative z-10 w-full h-full sm:h-auto max-h-full max-w-5xl bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] flex flex-col md:flex-row overflow-hidden animate-in zoom-in-95 duration-200 rounded-none">
            
            {/* Mobile Close Button */}
            <button 
              onClick={() => setSelectedProfile(null)}
              className="md:hidden absolute top-4 right-4 z-20 p-2 bg-black border-2 border-zinc-800 flex items-center justify-center text-white"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Profile Image Area (Now Supports Gallery Layout) */}
            <div className="w-full md:w-1/2 h-[40vh] md:h-[70vh] relative bg-zinc-950 border-b-2 md:border-b-0 md:border-r-2 border-zinc-800 overflow-y-auto custom-scrollbar flex flex-col">
              {(selectedProfile.images && selectedProfile.images.length > 0) ? (
                selectedProfile.images.map((img, idx) => (
                  <img 
                    key={idx}
                    src={img} 
                    alt={`${selectedProfile.display_name} - ${idx + 1}`} 
                    className="w-full min-h-[40vh] md:min-h-[70vh] object-cover grayscale border-b-2 border-zinc-800 last:border-b-0"
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
                  <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-3">ABOUT ME</h3>
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