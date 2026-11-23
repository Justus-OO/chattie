import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  ArrowLeft, Users, Camera, Heart, MessageSquare, MoreVertical, Share2,
  CheckCircle2, Crown, ExternalLink, Play, Coins, AlertTriangle, X, Loader2,
  ShieldCheck, Search, Lock, Star, ChevronRight,
  UserPlus, UserCheck, Eye
} from 'lucide-react';
import { toast } from 'sonner';

// Import existing modules
import LockedPostCard from '../../components/afterdark/LockedPostCard';
import MpesaPaystackModal from '../../components/afterdark/MpesaPaystackModal';
import { normalizeMediaType } from '../../utils/mediaType';
import { useAppStore } from '../../store/useAppStore';
import { afterDarkService } from '../../api/afterdark.service';
import { useAppDialogs } from '../../components/modals/useAppDialogs';
import { useI18n } from '../../i18n';

// ============================================================================
// DATA NORMALIZATION
// ============================================================================
const normalizeCreator = (creator, t) => ({
  ...creator,
  id: creator.id || creator.creator_id,
  standardProfileId: creator.standardProfileId || creator.user_id,
  name: creator.name || creator.display_name || creator.username || t('afterDarkUiCreator'),
  username: creator.username || creator.alias || 'creator',
  avatar: creator.avatar || creator.avatar_url || 'https://via.placeholder.com/150',
  cover: creator.cover || creator.cover_url || '',
  bio: creator.bio || t('afterDarkUiWelcomeExclusiveVault'),
  tier: creator.tier || creator.access_tier || 'Standard',
  isVerified: Boolean(creator.isVerified ?? creator.is_verified),
  isOnline: Boolean(creator.isOnline ?? creator.is_online),
  isFollowing: Boolean(creator.isFollowing ?? creator.is_following),
  subPrice: Number(creator.subPrice ?? creator.subscription_price ?? creator.subscription_price_cents ?? 0) /
    (creator.subscription_price_cents !== undefined ? 100 : 1),
  chatPrice: Number(creator.chatPrice ?? creator.chat_price ?? 0),
  stats: {
    subs: Number(creator.stats?.subs ?? creator.subscriber_count ?? 0),
    posts: Number(creator.stats?.posts ?? creator.post_count ?? 0),
    likes: Number(creator.stats?.likes ?? creator.like_count ?? 0),
    videos: Number(creator.stats?.videos ?? creator.video_count ?? 0),
    photos: Number(creator.stats?.photos ?? creator.photo_count ?? 0),
  },
  tags: Array.isArray(creator.tags) ? creator.tags : [],
});

const normalizePost = (post, creator, t) => ({
  ...post,
  id: post.id || post.post_id,
  creator,
  mediaUrl: post.mediaUrl || post.media_url || post.preview_url || '',
  mediaType: normalizeMediaType(post.mediaType || post.media_type),
  pricingStrategy: post.pricingStrategy || post.pricing_strategy || 'ppv',
  price: Number(post.price ?? post.price_cents ?? 0) / (post.price_cents !== undefined ? 100 : 1),
  timestamp: post.timestamp || post.created_at || t('afterDarkUiRecently'),
  watermark: post.watermark !== false,
  isExplicit: Boolean(post.isExplicit ?? post.is_explicit),
  isUnlocked: Boolean(post.isUnlocked ?? post.is_unlocked),
  isLiked: Boolean(post.isLiked ?? post.is_liked),
  likesCount: Number(post.likesCount ?? post.like_count ?? 0),
  comments: Array.isArray(post.comments) ? post.comments : [],
  tags: Array.isArray(post.tags) ? post.tags : [],
});

// ============================================================================
// INLINE COMPONENT: TIPPING MODAL (MATCHES BLUEPRINT)
// ============================================================================
const TipModal = ({ isOpen, onClose, creator, onCheckout }) => {
  const { t } = useI18n();
  const [amount, setAmount] = useState('500');
  const [message, setMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen || !creator) return null;

  const handleTip = async () => {
    if (Number(amount) < 100) return toast.error(t('afterDarkUiMinimumTipKes100'));
    const tipAmount = Number(amount);
    if (!Number.isFinite(tipAmount) || tipAmount < 100) return toast.error(t('afterDarkUiMinimumTipKes100'));
    setIsProcessing(true);
    try {
      onCheckout({
        paymentType: 'tip',
        targetId: creator.id,
        amountCents: Math.round(tipAmount * 100),
        price: tipAmount,
        caption: t('afterDarkUiTipForCreator', { name: creator.name }),
        message: message.trim(),
      });
      onClose();
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiSendTipFailed')));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => !isProcessing && onClose()} />
      <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] flex flex-col z-10 rounded-none animate-in zoom-in-95 duration-200 overflow-hidden">
        
        <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-zinc-950 shrink-0">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-white flex items-center gap-2">
            <Coins className="w-4 h-4 text-yellow-400" /> Send a Tip
          </h2>
          <button onClick={onClose} disabled={isProcessing} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors rounded-none disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <div className="p-6 space-y-6 bg-black">
          <div className="flex items-center justify-between bg-zinc-950 border-2 border-zinc-800 p-3 rounded-none">
            <div className="flex items-center gap-3">
              <img src={creator.avatar} alt={creator.name} className="w-12 h-12 object-cover border-2 border-zinc-700 rounded-none" />
              <div>
                <p className="text-xs font-bold text-white uppercase tracking-widest">@{creator.username}</p>
                <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">{t('afterDarkUiDirectCreatorSupport')}</p>
              </div>
            </div>
            <div className="text-right">
              <span className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500">{t('afterDarkUiPaymentMethods')}</span>
              <span className="text-xs font-bold text-zinc-300">M-Pesa or Paystack</span>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('afterDarkUiSelectAmount')}</label>
            <div className="flex border-2 border-zinc-800 bg-black rounded-none mb-3">
              {['100', '500', '1000', '2500'].map(val => (
                <button 
                  key={val} 
                  type="button"
                  onClick={() => setAmount(val)}
                  className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors border-r-2 border-zinc-800 last:border-r-0 rounded-none ${
                    amount === val 
                      ? 'bg-white text-black' 
                      : 'text-zinc-500 hover:text-white hover:bg-zinc-950'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-zinc-500 font-bold text-xs">KES</span>
              <input 
                type="number" 
                value={amount} 
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-black border-2 border-zinc-800 rounded-none p-3 pl-14 text-sm font-bold text-white focus:outline-none focus:border-white transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('afterDarkUiAttachedNoteOptional')}</label>
            <input 
              type="text" 
              value={message} 
              onChange={(e) => setMessage(e.target.value)} 
              placeholder={t('afterDarkUiTipNotePlaceholder')}
              maxLength={500}
              className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-xs font-bold text-white focus:outline-none focus:border-white transition-colors"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button 
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="flex-1 py-3 bg-black border-2 border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors rounded-none"
            >
              Cancel
            </button>
            <button 
              type="button"
              onClick={handleTip} 
              disabled={isProcessing || !amount || Number(amount) < 100}
              className="flex-[1.5] py-3 bg-white text-black font-bold uppercase text-xs tracking-widest border-2 border-white hover:bg-zinc-200 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 rounded-none"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : t('afterDarkUiSendKesAmount', { amount: Number(amount || 0).toLocaleString() })}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

// ============================================================================
// INLINE COMPONENT: SUBSCRIBE MODAL (MATCHES BLUEPRINT)
// ============================================================================
const SubscribeModal = ({ isOpen, onClose, creator, balance, onCheckoutFallback }) => {
  const { t } = useI18n();
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen || !creator) return null;

  const hasEnoughBalance = balance >= creator.subPrice;

  const handleSubscribe = async () => {
    setIsProcessing(true);
    try {
      await afterDarkService.subscribeToCreator(creator.id);
      toast.success(t('afterDarkUiSubscribedVip', { name: creator.name }));
      onClose(true);
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiSubscribeFailed')));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => !isProcessing && onClose(false)} />
      <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] flex flex-col z-10 rounded-none animate-in zoom-in-95 duration-200 overflow-hidden">
        
        <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-zinc-950 shrink-0">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-white flex items-center gap-2">
            <Crown className="w-4 h-4 text-yellow-400" /> {t('afterDarkUiVipSubscription')}
          </h2>
          <button onClick={() => onClose(false)} disabled={isProcessing} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors rounded-none disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <div className="p-6 space-y-6 bg-black">
          <div className="flex items-center gap-4 border-2 border-zinc-800 bg-zinc-950 p-4 rounded-none">
            <img src={creator.avatar} alt={creator.name} className="size-[clamp(3.5rem,8vw,4.5rem)] object-cover border-2 border-yellow-400 shrink-0 rounded-none" />
            <div>
              <h3 className="text-base font-bold text-white uppercase tracking-widest">{creator.name}</h3>
              <p className="text-sm font-bold text-yellow-400 uppercase tracking-widest mt-0.5">
                KES {creator.subPrice.toLocaleString()} / {t('afterDarkUiMonth')}
              </p>
              <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">{t('afterDarkUiCancelAnytime')}</p>
            </div>
          </div>

          <div className="bg-black border-2 border-zinc-800 p-4 space-y-3 rounded-none">
            <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">{t('afterDarkUiSubscriptionBenefits')}</h4>
            {[
              'afterDarkUiBenefitVaultAccess',
              'afterDarkUiBenefitDirectMessages',
              'afterDarkUiBenefitPriorityRequests',
              'afterDarkUiBenefitVipBadge'
            ].map((benefit, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest leading-relaxed">{t(benefit)}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-2 border-zinc-800 bg-zinc-950 p-3 rounded-none">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{t('afterDarkUiYourWalletBalance')}</span>
            <span className={`text-xs font-bold uppercase tracking-widest ${hasEnoughBalance ? 'text-green-500' : 'text-red-500'}`}>
              KES {balance.toLocaleString()}
            </span>
          </div>

          <div className="space-y-2">
            <button 
              type="button"
              onClick={handleSubscribe} 
              disabled={isProcessing || !hasEnoughBalance}
              className="w-full py-3.5 bg-white text-black font-bold uppercase text-xs tracking-widest border-2 border-white hover:bg-zinc-200 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 rounded-none"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : t('afterDarkUiPayWithWalletKes', { amount: creator.subPrice.toLocaleString() })}
            </button>

            {onCheckoutFallback && (
              <button 
                type="button"
                onClick={() => {
                  onClose(false);
                  onCheckoutFallback();
                }}
                disabled={isProcessing}
                className="w-full py-3 bg-black text-zinc-300 font-bold uppercase text-[10px] tracking-widest border-2 border-zinc-700 hover:border-white hover:text-white transition-colors rounded-none"
              >
                {t('afterDarkUiPayWithMpesaCard')}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT: CREATOR PROFILE & DIRECTORY EXPLORER
// ============================================================================
export default function AfterDarkCreatorProfile() {
  const { t } = useI18n();
  const { confirm } = useAppDialogs();
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const setWalletBalance = useAppStore(state => state.setWalletBalance);
  const updateUser = useAppStore(state => state.updateUser);
  const grantAfterDarkSubscription = useAppStore(state => state.grantAfterDarkSubscription);
  
  // Initial Creator Resolution
  const initialCreatorId = id || location.state?.creator?.id || location.state?.creator?.creator_id || '';
  const [selectedCreatorId, setSelectedCreatorId] = useState(initialCreatorId);
  const [creator, setCreator] = useState(() => location.state?.creator ? normalizeCreator(location.state.creator, t) : null);
  const creatorRef = useRef(null);
  
  // Status & Financial State
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [profileError, setProfileError] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);

  // --- Directory / Available Creators State (For Discovery & Manipulation) ---
  const [availableCreators, setAvailableCreators] = useState([]);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [creatorSearchQuery, setCreatorSearchQuery] = useState('');
  const [creatorFilterMode, setCreatorFilterMode] = useState('all'); // 'all' | 'online' | 'verified'
  const [creatorSortMode, setCreatorSortMode] = useState('popular'); // 'popular' | 'price_low' | 'price_high'

  // --- Creator Vault Posts & Manipulation State ---
  const [posts, setPosts] = useState([]);
  const [showExplicitContent, setShowExplicitContent] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'photos' | 'videos'
  const [accessFilter, setAccessFilter] = useState('all'); // 'all' | 'unlocked' | 'ppv' | 'free'
  const [postSort, setPostSort] = useState('newest'); // 'newest' | 'popular' | 'price_low'
  const [postSearch, setPostSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [viewLayout, setViewLayout] = useState('feed'); // 'feed' | 'grid'

  // --- UI & Modals State ---
  const [showMenu, setShowMenu] = useState(false);
  const [showTipModal, setShowTipModal] = useState(false);
  const [showSubModal, setShowSubModal] = useState(false);
  const [paymentPost, setPaymentPost] = useState(null);

  // Sync route param changes
  useEffect(() => {
    const nextId = id || location.state?.creator?.id || location.state?.creator?.creator_id || '';
    if (nextId) setSelectedCreatorId(nextId);
  }, [id, location.state]);

  useEffect(() => {
    if (location.state?.openTip) setShowTipModal(true);
  }, [location.key, location.state]);

  // ==========================================
  // FETCH AVAILABLE CREATORS DIRECTORY
  // ==========================================
  const loadAvailableCreators = async () => {
    setDirectoryLoading(true);
    try {
      const response = await afterDarkService.getDirectory({ sort: 'popular', limit: 24 });
      const records = Array.isArray(response) ? response : response?.creators || response?.items || [];
      if (Array.isArray(records)) {
        const normalizedList = records.map(normalizeCreator).filter(c => c.id);
        setAvailableCreators(normalizedList);
        // If no creator is currently selected, auto-select the first available one or remain in explorer view
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiAvailableCreatorsLoadFailed')));
    } finally {
      setDirectoryLoading(false);
    }
  };

  useEffect(() => {
    loadAvailableCreators();
    afterDarkService.getWallet().then(walletResponse => {
      const wallet = walletResponse?.wallet || walletResponse || {};
      const balance = Number(wallet.available_balance ?? wallet.available_balance_cents ?? 0) /
        (wallet.available_balance_cents !== undefined ? 100 : 1);
      setAvailableBalance(balance);
      setWalletBalance(balance);
      updateUser({ walletBalance: balance });
    }).catch(() => {});
  }, [setWalletBalance, updateUser]);

  useEffect(() => {
    let active = true;
    afterDarkService.getMySettings()
      .then(response => {
        if (!active) return;
        const settings = response?.settings || response || {};
        setShowExplicitContent(Boolean(settings.show_explicit_content ?? settings.showExplicitContent));
      })
      .catch(error => {
        if (active) toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiViewingPreferencesLoadFailed')));
      });
    return () => { active = false; };
  }, [t]);

  // ==========================================
  // FETCH SELECTED CREATOR PROFILE & VAULT
  // ==========================================
  useEffect(() => {
    let active = true;
    if (!selectedCreatorId) {
      setCreator(null);
      setProfileLoading(false);
      setLoadingPosts(false);
      setProfileError('');
      return undefined;
    }

    setPaymentPost(null);
    setSelectedTag('');
    setPostSearch('');
    setProfileLoading(true);
    setLoadingPosts(true);
    setProfileError('');
    setIsSubscribed(false);

    afterDarkService.getCreatorProfile(selectedCreatorId).then(profileResponse => {
      if (!active) return;
      const profile = profileResponse?.creator || profileResponse?.profile || profileResponse;
      if (!profile || typeof profile !== 'object' || !(profile.id || profile.creator_id)) {
        throw new Error(t('afterDarkUiCreatorProfileMissing'));
      }
      const nextCreator = normalizeCreator(profile, t);
      creatorRef.current = nextCreator;
      setCreator(nextCreator);
      setIsFollowing(Boolean(nextCreator.isFollowing));
      setPosts(previous => previous.map(post => ({ ...post, creator: nextCreator })));
    }).catch(error => {
      if (active) {
        setCreator(null);
        setProfileError(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiCreatorProfileLoadFailed')));
      }
    }).finally(() => {
      if (active) setProfileLoading(false);
    });

    afterDarkService.getFeed({ creator_id: selectedCreatorId, limit: 40 }).then(async feedResponse => {
      if (!active) return;
      const postRecords = Array.isArray(feedResponse)
        ? feedResponse
        : feedResponse?.posts || feedResponse?.items || [];
      if (!Array.isArray(postRecords)) throw new Error(t('afterDarkUiCreatorFeedInvalid'));
      const creatorPosts = await Promise.all(postRecords.map(async record => {
        const post = normalizePost(record, creatorRef.current || { id: selectedCreatorId }, t);
        if (!post.id || !post.isUnlocked || post.mediaUrl) return post;

        try {
          const mediaResponse = await afterDarkService.getPostMediaUrl(post.id);
          return { ...post, mediaUrl: mediaResponse?.url || '' };
        } catch (mediaError) {
          console.error(`Could not load authorized media for After Dark post ${post.id}.`, mediaError);
          return post;
        }
      }));
      if (active) setPosts(creatorPosts);
    }).catch(error => {
      if (active) toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiCreatorPostsLoadFailed')));
    }).finally(() => {
      if (active) setLoadingPosts(false);
    });

    afterDarkService.getMySubscriptions().then(subscriptionsResponse => {
      if (!active) return;
      const subscriptions = Array.isArray(subscriptionsResponse)
        ? subscriptionsResponse
        : subscriptionsResponse?.subscriptions || subscriptionsResponse?.items || [];
      if (Array.isArray(subscriptions)) {
        setIsSubscribed(subscriptions.some(subscription =>
          String(subscription.creator_id || subscription.creator?.id || subscription.id) === String(selectedCreatorId)
        ));
      }
    }).catch(() => {});

    return () => { active = false; };
  }, [selectedCreatorId, t]);

  // ==========================================
  // MANIPULATION & FILTERING COMPUTATIONS
  // ==========================================
  const filteredAvailableCreators = availableCreators
    .filter(item => {
      if (creatorFilterMode === 'online' && !item.isOnline) return false;
      if (creatorFilterMode === 'verified' && !item.isVerified) return false;
      const q = creatorSearchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.username.toLowerCase().includes(q) ||
        item.tags.some(t => t.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      if (creatorSortMode === 'price_low') return a.subPrice - b.subPrice;
      if (creatorSortMode === 'price_high') return b.subPrice - a.subPrice;
      return b.stats.subs - a.stats.subs;
    });

  const manipulatedPosts = posts
    .filter(post => {
      if (!showExplicitContent && post.isExplicit) return false;
      if (activeTab === 'photos' && post.mediaType !== 'image') return false;
      if (activeTab === 'videos' && post.mediaType !== 'video') return false;
      if (accessFilter === 'unlocked' && !post.isUnlocked && post.pricingStrategy !== 'free') return false;
      if (accessFilter === 'ppv' && post.pricingStrategy !== 'ppv') return false;
      if (accessFilter === 'free' && post.pricingStrategy !== 'free') return false;
      if (selectedTag && !post.tags.includes(selectedTag)) return false;
      const q = postSearch.trim().toLowerCase();
      if (q && !(post.caption || '').toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      if (postSort === 'popular') return b.likesCount - a.likesCount;
      if (postSort === 'price_low') return a.price - b.price;
      return 0; // default newest order from server
    });

  // ==========================================
  // INTERACTION HANDLERS
  // ==========================================
  const handleSelectCreator = (targetCreator) => {
    setSelectedCreatorId(targetCreator.id);
    setCreator(normalizeCreator(targetCreator, t));
    navigate(`/afterdark/cprofile/${encodeURIComponent(targetCreator.id)}`, { state: { creator: targetCreator } });
  };

  const handleMessageCreator = async (targetCreator = creator) => {
    if (!targetCreator?.id) return;
    const targetUserId = targetCreator.standardProfileId || targetCreator.user_id || targetCreator.id;
    try {
      const chatAccess = await afterDarkService.initConversation(targetUserId);
      navigate(`/afterdark/chats?creator=${encodeURIComponent(chatAccess.other_user_id || targetUserId)}`, {
        state: { creator: targetCreator, chatAccess },
      });
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiCreatorChatOpenFailed')));
    }
  };

  const handleToggleFollow = async (targetCreator = creator) => {
    if (!targetCreator?.id) return;
    try {
      const result = await afterDarkService.toggleFollow(targetCreator.id);
      const nextFollow = Boolean(result?.following ?? result?.is_following ?? !isFollowing);
      if (targetCreator.id === creator?.id) setIsFollowing(nextFollow);
      setAvailableCreators(prev => prev.map(c => c.id === targetCreator.id ? { ...c, isFollowing: nextFollow } : c));
      toast.success(t(nextFollow ? 'afterDarkUiFollowingUsername' : 'afterDarkUiUnfollowedUsername', { username: targetCreator.username }));
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiFollowStatusUpdateFailed')));
    }
  };

  const handlePaymentSuccess = (payment) => {
    if (payment?.payment_type === 'tip') {
      toast.success(t('afterDarkUiTipSentToCreator', { amount: (payment.amount_cents / 100).toLocaleString(), name: creator?.name }));
      return;
    }
    if (creator && (payment?.payment_type === 'subscription' || payment === `live-subscription-${creator.id}`)) {
      grantAfterDarkSubscription(creator.id);
      setIsSubscribed(true);
      setPosts(prev => prev.map(p => p.pricingStrategy === 'subscriber' ? { ...p, isUnlocked: true } : p));
      return;
    }
    const targetId = payment?.target_id || payment?.targetId || payment;
    setPosts(prev => prev.map(p => p.id === targetId ? { ...p, isUnlocked: true } : p));
  };

  const handleTipSuccess = async () => {
    try {
      const walletResponse = await afterDarkService.getWallet();
      const wallet = walletResponse?.wallet || walletResponse || {};
      const nextBalance = Number(wallet.available_balance ?? wallet.available_balance_cents ?? 0) /
        (wallet.available_balance_cents !== undefined ? 100 : 1);
      setAvailableBalance(nextBalance);
      setWalletBalance(nextBalance);
      updateUser({ walletBalance: nextBalance });
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiWalletBalanceRefreshFailed')));
    }
  };

  const handleSubSuccess = async (success) => {
    if (success && creator) {
      grantAfterDarkSubscription(creator.id);
      setIsSubscribed(true);
      setPosts(prev => prev.map(p => p.pricingStrategy === 'subscriber' ? { ...p, isUnlocked: true } : p));
      await handleTipSuccess();
    }
    setShowSubModal(false);
  };

  const triggerMpesaSubscription = () => {
    if (!creator) return;
    setPaymentPost({
      id: `live-subscription-${creator.id}`,
      paymentType: 'subscription',
      targetId: creator.id,
      resourceId: creator.id,
      price: creator.subPrice,
      caption: t('afterDarkUiMonthlyVipSubscriptionFor', { username: creator.username }),
    });
  };

  const reportCreator = async () => {
    if (!creator || !await confirm(t('afterDarkUiReportCreatorConfirm', { name: creator.name }), {
      title: t('afterDarkUiReportCreatorTitle'),
      confirmLabel: t('afterDarkUiSubmitReport'),
      tone: 'danger',
    })) return;
    try {
      await afterDarkService.submitReport({ target_type: 'creator', target_id: creator.id, reason: 'User report' });
      toast.success(t('afterDarkUiReportSubmitted'));
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiReportSubmitFailed')));
    }
  };

  const copyProfileLink = async () => {
    if (!creator) return;
    try {
      const result = await afterDarkService.createShareLink({ target_type: 'profile', target_id: creator.id });
      const shareUrl = result?.url || result?.share_url || window.location.href;
      await navigator.clipboard.writeText(shareUrl);
      toast.success(t('afterDarkUiCreatorProfileLinkCopied'));
      setShowMenu(false);
    } catch {
      toast.error(t('afterDarkUiCopyProfileLinkFailed'));
    }
  };

  // ==========================================================================
  // RENDER: AVAILABLE CREATORS EXPLORER (WHEN NO SPECIFIC CREATOR IS SELECTED)
  // ==========================================================================
  if (!creator && !profileLoading) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-black w-full relative overflow-hidden text-zinc-300 rounded-none font-mono">
        
        {/* HEADER */}
        <header className="p-4 md:p-6 border-b-2 border-zinc-800 bg-zinc-950 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 z-20">
          <div className="flex items-center gap-3">
            <div className="hidden p-2 border-2 border-zinc-600 bg-black rounded-none md:block">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="hidden text-xl md:text-2xl font-bold uppercase tracking-widest text-white leading-none md:block">
                {t('afterDarkUiAvailableCreators')}
              </h1>
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mt-1">
                {profileError || t('afterDarkUiSelectCreatorPrompt')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:w-[clamp(12rem,26vw,20rem)]">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={creatorSearchQuery}
                onChange={(e) => setCreatorSearchQuery(e.target.value)}
                placeholder={t('afterDarkUiSearchCreatorsTags')}
                className="w-full bg-black border-2 border-zinc-800 rounded-none pl-9 pr-3 py-2 text-xs font-bold text-white uppercase tracking-widest focus:outline-none focus:border-white transition-colors"
              />
            </div>
          </div>
        </header>

        {/* MANIPULATION BAR: FILTER & SORT CREATORS */}
        <div className="px-4 md:px-6 py-3 border-b-2 border-zinc-800 bg-black flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex border-2 border-zinc-800 bg-black rounded-none">
            {[
              { id: 'all', labelKey: 'afterDarkUiAllCount', count: availableCreators.length },
              { id: 'online', labelKey: 'afterDarkUiOnlineNow' },
              { id: 'verified', labelKey: 'afterDarkUiVerified' },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCreatorFilterMode(tab.id)}
                className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors border-r-2 border-zinc-800 last:border-r-0 rounded-none ${
                  creatorFilterMode === tab.id
                    ? 'bg-white text-black'
                    : 'text-zinc-500 hover:text-white hover:bg-zinc-950'
                }`}
              >
                {t(tab.labelKey, { count: tab.count })}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('afterDarkUiSortBy')}</span>
            <div className="flex border-2 border-zinc-800 bg-black rounded-none">
              {[
                { id: 'popular', labelKey: 'afterDarkUiPopular' },
                { id: 'price_low', labelKey: 'afterDarkUiLowestSubscription' },
                { id: 'price_high', labelKey: 'afterDarkUiHighestSubscription' },
              ].map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setCreatorSortMode(s.id)}
                  className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors border-r-2 border-zinc-800 last:border-r-0 rounded-none ${
                    creatorSortMode === s.id
                      ? 'bg-white text-black'
                      : 'text-zinc-500 hover:text-white hover:bg-zinc-950'
                  }`}
                >
                  {t(s.labelKey)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* CREATORS GRID */}
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar bg-black p-2 sm:p-3 lg:p-4">
          <div className="w-full">
            {directoryLoading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-white animate-spin mb-3" />
                <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">{t('afterDarkUiLoadingAvailableCreators')}</span>
              </div>
            ) : filteredAvailableCreators.length === 0 ? (
              <div className="border-2 border-dashed border-zinc-800 p-12 text-center rounded-none">
                <Users className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
                <p className="text-xs font-bold uppercase tracking-widest text-white mb-2">{t('afterDarkUiNoCreatorsMatchFilter')}</p>
                <button
                  type="button"
                  onClick={() => { setCreatorFilterMode('all'); setCreatorSearchQuery(''); }}
                  className="mt-2 px-4 py-2 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest rounded-none"
                >
                  {t('afterDarkUiResetFilters')}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredAvailableCreators.map(item => (
                  <div key={item.id} className="bg-black border-2 border-zinc-800 hover:border-zinc-600 transition-colors flex flex-col rounded-none group">
                    <div className="relative aspect-[3/1] overflow-hidden border-b-2 border-zinc-800 bg-zinc-950">
                      {item.cover && (
                        <img src={item.cover} alt="" className="w-full h-full object-cover opacity-50 grayscale group-hover:grayscale-0 transition-all" />
                      )}
                      <div className="absolute top-2 right-2 flex gap-1.5">
                        {item.isOnline && (
                          <span className="px-2 py-0.5 bg-black border-2 border-green-500 text-green-500 text-[8px] font-bold uppercase tracking-widest">
                            {t('afterDarkUiOnline')}
                          </span>
                        )}
                        <span className="px-2 py-0.5 bg-black border-2 border-zinc-700 text-white text-[8px] font-bold uppercase tracking-widest">
                          KES {item.subPrice}/mo
                        </span>
                      </div>
                    </div>

                    <div className="p-4 flex-1 flex flex-col">
                      <div className="flex items-end gap-3 -mt-10 mb-3 relative z-10">
                        <img src={item.avatar} alt={item.name} className="w-16 h-16 object-cover border-2 border-zinc-600 bg-black rounded-none shrink-0" />
                        <div className="min-w-0 pb-0.5">
                          <h3 className="text-sm font-bold text-white uppercase tracking-widest truncate flex items-center gap-1.5">
                            <span className="truncate">{item.name}</span>
                            {item.isVerified && <CheckCircle2 className="w-3.5 h-3.5 text-yellow-400 shrink-0" />}
                          </h3>
                          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest truncate">@{item.username}</p>
                        </div>
                      </div>

                      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider line-clamp-2 mb-4 flex-1">
                        {item.bio}
                      </p>

                      <div className="grid grid-cols-3 border-2 border-zinc-800 bg-zinc-950 py-2 mb-4 text-center">
                        <div>
                          <div className="text-xs font-bold text-white">{item.stats.subs}</div>
                          <div className="text-[8px] font-bold text-zinc-500 uppercase">{t('afterDarkUiVips')}</div>
                        </div>
                        <div className="border-x-2 border-zinc-800">
                          <div className="text-xs font-bold text-white">{item.stats.posts}</div>
                          <div className="text-[8px] font-bold text-zinc-500 uppercase">{t('afterDarkUiPosts')}</div>
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">{item.stats.likes}</div>
                          <div className="text-[8px] font-bold text-zinc-500 uppercase">{t('afterDarkUiLikes')}</div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleSelectCreator(item)}
                          className="flex-1 py-2.5 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors rounded-none"
                        >
                          {t('afterDarkUiOpenVault')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMessageCreator(item)}
                          className="px-3 py-2.5 bg-black border-2 border-zinc-700 text-zinc-300 hover:border-white hover:text-white transition-colors rounded-none"
                          title={t('afterDarkUiMessageCreator')}
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (profileLoading && !creator) {
    return (
      <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col items-center justify-center bg-black p-6 text-center text-zinc-300 font-mono">
        <Loader2 className="w-10 h-10 text-white animate-spin mb-4" />
        <h2 className="text-sm font-bold text-white uppercase tracking-widest">{t('afterDarkUiLoadingCreatorVault')}</h2>
      </div>
    );
  }

  // ==========================================================================
  // RENDER: MAIN CREATOR PROFILE & VAULT MANIPULATION UI
  // ==========================================================================
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 bg-black w-full relative overflow-hidden text-zinc-300 rounded-none font-mono">
      
      {/* LEFT/MAIN SCROLLABLE AREA */}
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto custom-scrollbar relative lg:border-r-2 border-zinc-800 rounded-none">
        
        {/* TOP STICKY HEADER BAR (Matches UserSettings Header) */}
        <header className="p-4 border-b-2 border-zinc-800 bg-zinc-950 flex items-center justify-between sticky top-0 z-30 shrink-0 rounded-none">
          <div className="flex items-center gap-3 min-w-0">
            <button 
              type="button"
              onClick={() => navigate(-1)} 
              aria-label={t('afterDarkUiGoBack')}
              className="p-2 bg-black border-2 border-zinc-700 text-zinc-300 hover:text-white hover:border-white transition-colors rounded-none shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-sm md:text-base font-bold uppercase tracking-widest text-white truncate flex items-center gap-2">
                <span className="truncate">{creator.name}</span>
                {creator.isVerified && <CheckCircle2 className="w-4 h-4 text-yellow-400 shrink-0" />}
              </h1>
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 truncate">
                @{creator.username} · {t('afterDarkUiVaultItemsCount', { count: creator.stats.posts })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleToggleFollow(creator)}
              className={`px-3 py-2 border-2 text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center gap-1.5 rounded-none ${
                isFollowing 
                  ? 'bg-zinc-900 border-zinc-600 text-white' 
                  : 'bg-black border-zinc-700 text-zinc-300 hover:border-white hover:text-white'
              }`}
            >
              {isFollowing ? <UserCheck className="w-3.5 h-3.5 text-green-500" /> : <UserPlus className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{t(isFollowing ? 'afterDarkUiFollowing' : 'afterDarkUiFollow')}</span>
            </button>

            <div className="relative">
              <button 
                type="button"
                onClick={() => setShowMenu(!showMenu)} 
                aria-label={t('afterDarkUiMoreCreatorActions')}
                className="p-2 bg-black border-2 border-zinc-700 text-zinc-300 hover:text-white hover:border-white transition-colors rounded-none"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-full z-30 mt-2 flex w-[clamp(12rem,24vw,16rem)] flex-col border-2 border-zinc-600 bg-black shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] rounded-none">
                    <button onClick={copyProfileLink} className="px-4 py-3 text-left text-[10px] font-bold text-white uppercase tracking-widest hover:bg-zinc-950 flex items-center gap-2 border-b-2 border-zinc-800">
                      <Share2 className="w-4 h-4 text-zinc-400" /> {t('afterDarkUiShareProfile')}
                    </button>
                    <button 
                      onClick={() => {
                        setShowMenu(false);
                        setCreator(null);
                        setSelectedCreatorId('');
                      }} 
                      className="px-4 py-3 text-left text-[10px] font-bold text-yellow-400 uppercase tracking-widest hover:bg-zinc-950 flex items-center gap-2 border-b-2 border-zinc-800"
                    >
                      <Users className="w-4 h-4" /> {t('afterDarkUiBrowseAllCreators')}
                    </button>
                    <button 
                      onClick={() => {
                        setShowMenu(false);
                        navigate('/profile');
                      }} 
                      className="px-4 py-3 text-left text-[10px] font-bold text-white uppercase tracking-widest hover:bg-zinc-950 flex items-center gap-2 border-b-2 border-zinc-800"
                    >
                      <ExternalLink className="w-4 h-4 text-zinc-400" /> {t('afterDarkUiStandardProfile')}
                    </button>
                    <button onClick={() => { setShowMenu(false); reportCreator(); }} className="px-4 py-3 text-left text-[10px] font-bold text-red-500 uppercase tracking-widest hover:bg-red-950 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> {t('afterDarkUiReportCreator')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* AVAILABLE CREATORS QUICK-SWITCHER STRIP (Mobile & Desktop Manipulation) */}
        {availableCreators.length > 0 && (
          <div className="border-b-2 border-zinc-800 bg-black px-4 py-3 shrink-0 overflow-x-auto custom-scrollbar">
            <div className="flex items-center gap-3 min-w-max">
              <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mr-1 flex items-center gap-1">
                <Users className="w-3 h-3" /> {t('afterDarkUiAvailableColon')}
              </span>
              {availableCreators.map(item => {
                const isCurrent = String(item.id) === String(creator.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectCreator(item)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 border-2 transition-colors rounded-none ${
                      isCurrent 
                        ? 'bg-white text-black border-white' 
                        : 'bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-zinc-600 hover:text-white'
                    }`}
                  >
                    <div className="relative">
                      <img src={item.avatar} alt="" className="w-5 h-5 object-cover border border-black rounded-none" />
                      {item.isOnline && <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-500 border border-black rounded-none" />}
                    </div>
                    <span className="max-w-[clamp(5rem,12vw,7rem)] truncate text-[10px] font-bold uppercase tracking-widest">
                      {item.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* HERO / COVER SECTION */}
        <div className="relative aspect-[4/1] shrink-0 overflow-hidden border-b-2 border-zinc-800 bg-zinc-950">
          {creator.cover ? (
            <img src={creator.cover} alt={t('afterDarkUiCover')} className="w-full h-full object-cover opacity-60 grayscale" />
          ) : (
            <div className="w-full h-full bg-zinc-950" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
        </div>

        {/* PROFILE INFO SECTION */}
        <div className="px-4 md:px-8 pb-6 bg-black border-b-2 border-zinc-800 relative z-10">
          
          {/* Floating Avatar & Primary Actions */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 -mt-14 md:-mt-16 mb-6">
            <div className="relative shrink-0">
              <img 
                src={creator.avatar} 
                alt={creator.name} 
                className="size-[clamp(6rem,13vw,9rem)] object-cover border-2 border-zinc-600 bg-black rounded-none"
              />
              {creator.isOnline && (
                <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black border-2 border-green-500 text-[8px] font-bold text-green-500 uppercase tracking-widest rounded-none">
                  {t('afterDarkUiOnline')}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              {!isSubscribed ? (
                <button 
                  type="button"
                  onClick={() => setShowSubModal(true)}
                  className="flex-1 md:flex-none px-6 py-3.5 bg-white text-black font-bold uppercase tracking-widest text-xs border-2 border-white hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 rounded-none"
                >
                  <Crown className="w-4 h-4" /> {t('afterDarkUiSubscribeKes', { amount: creator.subPrice.toLocaleString() })}
                </button>
              ) : (
                <div className="flex-1 md:flex-none px-6 py-3.5 bg-black text-green-500 font-bold uppercase tracking-widest text-xs border-2 border-green-500 flex items-center justify-center gap-2 rounded-none">
                  <CheckCircle2 className="w-4 h-4" /> {t('afterDarkUiVipSubscribed')}
                </div>
              )}
              
              <button 
                type="button"
                onClick={() => setShowTipModal(true)}
                className="px-5 py-3.5 bg-black text-yellow-400 font-bold uppercase tracking-widest text-xs border-2 border-yellow-400 hover:bg-zinc-950 transition-colors flex items-center justify-center gap-2 rounded-none"
              >
                <Coins className="w-4 h-4" /> {t('afterDarkUiTip')}
              </button>
              
              <button 
                type="button"
                onClick={() => handleMessageCreator(creator)}
                aria-label={t('afterDarkUiOpenPaidChat', { name: creator.name })}
                className="px-4 py-3.5 bg-black border-2 border-zinc-700 text-zinc-300 hover:border-white hover:text-white flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest transition-colors shrink-0 rounded-none"
              >
                <MessageSquare className="w-4 h-4" /> {t('afterDarkUiChat')}
              </button>
            </div>
          </div>

          {/* Name, Bio & Interactive Tags */}
          <div className="w-full">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h2 className="text-xl md:text-2xl font-bold text-white uppercase tracking-widest flex items-center gap-2">
                {creator.name}
                {creator.isVerified && <CheckCircle2 className="w-5 h-5 text-yellow-400" />}
              </h2>
              <span className="px-2 py-0.5 bg-zinc-950 border-2 border-zinc-700 text-[9px] font-bold text-yellow-400 uppercase tracking-widest rounded-none">
                {t('afterDarkUiTierValue', { tier: creator.tier })}
              </span>
            </div>
            
            <p className="text-xs font-bold text-zinc-300 uppercase tracking-wider leading-relaxed mb-5">
              {creator.bio}
            </p>

            {creator.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-6">
                <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mr-1">{t('afterDarkUiFilterByTag')}</span>
                {creator.tags.map(tag => {
                  const isTagActive = selectedTag === tag;
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setSelectedTag(isTagActive ? '' : tag)}
                      className={`px-3 py-1 border-2 text-[9px] font-bold uppercase tracking-widest transition-colors rounded-none ${
                        isTagActive
                          ? 'bg-white text-black border-white'
                          : 'bg-black border-zinc-800 text-yellow-400 hover:border-yellow-400'
                      }`}
                    >
                      #{tag}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sharp Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 border-2 border-zinc-800 bg-zinc-950 rounded-none">
            <div className="p-4 border-b-2 sm:border-b-0 border-r-2 border-zinc-800">
              <span className="text-lg md:text-xl font-bold text-white block">{creator.stats.subs.toLocaleString()}</span>
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1.5 mt-1">
                <Users className="w-3 h-3" /> {t('afterDarkUiVipSubscribers')}
              </span>
            </div>
            <div className="p-4 border-b-2 sm:border-b-0 sm:border-r-2 border-zinc-800">
              <span className="text-lg md:text-xl font-bold text-white block">{creator.stats.likes.toLocaleString()}</span>
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1.5 mt-1">
                <Heart className="w-3 h-3" /> {t('afterDarkUiTotalLikes')}
              </span>
            </div>
            <div className="p-4 border-r-2 border-zinc-800">
              <span className="text-lg md:text-xl font-bold text-white block">{creator.stats.photos}</span>
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1.5 mt-1">
                <Camera className="w-3 h-3" /> {t('afterDarkUiPhotos')}
              </span>
            </div>
            <div className="p-4">
              <span className="text-lg md:text-xl font-bold text-white block">{creator.stats.videos}</span>
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1.5 mt-1">
                <Play className="w-3 h-3" /> {t('afterDarkUiVideos')}
              </span>
            </div>
          </div>
        </div>

        {/* SHARP SEGMENTED MEDIA TABS (Matches UserSettings 'Show Me' group) */}
        <div className="flex border-b-2 border-zinc-800 bg-black sticky top-[68px] z-20 shrink-0 rounded-none">
          {[
            { id: 'all', labelKey: 'afterDarkUiAllMediaCount', count: posts.length },
            { id: 'photos', labelKey: 'afterDarkUiPhotosCount', count: creator.stats.photos },
            { id: 'videos', labelKey: 'afterDarkUiVideosCount', count: creator.stats.videos },
          ].map(tab => {
            const isSelected = activeTab === tab.id;
            return (
              <button 
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-3.5 px-2 text-xs font-bold uppercase tracking-widest transition-colors border-r-2 border-zinc-800 last:border-r-0 rounded-none focus:outline-none ${
                  isSelected 
                    ? 'bg-white text-black' 
                    : 'bg-black text-zinc-500 hover:text-white hover:bg-zinc-950'
                }`}
              >
                {t(tab.labelKey, { count: tab.count })}
              </button>
            );
          })}
        </div>

        {/* VAULT MANIPULATION TOOLBAR (Search, Access Filter, Sort, Layout) */}
        <div className="p-4 md:px-8 border-b-2 border-zinc-800 bg-zinc-950 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={postSearch}
              onChange={(e) => setPostSearch(e.target.value)}
              placeholder={t('afterDarkUiSearchVaultCaptions')}
              className="w-full bg-black border-2 border-zinc-800 rounded-none pl-9 pr-3 py-2 text-[10px] font-bold text-white uppercase tracking-widest focus:outline-none focus:border-white transition-colors"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Access Type Filter */}
            <div className="flex border-2 border-zinc-800 bg-black rounded-none">
              {[
                { id: 'all', labelKey: 'afterDarkUiAll' },
                { id: 'unlocked', labelKey: 'afterDarkUiUnlocked' },
                { id: 'ppv', labelKey: 'afterDarkUiPpv' },
                { id: 'free', labelKey: 'afterDarkUiFree' },
              ].map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setAccessFilter(f.id)}
                  className={`px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest border-r-2 border-zinc-800 last:border-r-0 rounded-none ${
                    accessFilter === f.id ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'
                  }`}
                >
                  {t(f.labelKey)}
                </button>
              ))}
            </div>

            {/* Sort Order */}
            <div className="flex border-2 border-zinc-800 bg-black rounded-none">
              {[
                { id: 'newest', labelKey: 'afterDarkUiNewest' },
                { id: 'popular', labelKey: 'afterDarkUiTop' },
                { id: 'price_low', labelKey: 'afterDarkUiPrice' },
              ].map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setPostSort(s.id)}
                  className={`px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest border-r-2 border-zinc-800 last:border-r-0 rounded-none ${
                    postSort === s.id ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'
                  }`}
                >
                  {t(s.labelKey)}
                </button>
              ))}
            </div>

            {/* Layout Toggle */}
            <div className="flex border-2 border-zinc-800 bg-black rounded-none">
              <button
                type="button"
                onClick={() => setViewLayout('feed')}
                className={`px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest border-r-2 border-zinc-800 rounded-none ${
                  viewLayout === 'feed' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'
                }`}
              >
                {t('afterDarkUiFeed')}
              </button>
              <button
                type="button"
                onClick={() => setViewLayout('grid')}
                className={`px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-none ${
                  viewLayout === 'grid' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'
                }`}
              >
                {t('afterDarkUiGrid')}
              </button>
            </div>
          </div>
        </div>

        {/* VAULT POSTS DISPLAY */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-black p-2 sm:p-3 lg:p-4">
          <div className="w-full">
            {loadingPosts ? (
              <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
                <Loader2 className="w-8 h-8 animate-spin mb-4 text-white" />
                <span className="text-[10px] font-bold uppercase tracking-widest">{t('afterDarkUiLoadingVault')}</span>
              </div>
            ) : manipulatedPosts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-zinc-800 bg-zinc-950 p-6 rounded-none">
                <Camera className="w-8 h-8 text-zinc-600 mb-3" />
                <h3 className="text-xs font-bold text-white uppercase tracking-widest mb-1">{t('afterDarkUiNoMatchingVaultMedia')}</h3>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">
                  {!showExplicitContent
                    ? t('afterDarkUiExplicitPostsHidden')
                          : t('afterDarkUiAdjustVaultFilters')}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (!showExplicitContent) {
                      navigate('/afterdark/settings?tab=viewing');
                    } else {
                      setActiveTab('all');
                      setAccessFilter('all');
                      setPostSearch('');
                      setSelectedTag('');
                    }
                  }}
                  className="px-4 py-2 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest rounded-none"
                >
                  {t(!showExplicitContent ? 'afterDarkUiViewingSettings' : 'afterDarkUiResetVaultFilters')}
                </button>
              </div>
            ) : viewLayout === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {manipulatedPosts.map(post => {
                  const locked = !post.isUnlocked && post.pricingStrategy !== 'free';
                  return (
                    <div key={post.id} className="bg-black border-2 border-zinc-800 flex flex-col rounded-none group">
                      <div className="relative aspect-square bg-zinc-950 border-b-2 border-zinc-800 overflow-hidden">
                        <img
                          src={post.mediaUrl || 'https://via.placeholder.com/400'}
                          alt={post.caption}
                          className={`w-full h-full object-cover transition-all ${locked ? 'blur-xl scale-110 brightness-50' : ''}`}
                        />
                        <div className="absolute top-2 left-2 flex gap-1.5">
                          <span className="px-2 py-0.5 bg-black border-2 border-zinc-700 text-[9px] font-bold uppercase tracking-widest text-white">
                            {post.mediaType}
                          </span>
                          <span className={`px-2 py-0.5 bg-black border-2 text-[9px] font-bold uppercase tracking-widest ${
                            locked ? 'border-yellow-400 text-yellow-400' : 'border-green-500 text-green-500'
                          }`}>
                            {locked ? (post.pricingStrategy === 'ppv' ? `KES ${post.price}` : t('afterDarkUiVipSub')) : t('afterDarkUiUnlocked')}
                          </span>
                        </div>
                        {locked && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                            <Lock className="w-8 h-8 text-yellow-400 mb-3" />
                            <button
                              type="button"
                              onClick={() => post.pricingStrategy === 'ppv' ? setPaymentPost(post) : setShowSubModal(true)}
                              className="px-4 py-2 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 rounded-none"
                            >
                              {post.pricingStrategy === 'ppv' ? t('afterDarkUiUnlockKes', { amount: post.price }) : t('afterDarkUiSubscribeVip')}
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="p-3 flex items-center justify-between bg-zinc-950">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-300 truncate pr-3">
                          {post.caption}
                        </p>
                        <button
                          type="button"
                          onClick={() => setViewLayout('feed')}
                          className="px-2.5 py-1 bg-black border-2 border-zinc-700 text-[9px] font-bold uppercase tracking-widest text-white hover:border-white shrink-0 rounded-none"
                        >
                          <Eye className="w-3 h-3 inline mr-1" /> {t('afterDarkUiInspect')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-8">
                {manipulatedPosts.map(post => (
                  <LockedPostCard 
                    key={post.id} 
                    post={post} 
                    onTriggerMpesa={setPaymentPost}
                    onRequireSubscribe={() => setShowSubModal(true)}
                    onMessageCreator={() => handleMessageCreator(creator)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* RIGHT SIDEBAR (Desktop: Available Creators Directory & Manipulation) */}
      <aside className="hidden w-[clamp(16rem,22vw,22rem)] shrink-0 flex-col overflow-y-auto bg-black custom-scrollbar rounded-none xl:flex">
        
        <div className="p-4 border-b-2 border-zinc-800 bg-zinc-950 sticky top-0 z-10 space-y-3 rounded-none">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
              <Users className="w-4 h-4 text-yellow-400" /> {t('afterDarkUiAvailableCreators')}
            </h3>
            <span className="text-[10px] font-bold text-zinc-500 uppercase">{filteredAvailableCreators.length}</span>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={creatorSearchQuery}
              onChange={(e) => setCreatorSearchQuery(e.target.value)}
              placeholder={t('afterDarkUiFindCreator')}
              className="w-full bg-black border-2 border-zinc-800 rounded-none pl-9 pr-3 py-2 text-[10px] font-bold text-white uppercase tracking-widest focus:outline-none focus:border-white transition-colors"
            />
          </div>

          <div className="flex border-2 border-zinc-800 bg-black rounded-none">
            {[
              { id: 'all', labelKey: 'afterDarkUiAll' },
              { id: 'online', labelKey: 'afterDarkUiOnline' },
              { id: 'verified', labelKey: 'afterDarkUiVip' },
            ].map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setCreatorFilterMode(f.id)}
                className={`flex-1 py-1.5 text-[9px] font-bold uppercase tracking-widest border-r-2 border-zinc-800 last:border-r-0 rounded-none ${
                  creatorFilterMode === f.id ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'
                }`}
              >
                {t(f.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 space-y-3">
          {filteredAvailableCreators.map(similarCreator => {
            const isActiveCreator = String(similarCreator.id) === String(creator.id);
            return (
              <div
                key={similarCreator.id}
                onClick={() => handleSelectCreator(similarCreator)}
                className={`flex w-full items-center justify-between border-2 p-3 text-left transition-colors cursor-pointer group rounded-none ${
                  isActiveCreator 
                    ? 'border-white bg-zinc-950' 
                    : 'border-zinc-800 bg-black hover:bg-zinc-950 hover:border-zinc-600'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0">
                    <img src={similarCreator.avatar} alt="" className="h-10 w-10 border-2 border-zinc-700 object-cover grayscale transition-all group-hover:grayscale-0 rounded-none" />
                    {similarCreator.isOnline && (
                      <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 border-2 border-black rounded-none" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <span className="block text-xs font-bold uppercase tracking-widest text-white truncate flex items-center gap-1">
                      {similarCreator.name}
                      {similarCreator.isVerified && <Star className="w-3 h-3 text-yellow-400 shrink-0" />}
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 block mt-0.5">
                      KES {similarCreator.subPrice}/mo · {similarCreator.stats.subs} VIPs
                    </span>
                  </div>
                </div>
                <div className="w-7 h-7 bg-black border-2 border-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-white group-hover:border-white shrink-0 rounded-none">
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            );
          })}

          {filteredAvailableCreators.length === 0 && (
            <div className="border-2 border-dashed border-zinc-800 p-6 text-center rounded-none">
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('afterDarkUiNoCreatorsMatchFilter')}</p>
            </div>
          )}
          
          <button
            type="button"
            onClick={() => navigate('/afterdark/directory')}
            className="w-full py-3 bg-black border-2 border-zinc-700 text-zinc-300 hover:text-white hover:border-white text-[10px] font-bold uppercase tracking-widest transition-colors rounded-none mt-2"
          >
            Open Full Directory
          </button>

          <div className="mt-6 p-4 bg-zinc-950 border-2 border-zinc-800 text-center rounded-none">
            <ShieldCheck className="w-5 h-5 text-green-500 mx-auto mb-2" />
            <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed">
              All transactions are encrypted. Charges appear discreetly on your statement.
            </p>
          </div>
        </div>
      </aside>

      {/* ==========================================
          MODALS PORTAL
          ========================================== */}
      <TipModal 
        isOpen={showTipModal} 
        onClose={() => setShowTipModal(false)} 
        creator={creator} 
        onCheckout={checkout => setPaymentPost({
          id: `tip-${creator?.id}`,
          ...checkout,
        })}
      />
      
      <SubscribeModal 
        isOpen={showSubModal} 
        onClose={handleSubSuccess} 
        creator={creator} 
        balance={availableBalance}
        onCheckoutFallback={triggerMpesaSubscription}
      />
      
      <MpesaPaystackModal 
        isOpen={!!paymentPost}
        onClose={() => setPaymentPost(null)}
        postItem={paymentPost}
        onSuccess={handlePaymentSuccess}
      />

    </div>
  );
}