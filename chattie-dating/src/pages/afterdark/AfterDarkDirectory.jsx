import React, { useState, useEffect } from 'react';
import { 
  Users, Search, ChevronRight, ChevronLeft,
  LayoutGrid, List, CheckCircle2, MapPin, Eye, SlidersHorizontal,
  X, Activity, Camera, Sparkles, Radio, Heart, ArrowUpDown
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { afterDarkService } from '../../api/afterdark.service';

const normalizeCreator = creator => ({
  ...creator,
  id: creator.id || creator.creator_id,
  username: creator.username || creator.alias || '',
  displayName: creator.displayName || creator.display_name || creator.name || creator.username || '',
  avatar: creator.avatar || creator.avatar_url || '',
  cover: creator.cover || creator.cover_url || '',
  bio: creator.bio || '',
  isVerified: Boolean(creator.isVerified ?? creator.is_verified),
  isOnline: Boolean(creator.isOnline ?? creator.is_live ?? creator.is_online),
  subPrice: Number(creator.subPrice ?? creator.subscription_price ??
    (creator.subscription_price_cents !== undefined ? creator.subscription_price_cents / 100 : 0)),
  location: creator.location || '',
  stats: {
    subs: Number(creator.stats?.subs ?? creator.subscriber_count ?? 0),
    posts: Number(creator.stats?.posts ?? creator.post_count ?? 0),
    likes: Number(creator.stats?.likes ?? creator.like_count ?? 0),
  },
  joinedAt: creator.joinedAt || creator.joined_at || '',
});

const priceToCents = value => {
  if (value === '') return undefined;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? Math.round(price * 100) : undefined;
};

const formatSubscriptionPrice = price => price === 0
  ? 'FREE'
  : `KES ${price.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

const creatorInitials = creator => (creator.displayName || creator.username || '?')
  .split(/\s+/)
  .slice(0, 2)
  .map(part => part[0])
  .join('')
  .toUpperCase();

// ============================================================================
// INLINE COMPONENT: QUICK VIEW MODAL
// ============================================================================
const QuickViewModal = ({ creator, onClose, onNavigate }) => {
  if (!creator) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={onClose} />
      
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-y-auto border-2 border-zinc-700 bg-black font-mono animate-in zoom-in-95 duration-200">
        <div className="relative h-32 shrink-0 overflow-hidden border-b-2 border-zinc-800 bg-zinc-900 group">
          {creator.cover && <img src={creator.cover} alt="" className="w-full h-full object-cover opacity-40 grayscale group-hover:grayscale-0 transition-all duration-700" />}
          <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-black border-2 border-zinc-800 hover:text-white transition-colors z-10">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative px-4 pb-4 sm:px-6 sm:pb-6">
          <div className="relative z-10 mb-4 -mt-12 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <div className="relative">
              {creator.avatar ? (
                <img src={creator.avatar} alt={creator.username} className="h-24 w-24 border-4 border-black bg-zinc-900 object-cover" />
              ) : (
                <div aria-label={creator.displayName} className="flex h-24 w-24 items-center justify-center border-4 border-black bg-zinc-800 text-2xl font-black text-white">
                  {creatorInitials(creator)}
                </div>
              )}
              {creator.isOnline && <div className="absolute bottom-1 right-1 h-4 w-4 animate-pulse border-2 border-black bg-white" />}
            </div>
            <button 
              onClick={() => onNavigate(creator.id)}
              className="border-2 border-white bg-white px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-zinc-200 sm:px-6"
            >
              VIEW FULL PROFILE
            </button>
          </div>

          <div className="mb-6">
            <h2 className="text-xl font-black text-white uppercase tracking-widest flex items-center gap-2">
              {creator.displayName}
              {creator.isVerified && <CheckCircle2 className="h-5 w-5 text-white" />}
            </h2>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">@{creator.username}</p>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div className="bg-zinc-950 border-2 border-zinc-800 p-4 text-center">
              <Users className="w-5 h-5 text-zinc-400 mx-auto mb-2" />
              <div className="text-sm font-black text-white">{creator.stats.subs.toLocaleString()}</div>
              <div className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">VIP Subs</div>
            </div>
            <div className="bg-zinc-950 border-2 border-zinc-800 p-4 text-center">
              <Camera className="w-5 h-5 text-zinc-400 mx-auto mb-2" />
              <div className="text-sm font-black text-white">{creator.stats.posts.toLocaleString()}</div>
              <div className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Vault Media</div>
            </div>
            <div className="bg-zinc-950 border-2 border-zinc-800 p-4 text-center">
              <Activity className="w-5 h-5 text-zinc-400 mx-auto mb-2" />
              <div className="text-sm font-black text-white">{creator.stats.likes.toLocaleString()}</div>
              <div className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Total Likes</div>
            </div>
          </div>

          <div className="bg-zinc-950 border-2 border-zinc-800 p-4 mb-6">
            <h3 className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-2">BIOGRAPHY</h3>
            <p className="text-[10px] font-bold text-zinc-300 leading-relaxed uppercase">{creator.bio || 'This creator has not added a bio yet.'}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {creator.location && (
              <span className="flex items-center gap-1 border border-zinc-800 bg-black px-3 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-300">
                <MapPin className="h-3 w-3" /> {creator.location}
              </span>
            )}
            <span className="border border-zinc-800 bg-black px-3 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-300">
              {formatSubscriptionPrice(creator.subPrice)} / MONTH
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// INLINE COMPONENT: CREATOR GRID CARD
// ============================================================================
const CreatorGridCard = ({ creator, onQuickView, onNavigate }) => {
  return (
    <div className="group relative flex min-w-0 flex-col overflow-hidden border-2 border-zinc-800 bg-black transition-colors hover:border-zinc-600">
      {/* Cover & Avatar Header */}
      <div className="relative h-32 shrink-0 cursor-pointer overflow-hidden border-b-2 border-zinc-800 bg-zinc-900" onClick={() => onNavigate(creator.id)}>
        {creator.cover && (
          <img src={creator.cover} alt="" className="w-full h-full object-cover opacity-50 grayscale group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700" />
        )}
        <div className="absolute top-2 left-2 flex gap-2">
          {creator.isOnline && (
            <span className="flex items-center gap-1 border border-zinc-600 bg-black/90 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-white backdrop-blur-sm">
              <div className="h-1.5 w-1.5 animate-pulse bg-white" /> LIVE
            </span>
          )}
          {creator.isVerified && (
            <span className="flex items-center gap-1 border border-zinc-600 bg-black/90 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-white backdrop-blur-sm">
          <CheckCircle2 className="h-3 w-3" /> VERIFIED
            </span>
          )}
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col relative">
        {/* Floating Avatar */}
        <div className="absolute -top-8 left-4">
          {creator.avatar ? (
            <img src={creator.avatar} alt="" className="h-14 w-14 border-2 border-black bg-zinc-900 object-cover" />
          ) : (
            <div aria-label={creator.displayName} className="flex h-14 w-14 items-center justify-center border-2 border-black bg-zinc-800 text-sm font-black text-white">
              {creatorInitials(creator)}
            </div>
          )}
        </div>

        {/* Quick View Button */}
        <button 
          onClick={(e) => { e.stopPropagation(); onQuickView(creator); }}
          className="absolute -top-5 right-4 w-10 h-10 bg-black border-2 border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white hover:border-white transition-colors z-10 opacity-0 group-hover:opacity-100"
          title="Quick View"
        >
          <Eye className="w-4 h-4" />
        </button>

        <div className="mt-8 mb-4">
          <h3 className="flex cursor-pointer items-center gap-1.5 truncate text-sm font-black uppercase tracking-widest text-white transition-colors hover:text-zinc-300" onClick={() => onNavigate(creator.id)}>
            {creator.displayName}
            {creator.isVerified && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-white" />}
          </h3>
          <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest truncate">@{creator.username}</p>
        </div>

        <p className="text-[9px] font-bold text-zinc-400 uppercase leading-relaxed line-clamp-2 mb-4 flex-1">
          {creator.bio}
        </p>

        <div className="mb-4 flex min-h-8 flex-wrap items-center gap-2">
          {creator.location && (
            <span className="flex items-center gap-1 border border-zinc-800 bg-zinc-950 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-zinc-400">
              <MapPin className="h-3 w-3" /> {creator.location}
            </span>
          )}
          {creator.isOnline && (
            <span className="flex items-center gap-1 border border-white/30 bg-white/5 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-white">
              <Radio className="h-3 w-3" /> Live now
            </span>
          )}
        </div>

        <div className="flex items-center justify-between pt-4 border-t-2 border-zinc-900 mt-auto">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-[9px] font-black text-white uppercase tracking-widest">
              <Users className="w-3 h-3 text-zinc-500" /> {creator.stats.subs >= 1000 ? (creator.stats.subs/1000).toFixed(1)+'k' : creator.stats.subs}
            </span>
            <span className="flex items-center gap-1 text-[9px] font-black text-white uppercase tracking-widest">
              <Camera className="w-3 h-3 text-zinc-500" /> {creator.stats.posts}
            </span>
            <span className="hidden items-center gap-1 text-[9px] font-black text-white uppercase tracking-widest xl:flex">
              <Heart className="w-3 h-3 text-zinc-500" /> {creator.stats.likes}
            </span>
          </div>
          <span className="text-[10px] font-black tracking-widest text-white">
            {formatSubscriptionPrice(creator.subPrice)}
          </span>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// INLINE COMPONENT: CREATOR LIST ROW
// ============================================================================
const CreatorListRow = ({ creator, onQuickView, onNavigate }) => {
  return (
    <div className="mb-2 flex min-w-0 flex-col gap-3 border-2 border-zinc-800 bg-black p-4 transition-colors hover:border-zinc-600 group sm:flex-row sm:items-center sm:justify-between" onClick={() => onNavigate(creator.id)}>
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className="relative shrink-0">
          {creator.avatar ? (
            <img src={creator.avatar} alt="" className="h-12 w-12 border-2 border-zinc-700 object-cover grayscale transition-all group-hover:grayscale-0" />
          ) : (
            <div aria-label={creator.displayName} className="flex h-12 w-12 items-center justify-center border-2 border-zinc-700 bg-zinc-800 text-xs font-black text-white">
              {creatorInitials(creator)}
            </div>
          )}
          {creator.isOnline && <div className="absolute -bottom-1 -right-1 h-3 w-3 border border-black bg-white" />}
        </div>
        <div className="flex flex-col min-w-0 pr-4">
          <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2 truncate">
            {creator.displayName}
            {creator.isVerified && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-white" />}
          </h3>
          <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest truncate">
            @{creator.username}{creator.location ? ` · ${creator.location}` : ''}
          </p>
        </div>
      </div>

      <div className="hidden md:flex items-center gap-8 px-8 flex-1 justify-center border-x-2 border-zinc-900">
        <div className="text-center">
          <div className="text-xs font-black text-white">{creator.stats.subs.toLocaleString()}</div>
          <div className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Subscribers</div>
        </div>
        <div className="text-center">
          <div className="text-xs font-black text-white">{creator.stats.posts.toLocaleString()}</div>
          <div className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Media</div>
        </div>
        <div className="text-center">
          <div className="text-xs font-black text-white">{creator.stats.likes.toLocaleString()}</div>
          <div className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Likes</div>
        </div>
        <div className="text-center">
          <div className="text-xs font-black text-white">{formatSubscriptionPrice(creator.subPrice)}</div>
          <div className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Per Month</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-3 sm:ml-4">
        <button 
          onClick={(e) => { e.stopPropagation(); onQuickView(creator); }}
          className="p-3 bg-zinc-950 border-2 border-zinc-800 text-zinc-400 hover:text-white hover:border-white transition-colors opacity-0 group-hover:opacity-100 hidden sm:block"
          title="Quick View"
        >
          <Eye className="w-4 h-4" />
        </button>
        <button className="px-6 py-3 bg-white text-black font-black uppercase text-[9px] tracking-widest border-2 border-white hover:bg-zinc-200 transition-colors hidden sm:block">
          VIEW
        </button>
        <ChevronRight className="w-5 h-5 text-zinc-600 sm:hidden" />
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT: DIRECTORY
// ============================================================================
export default function AfterDarkDirectory() {
  const navigate = useNavigate();
  
  // --- UI State ---
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [quickViewCreator, setQuickViewCreator] = useState(null);

  // --- Filtering & Sorting State ---
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [showVerifiedOnly, setShowVerifiedOnly] = useState(false);
  const [showOnlineOnly, setShowOnlineOnly] = useState(false);
  const [sortBy, setSortBy] = useState('popular');
  const [creators, setCreators] = useState([]);
  const [totalCreators, setTotalCreators] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  // --- Pagination State ---
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = viewMode === 'grid' ? 12 : 20;

  const totalPages = Math.max(1, Math.ceil(totalCreators / itemsPerPage));
  const hasInvalidPriceRange = (minPrice !== '' && priceToCents(minPrice) === undefined)
    || (maxPrice !== '' && priceToCents(maxPrice) === undefined)
    || (minPrice !== '' && maxPrice !== '' && Number(minPrice) > Number(maxPrice));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, showVerifiedOnly, showOnlineOnly, selectedLocation, minPrice, maxPrice, sortBy, viewMode]);

  useEffect(() => {
    let active = true;
    if (hasInvalidPriceRange) {
      setIsLoading(false);
      setLoadError('');
      setCreators([]);
      setTotalCreators(0);
      return () => { active = false; };
    }
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const response = await afterDarkService.getDirectory({
          q: searchQuery.trim() || undefined,
          location: selectedLocation.trim() || undefined,
          min_price_cents: priceToCents(minPrice),
          max_price_cents: priceToCents(maxPrice),
          verified_only: showVerifiedOnly || undefined,
          online_only: showOnlineOnly || undefined,
          sort: sortBy,
          page: currentPage,
          limit: itemsPerPage,
        });
        if (!active) return;
        const records = Array.isArray(response)
          ? response
          : response?.creators || response?.items || response?.results || response?.data || [];
        if (!Array.isArray(records)) throw new Error('The creator directory returned an invalid response.');
        setCreators(records.map(normalizeCreator));
        setTotalCreators(Number(response?.total ?? response?.pagination?.total ?? records.length));
      } catch (error) {
        if (!active) return;
        setCreators([]);
        setTotalCreators(0);
        setLoadError(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load creators.'));
      } finally {
        if (active) setIsLoading(false);
      }
    }, searchQuery ? 250 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [searchQuery, selectedLocation, minPrice, maxPrice, hasInvalidPriceRange, showVerifiedOnly, showOnlineOnly, sortBy, currentPage, itemsPerPage, reloadToken]);

  const paginatedCreators = creators;
  const liveCreators = creators.filter(creator => creator.isOnline);
  const activeFilterCount = Number(showVerifiedOnly) + Number(showOnlineOnly)
    + Number(Boolean(selectedLocation.trim())) + Number(minPrice !== '') + Number(maxPrice !== '');

  // ==========================================
  // HANDLERS
  // ==========================================
  const handleNavigateProfile = (id) => {
    const creator = creators.find(item => item.id === id);
    if (creator) navigate(`/afterdark/cprofile/${encodeURIComponent(creator.id)}`, { state: { creator } });
  };

  // ==========================================
  // RENDER BLOCKS
  // ==========================================
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black font-mono text-zinc-300">
      
      {/* LEFT SIDEBAR FILTERS (Desktop) & DRAWER (Mobile) */}
      {isSidebarOpen && (
      <div className="fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col border-r-2 border-zinc-800 bg-zinc-950">
        <div className="flex shrink-0 items-center justify-between border-b-2 border-zinc-800 bg-black p-4">
          <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-zinc-400" /> FILTERS
          </h2>
          <button onClick={() => setIsSidebarOpen(false)} aria-label="Collapse filters" className="p-1 text-zinc-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
          
          {/* Quick Toggles */}
          <div className="space-y-3">
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-[10px] font-black text-zinc-400 group-hover:text-white uppercase tracking-widest transition-colors flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Verified Only
              </span>
              <div className={`flex h-5 w-10 items-center border-2 p-0.5 transition-colors ${showVerifiedOnly ? 'justify-end border-white bg-white' : 'justify-start border-zinc-700 bg-black'}`}>
                <div className="w-3 h-3 bg-black border border-black" />
              </div>
              <input type="checkbox" className="hidden" checked={showVerifiedOnly} onChange={() => setShowVerifiedOnly(!showVerifiedOnly)} />
            </label>
            
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-[10px] font-black text-zinc-400 group-hover:text-white uppercase tracking-widest transition-colors flex items-center gap-2">
                <Activity className="w-4 h-4" /> Online Now
              </span>
              <div className={`flex h-5 w-10 items-center border-2 p-0.5 transition-colors ${showOnlineOnly ? 'justify-end border-white bg-white' : 'justify-start border-zinc-700 bg-black'}`}>
                <div className="w-3 h-3 bg-black border border-black" />
              </div>
              <input type="checkbox" className="hidden" checked={showOnlineOnly} onChange={() => setShowOnlineOnly(!showOnlineOnly)} />
            </label>
          </div>

          {/* Location Filter */}
          <div className="space-y-3">
            <h3 className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <MapPin className="w-3 h-3" /> LOCATION
            </h3>
            <input
              type="search"
              value={selectedLocation}
              onChange={event => setSelectedLocation(event.target.value)}
              placeholder="Any city or region"
              className="w-full border-2 border-zinc-800 bg-black p-3 text-[10px] font-bold uppercase text-white outline-none placeholder:text-zinc-700 focus:border-white"
            />
          </div>

          {/* Subscription Price Filter */}
          <div className="space-y-3">
            <h3 className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">MONTHLY SUBSCRIPTION (KES)</h3>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">
                Minimum
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={minPrice}
                  onChange={event => setMinPrice(event.target.value)}
                  placeholder="0"
                  className="mt-1 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white"
                />
              </label>
              <label className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">
                Maximum
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={maxPrice}
                  onChange={event => setMaxPrice(event.target.value)}
                  placeholder="Any"
                  className="mt-1 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white"
                />
              </label>
            </div>
            {hasInvalidPriceRange && (
              <p role="alert" className="text-[9px] font-bold uppercase tracking-widest text-red-400">Enter a valid range with minimum no higher than maximum.</p>
            )}
          </div>
        </div>

        <div className="p-4 border-t-2 border-zinc-800 bg-black shrink-0">
          <button 
            onClick={() => {
              setSelectedLocation('');
              setMinPrice('');
              setMaxPrice('');
              setShowVerifiedOnly(false);
              setShowOnlineOnly(false);
              setSearchQuery('');
              setSortBy('popular');
            }}
            className="w-full border-2 border-zinc-800 bg-black py-3 text-[10px] font-black uppercase tracking-widest text-zinc-400 transition-colors hover:border-white hover:text-white"
          >
            RESET ALL FILTERS
          </button>
        </div>
      </div>
      )}

      {/* BACKDROP FOR FILTER DRAWER */}
      {isSidebarOpen && (
        <button type="button" aria-label="Close filters" className="fixed inset-0 z-30 cursor-default bg-black/70 backdrop-blur-sm" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* MAIN CONTENT AREA */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        
        {/* Top Action Bar */}
        <header className="relative z-20 flex shrink-0 flex-col gap-4 border-b-2 border-zinc-800 bg-black p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              aria-expanded={isSidebarOpen}
              className="flex shrink-0 items-center gap-2 border-2 border-zinc-800 bg-black px-3 py-2.5 text-zinc-300 transition-colors hover:border-white hover:text-white"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="text-[9px] font-black uppercase tracking-widest">Filters</span>
            </button>
            <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search names, usernames, bios..."
                className="w-full border-2 border-zinc-800 bg-black py-2.5 pl-10 pr-4 text-[10px] font-bold uppercase text-white outline-none transition-colors placeholder:text-zinc-700 focus:border-white"
              />
            </div>
          </div>

          <div className="flex min-w-0 items-center justify-between gap-3 sm:gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
              <span className="hidden items-center gap-1 text-[9px] font-black uppercase tracking-widest text-zinc-600 sm:flex"><ArrowUpDown className="h-3 w-3" /> SORT BY:</span>
              <select 
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="min-w-0 flex-1 appearance-none border-2 border-zinc-800 bg-black p-2 text-[10px] font-bold uppercase text-white outline-none focus:border-white sm:min-w-[120px] sm:flex-none"
              >
                <option value="popular">Most Popular</option>
                <option value="most_subscribers">Most Subscribers</option>
                <option value="most_content">Most Content</option>
                <option value="most_liked">Most Liked</option>
                <option value="newest">Newest Creators</option>
                <option value="price_low">Price: Low to High</option>
                <option value="price_high">Price: High to Low</option>
              </select>
            </div>
            
            <div className="hidden sm:flex border-2 border-zinc-800 bg-black">
              <button 
                onClick={() => setViewMode('grid')}
                className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={`p-2 transition-colors border-l-2 border-zinc-800 ${viewMode === 'list' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Directory Content Area */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-black p-4 custom-scrollbar sm:p-6">
          
          {/* Results Summary */}
          <div className="mb-6 border-b-2 border-zinc-800 pb-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="mb-2 flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.25em] text-zinc-500">
                  <Sparkles className="h-3.5 w-3.5 text-white" /> Find your next favorite
                </p>
                <h1 className="flex items-center gap-3 text-xl font-black uppercase tracking-widest text-white sm:text-2xl">
                  <Users className="h-6 w-6 text-white" /> CREATOR DIRECTORY
                </h1>
                <p className="mt-2 max-w-2xl text-[9px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
                  Explore creators by live status, verification, location, content, audience, and monthly price.
                </p>
              </div>
              <span className="w-fit border-2 border-zinc-800 bg-zinc-950 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">
                {totalCreators.toLocaleString()} {totalCreators === 1 ? 'CREATOR' : 'CREATORS'}
              </span>
            </div>
            {activeFilterCount > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-[8px] font-black uppercase tracking-widest text-zinc-600">Active filters</span>
                {showVerifiedOnly && <span className="border border-zinc-700 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-zinc-300">Verified</span>}
                {showOnlineOnly && <span className="border border-zinc-700 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-zinc-300">Live now</span>}
                {selectedLocation.trim() && <span className="border border-zinc-700 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-zinc-300">{selectedLocation}</span>}
                {minPrice !== '' && <span className="border border-zinc-700 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-zinc-300">From KES {minPrice}</span>}
                {maxPrice !== '' && <span className="border border-zinc-700 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-zinc-300">To KES {maxPrice}</span>}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedLocation('');
                    setMinPrice('');
                    setMaxPrice('');
                    setShowVerifiedOnly(false);
                    setShowOnlineOnly(false);
                    setSearchQuery('');
                    setSortBy('popular');
                  }}
                  className="px-2 py-1 text-[8px] font-black uppercase tracking-widest text-white underline underline-offset-2"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>

          {!isLoading && !loadError && liveCreators.length > 0 && !showOnlineOnly && (
            <section aria-label="Creators live now" className="mb-7 border-2 border-zinc-800 bg-zinc-950 p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white">
                    <Radio className="h-4 w-4 text-red-400" /> Live right now
                  </h2>
                  <p className="mt-1 text-[8px] font-bold uppercase tracking-widest text-zinc-500">Join an active creator broadcast</p>
                </div>
                <button type="button" onClick={() => setShowOnlineOnly(true)} className="text-[8px] font-black uppercase tracking-widest text-zinc-300 hover:text-white">See all live</button>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {liveCreators.slice(0, 8).map(creator => (
                  <button
                    key={creator.id}
                    type="button"
                    onClick={() => handleNavigateProfile(creator.id)}
                    className="flex w-36 shrink-0 items-center gap-3 border border-zinc-800 bg-black p-2 text-left transition-colors hover:border-white"
                  >
                    <span className="relative h-10 w-10 shrink-0">
                      <img src={creator.avatar} alt="" className="h-full w-full border border-zinc-700 bg-zinc-900 object-cover" />
                      <span className="absolute -bottom-1 -right-1 h-3 w-3 border-2 border-black bg-red-500" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[9px] font-black uppercase tracking-widest text-white">{creator.displayName}</span>
                      <span className="mt-1 block text-[8px] font-bold uppercase tracking-widest text-red-300">Live now</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Grid / List Content */}
          {hasInvalidPriceRange ? (
            <div role="alert" className="border-2 border-amber-900 bg-black py-16 text-center text-xs font-bold uppercase tracking-widest text-amber-300">
              Check the subscription price range in filters and try again.
            </div>
          ) : isLoading ? (
            <div role="status" className="py-20 text-center text-xs font-bold uppercase tracking-widest text-zinc-500">Loading creators…</div>
          ) : loadError ? (
            <div role="alert" className="border-2 border-red-900 bg-black py-20 text-center text-xs font-bold uppercase tracking-widest text-red-500">
              {loadError}
              <button type="button" onClick={() => setReloadToken(token => token + 1)} className="ml-3 text-white underline">Retry</button>
            </div>
          ) : totalCreators === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-zinc-800 bg-black">
              <Search className="w-12 h-12 text-zinc-600 mb-4" />
              <h3 className="text-sm font-black text-white uppercase tracking-widest mb-2">NO CREATORS MATCH YOUR FILTERS</h3>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Adjust your search or clear filters to see more results.</p>
              <button
                type="button"
                onClick={() => {
                  setSelectedLocation('');
                  setMinPrice('');
                  setMaxPrice('');
                  setShowVerifiedOnly(false);
                  setShowOnlineOnly(false);
                  setSearchQuery('');
                  setSortBy('popular');
                }}
                className="mt-5 border-2 border-zinc-700 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:border-white"
              >
                Clear filters
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 md:gap-6">
              {paginatedCreators.map(creator => (
                <CreatorGridCard 
                  key={creator.id} 
                  creator={creator} 
                  onQuickView={setQuickViewCreator}
                  onNavigate={handleNavigateProfile}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="hidden md:flex items-center px-4 pb-2 mb-2 border-b-2 border-zinc-800 text-[9px] font-black text-zinc-600 uppercase tracking-widest">
                <div className="flex-1">Creator Profile</div>
                <div className="flex-1 px-8 text-center flex justify-between">
                  <span>Audience</span>
                  <span>Content</span>
                  <span>Pricing</span>
                </div>
                <div className="w-32 text-right">Actions</div>
              </div>
              {paginatedCreators.map(creator => (
                <CreatorListRow 
                  key={creator.id} 
                  creator={creator}
                  onQuickView={setQuickViewCreator}
                  onNavigate={handleNavigateProfile}
                />
              ))}
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="mt-12 flex items-center justify-between border-t-2 border-zinc-800 pt-6">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 py-3 bg-black border-2 border-zinc-800 text-zinc-400 font-black uppercase text-[10px] tracking-widest hover:text-white hover:border-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" /> PREV
              </button>
              
              <div className="hidden sm:flex items-center gap-2">
                {Array.from({ length: Math.min(5, totalPages) }).map((_, idx) => {
                  // Complex pagination logic to show sliding window omitted for brevity, simplified to show around current page
                  let pageNum = currentPage > 3 ? currentPage - 2 + idx : idx + 1;
                  if (pageNum > totalPages) return null;
                  
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-10 h-10 border-2 flex items-center justify-center text-[10px] font-black transition-colors
                        ${currentPage === pageNum ? 'bg-white border-white text-black' : 'bg-black border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-white'}
                      `}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <div className="sm:hidden text-[10px] font-black text-zinc-500 tracking-widest uppercase">
                PAGE {currentPage} OF {totalPages}
              </div>

              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-4 py-3 bg-black border-2 border-zinc-800 text-zinc-400 font-black uppercase text-[10px] tracking-widest hover:text-white hover:border-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                NEXT <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

        </div>
      </div>

      {/* QUICK VIEW MODAL COMPONENT PORTAL */}
      {quickViewCreator && (
        <QuickViewModal 
          creator={quickViewCreator} 
          onClose={() => setQuickViewCreator(null)}
          onNavigate={(id) => { setQuickViewCreator(null); handleNavigateProfile(id); }}
        />
      )}

    </div>
  );
}