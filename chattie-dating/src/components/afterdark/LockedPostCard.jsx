import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Lock, Heart, MessageSquare, Share2, MoreVertical,
  Play, Pause, Volume2, VolumeX, Maximize, ShieldAlert,
  Coins, Crown, Eye, AlertTriangle, CheckCircle2, DollarSign,
  Flag, UserPlus, Loader2, Send
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '../../store/useAppStore';
import { afterDarkService } from '../../api/afterdark.service';

// ============================================================================
// INLINE COMPONENT: CUSTOM VIDEO PLAYER
// ============================================================================
const CustomVideoPlayer = ({ src, poster, isUnlocked, watermark, creatorName }) => {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [progress, setProgress] = useState(0);

  const togglePlay = (e) => {
    e.stopPropagation();
    if (!isUnlocked || !videoRef.current) return;
    
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const p = (videoRef.current.currentTime / videoRef.current.duration) * 100;
    setProgress(p || 0);
  };

  const handleSeek = (e) => {
    e.stopPropagation();
    if (!isUnlocked || !videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickedValue = (x / rect.width) * 100;
    videoRef.current.currentTime = (clickedValue / 100) * videoRef.current.duration;
  };

  return (
    <div className="relative w-full aspect-video bg-black group overflow-hidden border-b-2 border-zinc-900">
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setIsPlaying(false)}
        className={`w-full h-full object-contain transition-all duration-700 ease-out ${
          !isUnlocked ? 'filter blur-[40px] scale-125 pointer-events-none brightness-50' : ''
        }`}
        loop
        playsInline
        muted={isMuted}
      />

      {isUnlocked && watermark && (
        <div className="absolute top-4 left-4 opacity-30 pointer-events-none select-none flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-white" />
          <span className="text-[10px] font-black text-white uppercase tracking-widest drop-shadow-md">
            @{creatorName} PROTECTED
          </span>
        </div>
      )}

      {isUnlocked && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-4">
          <div className="flex items-center justify-between mb-3">
            <button 
              onClick={togglePlay} 
              aria-label={isPlaying ? "Pause" : "Play"}
              className="text-white hover:text-yellow-400 transition-colors"
            >
              {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
            </button>
            <div className="flex items-center gap-4">
              <button 
                onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }} 
                aria-label={isMuted ? "Unmute" : "Mute"}
                className="text-white hover:text-yellow-400 transition-colors"
              >
                {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); videoRef.current?.requestFullscreen(); }} 
                aria-label="Fullscreen"
                className="text-white hover:text-yellow-400 transition-colors"
              >
                <Maximize className="w-5 h-5" />
              </button>
            </div>
          </div>
          {/* Progress Bar */}
          <div onClick={handleSeek} className="w-full h-2 bg-zinc-800 cursor-pointer relative border border-zinc-700">
            <div 
              className="absolute inset-y-0 left-0 bg-yellow-500 transition-all duration-75 ease-linear" 
              style={{ width: `${progress}%` }} 
            />
          </div>
        </div>
      )}
    </div>
  );
};


// ============================================================================
// MAIN COMPONENT: LOCKED POST CARD
// ============================================================================
export default function LockedPostCard({ post, onTriggerMpesa, onRequireSubscribe, onMessageCreator, onOpenCreator }) {
  const navigate = useNavigate();
  const currentUser = useAppStore(state => state.user);
  
  // Destructure with robust defaults (replaces the old `const p = {}` object)
  const {
    id,
    creator = { name: 'Unknown', avatar: '', isVerified: false },
    mediaUrl = '',
    mediaType = 'image',
    caption = 'Exclusive content.',
    pricingStrategy = 'ppv', // 'ppv', 'subscriber', 'free'
    price = 150,
    timestamp = 'Just now',
    watermark = true,
    isExplicit = true,
    tags = []
  } = post;

  // Post States
  const [isUnlocked, setIsUnlocked] = useState(post.isUnlocked || pricingStrategy === 'free');
  const [isLiked, setIsLiked] = useState(post.isLiked || false);
  const [likesCount, setLikesCount] = useState(post.likesCount || 0);
  
  // Interactive UI States
  const [showComments, setShowComments] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [explicitAcknowledged, setExplicitAcknowledged] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);

  // Comments State
  const [comments, setComments] = useState(post.comments || []);
  const [commentInput, setCommentInput] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  useEffect(() => {
    setIsUnlocked(post.isUnlocked || pricingStrategy === 'free');
  }, [post.isUnlocked, pricingStrategy]);

  // ==========================================
  // HANDLERS
  // ==========================================
  const handleLike = () => {
    afterDarkService.toggleLike(id)
      .then(result => {
        const liked = Boolean(result?.liked);
        setIsLiked(liked);
        setLikesCount(count => Math.max(0, count + (liked === isLiked ? 0 : liked ? 1 : -1)));
      })
      .catch(error => toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not update your like.')));
  };

  const handleUnlockClick = () => {
    if (pricingStrategy === 'subscriber') {
      if (onRequireSubscribe) {
        onRequireSubscribe();
      } else {
        navigate(`/afterdark/cprofile/${encodeURIComponent(creator.id)}`, { state: { creator } });
      }
      return;
    }
    
    if (pricingStrategy === 'ppv') {
      if (onTriggerMpesa) onTriggerMpesa(post); // Pass full post obj
    }
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!commentInput.trim()) return;

    if (!isUnlocked && pricingStrategy !== 'free') {
      toast.error('You must unlock the content to comment.');
      return;
    }

    setIsSubmittingComment(true);
    try {
      const newComment = await afterDarkService.addComment(id, commentInput.trim());
      setComments(current => [newComment, ...current]);
      setCommentInput('');
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not post your comment.'));
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleReport = () => {
    if (window.confirm('Report this post for review?')) {
      afterDarkService.submitReport({ target_type: 'post', target_id: id, reason: 'User report' })
        .then(() => toast.success('Report submitted for review.'))
        .catch(error => toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not submit the report.')));
    }
    setShowMenu(false);
  };

  const toggleComments = () => {
    const shouldOpen = !showComments;
    setShowComments(shouldOpen);
    if (!shouldOpen) return;
    
    afterDarkService.getComments(id)
      .then(result => {
        const records = Array.isArray(result) ? result : result?.comments || result?.items || [];
        setComments(records);
      })
      .catch(error => toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load comments.')));
  };

  const handleFollow = () => {
    afterDarkService.toggleFollow(creator.id)
      .then(result => setIsFollowing(Boolean(result?.following ?? result?.is_following)))
      .catch(error => toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not update your follow.')));
  };

  const copyPostLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/afterdark/cprofile/${encodeURIComponent(creator.id)}?post=${encodeURIComponent(id)}`);
      toast.success('Link copied to clipboard');
      setShowMenu(false);
    } catch {
      toast.error('Unable to copy the post link from this browser.');
    }
  };

  // ==========================================
  // RENDER HELPERS
  // ==========================================
  const NeedsExplicitAck = isExplicit && !explicitAcknowledged;
  const isBlurred = !isUnlocked || NeedsExplicitAck;

  return (
    <div className="w-full bg-black border-2 border-zinc-800 font-mono flex flex-col mb-8 transition-all hover:border-zinc-600 hover:-translate-y-0.5 shadow-[4px_4px_0px_rgba(255,255,255,0.05)] hover:shadow-[8px_8px_0px_rgba(255,255,255,0.08)] relative duration-200">
      
      {/* HEADER */}
      <div className="p-4 flex items-center justify-between border-b-2 border-zinc-900 bg-zinc-950 relative z-20">
        <button type="button" onClick={() => onOpenCreator ? onOpenCreator(creator) : navigate(`/afterdark/cprofile/${encodeURIComponent(creator.id)}`, { state: { creator } })} className="flex items-center gap-3 cursor-pointer text-left group">
          <div className="relative">
            <img 
              src={creator.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&q=80'} 
              alt={creator.name} 
              className="w-10 h-10 object-cover border-2 border-zinc-700 grayscale group-hover:grayscale-0 transition-all"
            />
            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 border-2 border-black rounded-full" />
          </div>
          <div>
            <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-1.5 group-hover:text-yellow-500 transition-colors">
              {creator.name}
              {creator.isVerified && <CheckCircle2 className="w-3.5 h-3.5 text-yellow-500" />}
            </h3>
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">{timestamp}</span>
          </div>
        </button>

        <div className="flex items-center gap-2">
          {!isUnlocked && pricingStrategy === 'subscriber' && (
            <button onClick={handleFollow} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border-2 border-zinc-700 text-[9px] font-black text-white uppercase tracking-widest hover:border-white transition-colors">
              <UserPlus className="w-3 h-3" /> {isFollowing ? 'Following' : 'Follow'}
            </button>
          )}
          
          <div className="relative">
            <button onClick={() => setShowMenu(!showMenu)} aria-label="More options" className="p-2 text-zinc-500 hover:text-white transition-colors">
              <MoreVertical className="w-5 h-5" />
            </button>
            
            {showMenu && (
              <>
                {/* Click-away backdrop */}
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                {/* Menu Dropdown */}
                <div className="absolute right-0 top-full mt-2 w-48 bg-black border-2 border-zinc-700 shadow-[4px_4px_0px_rgba(255,255,255,0.1)] z-20 flex flex-col animate-in fade-in zoom-in-95 duration-100">
                  <button onClick={handleUnlockClick} className="px-4 py-3 text-left text-[10px] font-black text-white uppercase tracking-widest hover:bg-zinc-900 flex items-center gap-2 transition-colors">
                    <UserPlus className="w-4 h-4" /> Subscribe
                  </button>
                  <button onClick={copyPostLink} className="px-4 py-3 text-left text-[10px] font-black text-white uppercase tracking-widest hover:bg-zinc-900 flex items-center gap-2 transition-colors">
                    <Share2 className="w-4 h-4" /> Copy Link
                  </button>
                  <button onClick={handleReport} className="px-4 py-3 text-left text-[10px] font-black text-red-500 uppercase tracking-widest hover:bg-zinc-900 border-t-2 border-zinc-800 flex items-center gap-2 transition-colors">
                    <Flag className="w-4 h-4" /> Report
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* MEDIA CONTAINER */}
      <div className="relative w-full aspect-square sm:aspect-[4/5] md:aspect-video bg-zinc-950 overflow-hidden flex items-center justify-center">
        
        {/* Render Actual Media */}
        {mediaType === 'video' ? (
          mediaUrl ? (
            <CustomVideoPlayer
              src={mediaUrl}
              isUnlocked={!isBlurred}
              watermark={watermark}
              creatorName={creator.name}
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center border-b-2 border-zinc-900 bg-zinc-950 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
              Media preview unavailable
            </div>
          )
        ) : (
          <div className="w-full h-full relative group border-b-2 border-zinc-900">
            {mediaUrl ? (
              <img
                src={mediaUrl}
                alt={caption}
                className={`w-full h-full object-cover transition-all duration-700 ease-out ${
                  isBlurred ? 'filter blur-[40px] scale-125 brightness-50 pointer-events-none' : ''
                }`}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-zinc-950 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                Media preview unavailable
              </div>
            )}
            {!isBlurred && watermark && (
              <div className="absolute bottom-4 right-4 opacity-40 pointer-events-none select-none">
                <span className="text-[10px] font-black text-white uppercase tracking-widest drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] bg-black/30 px-2 py-1 border border-white/20">
                  @{creator.name} PROTECTED
                </span>
              </div>
            )}
          </div>
        )}

        {/* OVERLAYS (Locks & Warnings) */}
        {isBlurred && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10">
            
            {NeedsExplicitAck && isUnlocked ? (
              // Explicit Content Warning for unlocked/free posts
              <div className="bg-black/90 p-6 border-2 border-zinc-700 max-w-sm w-full animate-in fade-in zoom-in duration-300 flex flex-col items-center">
                <AlertTriangle className="w-12 h-12 text-yellow-500 mb-4" />
                <h3 className="text-sm font-black text-white uppercase tracking-widest mb-2">EXPLICIT CONTENT</h3>
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-6 leading-relaxed">
                  This media contains mature themes. Viewer discretion is advised.
                </p>
                <button 
                  onClick={() => setExplicitAcknowledged(true)}
                  className="w-full py-3 bg-white text-black font-black uppercase text-xs tracking-widest border-2 border-white hover:bg-zinc-200 transition-colors shadow-[4px_4px_0px_rgba(255,255,255,0.2)]"
                >
                  <Eye className="w-4 h-4 inline mr-2" /> REVEAL MEDIA
                </button>
              </div>
            ) : pricingStrategy === 'ppv' ? (
              // Pay-Per-View Lock Overlay
              <div className="bg-black/95 p-8 border-2 border-yellow-500/50 max-w-sm w-full flex flex-col items-center shadow-[8px_8px_0px_rgba(234,179,8,0.1)]">
                <div className="w-16 h-16 rounded-full bg-yellow-500/10 border-2 border-yellow-500 flex items-center justify-center mb-4">
                  <Lock className="w-6 h-6 text-yellow-500" />
                </div>
                <h3 className="text-sm font-black text-white uppercase tracking-widest mb-1">LOCKED PPV MEDIA</h3>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-6 flex items-center gap-1.5">
                  <DollarSign className="w-3 h-3" /> One-Time Purchase
                </p>
                <button 
                  onClick={handleUnlockClick}
                  className="w-full py-4 bg-yellow-500 text-black font-black uppercase text-xs tracking-widest border-2 border-yellow-500 hover:bg-yellow-400 transition-all hover:-translate-y-0.5 shadow-[4px_4px_0px_rgba(234,179,8,0.2)] hover:shadow-[6px_6px_0px_rgba(234,179,8,0.4)]"
                >
                  UNLOCK FOR KES {price}
                </button>
                <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mt-4">Secure M-Pesa Checkout</span>
              </div>
            ) : pricingStrategy === 'subscriber' ? (
              // Subscriber Only Lock Overlay
              <div className="bg-black/95 p-8 border-2 border-green-500/50 max-w-sm w-full flex flex-col items-center shadow-[8px_8px_0px_rgba(34,197,94,0.1)]">
                <div className="w-16 h-16 rounded-full bg-green-500/10 border-2 border-green-500 flex items-center justify-center mb-4">
                  <Crown className="w-6 h-6 text-green-500" />
                </div>
                <h3 className="text-sm font-black text-white uppercase tracking-widest mb-1">VIP SUBSCRIBERS ONLY</h3>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-6 text-center leading-relaxed">
                  Subscribe to {creator.name}'s tier to unlock this and all past content.
                </p>
                <button 
                  onClick={handleUnlockClick}
                  className="w-full py-4 bg-green-500 text-black font-black uppercase text-xs tracking-widest border-2 border-green-500 hover:bg-green-400 transition-all hover:-translate-y-0.5 shadow-[4px_4px_0px_rgba(34,197,94,0.2)] hover:shadow-[6px_6px_0px_rgba(34,197,94,0.4)]"
                >
                  SUBSCRIBE NOW
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* CAPTION & TAGS */}
      <div className="p-4 bg-black">
        <p className="text-[11px] font-bold text-white leading-relaxed tracking-wider mb-3">
          <span className="font-black uppercase text-zinc-400 mr-2">{creator.name}</span>
          {isUnlocked ? caption : (
            <span className="text-zinc-600 italic">Caption hidden. Unlock to view full description...</span>
          )}
        </p>
        
        {isUnlocked && tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {tags.map(tag => (
              <span key={tag} className="text-[9px] font-black text-black bg-yellow-500 px-2 py-0.5 uppercase tracking-widest hover:bg-white transition-colors cursor-pointer">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ACTION BAR */}
      <div className="px-4 py-3 border-t-2 border-zinc-900 bg-zinc-950 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <button 
            onClick={handleLike}
            aria-label={isLiked ? "Unlike" : "Like"}
            className={`flex items-center gap-2 transition-colors ${isLiked ? 'text-red-500' : 'text-zinc-400 hover:text-white'}`}
          >
            <Heart className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`} />
            <span className="text-[10px] font-black uppercase">{likesCount}</span>
          </button>
          
          <button 
            onClick={toggleComments}
            aria-label="Toggle comments"
            className={`flex items-center gap-2 transition-colors ${showComments ? 'text-white' : 'text-zinc-400 hover:text-white'}`}
          >
            <MessageSquare className="w-5 h-5" />
            <span className="text-[10px] font-black uppercase">{comments.length}</span>
          </button>
          
          <button onClick={copyPostLink} aria-label="Copy post link" className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors">
            <Share2 className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-2">
          <button 
            onClick={() => navigate(`/afterdark/cprofile/${encodeURIComponent(creator.id)}`, { state: { creator, openTip: true } })}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/10 border-2 border-yellow-500/50 text-yellow-500 hover:bg-yellow-500 hover:text-black transition-colors"
          >
            <Coins className="w-4 h-4" />
            <span className="text-[9px] font-black uppercase tracking-widest">SEND TIP</span>
          </button>
          <button
            type="button"
            onClick={() => onMessageCreator?.(creator)}
            className="flex items-center gap-1.5 border-2 border-zinc-700 bg-black px-3 py-1.5 text-zinc-300 transition-colors hover:border-white hover:text-white"
            aria-label={`Open paid chat with ${creator.name}`}
          >
            <MessageSquare className="h-4 w-4" />
            <span className="text-[9px] font-black uppercase tracking-widest">PAID CHAT</span>
          </button>
        </div>
      </div>

      {/* COMMENTS SECTION (EXPANDABLE) */}
      {showComments && (
        <div className="border-t-2 border-zinc-900 bg-black animate-in slide-in-from-top-2 duration-200">
          
          {/* Add Comment Input */}
          <div className="p-4 border-b-2 border-zinc-900 bg-zinc-950 flex gap-3">
            <img 
              src={currentUser?.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&q=80'} 
              alt="You" 
              className="w-8 h-8 object-cover border-2 border-zinc-700 grayscale shrink-0"
            />
            <form onSubmit={handleAddComment} className="flex-1 flex gap-2">
              <input 
                type="text" 
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                placeholder={isUnlocked || pricingStrategy === 'free' ? "Add a comment..." : "Unlock to comment..."}
                disabled={!isUnlocked && pricingStrategy !== 'free'}
                className="flex-1 bg-black border-2 border-zinc-800 text-white text-[10px] font-bold px-3 outline-none focus:border-zinc-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              />
              <button 
                type="submit"
                aria-label="Post comment"
                disabled={isSubmittingComment || (!isUnlocked && pricingStrategy !== 'free') || !commentInput.trim()}
                className="px-4 bg-white text-black border-2 border-white font-black hover:bg-zinc-200 disabled:opacity-50 disabled:hover:bg-white transition-colors flex items-center justify-center"
              >
                {isSubmittingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </form>
          </div>

          {/* Comment List */}
          <div className="p-4 space-y-4 max-h-60 overflow-y-auto custom-scrollbar">
            {comments.length === 0 ? (
              <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest text-center py-4">No comments yet. Be the first.</p>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="flex gap-3 group">
                  <img 
                    src={comment.user.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=50&q=80'} 
                    alt={comment.user.name} 
                    className="w-6 h-6 object-cover border border-zinc-700 grayscale mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-[10px] font-black text-white uppercase tracking-widest">{comment.user.name}</span>
                      <span className="text-[8px] font-bold text-zinc-600 uppercase">{comment.timestamp}</span>
                    </div>
                    <p className="text-[10px] font-bold text-zinc-400 leading-relaxed">{comment.text}</p>
                  </div>
                  <button aria-label="Report comment" className="opacity-0 group-hover:opacity-100 p-1 text-zinc-600 hover:text-red-500 transition-all">
                    <Flag className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}