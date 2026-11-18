import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, Search, Flame, Plus, Shield, Hash, 
  Lock, Globe, X, MessageSquare, Mic,
  Loader2, Crown, Star
} from 'lucide-react';
import { toast } from 'sonner';

// Services & Store
import { chatService } from '../../api/chat.service';
import { useAppStore } from '../../store/useAppStore';
import { useI18n } from '../../i18n';

// ============================================================================
// CONSTANTS
// ============================================================================
const CATEGORIES = ['All', 'Trending', 'Naps & Chill', 'Playtime', 'Treats', 'Grooming', 'Zoomies', 'Exclusive'];

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function RoomDirectory() {
  const navigate = useNavigate();
  const { t } = useI18n();
  
  // --- STORE & PERMISSIONS ---
  const currentUser = useAppStore((state) => state.user) || { id: 'me', name: 'You', tier: 'STANDARD' };
  const userTier = currentUser?.tier || 'STANDARD'; // 'STANDARD', 'PREMIUM', 'VIP'
  
  const canCreatePrivate = userTier === 'PREMIUM' || userTier === 'VIP';
  const canAccessExclusive = userTier === 'VIP';
  const canAccessPrivate = userTier === 'PREMIUM' || userTier === 'VIP';

  // --- STATE ---
  const [rooms, setRooms] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [directoryTab, setDirectoryTab] = useState('discover');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [isJoiningByCode, setIsJoiningByCode] = useState(false);
  const isInitialLoading = isLoading && rooms.length === 0;
  
  // --- UI TOGGLES ---
  const [previewRoom, setPreviewRoom] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // --- SPATIAL NAVIGATION ---
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const gridRef = useRef(null);

  // ============================================================================
  // EFFECTS & DATA FETCHING
  // ============================================================================
  const translateRef = useRef(t);
  translateRef.current = t;

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setIsLoading(true);
      setPage(1);
      try {
        if (directoryTab === 'joined') {
          const joinedRooms = await chatService.getMyRooms();
          if (active) {
            setRooms(joinedRooms);
            setHasMore(false);
          }
        } else {
          const category = ['All', 'Trending'].includes(activeCategory) ? undefined : activeCategory;
          const result = await chatService.getRoomDirectoryPage({
            page: 1,
            limit: 20,
            search: searchQuery.trim() || undefined,
            category,
          });
          if (active) {
            setRooms(result.rooms);
            setHasMore(result.hasMore);
          }
        }
      } catch (error) {
        console.error("Failed to load rooms:", error);
        if (active) toast.error(translateRef.current('unableFetchGroups'));
      } finally {
        if (active) setIsLoading(false);
      }
    }, searchQuery ? 250 : 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [directoryTab, activeCategory, searchQuery]);

  const loadMoreRooms = async () => {
    if (directoryTab !== 'discover' || !hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    const nextPage = page + 1;
    try {
      const category = ['All', 'Trending'].includes(activeCategory) ? undefined : activeCategory;
      const result = await chatService.getRoomDirectoryPage({
        page: nextPage,
        limit: 20,
        search: searchQuery.trim() || undefined,
        category,
      });
      setRooms((current) => [...current, ...result.rooms]);
      setPage(nextPage);
      setHasMore(result.hasMore);
    } catch (error) {
      console.error("Failed to load more rooms:", error);
      toast.error(t('unableFetchGroups'));
    } finally {
      setIsLoadingMore(false);
    }
  };

  // ============================================================================
  // DATA PROCESSING
  // ============================================================================
  const processedRooms = useMemo(() => {
    let result = [...rooms];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r => 
        r.name?.toLowerCase().includes(q) || 
        r.tags?.some(tag => tag.toLowerCase().includes(q))
      );
    }

    if (activeCategory !== 'All') {
      if (activeCategory === 'Trending') {
        result.sort((a, b) => (b.active || 0) - (a.active || 0)); 
      } else {
        result = result.filter(r => r.category === activeCategory);
      }
    }

    return result;
  }, [rooms, searchQuery, activeCategory]);

  // ============================================================================
  // KEYBOARD NAVIGATION
  // ============================================================================
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
      if (previewRoom || showCreateModal || isLoading) return;
      if (processedRooms.length === 0) return;

      const width = window.innerWidth;
      let cols = 1; 
      if (width >= 768) cols = 2; // md
      if (width >= 1024) cols = 3; // lg
      if (width >= 1536) cols = 4; // 2xl

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          setFocusedIndex(prev => Math.min(prev + 1, processedRooms.length - 1));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setFocusedIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex(prev => Math.min(prev + cols, processedRooms.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex(prev => Math.max(prev - cols, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (focusedIndex >= 0 && processedRooms[focusedIndex]) {
            setPreviewRoom(processedRooms[focusedIndex]);
          }
          break;
        case 'Escape':
          setFocusedIndex(-1);
          setPreviewRoom(null);
          setShowCreateModal(false);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [processedRooms, previewRoom, showCreateModal, focusedIndex, isLoading]);

  useEffect(() => {
    if (focusedIndex >= 0 && gridRef.current && gridRef.current.children[focusedIndex]) {
      gridRef.current.children[focusedIndex].scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [focusedIndex]);

  // ============================================================================
  // HANDLERS
  // ============================================================================
  const handleJoinRoom = async (room) => {
    if (room.category === 'Exclusive' && !canAccessExclusive) {
      toast.error(t('vipRequired'));
      return;
    }
    if (room.isPrivate && !canAccessPrivate) {
      toast.error(t('premiumRequired'));
      return;
    }

    try {
      if (room.isPrivate && directoryTab !== 'joined') {
        await chatService.requestRoomAccessByID(room.id);
        toast.success(t('accessRequestSent'));
        setPreviewRoom(null);
        return;
      }
      await chatService.joinRoom(room.id);
      setPreviewRoom(null);
      navigate(`/rooms/${room.id}`, { state: { selectedRoom: room } });
    } catch (error) {
      toast.error(error.response?.data?.error || t('roomAccessFailed'));
    }
  };

  const handleJoinByCode = async (event) => {
    event.preventDefault();
    const code = roomCode.trim();
    if (!code) return;
    setIsJoiningByCode(true);
    try {
      const room = await chatService.joinRoomByCode(code);
      setRoomCode('');
      navigate(`/rooms/${room.id}`, { state: { selectedRoom: room } });
    } catch (error) {
      const reason = String(error.response?.data || '');
      if (reason.includes('requires approval')) {
        try {
          await chatService.requestRoomAccess(code);
          setRoomCode('');
          toast.success(t('accessRequestSent'));
        } catch (requestError) {
          toast.error(requestError.response?.data || t('roomAccessFailed'));
        }
      } else {
        toast.error(reason || t('roomAccessFailed'));
      }
    } finally {
      setIsJoiningByCode(false);
    }
  };

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const rawTags = formData.get('tags');
    const tagsArray = rawTags ? rawTags.split(',').map(t => t.trim()).filter(Boolean) : [];

    const isPrivate = formData.get('isPrivate') === 'on';
    const isVoiceRoom = formData.get('isVoiceRoom') === 'on';

    if (isPrivate && !canCreatePrivate) {
      toast.error(t('premiumRequired'));
      return;
    }

    const newRoomPayload = {
      name: formData.get('roomName'),
      icon: isVoiceRoom ? '🎙️' : (formData.get('roomIcon') || '🐾'),
      category: formData.get('category'),
      desc: formData.get('desc'),
      tags: tagsArray,
      isPrivate: isPrivate,
      isVoiceRoom: isVoiceRoom,
      content_mode: 'general',
      allow_media: true,
      allow_links: true,
    };

    try {
      const createdRoom = await chatService.createRoom(newRoomPayload);
      
      const formattedRoom = {
        ...createdRoom,
        tags: Array.isArray(createdRoom.tags) ? createdRoom.tags : [],
        isVoiceRoom: isVoiceRoom
      };

      setRooms(prev => [formattedRoom, ...prev]);
      setShowCreateModal(false);
      toast.success(t('loungeOpened', { name: formattedRoom.name }));
      
      navigate(`/rooms/${formattedRoom.id}`, { state: { selectedRoom: formattedRoom } });
    } catch (error) {
      console.error("Failed to create room:", error);
      toast.error(t('createLoungeFailed'));
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-black w-full relative overflow-hidden font-mono text-zinc-300 rounded-none" style={{ fontFamily: 'Roboto, sans-serif' }}>
      
      {/* HEADER SECTION */}
      <header className="flex flex-col border-b-2 border-zinc-800 bg-black shrink-0 shadow-[0_4px_20px_rgba(0,0,0,0.5)] z-20">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 border-2 bg-zinc-900 border-zinc-500 flex items-center justify-center font-black text-white text-xl">
              🐾
            </div>
            <div>
              <h1 className="text-lg font-black text-white uppercase tracking-widest flex items-center gap-2">
                {t('lounge')}
              </h1>
              <span className="text-[9px] font-bold text-green-400 uppercase tracking-widest flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-500 animate-pulse rounded-full" /> {t('roomCountActive', { count: processedRooms.length })}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 border-2 text-[9px] font-black uppercase tracking-widest
              ${userTier === 'VIP' ? 'bg-yellow-500/10 border-yellow-500 text-yellow-500' : 
                userTier === 'PREMIUM' ? 'bg-blue-500/10 border-blue-500 text-blue-500' : 
                'bg-zinc-900 border-zinc-700 text-zinc-400'}
            `}>
              {userTier === 'VIP' && <Crown className="w-3 h-3" />}
              {userTier === 'PREMIUM' && <Star className="w-3 h-3" />}
              {userTier === 'STANDARD' && <Users className="w-3 h-3" />}
              {userTier}
            </div>

            <button 
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 md:px-6 md:py-2 border-2 border-white bg-white text-black font-black uppercase tracking-widest text-[10px] hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
            >
                <Plus className="w-4 h-4" /> <span className="hidden md:inline">{t('startLounge')}</span>
            </button>
          </div>
        </div>

        {/* Search & Categories Bar */}
        <div className="px-4 pb-4 flex flex-col md:flex-row gap-4">
          <div className="relative w-full shrink-0 md:w-[clamp(16rem,26vw,20rem)]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input 
              type="text" 
              placeholder={t('roomSearchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border-2 border-zinc-800 rounded-none pl-9 pr-4 py-2.5 text-xs font-bold text-white uppercase tracking-widest focus:outline-none focus:border-zinc-500 transition-colors placeholder:text-zinc-700"
            />
          </div>
          <form onSubmit={handleJoinByCode} className="flex gap-2 shrink-0">
            <input
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
              placeholder="ROOM CODE"
              maxLength={20}
              className="w-[clamp(7rem,16vw,9rem)] border-2 border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-black tracking-widest text-white outline-none focus:border-zinc-500"
              aria-label="Room invite code"
            />
            <button disabled={isJoiningByCode || !roomCode.trim()} className="px-3 py-2 border-2 border-zinc-700 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-50">
              {isJoiningByCode ? 'Joining…' : 'Join code'}
            </button>
          </form>
          
          <div className="flex-1 overflow-x-auto custom-scrollbar flex items-center gap-2">
            <button
              onClick={() => setDirectoryTab('discover')}
              className={`px-4 py-2 border-2 text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${directoryTab === 'discover' ? 'bg-white text-black border-white' : 'bg-black text-zinc-500 border-zinc-800 hover:text-white'}`}
            >
              Discover
            </button>
            <button
              onClick={() => {
                setDirectoryTab('joined');
                setActiveCategory('All');
              }}
              className={`px-4 py-2 border-2 text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${directoryTab === 'joined' ? 'bg-white text-black border-white' : 'bg-black text-zinc-500 border-zinc-800 hover:text-white'}`}
            >
              My rooms
            </button>
            {directoryTab === 'discover' && CATEGORIES.map(cat => {
              const isExclusive = cat === 'Exclusive';
              const isLocked = isExclusive && !canAccessExclusive;

              return (
                <button
                  key={cat}
                  onClick={() => {
                    if (isLocked) {
                      toast.error(t('vipRequired'));
                      return;
                    }
                    setActiveCategory(cat);
                  }}
                  className={`px-4 py-2 border-2 text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-colors flex items-center gap-2
                    ${activeCategory === cat 
                      ? 'bg-zinc-800 text-white border-zinc-600' 
                      : isLocked 
                        ? 'bg-black text-zinc-700 border-zinc-800 cursor-not-allowed hover:border-red-900/50'
                        : 'bg-black text-zinc-600 border-zinc-800 hover:bg-zinc-900 hover:text-zinc-400'
                    }`}
                >
                  {cat === 'Trending' && <Flame className="w-3.5 h-3.5" />}
                  {isExclusive && (isLocked ? <Lock className="w-3.5 h-3.5 text-red-500/50" /> : <Shield className="w-3.5 h-3.5 text-yellow-500" />)}
                  {cat === 'Trending' ? t('hotCategory') : cat === 'All' ? t('allLikes') : cat}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* ROOM GRID */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3 lg:p-4 custom-scrollbar relative bg-black">
        <div className="w-full">
          <div className="flex items-center justify-between mb-4 border-b-2 border-zinc-800 pb-2">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
              {activeCategory === 'Trending' ? <Flame className="w-3.5 h-3.5 text-zinc-400" /> : <Hash className="w-3.5 h-3.5 text-zinc-400" />} 
              {activeCategory === 'All' ? t('availableLounges') : t('categoryLounges', { category: activeCategory })}
            </h2>
          </div>
          
          {isInitialLoading ? (
            <div className="w-full py-20 flex flex-col items-center justify-center text-center border-2 border-dashed border-zinc-800 bg-zinc-950/50">
              <Loader2 className="w-8 h-8 text-zinc-400 animate-spin mb-4" />
              <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{t('loading')} {t('lounges').toUpperCase()}...</h3>
            </div>
          ) : processedRooms.length === 0 ? (
            <div className="w-full py-20 flex flex-col items-center justify-center text-center border-2 border-dashed border-zinc-800 bg-zinc-950/50">
              <div className="w-16 h-16 bg-black flex items-center justify-center border-2 border-zinc-800 mb-4">
                <Search className="w-6 h-6 text-zinc-600" />
              </div>
              <h3 className="text-sm font-black text-white mb-2 uppercase tracking-widest">{t('noLounges')}</h3>
              <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest max-w-sm mb-6 leading-relaxed">
                {t('roomsNotFoundStart')}
              </p>
              <button 
                onClick={() => setShowCreateModal(true)}
                className="px-6 py-3 border-2 border-zinc-600 bg-zinc-800 text-white font-black uppercase tracking-widest text-[10px] hover:bg-zinc-700 transition-colors"
              >
                {t('startLounge')}
              </button>
            </div>
          ) : (
            <div 
              ref={gridRef}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4"
            >
              {processedRooms.map((room, idx) => {
                const isFocused = focusedIndex === idx;
                const isRoomLocked = (room.isPrivate && directoryTab !== 'joined' && !canAccessPrivate) || (room.category === 'Exclusive' && !canAccessExclusive);

                return (
                  <div 
                    key={room.id}
                    onClick={() => {
                      setFocusedIndex(idx);
                      setPreviewRoom(room);
                    }}
                    className={`
                      flex flex-col text-left bg-black border-2 p-4 transition-colors cursor-pointer group
                      ${isFocused ? 'border-zinc-500 bg-zinc-900' : 'border-zinc-800 hover:bg-zinc-950 hover:border-zinc-700'}
                      ${isRoomLocked ? 'opacity-75 hover:border-red-900/50' : ''}
                    `}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl bg-zinc-900 p-2 border-2 border-zinc-800 transition-colors flex items-center justify-center min-w-[48px] min-h-[48px] ${isRoomLocked ? '' : 'group-hover:bg-black'}`}>
                          {room.icon || '💬'}
                        </span>
                        {/* Type Identifier Badge */}
                        <span className={`px-2 py-0.5 border text-[8px] font-black uppercase tracking-widest flex items-center gap-1
                          ${room.isVoiceRoom ? 'bg-purple-950/40 border-purple-800 text-purple-400' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}
                        `}>
                          {room.isVoiceRoom ? <><Mic className="w-2.5 h-2.5" /> {t('voice')}</> : <><MessageSquare className="w-2.5 h-2.5" /> {t('text')}</>}
                        </span>
                      </div>

                      <span className={`px-2 py-1 border-2 text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5
                        ${room.category === 'Exclusive' ? 'bg-zinc-900 text-yellow-400 border-zinc-800' : 
                          room.isPrivate ? 'bg-zinc-900 text-blue-400 border-zinc-800' : 
                          'bg-black text-green-500 border-zinc-800'}
                      `}>
                        {room.category === 'Exclusive' ? (
                          <><Shield className="w-3 h-3" /> VIP</>
                        ) : room.isPrivate ? (
                          <><Lock className="w-3 h-3" /> {t('privateShort')}</>
                        ) : (
                          <><span className="w-1.5 h-1.5 bg-green-500"></span> {room.active || 0}</>
                        )}
                      </span>
                    </div>
                    
                    <div className="flex-1 flex flex-col">
                      <h3 className="text-sm font-black text-white mb-1 uppercase tracking-widest truncate flex items-center gap-2">
                        {room.name}
                        {isRoomLocked && <Lock className="w-3.5 h-3.5 text-zinc-600" />}
                      </h3>
                      <p className="mb-4 min-h-[2.5em] line-clamp-2 text-[10px] font-bold uppercase tracking-widest leading-relaxed text-zinc-500">
                        {room.desc || t('noDescription')}
                      </p>
                      
                      <div className="mt-auto flex flex-wrap gap-1.5">
                        {(room.tags || []).slice(0, 3).map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 border border-zinc-800 text-zinc-400 text-[9px] font-black uppercase tracking-widest bg-zinc-950">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {directoryTab === 'discover' && hasMore && (
            <div className="flex justify-center py-6">
              <button
                onClick={loadMoreRooms}
                disabled={isLoadingMore}
                className="px-6 py-3 border-2 border-zinc-700 bg-zinc-950 text-white text-[10px] font-black uppercase tracking-widest hover:border-white disabled:opacity-50"
              >
                {isLoadingMore ? 'Loading…' : 'Load more rooms'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ROOM PREVIEW MODAL */}
      {previewRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setPreviewRoom(null)} />
          
          <div className="relative w-full max-w-sm bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] flex flex-col animate-in zoom-in-95 duration-200">
            
            <div className="p-4 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="flex size-[clamp(4rem,9vw,5rem)] items-center justify-center border-2 border-zinc-800 bg-black p-3 text-4xl">
                  {previewRoom.icon || '💬'}
                </div>
                <div>
                  <span className={`px-2 py-0.5 border text-[8px] font-black uppercase tracking-widest inline-flex items-center gap-1 mb-1
                    ${previewRoom.isVoiceRoom ? 'bg-purple-950/40 border-purple-800 text-purple-400' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}
                  `}>
                    {previewRoom.isVoiceRoom ? <><Mic className="w-2.5 h-2.5" /> {t('voiceStageType')}</> : <><MessageSquare className="w-2.5 h-2.5" /> {t('textLoungeType')}</>}
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setPreviewRoom(null)}
                className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 flex-1">
              <div className="flex items-center gap-2 mb-2">
                {previewRoom.category === 'Exclusive' && <Shield className="w-4 h-4 text-yellow-400 shrink-0" />}
                {previewRoom.isPrivate && previewRoom.category !== 'Exclusive' && <Lock className="w-4 h-4 text-blue-400 shrink-0" />}
                <h2 className="text-lg font-black text-white uppercase tracking-widest truncate">{previewRoom.name}</h2>
              </div>
              
              <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-6">
                <span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> {previewRoom.category || 'General'}</span>
                <span>|</span>
                <span className="flex items-center gap-1 text-green-500">
                  <Users className="w-3.5 h-3.5" /> {t('activeCount', { count: previewRoom.active || 0 })}
                </span>
              </div>

              <div className="bg-zinc-950 p-4 border-2 border-zinc-800 mb-6">
                <h3 className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-2">{t('aboutLounge')}</h3>
                <p className="text-xs font-bold text-zinc-300 uppercase tracking-widest leading-relaxed mb-4">
                  {previewRoom.desc || t('noDescription')}
                </p>
                <div className="flex flex-wrap gap-2 pt-3 border-t-2 border-zinc-800">
                  {(previewRoom.tags || []).map(tag => (
                    <span key={tag} className="px-1.5 py-0.5 border border-zinc-700 text-zinc-400 text-[9px] font-black uppercase tracking-widest">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>

              {(() => {
                const isExclusiveLocked = previewRoom.category === 'Exclusive' && !canAccessExclusive;
                const isPrivateLocked = previewRoom.isPrivate && directoryTab !== 'joined' && !canAccessPrivate;
                const isLocked = isExclusiveLocked || isPrivateLocked;

                return (
                  <button 
                    onClick={() => handleJoinRoom(previewRoom)}
                    className={`w-full py-3 text-[10px] font-black uppercase tracking-widest border-2 transition-colors flex items-center justify-center gap-2
                      ${isLocked 
                        ? 'border-zinc-800 bg-zinc-900 text-zinc-500 cursor-not-allowed hover:border-red-900/50' 
                        : previewRoom.category === 'Exclusive'
                          ? 'border-yellow-400 bg-black text-yellow-400 hover:bg-yellow-400 hover:text-black'
                          : previewRoom.isPrivate
                            ? 'border-blue-400 bg-black text-blue-400 hover:bg-blue-400 hover:text-black'
                            : 'border-white bg-white text-black hover:bg-zinc-200'
                      }
                    `}
                  >
                    {isLocked ? (
                      <><Lock className="w-4 h-4" /> {t('upgradeUnlock')}</>
                    ) : previewRoom.isVoiceRoom ? (
                      <><Mic className="w-4 h-4" /> {t('joinVoice')}</>
                    ) : (
                      <><MessageSquare className="w-4 h-4" /> {t('enterText')}</>
                    )}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* CREATE ROOM MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
          
          <div className="relative flex max-h-[90dvh] w-full max-w-lg flex-col border-2 border-zinc-600 bg-black shadow-[8px_8px_0px_rgba(255,255,255,0.1)] animate-in zoom-in-95 duration-200">
            
            <div className="p-4 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center shrink-0">
              <h2 className="font-black text-sm uppercase tracking-widest text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-zinc-400" /> {t('startLounge')}
              </h2>
              <button onClick={() => setShowCreateModal(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRoom} className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
              <div className="p-6 space-y-5 flex-1">
                
                <div className="flex gap-4">
                  <div className="w-20 shrink-0">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">{t('icon')}</label>
                    <input 
                      type="text" 
                      name="roomIcon"
                      defaultValue="🐾"
                      className="w-full h-10 bg-zinc-950 border-2 border-zinc-800 text-center text-xl focus:border-zinc-500 outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">{t('loungeName')}</label>
                    <input 
                      type="text" 
                      name="roomName"
                      required
                      placeholder={t('loungeSearchExample')}
                      className="w-full h-10 bg-zinc-950 border-2 border-zinc-800 px-3 text-xs font-bold text-white uppercase tracking-widest focus:border-zinc-500 outline-none placeholder:text-zinc-700"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">{t('category')}</label>
                  <select 
                    name="category" 
                    className="w-full h-10 bg-zinc-950 border-2 border-zinc-800 px-3 text-xs font-bold text-white uppercase tracking-widest focus:border-zinc-500 outline-none appearance-none cursor-pointer"
                  >
                    {CATEGORIES.filter(c => c !== 'All' && c !== 'Trending').map(cat => (
                      <option key={cat} value={cat} disabled={cat === 'Exclusive' && !canAccessExclusive}>
                        {cat} {cat === 'Exclusive' && !canAccessExclusive ? '(VIP)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">{t('description')}</label>
                  <textarea 
                    name="desc"
                    required
                    rows="3"
                    placeholder={t('loungeDescriptionPlaceholder')}
                    className="w-full bg-zinc-950 border-2 border-zinc-800 p-3 text-xs font-bold text-white uppercase tracking-widest focus:border-zinc-500 outline-none resize-none custom-scrollbar placeholder:text-zinc-700"
                  ></textarea>
                </div>

                <div>
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">{t('tags')}</label>
                  <input 
                    type="text" 
                    name="tags"
                    placeholder={t('loungeTagsExample')}
                    className="w-full h-10 bg-zinc-950 border-2 border-zinc-800 px-3 text-xs font-bold text-white uppercase tracking-widest focus:border-zinc-500 outline-none placeholder:text-zinc-700"
                  />
                </div>

                {/* Voice Room Toggle Identifier */}
                <div 
                  className="p-3 bg-zinc-950 border-2 border-zinc-800 flex items-center justify-between cursor-pointer hover:border-zinc-600 transition-colors"
                  onClick={() => document.getElementById('isVoiceRoom').click()}
                >
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-widest mb-1 flex items-center gap-2">
                      <Mic className="w-3.5 h-3.5 text-purple-400" /> Live Voice Stage
                    </h4>
                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">
                      Enable zero-latency WebRTC voice communication.
                    </p>
                  </div>
                  <input type="checkbox" id="isVoiceRoom" name="isVoiceRoom" className="w-4 h-4 accent-purple-500" />
                </div>

                {/* Private Room Toggle */}
                <div 
                  className={`p-3 bg-zinc-950 border-2 flex items-center justify-between transition-colors ${canCreatePrivate ? 'border-zinc-800 cursor-pointer hover:border-zinc-600' : 'border-zinc-800/50 opacity-75 cursor-not-allowed'}`} 
                  onClick={() => canCreatePrivate && document.getElementById('isPrivate').click()}
                >
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-widest mb-1 flex items-center gap-2">
                      Private Lounge {!canCreatePrivate && <Lock className="w-3 h-3 text-yellow-500" />}
                    </h4>
                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">
                      {canCreatePrivate ? 'Only cats with an invite link or code can join.' : 'Upgrade to Premium to create private lounges.'}
                    </p>
                  </div>
                  <input type="checkbox" id="isPrivate" name="isPrivate" disabled={!canCreatePrivate} className="w-4 h-4 accent-zinc-500" />
                </div>

              </div>

              <div className="p-4 border-t-2 border-zinc-800 bg-zinc-950 shrink-0">
                <button 
                  type="submit"
                  className="w-full py-3 border-2 border-white bg-white text-black text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 transition-colors"
                >
                  Create & Enter Lounge
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}