import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Heart, X, Star, MapPin, RotateCcw, Info, 
  Flag, MessageCircle, ShieldAlert, ChevronDown, Flame, Loader2, Ban, Sliders, BadgeCheck
} from 'lucide-react';
import { toast } from 'sonner';

// Services
import { discoveryService } from '../../api/discovery.service';
import './discovery.css';
import { useI18n } from '../../i18n';

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function SwipeDeck() {
  const navigate = useNavigate();
  const { t } = useI18n();

  // --- CORE STATE ---
  const [deck, setDeck] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [photoIndex, setPhotoIndex] = useState(0);
  
  // --- UI TOGGLES ---
  const [showProfile, setShowProfile] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [matchModal, setMatchModal] = useState({ show: false, user: null });
  const [reportModal, setReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('INAPPROPRIATE CONTENT');

  // --- PHYSICS & DRAG STATE ---
  const [drag, setDrag] = useState({ startX: 0, currentX: 0, startY: 0, currentY: 0, isDragging: false });
  const cardRef = useRef(null);
  const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1000;
  const swipeThreshold = windowWidth * 0.25;

  const activeUser = deck[0];

  // --- FETCH SWIPE DECK ON MOUNT ---
  useEffect(() => {
    fetchDeck();
  }, []);

  const fetchDeck = async () => {
    try {
      setLoading(true);
      const profiles = await discoveryService.getSwipeDeck(20, 0);
      setDeck(profiles || []);
    } catch (error) {
      toast.error(error.message || t('failedLoadDeck'));
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // GESTURE & PHYSICS CALCULATIONS
  // ============================================================================
  const onPointerDown = (e) => {
    if (showProfile || matchModal.show || reportModal) return;
    if (e.target.setPointerCapture) {
      try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
    }
    setDrag({
      startX: e.clientX,
      currentX: e.clientX,
      startY: e.clientY,
      currentY: e.clientY,
      isDragging: true
    });
  };

  const onPointerMove = (e) => {
    if (!drag.isDragging) return;
    setDrag(prev => ({
      ...prev,
      currentX: e.clientX,
      currentY: e.clientY
    }));
  };

  const onPointerUp = () => {
    if (!drag.isDragging) return;
    const deltaX = drag.currentX - drag.startX;

    if (deltaX > swipeThreshold) {
      handleAction('right');
    } else if (deltaX < -swipeThreshold) {
      handleAction('left');
    } else {
      setDrag({ startX: 0, currentX: 0, startY: 0, currentY: 0, isDragging: false });
    }
  };

  const deltaX = drag.isDragging ? drag.currentX - drag.startX : 0;
  const deltaY = drag.isDragging ? drag.currentY - drag.startY : 0;
  const rotation = deltaX * 0.05; 
  
  const cardStyle = {
    transform: drag.isDragging 
      ? `translate3d(${deltaX}px, ${deltaY}px, 0) rotate(${rotation}deg)` 
      : 'translate3d(0, 0, 0) rotate(0deg)',
    transition: drag.isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
  };

  const likeOpacity = Math.min(Math.max(deltaX / (swipeThreshold * 0.8), 0), 1);
  const nopeOpacity = Math.min(Math.max(-deltaX / (swipeThreshold * 0.8), 0), 1);

  // ============================================================================
  // ACTION HANDLERS
  // ============================================================================
  const handleAction = useCallback(async (direction) => {
    if (!activeUser) return;

    const targetUser = activeUser;
    setDrag({ startX: 0, currentX: 0, startY: 0, currentY: 0, isDragging: false });
    setShowProfile(false);
    setPhotoIndex(0);

    // Map frontend action to backend API payload
    let actionType = 'PASS';
    if (direction === 'right') actionType = 'LIKE';
    if (direction === 'super') actionType = 'SUPER_LIKE';
    if (direction === 'flirt') actionType = 'FLIRT';

    // Optimistically update deck & history
    setHistory(prev => [...prev, targetUser]);
    setDeck(prev => prev.slice(1));

    try {
      const response = await discoveryService.sendInteraction(targetUser.id, actionType);
      
      // If a match occurred
      if (response.is_match) {
        setMatchModal({ show: true, user: targetUser });
      }
    } catch (error) {
      // Handle Daily Limits or Upgrades
      if (error.response?.status === 402 || error.response?.data?.error === 'UPGRADE_REQUIRED') {
        toast.error(t('dailyLimit'));
        navigate('/upgrade');
      } else {
        toast.error(error.message || t('interactionFailed'));
      }
    }
  }, [activeUser, navigate]);

  const handleUndo = useCallback(async () => {
    try {
      await discoveryService.undoLastAction();
      if (history.length === 0) return;
      const lastUser = history[history.length - 1];
      setHistory(prev => prev.slice(0, -1));
      setDeck(prev => [lastUser, ...prev]);
      setShowProfile(false);
      setPhotoIndex(0);
      toast.success(t('actionUndone'));
    } catch (error) {
      if (error.response?.status === 403 || error.response?.data?.error === 'UPGRADE_REQUIRED') {
        toast.error(t('rewindRequired'));
        navigate('/upgrade');
      } else {
        toast.error(error.message || t('nothingToUndo'));
      }
    }
  }, [history, navigate]);

  const handleReportSubmit = async () => {
    if (!activeUser) return;
    try {
      await discoveryService.reportUser(activeUser.id, reportReason);
      setReportModal(false);
      toast.success(t('reportBlocked'));
      handleAction('left'); // Remove from deck
    } catch (error) {
      toast.error(error.message || t('reportFailed'));
    }
  };

  const handleBlock = async () => {
    if (!activeUser) return;
    try {
      await discoveryService.blockUser(activeUser.id);
      toast.success(t('permanentlyBlocked'));
      handleAction('left'); // Remove from deck
    } catch (error) {
      toast.error(error.message || t('blockFailed'));
    }
  };

  // PROFILE DRAWER HANDLER (Triggers Backend View Tracking)
  const toggleProfile = async (e) => {
    if (e) e.stopPropagation();
    
    if (showProfile) {
      setShowProfile(false);
      return;
    }

    setShowProfile(true);
    if (!activeUser) return;

    try {
      setIsLoadingProfile(true);
      // Fetch full profile to get all images, bio, and trigger DB 'profile_views' insert
      const fullData = await discoveryService.getFullProfile(activeUser.id);
      
      // Merge fullData into the current active user in the deck
      setDeck(prev => {
        const newDeck = [...prev];
        if (newDeck[0]?.id === fullData.id) {
          newDeck[0] = { ...newDeck[0], ...fullData };
        }
        return newDeck;
      });
    } catch (err) {
      console.error("Failed to load full profile data", err);
    } finally {
      setIsLoadingProfile(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (matchModal.show || reportModal) return;

      switch (e.key) {
        case 'ArrowLeft':
          handleAction('left');
          break;
        case 'ArrowRight':
          handleAction('right');
          break;
        case 'ArrowUp':
          handleAction('super');
          break;
        case 'ArrowDown':
          toggleProfile();
          break;
        case 'Backspace':
          handleUndo();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAction, handleUndo, matchModal.show, reportModal, showProfile]);

  const handlePhotoTap = (e, side) => {
    e.stopPropagation();
    if (!activeUser?.images) return;
    if (side === 'left' && photoIndex > 0) {
      setPhotoIndex(prev => prev - 1);
    } else if (side === 'right' && photoIndex < activeUser.images.length - 1) {
      setPhotoIndex(prev => prev + 1);
    }
  };

  // ============================================================================
  // LOADING STATE
  // ============================================================================
  if (loading) {
    return (
      <div className="discovery-shell flex-1 flex flex-col items-center justify-center p-6 text-center font-mono text-zinc-300 w-full h-full border-l-2 md:border-zinc-800 rounded-none">
        <Loader2 className="w-8 h-8 text-white animate-spin mb-4" />
        <p className="text-zinc-500 text-xs uppercase tracking-widest animate-pulse">{t('scanningNetwork')}</p>
      </div>
    );
  }

  // ============================================================================
  // EMPTY STATE RENDER
  // ============================================================================
  if (deck.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-black p-6 text-center font-mono text-zinc-300 w-full h-full border-l-2 md:border-zinc-800 rounded-none">
        <div className="w-24 h-24 bg-zinc-950 border-2 border-zinc-800 flex items-center justify-center mb-6">
          <Flame className="w-10 h-10 text-zinc-600" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2 uppercase tracking-widest">{t('caughtUpTitle')}</h2>
        <p className="text-zinc-500 text-[10px] uppercase tracking-widest max-w-sm leading-relaxed mb-8">
          {t('caughtUpDescription')}
        </p>
        <div className="flex gap-4">
          <button 
            onClick={() => navigate('/settings')}
            className="px-6 py-3 bg-black border-2 border-zinc-700 text-zinc-400 font-bold uppercase tracking-widest text-[10px] hover:text-white hover:border-white transition-colors flex items-center gap-2"
          >
            <Sliders className="w-4 h-4" /> {t('settings')}
          </button>
          <button 
            onClick={fetchDeck}
            className="px-6 py-3 bg-white border-2 border-white text-black font-bold uppercase tracking-widest text-[10px] hover:bg-zinc-200 transition-colors flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" /> {t('refresh')}
          </button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // MAIN RENDER
  // ============================================================================
  return (
    <div className="discovery-shell flex-1 flex flex-col relative overflow-hidden font-mono text-zinc-300 w-full h-full rounded-none border-l-2 md:border-zinc-800">
      
      {/* HEADER BAR */}
      <div className="discovery-header w-full p-4 md:p-6 border-b-2 flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <p className="discovery-kicker mb-1">{t('curatedForYou')}</p>
            <h1 className="discovery-title font-bold">{t('discover')}</h1>
          </div>
          <span className="discovery-chip text-[10px] font-bold px-3 py-1.5 uppercase">
            {t('nearbyCount', { count: deck.length })}
          </span>
        </div>
        
        {/* Undo Button */}
        <button 
          onClick={handleUndo}
          disabled={history.length === 0}
          className="discovery-control flex items-center gap-2 px-4 py-2 border-2 text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          <span className="hidden md:inline">{t('undo')}</span>
        </button>
      </div>

      {/* SWIPE DECK AREA */}
      <div className="discovery-content flex-1 w-full flex flex-col items-center justify-center p-4 md:p-8 relative overflow-hidden">
        
        {/* Keyboard Hint (Top Left) */}
        <div className="absolute top-8 left-8 z-10 hidden lg:block text-zinc-600 text-[10px] font-bold uppercase tracking-widest">
          <p className="flex items-center gap-2 mb-2"><span className="px-1.5 py-0.5 bg-zinc-950 border-2 border-zinc-800">&lt;</span> {t('pass')}</p>
          <p className="flex items-center gap-2 mb-2"><span className="px-1.5 py-0.5 bg-zinc-950 border-2 border-zinc-800">&gt;</span> {t('like')}</p>
          <p className="flex items-center gap-2"><span className="px-1.5 py-0.5 bg-zinc-950 border-2 border-zinc-800">V</span> {t('profileShortcut')}</p>
        </div>

        {/* DRAGGABLE CARD CONTAINER */}
        <div 
          ref={cardRef}
          className="w-full max-w-[400px] aspect-[3/4] max-h-[70vh] relative cursor-grab active:cursor-grabbing touch-none z-20"
          style={cardStyle}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="discovery-swipe-card absolute inset-0 overflow-hidden flex flex-col">
            
            {/* Image Gallery */}
            <div className="relative flex-1 bg-zinc-950 overflow-hidden">
              <img 
                src={activeUser.images?.[photoIndex] || 'https://images.unsplash.com/photo-1500000000000?auto=format&fit=crop&w=400&q=80'} 
                alt={activeUser.display_name} 
                className="w-full h-full object-cover grayscale select-none pointer-events-none" 
                draggable="false"
              />
              
              {/* Online Pulse Status */}
              {activeUser.status === 'online' && (
                <div className="absolute top-4 left-4 bg-black border-2 border-zinc-800 px-3 py-1.5 flex items-center gap-2 z-10">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  <span className="text-[10px] font-bold text-white uppercase tracking-widest">{t('online')}</span>
                </div>
              )}

              {/* Photo Navigation Overlays */}
              <div className="absolute inset-y-0 left-0 w-1/3 z-20" onClick={(e) => handlePhotoTap(e, 'left')} />
              <div className="absolute inset-y-0 right-0 w-1/3 z-20" onClick={(e) => handlePhotoTap(e, 'right')} />

              {/* Progress Bars */}
              <div className="absolute top-3 inset-x-3 flex gap-1.5 z-30">
                {(activeUser.images || [1]).map((_, idx) => (
                  <div key={idx} className={`h-1.5 flex-1 rounded-none border border-black ${idx === photoIndex ? 'bg-white' : 'bg-zinc-600'}`} />
                ))}
              </div>

              {/* Dynamic Action Stamps */}
              <div className="absolute inset-0 z-10 flex items-center justify-between px-8 pointer-events-none">
                <div style={{ opacity: likeOpacity }} className="border-4 border-white text-white bg-black font-bold text-4xl p-3 rotate-12 tracking-widest uppercase shadow-lg">
                  {t('like')}
                </div>
                <div style={{ opacity: nopeOpacity }} className="border-4 border-red-500 text-red-500 bg-black font-bold text-4xl p-3 -rotate-12 tracking-widest uppercase shadow-lg">
                  {t('pass')}
                </div>
              </div>

              {/* Basic Info Overlay */}
              <div className="discovery-swipe-info absolute bottom-0 inset-x-0 p-4 z-20 pointer-events-none">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-2xl font-bold text-white uppercase tracking-widest">
                          {activeUser.display_name}
                        </h2>
                        {activeUser.is_verified && (
                          <BadgeCheck className="w-5 h-5 text-blue-500 shrink-0" title={t('verifiedProfile')} />
                        )}
                      </div>
                      <span className="text-xl text-zinc-500">{activeUser.age}</span>
                    </div>
                    <p className="text-zinc-400 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
                      <MapPin className="w-3.5 h-3.5 text-zinc-500" /> {activeUser.city} ({activeUser.distance} KM)
                    </p>
                  </div>
                  
                  <button 
                    onClick={toggleProfile}
                    className="w-10 h-10 bg-zinc-900 border-2 border-zinc-700 hover:border-white text-white flex items-center justify-center transition-colors pointer-events-auto"
                  >
                    <Info className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* EXPANDED PROFILE DRAWER */}
            <div className={`absolute bottom-0 inset-x-0 bg-black border-t-2 border-zinc-600 transition-transform duration-300 ease-in-out z-30 flex flex-col pointer-events-auto ${showProfile ? 'h-[85%] translate-y-0' : 'h-[85%] translate-y-full'}`}>
              
              <div className="w-full flex items-center justify-between p-4 bg-zinc-950 border-b-2 border-zinc-800 shrink-0 cursor-pointer" onClick={() => setShowProfile(false)}>
                <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                  {t('aboutProfile', { name: activeUser.display_name })}
                  {activeUser.is_verified && (
                    <BadgeCheck className="w-3 h-3 text-blue-500" title={t('verifiedProfile')} />
                  )}
                  {isLoadingProfile && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
                </h3>
                <button className="text-zinc-500 hover:text-white p-1 transition-colors"><ChevronDown className="w-5 h-5" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar flex flex-col">
                
                <div className="flex items-center gap-3 p-3 bg-black border-2 border-white text-white shrink-0">
                  <Star className="w-4 h-4" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">{t('matchBasedPreferences', { percent: activeUser.match_pct })}</p>
                </div>

                <section>
                  <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-2">{t('aboutMe')}</h3>
                  <p className="text-zinc-300 text-[10px] md:text-xs leading-relaxed uppercase tracking-widest bg-zinc-950 p-4 border-2 border-zinc-800">
                    {activeUser.bio || t('noBio')}
                  </p>
                </section>

                <section>
                  <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-2">{t('interests')}</h3>
                  <div className="flex flex-wrap gap-2">
                    {(activeUser.tags || []).map(tag => (
                      <span key={tag} className="px-2 py-1 bg-zinc-950 border-2 border-zinc-800 text-zinc-400 text-[9px] font-bold uppercase tracking-widest">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </section>

                {/* Footer Buttons (Block / Report) */}
                <div className="pt-6 border-t-2 border-zinc-800 mt-auto pb-4 grid grid-cols-2 gap-3">
                  <button 
                    onClick={handleBlock}
                    className="py-3 bg-black border-2 border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors"
                  >
                    <Ban className="w-3.5 h-3.5" /> {t('userBlock')}
                  </button>
                  <button 
                    onClick={() => setReportModal(true)}
                    className="py-3 bg-black border-2 border-zinc-800 text-zinc-400 hover:border-red-900 hover:text-red-500 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors"
                  >
                    <Flag className="w-3.5 h-3.5" /> {t('userReport')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SWIPE ACTION CONTROLS */}
        <div className="absolute bottom-6 md:bottom-10 inset-x-0 flex justify-center items-center gap-4 z-10 px-4">
          <button 
            onClick={() => handleAction('left')}
            className="discovery-action w-16 h-16 border-2 flex items-center justify-center text-zinc-500 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          
          <button 
            onClick={() => handleAction('super')}
            className="discovery-action w-12 h-12 border-2 flex items-center justify-center text-zinc-500 transition-colors"
          >
            <Star className="w-5 h-5" />
          </button>

          <button 
            onClick={() => handleAction('right')}
            className="discovery-primary discovery-action w-16 h-16 border-2 flex items-center justify-center transition-colors"
          >
            <Heart className="w-6 h-6 fill-black" />
          </button>
        </div>
      </div>

      {/* ============================================================================
          IT'S A MATCH MODAL OVERLAY
          ============================================================================ */}
      {matchModal.show && matchModal.user && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-6 animate-in fade-in duration-300">
          
          <div className="text-center max-w-md w-full space-y-8 relative">
            <h1 className="text-5xl font-black text-white uppercase tracking-widest border-4 border-white p-4 inline-block shadow-[12px_12px_0px_rgba(255,255,255,0.2)]">
              MATCH
            </h1>
            
            <p className="text-zinc-400 text-[10px] font-bold uppercase tracking-widest mt-6">
              YOU AND <span className="text-white">{matchModal.user.display_name}</span> LIKED EACH OTHER.
            </p>

            <div className="flex justify-center items-center gap-4 relative py-4">
              <div className="w-28 h-28 border-2 border-white z-10 bg-zinc-950">
                <img src={matchModal.user.images?.[0]} alt="Match" className="w-full h-full object-cover grayscale" />
              </div>
              <div className="w-28 h-28 border-2 border-white z-0 bg-black flex items-center justify-center">
                <span className="text-white text-xs font-bold uppercase tracking-widest">YOU</span>
              </div>
            </div>

            <div className="space-y-4 pt-8 w-full">
              <button 
                onClick={() => {
                  setMatchModal({ show: false, user: null });
                  navigate('/messages');
                }} 
                className="w-full py-4 bg-white text-black font-bold uppercase tracking-widest text-[10px] border-2 border-white hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 shadow-[8px_8px_0px_rgba(255,255,255,0.2)]"
              >
                <MessageCircle className="w-4 h-4" /> SEND MESSAGE
              </button>
              <button 
                onClick={() => setMatchModal({ show: false, user: null })}
                className="w-full py-4 bg-black text-white font-bold uppercase tracking-widest text-[10px] border-2 border-zinc-700 hover:border-white hover:bg-zinc-900 transition-colors"
              >
                KEEP SWIPING
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================
          REPORT MODAL
          ============================================================================ */}
      {reportModal && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
          <div className="bg-black border-2 border-zinc-600 max-w-sm w-full p-6 space-y-6 shadow-[8px_8px_0px_rgba(255,255,255,0.1)]">
            <div className="flex items-center gap-3 text-white border-b-2 border-zinc-800 pb-4">
              <ShieldAlert className="w-5 h-5 text-zinc-400" />
              <h2 className="font-bold text-sm uppercase tracking-widest">REPORT PROFILE</h2>
            </div>
            
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              WE WON'T TELL {activeUser?.display_name} YOU REPORTED THEM. REASON:
            </p>

            <div className="space-y-2">
              {['INAPPROPRIATE CONTENT', 'FAKE PROFILE', 'HARASSMENT', 'UNDERAGE'].map(reason => (
                <label key={reason} className="flex items-center gap-3 p-3 border-2 border-zinc-800 hover:border-zinc-500 cursor-pointer transition-colors bg-zinc-950">
                  <input 
                    type="radio" 
                    name="report_reason" 
                    checked={reportReason === reason}
                    onChange={() => setReportReason(reason)}
                    className="accent-zinc-500 w-4 h-4" 
                  />
                  <span className="text-[10px] font-bold text-white uppercase tracking-widest">{reason}</span>
                </label>
              ))}
            </div>

            <div className="flex gap-3 pt-4">
              <button 
                onClick={() => setReportModal(false)}
                className="flex-1 py-3 border-2 border-zinc-700 text-zinc-400 hover:bg-zinc-900 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-colors"
              >
                CANCEL
              </button>
              <button 
                onClick={handleReportSubmit}
                className="flex-1 py-3 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors"
              >
                SUBMIT
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}