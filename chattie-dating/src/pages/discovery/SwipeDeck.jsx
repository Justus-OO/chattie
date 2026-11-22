import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Heart, X, Star, MapPin, RotateCcw, Info, 
  Flag, MessageCircle, ShieldAlert, ChevronDown, Flame, Loader2, Ban, Sliders, BadgeCheck
} from 'lucide-react';
import { toast } from 'sonner';

// Services
import { discoveryService } from '../../api/discovery.service';
import { settingsService } from '../../api/settings.service';
import { usePremiumStatus } from '../../hooks/usePremiumStatus';
import './discovery.css';
import { useI18n } from '../../i18n';

const IDLE_DRAG = {
  startX: 0,
  currentX: 0,
  startY: 0,
  currentY: 0,
  isDragging: false,
  photoNavigationSide: null,
};

const DECK_BATCH_SIZE = 20;

const countryCodeToFlag = (countryCode) => {
  const normalizedCode = countryCode?.trim().toUpperCase();
  if (!normalizedCode || !/^[A-Z]{2}$/.test(normalizedCode)) return '';
  return String.fromCodePoint(
    ...Array.from(normalizedCode, character => character.codePointAt(0) + 127397)
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function SwipeDeck() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const isPremium = usePremiumStatus();

  // --- CORE STATE ---
  const [deck, setDeck] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deckError, setDeckError] = useState(null);
  const [moreProfilesError, setMoreProfilesError] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState(false);
  const [isLoadingMoreProfiles, setIsLoadingMoreProfiles] = useState(false);
  const [isWideningSearch, setIsWideningSearch] = useState(false);
  const [showDiscoveryFilters, setShowDiscoveryFilters] = useState(false);
  const [discoveryFilters, setDiscoveryFilters] = useState(null);
  const [isLoadingDiscoveryFilters, setIsLoadingDiscoveryFilters] = useState(false);
  const [isSavingDiscoveryFilters, setIsSavingDiscoveryFilters] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const loadedFullProfilesRef = useRef(new Set());
  const loadedProfileIdsRef = useRef(new Set());
  const isLoadingMoreProfilesRef = useRef(false);
  const hasMoreProfilesRef = useRef(true);
  const diagnosticsRequestRef = useRef(0);
  
  // --- UI TOGGLES ---
  const [showProfile, setShowProfile] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [matchModal, setMatchModal] = useState({ show: false, user: null });
  const [reportModal, setReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('INAPPROPRIATE CONTENT');

  // --- PHYSICS & DRAG STATE ---
  const [drag, setDrag] = useState(IDLE_DRAG);
  const dragRef = useRef(IDLE_DRAG);
  const actionInProgressRef = useRef(false);
  const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1000;
  const swipeThreshold = Math.max(40, Math.min(windowWidth * 0.2, 96));

  const activeUser = deck[0];
  const activeCountryFlag = countryCodeToFlag(activeUser?.country_code);
  const resetDrag = useCallback(() => {
    dragRef.current = IDLE_DRAG;
    setDrag(IDLE_DRAG);
  }, []);

  // --- FETCH SWIPE DECK ON MOUNT ---
  const fetchDeck = useCallback(async () => {
    try {
      setLoading(true);
      setDeckError(null);
      setMoreProfilesError(false);
      diagnosticsRequestRef.current += 1;
      setDiagnostics(null);
      setDiagnosticsError(false);
      setIsLoadingDiagnostics(false);
      const profiles = await discoveryService.getSwipeDeck(DECK_BATCH_SIZE, 0);
      if (!Array.isArray(profiles)) throw new Error(t('coreUiSwipeDeckInvalidResponse'));
      loadedProfileIdsRef.current = new Set(profiles.map(profile => profile.id));
      hasMoreProfilesRef.current = profiles.length === DECK_BATCH_SIZE;
      setDeck(profiles);
    } catch (error) {
      loadedProfileIdsRef.current.clear();
      hasMoreProfilesRef.current = false;
      setDeck([]);
      setDeckError(error.message || t('failedLoadDeck'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchDeck();
  }, [fetchDeck]);

  const loadMoreProfiles = useCallback(async () => {
    if (!hasMoreProfilesRef.current || isLoadingMoreProfilesRef.current) return;

    isLoadingMoreProfilesRef.current = true;
    setIsLoadingMoreProfiles(true);
    setMoreProfilesError(false);
    try {
      const profiles = await discoveryService.getSwipeDeck(DECK_BATCH_SIZE, 0);
      if (!Array.isArray(profiles)) throw new Error(t('coreUiSwipeDeckInvalidResponse'));

      const newProfiles = profiles.filter(profile => !loadedProfileIdsRef.current.has(profile.id));
      newProfiles.forEach(profile => loadedProfileIdsRef.current.add(profile.id));
      setDeck(previous => [...previous, ...newProfiles]);

      hasMoreProfilesRef.current = profiles.length === DECK_BATCH_SIZE && newProfiles.length > 0;
    } catch (error) {
      setMoreProfilesError(true);
      toast.error(error.message || t('coreUiSwipeDeckLoadFailed'));
    } finally {
      isLoadingMoreProfilesRef.current = false;
      setIsLoadingMoreProfiles(false);
    }
  }, [t]);

  const loadDiscoveryDiagnostics = useCallback(async () => {
    const requestId = diagnosticsRequestRef.current + 1;
    diagnosticsRequestRef.current = requestId;
    setIsLoadingDiagnostics(true);
    setDiagnosticsError(false);
    try {
      const result = await discoveryService.getSwipeDeckDiagnostics();
      if (diagnosticsRequestRef.current === requestId) setDiagnostics(result);
    } catch {
      if (diagnosticsRequestRef.current === requestId) setDiagnosticsError(true);
    } finally {
      if (diagnosticsRequestRef.current === requestId) setIsLoadingDiagnostics(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && !deckError && deck.length === 0 && !moreProfilesError && !diagnostics && !diagnosticsError && !isLoadingDiagnostics && !isLoadingMoreProfiles) {
      loadDiscoveryDiagnostics();
    }
  }, [deck.length, deckError, diagnostics, diagnosticsError, isLoadingDiagnostics, isLoadingMoreProfiles, loading, loadDiscoveryDiagnostics, moreProfilesError]);

  const openDiscoveryFilters = async () => {
    setShowDiscoveryFilters(true);
    setIsLoadingDiscoveryFilters(true);
    try {
      const preferences = await settingsService.getDiscoveryPreferences();
      setDiscoveryFilters({
        minAge: String(preferences.min_age),
        maxAge: String(preferences.max_age),
        maxDistanceKm: Number(preferences.max_distance_km),
        showMe: preferences.show_me,
        globalMode: Boolean(preferences.global_mode),
        interestedIn: preferences.interested_in || 'All',
      });
    } catch (error) {
      setShowDiscoveryFilters(false);
      toast.error(error.response?.data?.error || t('coreUiDiscoveryFiltersLoadFailed'));
    } finally {
      setIsLoadingDiscoveryFilters(false);
    }
  };

  const saveDiscoveryFilters = async (event) => {
    event.preventDefault();
    if (!discoveryFilters || isSavingDiscoveryFilters) return;

    const minAge = Number(discoveryFilters.minAge);
    const maxAge = Number(discoveryFilters.maxAge);
    if (!Number.isInteger(minAge) || !Number.isInteger(maxAge) ||
      minAge < 18 || maxAge > 99 || minAge > maxAge) {
      toast.error(t('coreUiDiscoveryAgeRangeInvalid'));
      return;
    }

    setIsSavingDiscoveryFilters(true);
    try {
      await settingsService.updateDiscoveryPreferences({
        interested_in: discoveryFilters.interestedIn,
        min_age: minAge,
        max_age: maxAge,
        max_distance_km: discoveryFilters.maxDistanceKm,
        show_me: discoveryFilters.showMe,
        global_mode: discoveryFilters.globalMode,
      });
      setShowDiscoveryFilters(false);
      toast.success(t('coreUiDiscoveryFiltersSaved'));
      await fetchDeck();
    } catch (error) {
      toast.error(error.response?.data?.error || t('coreUiDiscoveryFiltersSaveFailed'));
    } finally {
      setIsSavingDiscoveryFilters(false);
    }
  };

  const widenDiscoverySearch = async () => {
    if (isWideningSearch) return;
    setIsWideningSearch(true);
    try {
      const preferences = await settingsService.getDiscoveryPreferences();
      await settingsService.updateDiscoveryPreferences({
        interested_in: preferences.interested_in || 'All',
        min_age: 18,
        max_age: 99,
        max_distance_km: 500,
        show_me: preferences.show_me,
        global_mode: true,
      });
      toast.success(t('coreUiSearchWidened'));
      await fetchDeck();
    } catch (error) {
      toast.error(error.response?.data?.error || error.message || t('coreUiDiscoveryFiltersSaveFailed'));
    } finally {
      setIsWideningSearch(false);
    }
  };

  // ============================================================================
  // GESTURE & PHYSICS CALCULATIONS
  // ============================================================================
  const onPointerDown = (e) => {
    if (!e.isPrimary || e.button !== 0 || showProfile || matchModal.show || reportModal) return;
    if (e.target instanceof Element && e.target.closest('button, a, input, select, textarea')) return;
    const photoNavigationSide = e.target instanceof Element
      ? e.target.closest('[data-photo-navigation]')?.getAttribute('data-photo-navigation')
      : null;
    e.currentTarget.setPointerCapture(e.pointerId);
    const nextDrag = {
      startX: e.clientX,
      currentX: e.clientX,
      startY: e.clientY,
      currentY: e.clientY,
      isDragging: true,
      photoNavigationSide,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  };

  const onPointerMove = (e) => {
    if (!dragRef.current.isDragging) return;
    const nextDrag = {
      ...dragRef.current,
      currentX: e.clientX,
      currentY: e.clientY
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  };

  const onPointerUp = (e) => {
    const currentDrag = dragRef.current;
    if (!currentDrag.isDragging) return;
    const deltaX = e.clientX - currentDrag.startX;
    resetDrag();

    if (deltaX > swipeThreshold) {
      handleAction('right');
    } else if (deltaX < -swipeThreshold) {
      handleAction('left');
    } else if (
      currentDrag.photoNavigationSide &&
      Math.abs(deltaX) < 10 &&
      Math.abs(e.clientY - currentDrag.startY) < 10
    ) {
      handlePhotoTap(e, currentDrag.photoNavigationSide);
    }
  };

  const onPointerCancel = () => {
    resetDrag();
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
    if (!activeUser || actionInProgressRef.current) return;

    actionInProgressRef.current = true;
    const targetUser = activeUser;
    resetDrag();
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
      if (deck.length <= 6) await loadMoreProfiles();
    } catch (error) {
      setHistory(prev => prev.filter(user => user.id !== targetUser.id));
      if (error.code !== 'ALREADY_INTERACTED') {
        setDeck(prev => prev.some(user => user.id === targetUser.id) ? prev : [targetUser, ...prev]);
      }

      // Handle Daily Limits or Upgrades
      if (error.status === 402 || error.code === 'UPGRADE_REQUIRED') {
        toast.error(t('dailyLimit'));
        navigate('/upgrade');
      } else {
        toast.error(error.message || t('interactionFailed'));
      }
    } finally {
      actionInProgressRef.current = false;
    }
  }, [activeUser, deck.length, loadMoreProfiles, navigate, resetDrag, t]);

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
      if (error.status === 403 || error.code === 'UPGRADE_REQUIRED') {
        toast.error(t('rewindRequired'));
        navigate('/upgrade');
      } else {
        toast.error(error.message || t('nothingToUndo'));
      }
    }
  }, [history, navigate, t]);

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

  const loadFullProfile = async (targetUser) => {
    if (loadedFullProfilesRef.current.has(targetUser.id)) return targetUser;

    setIsLoadingProfile(true);
    try {
      const fullData = await discoveryService.getFullProfile(targetUser.id);
      loadedFullProfilesRef.current.add(targetUser.id);
      setDeck(prev => {
        const newDeck = [...prev];
        if (newDeck[0]?.id === fullData.id) {
          newDeck[0] = { ...newDeck[0], ...fullData };
        }
        return newDeck;
      });
      return { ...targetUser, ...fullData };
    } catch (error) {
      toast.error(error.message || t('profileLoadFailed'));
      return targetUser;
    } finally {
      setIsLoadingProfile(false);
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
    await loadFullProfile(activeUser);
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

  const handlePhotoTap = async (e, side) => {
    e.stopPropagation();
    if (!activeUser || isLoadingProfile) return;

    const profile = await loadFullProfile(activeUser);
    const imageCount = Array.isArray(profile.images) ? profile.images.length : 0;
    if (imageCount === 0) return;
    setPhotoIndex(current => side === 'left'
      ? Math.max(0, current - 1)
      : Math.min(imageCount - 1, current + 1));
  };

  const handlePhotoNavigationKeyDown = (e, side) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    handlePhotoTap(e, side);
  };

  // ============================================================================
  // LOADING STATE
  // ============================================================================
  if (loading) {
    return (
      <div className="discovery-shell flex h-full min-h-0 min-w-0 w-full flex-1 flex-col items-center justify-center p-2 text-center font-mono text-zinc-300 border-l-2 md:border-zinc-800 rounded-none sm:p-3 lg:p-4">
        <Loader2 className="w-8 h-8 text-white animate-spin mb-4" />
        <p className="text-zinc-500 text-xs uppercase tracking-widest animate-pulse">{t('scanningNetwork')}</p>
      </div>
    );
  }

  if (deckError) {
    return (
      <div className="discovery-shell flex h-full min-h-0 min-w-0 w-full flex-1 flex-col items-center justify-center gap-4 bg-black p-4 text-center font-mono text-zinc-300">
        <h2 className="text-xl font-bold uppercase tracking-widest text-white">{t('coreUiSwipeDeckLoadFailed')}</h2>
        <p className="max-w-md text-xs leading-relaxed text-zinc-400">{deckError}</p>
        <button
          type="button"
          onClick={fetchDeck}
          className="flex items-center gap-2 border-2 border-white bg-white px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-black hover:bg-zinc-200"
        >
          <RotateCcw className="h-4 w-4" /> {t('refresh')}
        </button>
      </div>
    );
  }

  // ============================================================================
  // EMPTY STATE RENDER
  // ============================================================================
  if (deck.length === 0) {
    let emptyDeckReason = isLoadingMoreProfiles
      ? t('coreUiLoadingMoreProfiles')
      : t('coreUiEmptyDeckFiltersHint');
    if (diagnostics) {
      if (!diagnostics.viewer_ready) {
        emptyDeckReason = !diagnostics.viewer_has_photo
          ? t('coreUiDiagnosticsAddPhoto')
          : !diagnostics.viewer_age_eligible
            ? t('coreUiDiagnosticsAgeEligibility')
            : t('coreUiDiagnosticsProfileEligibility');
      } else if (diagnostics.candidate_pool === 0) {
        emptyDeckReason = t('coreUiDiagnosticsNoCandidates');
      } else if (diagnostics.after_age === 0) {
        emptyDeckReason = t('coreUiDiagnosticsAgeFilters');
      } else if (diagnostics.after_gender === 0) {
        emptyDeckReason = t('coreUiDiagnosticsGenderFilters');
      } else if (diagnostics.after_intent === 0) {
        emptyDeckReason = t('coreUiDiagnosticsIntentFilters');
      } else if (diagnostics.after_location === 0) {
        emptyDeckReason = t('coreUiDiagnosticsLocationFilters');
      } else {
        emptyDeckReason = t('coreUiDiagnosticsCaughtUp');
      }
    }

    return (
      <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col items-center justify-center overflow-y-auto bg-black p-2 text-center font-mono text-zinc-300 border-l-2 md:border-zinc-800 rounded-none sm:p-3 lg:p-4">
        <div className="w-24 h-24 bg-zinc-950 border-2 border-zinc-800 flex items-center justify-center mb-6">
          <Flame className="w-10 h-10 text-zinc-600" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2 uppercase tracking-widest">
          {moreProfilesError
            ? t('coreUiSwipeDeckLoadFailed')
            : diagnostics && !diagnostics.viewer_ready
              ? t('coreUiDiscoveryNeedsAttention')
              : t('caughtUpTitle')}
        </h2>
        <p className="text-zinc-500 text-[10px] uppercase tracking-widest max-w-sm leading-relaxed mb-6">
          {moreProfilesError ? t('coreUiSwipeDeckLoadFailed') : emptyDeckReason}
        </p>
        {isLoadingMoreProfiles && (
          <div className="mb-5 flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('coreUiLoadingMoreProfiles')}
          </div>
        )}
        {isLoadingDiagnostics && (
          <div className="mb-5 flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('coreUiDiagnosingDeck')}
          </div>
        )}
        {diagnostics && (
          <div className="mb-5 grid w-full max-w-sm grid-cols-2 gap-2 border border-zinc-800 bg-zinc-950 p-3 text-left text-[10px] uppercase tracking-widest text-zinc-500" aria-label={t('coreUiDiscoveryDiagnostics')}>
            <span>{t('coreUiDiagnosticCandidatePool')}</span><span className="text-right text-white">{diagnostics.candidate_pool}</span>
            <span>{t('coreUiDiagnosticAfterAge')}</span><span className="text-right text-white">{diagnostics.after_age}</span>
            <span>{t('coreUiDiagnosticAfterGender')}</span><span className="text-right text-white">{diagnostics.after_gender}</span>
            <span>{t('coreUiDiagnosticAfterIntent')}</span><span className="text-right text-white">{diagnostics.after_intent}</span>
            <span>{t('coreUiDiagnosticAfterLocation')}</span><span className="text-right text-white">{diagnostics.after_location}</span>
          </div>
        )}
        {diagnosticsError && (
          <div className="mb-5 flex flex-col items-center gap-2">
            <p className="text-xs text-zinc-400">{t('coreUiDiagnosticsLoadFailed')}</p>
            <button
              type="button"
              onClick={loadDiscoveryDiagnostics}
              className="border-2 border-zinc-700 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300 hover:border-white"
            >
              {t('coreUiRetryDiagnostics')}
            </button>
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={widenDiscoverySearch}
            disabled={isWideningSearch || isLoadingMoreProfiles}
            className="flex items-center gap-2 border-2 border-zinc-700 bg-black px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-white transition-colors hover:border-white disabled:opacity-50"
          >
            {isWideningSearch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sliders className="h-4 w-4" />}
            {t(isWideningSearch ? 'coreUiWideningSearch' : 'coreUiWidenSearch')}
          </button>
          <button
            type="button"
            onClick={openDiscoveryFilters}
            disabled={isWideningSearch || isLoadingMoreProfiles}
            aria-expanded={showDiscoveryFilters}
            className="flex items-center gap-2 border-2 border-white bg-white px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-black transition-colors hover:bg-zinc-200 disabled:opacity-50"
          >
            <Sliders className="w-4 h-4" /> {t('coreUiAdjustDiscoveryFilters')}
          </button>
          <button 
            onClick={() => navigate('/settings')}
            className="px-6 py-3 bg-black border-2 border-zinc-700 text-zinc-400 font-bold uppercase tracking-widest text-[10px] hover:text-white hover:border-white transition-colors flex items-center gap-2"
          >
            <Sliders className="w-4 h-4" /> {t('settings')}
          </button>
          <button 
            onClick={fetchDeck}
            disabled={isLoadingMoreProfiles || isWideningSearch}
            className="px-6 py-3 bg-white border-2 border-white text-black font-bold uppercase tracking-widest text-[10px] hover:bg-zinc-200 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4" /> {t('refresh')}
          </button>
        </div>

        {showDiscoveryFilters && (
          <form
            onSubmit={saveDiscoveryFilters}
            className="mt-6 w-full max-w-lg border-2 border-zinc-800 bg-zinc-950 p-4 text-left sm:p-6"
            aria-labelledby="discovery-filter-title"
          >
            <h3 id="discovery-filter-title" className="mb-5 text-sm font-bold uppercase tracking-widest text-white">
              {t('coreUiAdjustDiscoveryFilters')}
            </h3>
            {isLoadingDiscoveryFilters ? (
              <div className="flex items-center justify-center gap-3 py-8 text-xs uppercase tracking-widest text-zinc-400" role="status">
                <Loader2 className="h-5 w-5 animate-spin" />
                {t('scanningNetwork')}
              </div>
            ) : discoveryFilters && (
              <div className="space-y-5">
                <fieldset>
                  <legend className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    {t('coreUiAgeRange')}
                  </legend>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-[10px] uppercase tracking-widest text-zinc-500">
                      {t('coreUiMin')}
                      <input
                        type="number"
                        min="18"
                        max="99"
                        required
                        value={discoveryFilters.minAge}
                        onChange={event => setDiscoveryFilters(filters => ({ ...filters, minAge: event.target.value }))}
                        className="mt-2 w-full border-2 border-zinc-700 bg-black px-3 py-2 text-sm text-white focus:border-white focus:outline-none"
                      />
                    </label>
                    <label className="text-[10px] uppercase tracking-widest text-zinc-500">
                      {t('coreUiMax')}
                      <input
                        type="number"
                        min="18"
                        max="99"
                        required
                        value={discoveryFilters.maxAge}
                        onChange={event => setDiscoveryFilters(filters => ({ ...filters, maxAge: event.target.value }))}
                        className="mt-2 w-full border-2 border-zinc-700 bg-black px-3 py-2 text-sm text-white focus:border-white focus:outline-none"
                      />
                    </label>
                  </div>
                </fieldset>

                <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  <span className="flex justify-between gap-3">
                    <span>{t('coreUiMaximumDistance')}</span>
                    <span className="text-white">{discoveryFilters.maxDistanceKm} km</span>
                  </span>
                  <input
                    type="range"
                    min="1"
                    max="500"
                    value={discoveryFilters.maxDistanceKm}
                    onChange={event => setDiscoveryFilters(filters => ({ ...filters, maxDistanceKm: Number(event.target.value) }))}
                    className="mt-3 h-2 w-full cursor-pointer appearance-none border-2 border-zinc-800 bg-black accent-white"
                  />
                </label>

                <fieldset>
                  <legend className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    {t('coreUiShowMe')}
                  </legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {['Men', 'Women', 'Other', 'Everyone'].map(option => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={discoveryFilters.showMe === option}
                        onClick={() => setDiscoveryFilters(filters => ({ ...filters, showMe: option }))}
                        className={`border-2 px-2 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                          discoveryFilters.showMe === option
                            ? 'border-white bg-white text-black'
                            : 'border-zinc-700 text-zinc-400 hover:border-white hover:text-white'
                        }`}
                      >
                        {t(`coreUiShowMe${option}`)}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className="flex cursor-pointer items-start gap-3 border-t border-zinc-800 pt-4 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={discoveryFilters.globalMode}
                    onChange={event => setDiscoveryFilters(filters => ({ ...filters, globalMode: event.target.checked }))}
                    className="mt-0.5 h-4 w-4 accent-white"
                  />
                  <span>
                    <span className="block font-bold uppercase tracking-widest">{t('coreUiGlobalMode')}</span>
                    <span className="mt-1 block text-[10px] leading-relaxed text-zinc-500">{t('coreUiGlobalModeDescription')}</span>
                  </span>
                </label>

                <div className="flex justify-end gap-3 border-t border-zinc-800 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowDiscoveryFilters(false)}
                    disabled={isSavingDiscoveryFilters}
                    className="border-2 border-zinc-700 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300 hover:border-white disabled:opacity-50"
                  >
                    {t('coreUiCancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingDiscoveryFilters}
                    className="flex items-center gap-2 border-2 border-white bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-black hover:bg-zinc-200 disabled:opacity-50"
                  >
                    {isSavingDiscoveryFilters && <Loader2 className="h-3 w-3 animate-spin" />}
                    {t('coreUiSaveFilters')}
                  </button>
                </div>
              </div>
            )}
          </form>
        )}
        {moreProfilesError && (
          <button
            type="button"
            onClick={loadMoreProfiles}
            disabled={isLoadingMoreProfiles}
            className="mt-4 flex items-center gap-2 border-2 border-zinc-700 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300 hover:border-white disabled:opacity-50"
          >
            {isLoadingMoreProfiles && <Loader2 className="h-3 w-3 animate-spin" />}
            {t('refresh')}
          </button>
        )}
      </div>
    );
  }

  // ============================================================================
  // MAIN RENDER
  // ============================================================================
  return (
    <div className="discovery-shell flex h-full min-h-0 min-w-0 flex-1 flex-col relative overflow-hidden font-mono text-zinc-300 w-full rounded-none border-l-2 md:border-zinc-800">
      
      {/* HEADER BAR */}
      <div className="discovery-header hidden w-full shrink-0 border-b-2 p-2 sm:flex sm:p-3 lg:p-4 justify-between items-center z-10">
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
      <div className="discovery-content min-h-0 flex-1 w-full flex flex-col items-center justify-center px-0.5 pb-0.5 pt-0 sm:px-1 sm:pb-1 lg:px-2 lg:pb-2 relative overflow-hidden">
        {isLoadingMoreProfiles && (
          <div className="absolute top-2 z-30 flex items-center gap-2 bg-black/80 px-3 py-2 text-[10px] uppercase tracking-widest text-zinc-300" role="status">
            <Loader2 className="h-3 w-3 animate-spin" /> {t('coreUiLoadingMoreProfiles')}
          </div>
        )}
        
        {/* Keyboard Hint (Top Left) */}
        <div className="absolute top-8 left-8 z-10 hidden lg:block text-zinc-600 text-[10px] font-bold uppercase tracking-widest">
          <p className="flex items-center gap-2 mb-2"><span className="px-1.5 py-0.5 bg-zinc-950 border-2 border-zinc-800">&lt;</span> {t('pass')}</p>
          <p className="flex items-center gap-2 mb-2"><span className="px-1.5 py-0.5 bg-zinc-950 border-2 border-zinc-800">&gt;</span> {t('like')}</p>
          <p className="flex items-center gap-2"><span className="px-1.5 py-0.5 bg-zinc-950 border-2 border-zinc-800">V</span> {t('profileShortcut')}</p>
        </div>

        {/* DRAGGABLE CARD CONTAINER */}
        <div 
          className="relative z-20 aspect-[2/3] max-h-[78dvh] w-full max-w-[min(94vw,30rem)] cursor-grab touch-none active:cursor-grabbing"
          style={cardStyle}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <div className="discovery-swipe-card absolute inset-0 overflow-hidden flex flex-col">
            
            {/* Image Gallery */}
            <div className="relative flex-1 bg-zinc-950 overflow-hidden">
              <img 
                src={activeUser.images?.[photoIndex] || 'https://images.unsplash.com/photo-1500000000000?auto=format&fit=crop&w=400&q=80'} 
                alt={activeUser.display_name} 
                className={`w-full h-full object-cover select-none pointer-events-none transition-[filter,transform] duration-300 ${
                  !isPremium && photoIndex >= 2 ? 'blur-md scale-105' : ''
                }`}
                draggable="false"
              />
              
              {/* Photo Navigation Overlays */}
              <div
                data-photo-navigation="left"
                role="button"
                tabIndex={0}
                aria-label={t('coreUiPreviousProfilePhoto')}
                onKeyDown={e => handlePhotoNavigationKeyDown(e, 'left')}
                className="absolute inset-y-0 left-0 z-20 w-1/2 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
              />
              <div
                data-photo-navigation="right"
                role="button"
                tabIndex={0}
                aria-label={t('coreUiNextProfilePhoto')}
                onKeyDown={e => handlePhotoNavigationKeyDown(e, 'right')}
                className="absolute inset-y-0 right-0 z-20 w-1/2 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
              />
              {!showProfile && isLoadingProfile && (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/30" aria-live="polite">
                  <Loader2 className="h-7 w-7 animate-spin text-white" />
                  <span className="sr-only">{t('coreUiLoadingProfilePhotos')}</span>
                </div>
              )}

              {/* Progress Bars */}
              <div className="absolute top-3 inset-x-3 flex gap-1.5 z-30">
                {(activeUser.images || [1]).map((_, idx) => (
                  <div key={idx} className={`h-1.5 flex-1 rounded-none border border-black ${idx === photoIndex ? 'bg-white' : 'bg-zinc-600'}`} />
                ))}
              </div>

              {/* Dynamic Action Stamps */}
              <div className="pointer-events-none absolute inset-0 z-10">
                <div style={{ opacity: nopeOpacity }} className="absolute left-6 top-8 rotate-12 border-4 border-red-500 bg-black p-3 text-4xl font-bold uppercase tracking-widest text-red-500 shadow-lg">
                  {t('pass')}
                </div>
                <div style={{ opacity: likeOpacity }} className="absolute right-6 top-8 -rotate-12 border-4 border-white bg-black p-3 text-4xl font-bold uppercase tracking-widest text-white shadow-lg">
                  {t('like')}
                </div>
              </div>

              <button
                onClick={toggleProfile}
                aria-label={t('profileShortcut')}
                className="pointer-events-auto absolute right-4 top-8 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-white drop-shadow-[0_2px_8px_rgba(var(--shadow-rgb), 0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <Info className="h-5 w-5" />
              </button>

              <div className="discovery-swipe-card-caption pointer-events-none absolute inset-x-0 bottom-5 z-40 flex flex-col items-center gap-2 px-4 text-center">
                <div className="max-w-full">
                  <div className="flex items-center justify-center gap-2">
                    <h2 className="discovery-swipe-profile-accent truncate text-xl font-bold">
                      {activeUser.display_name}, {activeUser.age}
                    </h2>
                    {activeUser.is_verified && (
                      <BadgeCheck className="h-5 w-5 shrink-0 text-amber-400" title={t('verifiedProfile')} />
                    )}
                  </div>
                  <div className="discovery-swipe-profile-accent flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
                    <span className="flex items-center gap-1.5">
                      {activeCountryFlag && (
                        <span role="img" aria-label={`${activeUser.country_code} flag`} title={activeUser.country_code}>
                          {activeCountryFlag}
                        </span>
                      )}
                      <MapPin className="h-3.5 w-3.5" />
                      {activeUser.city} · {activeUser.distance} km
                    </span>
                    {activeUser.status === 'online' && (
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-white" />
                        {t('online')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="pointer-events-auto flex items-center justify-center gap-5">
                  <button
                    onClick={() => handleAction('left')}
                    aria-label={t('pass')}
                    title={t('pass')}
                    className="flex size-14 items-center justify-center rounded-full bg-transparent text-white shadow-none transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <X className="h-7 w-7 drop-shadow-[0_2px_8px_rgba(var(--shadow-rgb), 0.95)]" />
                  </button>

                  <button
                    onClick={() => handleAction('super')}
                    aria-label={t('superLike')}
                    title={t('superLike')}
                    className="flex size-12 items-center justify-center rounded-full bg-transparent text-white shadow-none transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <Star className="h-6 w-6 drop-shadow-[0_2px_8px_rgba(var(--shadow-rgb), 0.95)]" />
                  </button>

                  <button
                    onClick={() => handleAction('right')}
                    aria-label={t('like')}
                    title={t('like')}
                    className="flex size-14 items-center justify-center rounded-full bg-transparent text-white shadow-none transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <Heart className="h-7 w-7 fill-current drop-shadow-[0_2px_8px_rgba(var(--shadow-rgb), 0.95)]" />
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
                    <BadgeCheck className="w-3 h-3 text-amber-400" title={t('verifiedProfile')} />
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

      </div>

      {/* ============================================================================
          IT'S A MATCH MODAL OVERLAY
          ============================================================================ */}
      {matchModal.show && matchModal.user && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-6 animate-in fade-in duration-300">
          
          <div className="text-center max-w-md w-full space-y-8 relative">
            <h1 className="text-5xl font-black text-white uppercase tracking-widest border-4 border-white p-4 inline-block shadow-[12px_12px_0px_rgba(var(--highlight-rgb), 0.2)]">
              MATCH
            </h1>
            
            <p className="text-zinc-400 text-[10px] font-bold uppercase tracking-widest mt-6">
              YOU AND <span className="text-white">{matchModal.user.display_name}</span> LIKED EACH OTHER.
            </p>

            <div className="flex justify-center items-center gap-4 relative py-4">
              <div className="w-28 h-28 border-2 border-white z-10 bg-zinc-950">
                <img src={matchModal.user.images?.[0]} alt={t('coreUiMatch')} className="w-full h-full object-cover" />
              </div>
              <div className="w-28 h-28 border-2 border-white z-0 bg-black flex items-center justify-center">
                <span className="text-white text-xs font-bold uppercase tracking-widest">{t('coreUiYou')}</span>
              </div>
            </div>

            <div className="space-y-4 pt-8 w-full">
              <button 
                onClick={() => {
                  setMatchModal({ show: false, user: null });
                  navigate('/messages');
                }} 
                className="w-full py-4 bg-white text-black font-bold uppercase tracking-widest text-[10px] border-2 border-white hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.2)]"
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
          <div className="bg-black border-2 border-zinc-600 max-w-sm w-full p-6 space-y-6 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)]">
            <div className="flex items-center gap-3 text-white border-b-2 border-zinc-800 pb-4">
              <ShieldAlert className="w-5 h-5 text-zinc-400" />
              <h2 className="font-bold text-sm uppercase tracking-widest">{t('coreUiReportProfile')}</h2>
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