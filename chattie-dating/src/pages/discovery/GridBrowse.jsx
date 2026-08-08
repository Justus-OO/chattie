import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Search, ChevronDown, Sparkles, X, Star, 
  SlidersHorizontal, Check, Flame, MapPin, Heart, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { discoveryService } from '../../api/discovery.service';

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function GridBrowse() {
  // --- CORE STATE ---
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMethod, setSortMethod] = useState('match'); // match, distance, newest
  
  // --- FILTER STATE ---
  const [filters, setFilters] = useState({
    intent: 'All',
    status: 'All',
    minAge: 18,
    maxAge: 40
  });

  // --- UI TOGGLES ---
  const [showFilters, setShowFilters] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  
  // --- SPATIAL NAVIGATION ---
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const gridRef = useRef(null);

  // --- FETCH PROFILES ON MOUNT OR FILTER CHANGE ---
  useEffect(() => {
    fetchGridProfiles();
  }, [filters, sortMethod]);

  const fetchGridProfiles = async () => {
    try {
      setLoading(true);
      const data = await discoveryService.getGridProfiles({
        limit: 50,
        offset: 0,
        minAge: filters.minAge,
        maxAge: filters.maxAge,
        intent: filters.intent === 'All' ? '' : filters.intent,
        status: filters.status,
        searchQuery: searchQuery,
        sortBy: sortMethod
      });
      setUsers(data || []);
    } catch (error) {
      toast.error(error.message || 'Failed to load grid profiles');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // CLIENT-SIDE SEARCH FILTERING
  // ============================================================================
  const processedUsers = useMemo(() => {
    if (!searchQuery) return users;
    const q = searchQuery.toLowerCase();
    return users.filter(u => 
      u.display_name?.toLowerCase().includes(q) || 
      u.tags?.some(t => t.toLowerCase().includes(q)) ||
      u.city?.toLowerCase().includes(q)
    );
  }, [users, searchQuery]);

  // ============================================================================
  // PROFILE CLICK HANDLER (Triggers Backend View Tracking!)
  // ============================================================================
  const handleProfileClick = async (user, idx) => {
    setFocusedIndex(idx);
    // Optimistically open modal with grid summary data
    setSelectedProfile(user);
    setIsLoadingProfile(true);

    try {
      // Fetch the full profile to get all images, full bio, and trigger the DB 'profile_view'
      const fullData = await discoveryService.getFullProfile(user.id);
      setSelectedProfile(fullData);
    } catch (err) {
      // If it fails, they still see the summary data, so no need to panic
      console.error("Failed to load full profile data", err);
    } finally {
      setIsLoadingProfile(false);
    }
  };

  // ============================================================================
  // KEYBOARD NAVIGATION LOGIC
  // ============================================================================
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (document.activeElement.tagName === 'INPUT') return;
      if (showFilters || selectedProfile) return;

      if (processedUsers.length === 0) return;

      const width = typeof window !== 'undefined' ? window.innerWidth : 1000;
      let cols = 2; 
      if (width >= 768) cols = 3; // md
      if (width >= 1024) cols = 4; // lg
      if (width >= 1280) cols = 5; // xl
      if (width >= 1536) cols = 6; // 2xl

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          setFocusedIndex(prev => Math.min(prev + 1, processedUsers.length - 1));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setFocusedIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex(prev => Math.min(prev + cols, processedUsers.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex(prev => Math.max(prev - cols, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (focusedIndex >= 0 && processedUsers[focusedIndex]) {
            handleProfileClick(processedUsers[focusedIndex], focusedIndex);
          }
          break;
        case 'Escape':
          setFocusedIndex(-1);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [processedUsers, showFilters, selectedProfile, focusedIndex]);

  useEffect(() => {
    if (focusedIndex >= 0 && gridRef.current && gridRef.current.children[focusedIndex]) {
      gridRef.current.children[focusedIndex].scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [focusedIndex]);

  // ============================================================================
  // ACTION HANDLERS
  // ============================================================================
  const handleQuickFlirt = async (e, user) => {
    e.stopPropagation(); 
    try {
      await discoveryService.sendInteraction(user.id, 'FLIRT');
      toast.success(`FLIRT SENT TO ${user.display_name.toUpperCase()}`);
    } catch (error) {
      toast.error(error.message || 'Failed to send flirt');
    }
  };

  const handleModalInteract = async (user, actionType) => {
    try {
      await discoveryService.sendInteraction(user.id, actionType);
      toast.success(`${actionType} SENT TO ${user.display_name.toUpperCase()}`);
      setSelectedProfile(null);
      // Remove from grid view locally
      setUsers(prev => prev.filter(u => u.id !== user.id));
    } catch (error) {
      toast.error(error.message || 'Failed to process interaction');
    }
  };

  const activeFiltersCount = Object.values(filters).filter((v, idx) => {
    if (idx === 2) return v !== 18; // minAge
    if (idx === 3) return v !== 40; // maxAge
    return v !== 'All';
  }).length;

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="flex-1 flex flex-col bg-black w-full h-full relative overflow-hidden text-zinc-300 rounded-none" style={{ fontFamily: 'Roboto, sans-serif' }}>
      
      {/* =====================================================================
          STICKY HEADER & CONTROLS
          ===================================================================== */}
      <header className="sticky top-0 z-20 p-4 md:p-6 border-b-2 border-zinc-800 bg-zinc-950 flex flex-col md:flex-row md:items-start justify-between gap-4 shrink-0">
        
        {/* Title & Online Pulse */}
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-zinc-100 border-2 border-zinc-100">
            <Sparkles className="w-5 h-5 text-black" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-normal flex items-center gap-2 leading-none mb-1">
              Browse Grid <span className="w-2 h-2 bg-green-500 border border-black animate-pulse mt-0.5"></span>
            </h1>
            <p className="text-[10px] text-zinc-500 tracking-normal font-normal">
              {processedUsers.length} PROFILES MATCHING
            </p>
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex flex-col md:flex-row items-center gap-2 w-full md:w-auto mt-2 md:mt-0">
          
          {/* Search Bar */}
          <div className="relative w-full md:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Search names or tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black border-2 border-zinc-800 rounded-none pl-9 pr-4 py-2.5 text-xs text-white tracking-normal focus:outline-none focus:border-zinc-500 transition-colors placeholder:text-zinc-700"
            />
          </div>

          {/* Sort Dropdown */}
          <div className="relative hidden md:block w-full md:w-auto">
            <button 
              onClick={() => setShowSort(!showSort)}
              className="w-full md:w-auto px-4 py-2.5 bg-black border-2 border-zinc-800 rounded-none text-[10px] font-normal tracking-normal text-zinc-300 hover:bg-zinc-900 transition-colors flex items-center justify-between gap-4"
            >
              {sortMethod === 'match' ? 'Top Matches' : sortMethod === 'distance' ? 'Nearest' : 'Newest'}
              <ChevronDown className={`w-4 h-4 transition-transform ${showSort ? 'rotate-180' : ''}`} />
            </button>
            
            {showSort && (
              <div className="absolute top-full right-0 mt-2 w-48 bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] z-30 animate-in fade-in duration-200">
                {[
                  { id: 'match', label: 'Top Matches' },
                  { id: 'distance', label: 'Nearest First' },
                  { id: 'newest', label: 'Recently Active' }
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => { setSortMethod(opt.id); setShowSort(false); }}
                    className={`w-full text-left px-4 py-3 text-[10px] font-normal tracking-normal transition-colors flex items-center justify-between border-b-2 border-zinc-800 last:border-b-0
                      ${sortMethod === opt.id ? 'bg-zinc-800 text-white' : 'bg-black text-zinc-400 hover:bg-zinc-900'}
                    `}
                  >
                    {opt.label}
                    {sortMethod === opt.id && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Filter Button */}
          <button 
            onClick={() => setShowFilters(true)}
            className={`w-full md:w-auto px-4 py-2.5 border-2 rounded-none text-[10px] font-normal tracking-normal flex items-center justify-center gap-2 transition-colors
              ${activeFiltersCount > 0 
                ? 'bg-white text-black border-white font-bold' 
                : 'bg-black border-zinc-800 text-zinc-300 hover:bg-zinc-900'}
            `}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="hidden md:inline">Filters</span>
            {activeFiltersCount > 0 && (
              <span className="w-4 h-4 bg-black text-white text-[9px] flex items-center justify-center font-bold">
                {activeFiltersCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* =====================================================================
          MAIN GRID AREA
          ===================================================================== */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar bg-black relative">
        
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-zinc-500 text-xs tracking-normal animate-pulse flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading grid profiles...
            </p>
          </div>
        ) : processedUsers.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto space-y-4 border-2 border-dashed border-zinc-800 p-8">
            <div className="w-16 h-16 bg-zinc-950 flex items-center justify-center border-2 border-zinc-800 mb-2">
              <Search className="w-6 h-6 text-zinc-600" />
            </div>
            <h2 className="text-sm font-bold text-white tracking-normal">No profiles found</h2>
            <p className="text-zinc-500 text-[10px] tracking-normal leading-relaxed">
              Try adjusting your search or clearing your filters to see more people.
            </p>
            <button 
              onClick={() => {
                setSearchQuery('');
                setFilters({ intent: 'All', status: 'All', minAge: 18, maxAge: 40 });
              }}
              className="px-6 py-3 bg-white text-black border-2 border-white text-[10px] font-bold tracking-normal hover:bg-zinc-200 transition-colors mt-4"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div 
            ref={gridRef}
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 w-full"
          >
            {processedUsers.map((user, idx) => {
              const isFocused = focusedIndex === idx;

              return (
                <div 
                  key={user.id} 
                  onClick={() => handleProfileClick(user, idx)}
                  className={`
                    group relative bg-black border-2 cursor-pointer transition-colors p-3 flex flex-col
                    ${isFocused ? 'border-white bg-zinc-900 z-10' : 'border-zinc-800 hover:border-zinc-600 hover:bg-zinc-950'}
                  `}
                >
                  
                  {/* Photo Container */}
                  <div className="aspect-[3/4] relative border-2 border-zinc-800 mb-3 overflow-hidden bg-zinc-950">
                    <img 
                      src={user.images?.[0] || 'https://images.unsplash.com/photo-1500000000000?auto=format&fit=crop&w=400&q=80'} 
                      alt={user.display_name} 
                      className="w-full h-full object-cover grayscale transition-transform duration-700 group-hover:scale-105" 
                    />
                    
                    {/* Match Badge */}
                    <div className="absolute top-2 right-2 bg-black border-2 border-zinc-800 px-2 py-1 flex items-center gap-1.5 z-10">
                      <Star className="w-3 h-3 text-white" />
                      <span className="text-[10px] font-bold text-white tracking-normal">{user.match_pct}%</span>
                    </div>
                  </div>

                  {/* Profile Info */}
                  <div className="flex items-center justify-between mb-1.5">
                    <h3 className="text-sm md:text-base font-bold text-white tracking-normal truncate">
                      {user.display_name}, {user.age}
                    </h3>
                  </div>
                  
                  <p className="text-[10px] text-zinc-500 tracking-normal flex items-center gap-1.5 mb-3 font-normal truncate">
                    <MapPin className="w-3 h-3 text-zinc-400 shrink-0" /> {user.city} ({user.distance} KM)
                  </p>
                  
                  {/* Hover Quick Action */}
                  <div className="mt-auto opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={(e) => handleQuickFlirt(e, user)}
                      className="w-full py-2.5 bg-white text-black border-2 border-white text-[10px] font-bold tracking-normal hover:bg-zinc-200 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Flame className="w-4 h-4" /> Quick Flirt
                    </button>
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* =====================================================================
          FILTERS MODAL
          ===================================================================== */}
      {showFilters && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowFilters(false)} />
          
          <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] flex flex-col max-h-[85vh] animate-in slide-in-from-bottom-10 md:zoom-in-95 duration-200 rounded-none">
            
            <div className="p-4 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center shrink-0">
              <h2 className="font-bold text-sm tracking-normal text-white flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-zinc-400" /> Filter Grid
              </h2>
              <button onClick={() => setShowFilters(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-8 flex-1 custom-scrollbar">
              
              {/* Intent Filter */}
              <section>
                <h3 className="text-[10px] font-normal text-zinc-500 tracking-normal mb-3">LOOKING FOR</h3>
                <div className="grid grid-cols-2 gap-2">
                  {['All', 'Casual', 'Dating', 'Friends'].map(intent => (
                    <button
                      key={intent}
                      onClick={() => setFilters(prev => ({ ...prev, intent }))}
                      className={`p-3 border-2 text-[10px] font-normal tracking-normal transition-colors
                        ${filters.intent === intent 
                          ? 'bg-white border-white text-black font-bold' 
                          : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-950'
                        }`}
                    >
                      {intent}
                    </button>
                  ))}
                </div>
              </section>

              {/* Status Filter */}
              <section>
                <h3 className="text-[10px] font-normal text-zinc-500 tracking-normal mb-3">ACTIVITY STATUS</h3>
                <div className="flex gap-2">
                  {['All', 'Online', 'Offline'].map(status => (
                    <button
                      key={status}
                      onClick={() => setFilters(prev => ({ ...prev, status }))}
                      className={`flex-1 py-3 border-2 text-[10px] font-normal tracking-normal transition-colors
                        ${filters.status === status 
                          ? 'bg-white border-white text-black font-bold' 
                          : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-950'
                        }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </section>

              {/* Age Range Filter */}
              <section>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-[10px] font-normal text-zinc-500 tracking-normal">AGE RANGE</h3>
                  <span className="text-[10px] font-bold text-white tracking-normal">{filters.minAge} - {filters.maxAge}</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[9px] text-zinc-600 font-normal tracking-normal">MIN</span>
                    <input 
                      type="number" 
                      min="18" max="99"
                      value={filters.minAge}
                      onChange={(e) => setFilters(prev => ({ ...prev, minAge: Math.max(18, parseInt(e.target.value) || 18) }))}
                      className="w-full bg-black border-2 border-zinc-800 py-3 pl-12 pr-4 text-[10px] font-bold text-white tracking-normal focus:border-white outline-none rounded-none"
                    />
                  </div>
                  <span className="text-zinc-600 font-bold">-</span>
                  <div className="flex-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[9px] text-zinc-600 font-normal tracking-normal">MAX</span>
                    <input 
                      type="number" 
                      min={filters.minAge} max="99"
                      value={filters.maxAge}
                      onChange={(e) => setFilters(prev => ({ ...prev, maxAge: Math.min(99, parseInt(e.target.value) || 99) }))}
                      className="w-full bg-black border-2 border-zinc-800 py-3 pl-12 pr-4 text-[10px] font-bold text-white tracking-normal focus:border-white outline-none rounded-none"
                    />
                  </div>
                </div>
              </section>

            </div>

            <div className="p-4 border-t-2 border-zinc-800 bg-zinc-950 shrink-0 flex gap-3">
              <button 
                onClick={() => setFilters({ intent: 'All', status: 'All', minAge: 18, maxAge: 40 })}
                className="flex-1 py-3 bg-black border-2 border-zinc-700 text-zinc-300 text-[10px] font-normal tracking-normal hover:bg-zinc-900 hover:text-white transition-colors"
              >
                Reset
              </button>
              <button 
                onClick={() => setShowFilters(false)}
                className="flex-[2] py-3 bg-white text-black border-2 border-white text-[10px] font-bold tracking-normal hover:bg-zinc-200 transition-colors"
              >
                Apply Filters
              </button>
            </div>

          </div>
        </div>
      )}

      {/* =====================================================================
          EXPANDED PROFILE MODAL
          ===================================================================== */}
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
                <span className="text-[10px] font-bold tracking-normal text-white">{selectedProfile.match_pct}% Match</span>
              </div>
            </div>

            {/* Profile Data Area */}
            <div className="flex-1 flex flex-col p-6 md:p-8 overflow-y-auto custom-scrollbar bg-black relative">
              
              {/* Desktop Close */}
              <button 
                onClick={() => setSelectedProfile(null)}
                className="hidden md:flex self-end items-center gap-2 p-2 bg-black border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 text-[10px] font-normal tracking-normal text-zinc-400 hover:text-white transition-colors mb-2"
              >
                Close <X className="w-4 h-4" />
              </button>

              <div className="mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-3xl md:text-4xl font-bold text-white tracking-normal">
                    {selectedProfile.display_name}
                  </h2>
                  <span className="text-2xl md:text-3xl text-zinc-500 font-light">{selectedProfile.age}</span>
                  
                  {/* Loading Spinner for high-res fetch */}
                  {isLoadingProfile && <Loader2 className="w-5 h-5 animate-spin text-zinc-500 ml-2" />}
                </div>
                
                <p className="text-zinc-400 flex items-center gap-1.5 text-[10px] font-normal tracking-normal">
                  <MapPin className="w-3.5 h-3.5 text-zinc-500" /> {selectedProfile.city} ({selectedProfile.distance} KM Away)
                </p>
              </div>

              <div className="space-y-6 mb-8 flex-1">
                {/* Tags block */}
                <div className="flex flex-wrap items-center gap-2">
                  {(selectedProfile.tags || []).map(tag => (
                    <span key={tag} className="px-2 py-1 bg-zinc-950 border-2 border-zinc-800 text-zinc-400 text-[9px] font-normal tracking-normal">
                      #{tag}
                    </span>
                  ))}
                </div>

                <section>
                  <h3 className="text-[10px] font-normal text-zinc-600 tracking-normal mb-3">About Me</h3>
                  <p className="text-zinc-300 text-[10px] md:text-xs leading-relaxed tracking-normal bg-zinc-950 p-4 border-2 border-zinc-800">
                    {selectedProfile.bio || "No bio provided."}
                  </p>
                </section>
              </div>

              {/* Action Buttons */}
              <div className="mt-auto grid grid-cols-2 gap-4 pt-6 border-t-2 border-zinc-800">
                <button 
                  onClick={() => handleModalInteract(selectedProfile, 'PASS')}
                  className="py-4 bg-black border-2 border-zinc-700 text-zinc-300 text-[10px] font-normal tracking-normal hover:bg-zinc-900 transition-colors"
                >
                  Pass
                </button>
                <button 
                  onClick={() => handleModalInteract(selectedProfile, 'LIKE')}
                  className="py-4 bg-white text-black border-2 border-white text-[10px] font-bold tracking-normal hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
                >
                  <Heart className="w-4 h-4 fill-black" /> Like Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}