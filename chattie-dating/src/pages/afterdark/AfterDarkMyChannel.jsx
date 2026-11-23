import React, { useState, useEffect, useCallback } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Camera, Image as ImageIcon, Video, TrendingUp, Users, 
  DollarSign, Settings, Lock, Unlock, Edit3, Trash2, 
  Eye, Heart, MessageSquare, CheckCircle2,
  AlertTriangle, Clock, Check, X, Smartphone,
  Download, Search, Send, Share2, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '../../store/useAppStore';
import { afterDarkService } from '../../api/afterdark.service';
import { useAppDialogs } from '../../components/modals/useAppDialogs';
import AIDraftAssistant from '../../components/AIDraftAssistant';
import { normalizeMediaType } from '../../utils/mediaType';
import { useI18n } from '../../i18n';

// ============================================================================
// DATA NORMALIZATION
// ============================================================================
const normalizeVaultPost = post => ({
  ...post,
  id: post.id || post.post_id,
  type: normalizeMediaType(post.type || post.media_type),
  url: post.url || post.media_url || post.preview_url || '',
  strategy: post.strategy || post.pricing_strategy || post.access_type || post.accessType || 'free',
  price: Number(post.price ?? post.price_cents ?? 0) / (post.price_cents !== undefined ? 100 : 1),
  status: post.status || 'published',
  publishDate: post.publishDate || post.scheduled_for || post.published_at || post.created_at || '',
  stats: {
    views: Number(post.stats?.views ?? post.view_count ?? 0),
    unlocks: Number(post.stats?.unlocks ?? post.unlock_count ?? 0),
    likes: Number(post.stats?.likes ?? post.like_count ?? 0),
    revenue: Number(post.stats?.revenue ?? post.revenue ?? 0) / (post.revenue_cents !== undefined ? 100 : 1),
  },
});

const normalizeSubscriber = subscriber => ({
  ...subscriber,
  id: subscriber.id || subscriber.subscription_id,
  user: subscriber.user || {
    name: subscriber.username || subscriber.display_name || 'Member',
    avatar: subscriber.avatar_url || '',
    id: subscriber.user_id,
  },
  tier: subscriber.tier || subscriber.access_tier || 'Standard',
  status: subscriber.status || 'active',
  joinedAt: subscriber.joined_at || subscriber.joinedAt || '',
  expiresAt: subscriber.expires_at || subscriber.expiresAt || '',
  lifetimeValue: Number(subscriber.lifetime_value ?? subscriber.lifetimeValue ?? 0) /
    (subscriber.lifetime_value_cents !== undefined ? 100 : 1),
});

const SubscriberAvatar = ({ name, src, className = '' }) => {
  const { t } = useI18n();
  const [hasError, setHasError] = useState(false);
  const initials = (name || 'S').trim().slice(0, 1).toUpperCase();

  if (!src || hasError) {
    return (
      <div className={`flex shrink-0 items-center justify-center bg-zinc-900 font-bold text-zinc-300 rounded-none ${className}`} aria-label={t('afterDarkUiSubscriberAvatar', { name: name || t('afterDarkUiSubscriber') })}>
        {initials}
      </div>
    );
  }

  return <img src={src} alt="" onError={() => setHasError(true)} className={`shrink-0 object-cover rounded-none ${className}`} />;
};

// ============================================================================
// INLINE COMPONENT: EDIT POST MODAL (MATCHES BLUEPRINT)
// ============================================================================
const EditPostModal = ({ post, onClose, onSave }) => {
  const { t } = useI18n();
  const [caption, setCaption] = useState(post?.caption ?? '');
  const [captionContext, setCaptionContext] = useState('');
  const [price, setPrice] = useState(post?.price ?? 0);
  const [strategy, setStrategy] = useState(post?.strategy ?? 'free');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!post) return;
    setCaption(post.caption);
    setCaptionContext('');
    setPrice(post.price ?? 0);
    setStrategy(post.strategy ?? 'free');
  }, [post]);

  if (!post) return null;

  const handleSave = async () => {
    if (strategy === 'ppv' && (!Number(price) || Number(price) < 50)) {
      toast.error(t('afterDarkUiMinimumPpvPostPrice'));
      return;
    }
    setIsSubmitting(true);
    try {
      const updatedPost = await afterDarkService.updatePost(post.id, {
        caption,
        pricing_strategy: strategy,
        price_cents: strategy === 'ppv' ? Math.round(Number(price) * 100) : 0,
      });
      toast.success(t('afterDarkUiPostMetadataUpdated'));
      onSave(updatedPost);
      onClose();
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiPostUpdateFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] flex flex-col overflow-hidden rounded-none animate-in zoom-in-95 duration-200 z-10">
        
        <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-zinc-950 shrink-0">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-white flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-white" /> {t('afterDarkUiEditMediaVault')}
          </h2>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors rounded-none">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <div className="p-6 space-y-6 bg-black">
          <div className="flex gap-4 p-3 border-2 border-zinc-800 bg-zinc-950 rounded-none items-center">
            {post.type === 'video' ? (
              <div className="w-16 h-16 bg-black border-2 border-zinc-700 flex items-center justify-center shrink-0 rounded-none">
                <Video className="w-6 h-6 text-zinc-400" />
              </div>
            ) : (
              <img src={post.url} alt={t('afterDarkUiThumbnail')} className="w-16 h-16 object-cover border-2 border-zinc-700 shrink-0 rounded-none" />
            )}
            <div>
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-1.5">{t('afterDarkUiCurrentStatus')}</span>
              <span className={`px-2 py-1 text-[9px] font-bold uppercase tracking-widest border-2 rounded-none inline-block ${
                post.status === 'published' 
                  ? 'bg-black border-green-500 text-green-500' 
                  : 'bg-black border-yellow-400 text-yellow-400'
              }`}>
                {post.status}
              </span>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2 block">{t('afterDarkUiCaption')}</label>
            <label htmlFor="edit-caption-context" className="mb-2 block text-[9px] font-bold uppercase tracking-widest text-zinc-600">{t('afterDarkUiCaptionDirectionOptional')}</label>
            <input
              id="edit-caption-context"
              value={captionContext}
              onChange={(event) => setCaptionContext(event.target.value)}
              maxLength={500}
              placeholder={t('afterDarkUiCaptionDirectionPlaceholder')}
              className="mb-3 w-full border-2 border-zinc-800 bg-black px-3 py-2.5 text-xs font-bold text-white focus:outline-none focus:border-white"
            />
            <textarea 
              value={caption} 
              onChange={(e) => setCaption(e.target.value)}
              maxLength={2200}
              className="min-h-[clamp(6rem,15vh,8rem)] w-full resize-none border-2 border-zinc-800 bg-black px-4 py-3 text-xs font-bold text-white transition-colors focus:outline-none focus:border-white rounded-none"
            />
            <AIDraftAssistant
              type="creator-caption"
              context={captionContext}
              draft={caption}
              disabled={isSubmitting}
              onSelect={setCaption}
            />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2 block">{t('afterDarkUiMonetizationStrategy')}</label>
            <div className="flex border-2 border-zinc-800 bg-black rounded-none mb-4">
              {[
                { id: 'subscriber', labelKey: 'afterDarkUiVipSubs' },
                { id: 'ppv', labelKey: 'afterDarkUiPpvUnlock' },
                { id: 'free', labelKey: 'afterDarkUiFree' },
              ].map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setStrategy(opt.id)}
                  className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors border-r-2 border-zinc-800 last:border-r-0 rounded-none ${
                    strategy === opt.id
                      ? 'bg-white text-black'
                      : 'text-zinc-500 hover:text-white hover:bg-zinc-950'
                  }`}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>

            {strategy === 'ppv' && (
              <div>
                <label className="text-[10px] font-bold text-yellow-400 uppercase tracking-widest block mb-2">{t('afterDarkUiPpvPriceKes')}</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-zinc-500 text-xs font-bold">KES</span>
                  <input 
                    type="number" 
                    value={price} 
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full bg-black border-2 border-yellow-400 rounded-none px-4 py-3 pl-12 text-sm font-bold text-white focus:outline-none focus:border-white transition-colors"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4 border-t-2 border-zinc-800">
            <button 
              type="button"
              onClick={onClose} 
              className="flex-1 py-3 bg-black border-2 border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors rounded-none"
            >
              {t('afterDarkUiCancel')}
            </button>
            <button 
              type="button"
              onClick={handleSave} 
              disabled={isSubmitting} 
              className="flex-1 py-3 bg-white border-2 border-white hover:bg-zinc-200 text-black text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-50 rounded-none"
            >
              {isSubmitting ? t('afterDarkUiSaving') : t('afterDarkUiSaveChanges')}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

// ============================================================================
// INLINE COMPONENT: SUBSCRIBER MESSAGE MODAL (MATCHES BLUEPRINT)
// ============================================================================
const SubscriberMessageModal = ({ subscriber, onClose }) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const subscriberName = subscriber?.user?.name || subscriber?.name || 'Subscriber';
  const subscriberAvatar = subscriber?.user?.avatar || subscriber?.avatar || '';
  const subscriberTier = subscriber?.tier || 'Member';
  const subscriberStatus = subscriber?.status || 'active';

  useEffect(() => {
    if (!subscriber) return undefined;
    let active = true;
    const targetUserId = subscriber.user?.id || subscriber.user_id || subscriber.user?.user_id;
    if (!targetUserId) {
      setIsLoading(false);
      toast.error(t('afterDarkUiSubscriberNoChatAccount'));
      return undefined;
    }
    setIsLoading(true);
    afterDarkService.initConversation(targetUserId)
      .then(async result => {
        const id = result?.conversation_id || result?.id;
        if (!id) throw new Error(t('afterDarkUiConversationIdMissing'));
        const response = await afterDarkService.getMessages(id);
        const records = Array.isArray(response) ? response : response?.messages || response?.items || [];
        if (!Array.isArray(records)) throw new Error(t('afterDarkUiInvalidMessagesResponse'));
        if (active) {
          setConversationId(id);
          setMessages(records);
        }
      })
      .catch(error => toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiConversationLoadFailed'))))
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [subscriber, t]);

  if (!subscriber) return null;

  const handleSubmit = async event => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !conversationId) return;
    setIsSending(true);
    try {
      const message = await afterDarkService.sendMessage(conversationId, { content: text });
      setMessages(current => [...current, message]);
      setDraft('');
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiSendMessageFailed')));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <section 
        role="dialog" 
        aria-modal="true" 
        aria-label={t('afterDarkUiConversationWith', { name: subscriberName })}
        className="relative z-10 flex h-[85dvh] min-h-0 w-full max-w-lg flex-col overflow-hidden border-2 border-zinc-600 bg-black shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] rounded-none animate-in zoom-in-95 duration-200"
      >
        <header className="flex items-center justify-between border-b-2 border-zinc-800 bg-zinc-950 p-4 shrink-0">
          <div className="flex items-center gap-3">
            <SubscriberAvatar name={subscriberName} src={subscriberAvatar} className="h-10 w-10 border-2 border-zinc-700" />
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-white">@{subscriberName}</h2>
              <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500">{subscriberTier} member · {subscriberStatus}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors rounded-none" aria-label={t('afterDarkUiClose')}>
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 custom-scrollbar bg-black">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center border-2 border-dashed border-zinc-800 p-8 rounded-none">
              <MessageSquare className="mb-3 h-8 w-8 text-zinc-600" />
              <p className="text-xs font-bold uppercase tracking-widest text-white">{t('afterDarkUiNoMessagesYet')}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('afterDarkUiStartSubscriberConversation')}</p>
            </div>
          ) : messages.filter(Boolean).map((message, index) => {
            const isMine = message.sender === 'creator' || message.is_mine;
            return (
              <div key={message.id || index} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] border-2 px-3 py-2 rounded-none ${
                  isMine 
                    ? 'border-yellow-400 bg-zinc-950 text-white' 
                    : 'border-zinc-800 bg-zinc-950 text-zinc-300'
                }`}>
                  <p className="whitespace-pre-wrap break-words text-xs font-bold">{message.text || message.content || ''}</p>
                  <time className="mt-1 block text-right text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                    {message.createdAt || message.created_at ? new Date(message.createdAt || message.created_at).toLocaleString() : `Msg ${index + 1}`}
                  </time>
                </div>
              </div>
            );
          })}
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2 border-t-2 border-zinc-800 bg-zinc-950 p-3 shrink-0">
          <input 
            value={draft} 
            onChange={event => setDraft(event.target.value)} 
            placeholder={t('afterDarkUiWriteMessage')}
            aria-label={t('afterDarkUiMessage')}
            className="min-w-0 flex-1 border-2 border-zinc-800 bg-black px-3 py-2.5 text-xs font-bold text-white rounded-none focus:outline-none focus:border-white transition-colors" 
          />
          <button 
            type="submit" 
            disabled={!draft.trim() || !conversationId || isSending} 
            className="flex items-center gap-2 border-2 border-white bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-black hover:bg-zinc-200 transition-colors disabled:cursor-not-allowed disabled:opacity-50 rounded-none"
          >
            {isSending ? t('afterDarkUiSending') : <><Send className="h-3.5 w-3.5" /> {t('afterDarkUiSend')}</>}
          </button>
        </form>
      </section>
    </div>
  );
};

// ============================================================================
// INLINE COMPONENT: WITHDRAW MODAL

// ============================================================================
const WithdrawModal = ({ balance, pending, payoutMethods, onClose, onSuccess }) => {
  const { t } = useI18n();
  const [amount, setAmount] = useState('');
  const [payoutMethodId, setPayoutMethodId] = useState(payoutMethods[0]?.id || payoutMethods[0]?.payout_method_id || '');
  const [isProcessing, setIsProcessing] = useState(false);
  const selectedPayoutMethod = payoutMethods.find(method => String(method.id || method.payout_method_id) === String(payoutMethodId));
  const provider = selectedPayoutMethod?.provider || '';
  const isMpesa = provider === 'mpesa';
  const amountKes = Number(amount) || 0;
  const feeKes = isMpesa ? 50 : 0;
  const payoutKes = Math.max(0, amountKes - feeKes);

  const handleWithdraw = async () => {
    const val = Number(amount);
    if (!val || val < 1000) return toast.error(t('afterDarkUiMinimumWithdrawal', { amount: '1,000' }));
    if (val > balance) return toast.error(t('afterDarkUiInsufficientAvailableBalance'));
    if (!Number.isFinite(val) || Math.abs(val * 100 - Math.round(val * 100)) > 1e-7) return toast.error(t('afterDarkUiMaxTwoDecimals'));
    if (isMpesa && !Number.isInteger(val)) return toast.error(t('afterDarkUiMpesaWholeShillings'));

    if (!payoutMethodId) return toast.error(t('afterDarkUiPayoutMethodBeforeWithdrawal'));
    setIsProcessing(true);
    try {
      const result = await afterDarkService.requestWithdrawal({
        amount_cents: Math.round(val * 100),
        payout_method_id: payoutMethodId,
      });
      toast.success(t(result?.status === 'completed' ? 'afterDarkUiPayoutCompleted' : 'afterDarkUiWithdrawalRequestSubmitted'));
      onSuccess(result);
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiWithdrawalRequestFailed')));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] flex flex-col z-10 rounded-none animate-in zoom-in-95 duration-200 overflow-hidden">
        
        <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-zinc-950 shrink-0">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-white flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-green-500" /> {t('afterDarkUiWithdrawVia', { method: isMpesa ? 'M-Pesa' : provider === 'paystack_bank' ? 'Paystack bank' : provider === 'paystack_mobile_money' ? 'Paystack mobile money' : 'payout' })}
          </h2>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors rounded-none">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <div className="p-6 space-y-6 bg-black">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-zinc-950 border-2 border-zinc-800 p-4 rounded-none">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-1">{t('afterDarkUiAvailable')}</span>
              <span className="text-lg font-bold text-green-500">KES {balance.toLocaleString()}</span>
            </div>
            <div className="bg-zinc-950 border-2 border-zinc-800 p-4 rounded-none">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-1">{t('afterDarkUiPendingSevenDays')}</span>
              <span className="text-lg font-bold text-zinc-400">KES {pending.toLocaleString()}</span>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('afterDarkUiPayoutMethod')}</label>
            {payoutMethods.length ? (
              <select value={payoutMethodId} onChange={event => setPayoutMethodId(event.target.value)} className="w-full bg-black border-2 border-zinc-800 p-3 text-xs font-bold text-white focus:outline-none focus:border-white">
                {payoutMethods.map(method => (
                  <option key={method.id || method.payout_method_id} value={method.id || method.payout_method_id}>
                    {(method.provider || 'Payout').replaceAll('_', ' ')} · {method.account_number || method.phone_number || 'destination'}
                  </option>
                ))}
              </select>
            ) : (
              <p className="border-2 border-zinc-800 bg-zinc-950 p-3 text-[10px] font-bold uppercase text-zinc-400">{t('afterDarkUiPayoutMethodBeforeWithdrawal')}</p>
            )}
          </div>

          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2 flex justify-between">
              <span>{t('afterDarkUiAmountToWithdraw')}</span>
              <button type="button" onClick={() => setAmount((isMpesa ? Math.floor(balance) : balance).toFixed(isMpesa ? 0 : 2))} className="text-white hover:underline">{t('afterDarkUiMax')}</button>
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-zinc-500 font-bold text-xs">KES</span>
              <input
                type="number"
                min="1000"
                step={isMpesa ? '1' : '0.01'}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1000"
                className="w-full bg-black border-2 border-zinc-800 rounded-none p-4 pl-14 text-lg font-bold text-white focus:outline-none focus:border-white transition-colors"
              />
            </div>
          </div>

          <div className="bg-zinc-950 border-2 border-zinc-800 p-4 flex items-start gap-3 rounded-none">
            <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed">
              {selectedPayoutMethod
                ? t('afterDarkUiWithdrawalDestination', { destination: selectedPayoutMethod.account_number || selectedPayoutMethod.phone_number || t('afterDarkUiSavedPayoutMethod') })
                : t('afterDarkUiSelectSavedPayoutDestination')}
              {isMpesa
                ? t('afterDarkUiWithdrawalFeeNotice', { fee: feeKes.toLocaleString(), amount: payoutKes.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })
                : t('afterDarkUiNoPaystackPayoutFee')}
            </p>
          </div>

          <button 
            type="button"
            onClick={handleWithdraw} 
            disabled={isProcessing || !payoutMethodId || !amount || amountKes < 1000 || amountKes > balance || (isMpesa && !Number.isInteger(amountKes))}
            className="w-full py-4 bg-white text-black font-bold uppercase text-xs tracking-widest border-2 border-white hover:bg-zinc-200 disabled:opacity-50 transition-colors rounded-none"
          >
            {isProcessing ? t('afterDarkUiProcessing') : t('afterDarkUiConfirmKesWithdrawal', { amount: amountKes.toLocaleString() })}
          </button>
        </div>

      </div>
    </div>
  );
};


// ============================================================================
// MAIN COMPONENT: MY CHANNEL STUDIO (USERSETTINGS BLUEPRINT)
// ============================================================================
export default function AfterDarkMyChannel() {
  const { t } = useI18n();
  const { confirm } = useAppDialogs();
  const location = useLocation();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const currentUser = useAppStore(state => state.user);
  const isCreator = useAppStore(state => state.isCreator || state.user?.isCreator || false);
  const creatorAlias = useAppStore(state => state.afterDarkCreatorAlias);
  const setWalletBalance = useAppStore(state => state.setWalletBalance);
  const updateUser = useAppStore(state => state.updateUser);
  
  const [activeTab, setActiveTab] = useState('vault'); // 'vault' | 'subscribers' | 'finance' | 'settings'
  const [subscriberQuery, setSubscriberQuery] = useState('');
  const [subscriberStatusFilter, setSubscriberStatusFilter] = useState('all');
  const [selectedSubscriber, setSelectedSubscriber] = useState(null);
  
  // Modals
  const [editPost, setEditPost] = useState(null);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [vaultPosts, setVaultPosts] = useState([]);
  const [vaultFilter, setVaultFilter] = useState('all');
  const [subscribers, setSubscribers] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [payoutMethods, setPayoutMethods] = useState([]);
  const [channelStats, setChannelStats] = useState({ totalEarned: 0, pendingClearance: 0, activeSubs: 0, totalLikes: 0, conversionRate: '0%' });
  const [creatorProfile, setCreatorProfile] = useState({});
  const [vipPrice, setVipPrice] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [isLoadingChannel, setIsLoadingChannel] = useState(true);
  const [channelError, setChannelError] = useState('');
  const [isSavingChannel, setIsSavingChannel] = useState(false);

  // Financial State
  const [balance, setBalance] = useState(0);

  const loadChannel = useCallback(async () => {
    const [profileResponse, vaultResponse, subscriberResponse, earningsResponse, walletResponse, payoutResponse, methodsResponse] = await Promise.all([
      afterDarkService.getMyPerformerProfile(),
      afterDarkService.getVaultPosts({ status: vaultFilter === 'all' ? undefined : vaultFilter }),
      afterDarkService.getMySubscribers({
        q: subscriberQuery.trim() || undefined,
        status: subscriberStatusFilter === 'all' ? undefined : subscriberStatusFilter,
      }),
      afterDarkService.getEarningsSummary(),
      afterDarkService.getWallet(),
      afterDarkService.getWithdrawals(),
      afterDarkService.getPayoutMethods(),
    ]);
    const profile = profileResponse?.profile || profileResponse || {};
    setCreatorProfile(profile);
    const vaultRecords = Array.isArray(vaultResponse) ? vaultResponse : vaultResponse?.posts || vaultResponse?.items || [];
    const subscriberRecords = Array.isArray(subscriberResponse) ? subscriberResponse : subscriberResponse?.subscribers || subscriberResponse?.items || [];
    const withdrawalRecords = Array.isArray(payoutResponse) ? payoutResponse : payoutResponse?.withdrawals || payoutResponse?.items || [];
    const methods = Array.isArray(methodsResponse) ? methodsResponse : methodsResponse?.methods || methodsResponse?.items || [];
    if (![vaultRecords, subscriberRecords, withdrawalRecords, methods].every(Array.isArray)) {
      throw new Error(t('afterDarkUiCreatorChannelDataInvalid'));
    }
    const wallet = walletResponse?.wallet || walletResponse || {};
    const availableBalance = Number(wallet.available_balance ?? wallet.available_balance_cents ?? 0) /
      (wallet.available_balance_cents !== undefined ? 100 : 1);
    setVaultPosts(vaultRecords.map(normalizeVaultPost));
    setSubscribers(subscriberRecords.map(normalizeSubscriber));
    setPayouts(withdrawalRecords.map(payout => ({
      ...payout,
      id: payout.id || payout.withdrawal_id,
      ref: payout.ref || payout.reference || payout.transaction_reference || '',
      date: payout.date || payout.created_at || '',
      amount: Number(payout.amount ?? payout.amount_cents ?? 0) / (payout.amount_cents !== undefined ? 100 : 1),
      method: payout.method || payout.provider || 'Payout',
    })));
    setPayoutMethods(methods);
    setBalance(availableBalance);
    setWalletBalance(availableBalance);
    updateUser({ walletBalance: availableBalance });
    const earnings = earningsResponse?.summary || earningsResponse || {};
    setChannelStats({
      totalEarned: Number(earnings.total_earned ?? earnings.totalEarned ?? 0) / (earnings.total_earned_cents !== undefined ? 100 : 1),
      pendingClearance: Number(earnings.pending_clearance ?? earnings.pendingClearance ?? wallet.pending_balance ?? 0) /
        (earnings.pending_clearance_cents !== undefined ? 100 : wallet.pending_balance_cents !== undefined ? 100 : 1),
      activeSubs: Number(earnings.active_subscribers ?? earnings.activeSubs ?? subscriberRecords.filter(sub => sub.status === 'active').length),
      totalLikes: Number(earnings.total_likes ?? earnings.totalLikes ?? 0),
      conversionRate: earnings.conversion_rate || earnings.conversionRate || '0%',
    });
    const subscriptionPriceCents = profile.subscription_price_cents ?? profile.subscriptionPriceCents;
    const subscriptionPrice = profile.subscription_price ?? profile.subscriptionPrice;
    setVipPrice(String(subscriptionPriceCents !== undefined
      ? Number(subscriptionPriceCents) / 100
      : subscriptionPrice ?? ''));
    setWelcomeMessage(profile.welcome_message || profile.welcomeMessage || '');
  }, [vaultFilter, subscriberQuery, subscriberStatusFilter, setWalletBalance, t, updateUser]);

  useEffect(() => {
    if (!isCreator) {
      setIsLoadingChannel(false);
      return undefined;
    }
    let active = true;
    setIsLoadingChannel(true);
    setChannelError('');
    loadChannel().catch(error => {
      if (active) setChannelError(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiCreatorChannelLoadFailed')));
    }).finally(() => {
      if (active) setIsLoadingChannel(false);
    });
    return () => { active = false; };
  }, [loadChannel, isCreator, t]);

  useEffect(() => {
    if (location.state?.newPost) {
      const newPost = location.state.newPost;
      setVaultPosts(current => [normalizeVaultPost(newPost), ...current.filter(post => post.id !== newPost.id)]);
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }
  }, [location.key, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    const requestedTab = new URLSearchParams(location.search).get('tab');
    setActiveTab(['subscribers', 'finance', 'settings'].includes(requestedTab) ? requestedTab : 'vault');
  }, [location.search]);

  const changeChannelTab = (tabId) => {
    setActiveTab(tabId);
    if (tabId === 'vault') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: tabId }, { replace: true });
    }
  };

  const sharePost = async (post) => {
    try {
      const result = await afterDarkService.createShareLink({ target_type: 'post', target_id: post.id });
      const shareUrl = result?.url || result?.share_url;
      if (!shareUrl) throw new Error(t('afterDarkUiShareUrlMissing'));
      await navigator.clipboard.writeText(shareUrl);
      toast.success(t('afterDarkUiLinkCopied'));
    } catch {
      toast.error(t('afterDarkUiCopyPostLinkFailed'));
    }
  };

  const downloadReceipt = (payout) => {
    const receipt = [
      t('afterDarkUiPayoutReceiptTitle'),
      `${t('afterDarkUiReferenceId')}: ${payout.ref}`,
      `${t('afterDarkUiDate')}: ${payout.date}`,
      `${t('afterDarkUiMethod')}: ${payout.method}`,
      `${t('afterDarkUiStatus')}: ${payout.status}`,
      `${t('afterDarkUiAmountKes')}: KES ${payout.amount.toLocaleString()}`,
    ].join('\n');
    const url = URL.createObjectURL(new Blob([receipt], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `afterdark-payout-${payout.ref}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const visibleVaultPosts = vaultPosts.filter(post => vaultFilter === 'all' || post.status === vaultFilter);
  const visibleSubscribers = subscribers.filter(subscriber => {
    const matchesStatus = subscriberStatusFilter === 'all' || subscriber.status === subscriberStatusFilter;
    const query = subscriberQuery.trim().toLowerCase();
    const matchesQuery = !query || subscriber.user.name.toLowerCase().includes(query) || subscriber.tier.toLowerCase().includes(query);
    return matchesStatus && matchesQuery;
  });
  const activeSubscriberCount = subscribers.filter(subscriber => subscriber.status === 'active').length;
  const expiredSubscriberCount = subscribers.filter(subscriber => subscriber.status !== 'active').length;

  // ==========================================
  // RENDER BLOCKS - TABS
  // ==========================================
  const renderVaultTab = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('afterDarkUiContentLibrary')}</h2>
          <h3 className="text-base font-bold text-white uppercase tracking-widest flex items-center gap-2 mt-1">
            <Lock className="w-4 h-4 text-yellow-400" /> Media Vault ({vaultPosts.length})
          </h3>
        </div>
        
        {/* Segmented Status Filter (Matches UserSettings 'Show Me' group) */}
        <div className="flex border-2 border-zinc-800 bg-black rounded-none">
          {[
            { id: 'all', labelKey: 'afterDarkUiAll' },
            { id: 'published', labelKey: 'afterDarkUiPublished' },
            { id: 'scheduled', labelKey: 'afterDarkUiScheduled' },
          ].map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setVaultFilter(opt.id)}
              className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors border-r-2 border-zinc-800 last:border-r-0 rounded-none ${
                vaultFilter === opt.id
                  ? 'bg-white text-black'
                  : 'text-zinc-500 hover:text-white hover:bg-zinc-950'
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {visibleVaultPosts.length === 0 ? (
        <div className="bg-black border-2 border-dashed border-zinc-800 p-12 text-center flex flex-col items-center justify-center rounded-none">
          <ImageIcon className="w-8 h-8 text-zinc-600 mb-3" />
          <p className="text-xs font-bold uppercase tracking-widest text-white mb-1">{t('afterDarkUiNoVaultMedia')}</p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('afterDarkUiUploadContentToPopulate')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
          {visibleVaultPosts.map((post) => (
            <div key={post.id} className="bg-black border-2 border-zinc-800 hover:border-zinc-600 transition-colors flex flex-col group rounded-none">
              <div className="relative aspect-video bg-zinc-950 border-b-2 border-zinc-800 overflow-hidden rounded-none">
                {post.type === 'video' ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                    <Video className="w-8 h-8 text-white" />
                  </div>
                ) : null}
                {post.type === 'video' ? (
                  <video
                    src={post.url}
                    controls
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <img src={post.url} alt={t('afterDarkUiMedia')} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity rounded-none" />
                )}
                
                <div className="absolute top-3 left-3 flex flex-col gap-1.5 z-20">
                  <span className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border-2 bg-black rounded-none ${
                    post.status === 'published' 
                      ? 'border-green-500 text-green-500' 
                      : 'border-yellow-400 text-yellow-400'
                  }`}>
                    {post.status}
                  </span>
                  <span className="px-2 py-0.5 bg-black border-2 border-zinc-700 text-[9px] font-bold uppercase tracking-widest text-white rounded-none">
                    {post.strategy === 'ppv' ? `PPV: KES ${post.price}` : post.strategy === 'free' ? t('afterDarkUiFree') : t('afterDarkUiSubsOnly')}
                  </span>
                </div>
              </div>

              <div className="p-4 flex-1 flex flex-col">
                <p className="text-xs font-bold text-zinc-300 uppercase tracking-wider leading-relaxed line-clamp-2 mb-4 flex-1">
                  {post.caption || t('afterDarkUiUntitledMedia')}
                </p>
                
                <div className="grid grid-cols-3 gap-2 border-y-2 border-zinc-800 py-3 mb-4 bg-zinc-950">
                  <div className="text-center">
                    <div className="text-xs font-bold text-white">{post.stats.views.toLocaleString()}</div>
                    <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5 flex items-center justify-center gap-1">
                      <Eye className="w-3 h-3"/> {t('afterDarkUiViews')}
                    </div>
                  </div>
                  <div className="text-center border-x-2 border-zinc-800">
                    <div className="text-xs font-bold text-white">{post.stats.likes.toLocaleString()}</div>
                    <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5 flex items-center justify-center gap-1">
                      <Heart className="w-3 h-3"/> {t('afterDarkUiLikes')}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs font-bold text-green-500">{post.strategy === 'ppv' ? post.stats.unlocks : '--'}</div>
                    <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5 flex items-center justify-center gap-1">
                      <Unlock className="w-3 h-3"/> {t('afterDarkUiUnlocks')}
                    </div>
                  </div>
                </div>

                {post.strategy === 'ppv' && (
                  <div className="flex justify-between items-center bg-zinc-950 border-2 border-green-500 px-3 py-2 mb-4 rounded-none">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{t('afterDarkUiRevenue')}</span>
                    <span className="text-xs font-bold text-green-500 tracking-widest">KES {post.stats.revenue.toLocaleString()}</span>
                  </div>
                )}

                <div className="flex gap-2 mt-auto">
                  <button 
                    type="button"
                    onClick={() => setEditPost(post)}
                    className="flex-1 py-2.5 bg-black border-2 border-zinc-700 text-[10px] font-bold text-zinc-300 uppercase tracking-widest hover:border-white hover:text-white transition-colors rounded-none flex items-center justify-center gap-1.5"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> {t('afterDarkUiEdit')}
                  </button>
                  <button 
                    type="button"
                    onClick={() => sharePost(post)}
                    className="flex-1 py-2.5 bg-black border-2 border-zinc-700 text-[10px] font-bold text-zinc-300 uppercase tracking-widest hover:border-white hover:text-white transition-colors rounded-none flex items-center justify-center gap-1.5"
                  >
                    <Share2 className="w-3.5 h-3.5" /> {t('afterDarkUiShare')}
                  </button>
                  <button 
                    type="button"
                    onClick={async () => {
                      if (!await confirm(t('afterDarkUiDeleteVaultMediaConfirm'), {
                        title: t('afterDarkUiDeleteMedia'),
                        confirmLabel: t('afterDarkUiDelete'),
                        tone: 'danger',
                      })) return;
                      try {
                        await afterDarkService.deletePost(post.id);
                        setVaultPosts(current => current.filter(item => item.id !== post.id));
                        toast.success(t('afterDarkUiPostDeleted'));
                      } catch (error) {
                        toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiPostDeleteFailed')));
                      }
                    }} 
                    aria-label={t('afterDarkUiDeletePost', { caption: post.caption })}
                    className="px-3 bg-black border-2 border-red-900 text-red-500 hover:bg-red-950 hover:border-red-500 transition-colors rounded-none flex items-center justify-center"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderSubscribersTab = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('afterDarkUiAudienceManagement')}</h2>
          <h3 className="text-base font-bold text-white uppercase tracking-widest flex items-center gap-2 mt-1">
            <Users className="w-4 h-4 text-white" /> Your Subscribers
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:w-auto">
          <div className="border-2 border-green-500 bg-black px-4 py-2 rounded-none">
            <span className="block text-[9px] font-bold uppercase tracking-widest text-green-500">{t('afterDarkUiActiveVips')}</span>
            <span className="text-base font-bold text-white">{activeSubscriberCount}</span>
          </div>
          <div className="border-2 border-zinc-800 bg-zinc-950 px-4 py-2 rounded-none">
            <span className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500">{t('afterDarkUiExpired')}</span>
            <span className="text-base font-bold text-zinc-300">{expiredSubscriberCount}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={subscriberQuery}
            onChange={event => setSubscriberQuery(event.target.value)}
            placeholder={t('afterDarkUiSearchSubscriberTier')}
            className="w-full border-2 border-zinc-800 bg-black py-2.5 pl-10 pr-4 text-xs font-bold text-white uppercase tracking-widest rounded-none focus:outline-none focus:border-white transition-colors"
          />
        </div>
        
        {/* Segmented Membership Filter */}
        <div className="flex border-2 border-zinc-800 bg-black rounded-none shrink-0">
          {[
            { id: 'all', labelKey: 'afterDarkUiAll' },
            { id: 'active', labelKey: 'afterDarkUiActive' },
            { id: 'expired', labelKey: 'afterDarkUiExpired' },
          ].map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSubscriberStatusFilter(opt.id)}
              className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors border-r-2 border-zinc-800 last:border-r-0 rounded-none ${
                subscriberStatusFilter === opt.id
                  ? 'bg-white text-black'
                  : 'text-zinc-500 hover:text-white hover:bg-zinc-950'
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full overflow-x-auto custom-scrollbar border-2 border-zinc-800 bg-black rounded-none">
        <table className="w-full min-w-full text-left border-collapse">
          <thead>
            <tr className="bg-zinc-950 border-b-2 border-zinc-800">
              <th className="p-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest sm:p-3 lg:p-4">{t('afterDarkUiCustomer')}</th>
              <th className="p-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest sm:p-3 lg:p-4">{t('afterDarkUiTier')}</th>
              <th className="p-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest sm:p-3 lg:p-4">{t('afterDarkUiStatus')}</th>
              <th className="hidden p-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest sm:p-3 lg:table-cell lg:p-4">{t('afterDarkUiJoinedExpires')}</th>
              <th className="hidden p-2 text-right text-[10px] font-bold text-zinc-500 uppercase tracking-widest sm:p-3 lg:table-cell lg:p-4">{t('afterDarkUiLifetimeValue')}</th>
              <th className="p-2 text-center text-[10px] font-bold text-zinc-500 uppercase tracking-widest sm:p-3 lg:p-4">{t('afterDarkUiMessage')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleSubscribers.map((sub) => (
              <tr key={sub.id} className="border-b-2 border-zinc-800 last:border-b-0 hover:bg-zinc-950 transition-colors">
                <td className="p-2 sm:p-3 lg:p-4">
                  <div className="flex items-center gap-3">
                    <SubscriberAvatar name={sub.user?.name} src={sub.user?.avatar} className="h-9 w-9 border-2 border-zinc-700 grayscale" />
                    <span className="text-xs font-bold text-white uppercase tracking-widest">@{sub.user.name}</span>
                  </div>
                </td>
                <td className="p-2 sm:p-3 lg:p-4">
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${sub.tier === 'Diamond' ? 'text-yellow-400' : 'text-zinc-400'}`}>
                    {sub.tier}
                  </span>
                </td>
                <td className="p-2 sm:p-3 lg:p-4">
                  <span className={`px-2 py-1 text-[9px] font-bold uppercase tracking-widest border-2 rounded-none ${
                    sub.status === 'active' 
                      ? 'bg-black border-green-500 text-green-500' 
                      : 'bg-black border-red-500 text-red-500'
                  }`}>
                    {sub.status}
                  </span>
                </td>
                <td className="hidden p-2 sm:p-3 lg:table-cell lg:p-4">
                  <div className="flex flex-col gap-0.5 text-[10px] font-bold uppercase tracking-widest">
                    <span className="text-zinc-300">{sub.joinedAt || '--'}</span>
                    <span className="text-zinc-500">{sub.expiresAt || '--'}</span>
                  </div>
                </td>
                <td className="hidden p-2 text-right sm:p-3 lg:table-cell lg:p-4">
                  <span className="text-xs font-bold text-green-500 tracking-widest">KES {sub.lifetimeValue.toLocaleString()}</span>
                </td>
                <td className="p-2 text-center sm:p-3 lg:p-4">
                  <button 
                    type="button"
                    onClick={() => setSelectedSubscriber(sub)} 
                    aria-label={t('afterDarkUiMessagePerson', { name: sub.user.name })}
                    className="p-2 bg-black border-2 border-zinc-700 text-zinc-300 hover:text-black hover:bg-white hover:border-white transition-colors mx-auto rounded-none inline-flex"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {visibleSubscribers.length === 0 && (
              <tr>
                <td colSpan="6" className="p-10 text-center text-xs font-bold uppercase tracking-widest text-zinc-500">
                  No subscribers match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderFinanceTab = () => (
    <div className="space-y-8">
      
      {/* Finance Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-black border-2 border-green-500 p-6 flex flex-col justify-between shadow-[4px_4px_0px_rgba(var(--success-rgb), 0.1)] rounded-none">
          <div>
            <h4 className="text-[10px] font-bold text-green-500 uppercase tracking-widest mb-2 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Available Balance
            </h4>
            <div className="text-2xl md:text-3xl font-bold text-white tracking-widest mb-6">
              KES {balance.toLocaleString()}
            </div>
          </div>
          <button 
            type="button"
            onClick={() => setIsWithdrawOpen(true)}
            className="w-full py-3 bg-white text-black font-bold uppercase text-xs tracking-widest border-2 border-white hover:bg-zinc-200 transition-colors rounded-none"
          >
            Withdraw to M-Pesa
          </button>
        </div>

        <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col justify-center rounded-none">
          <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
            <Clock className="w-4 h-4" /> Pending Clearance
          </h4>
          <div className="text-2xl font-bold text-white tracking-widest mb-2">
            KES {channelStats.pendingClearance.toLocaleString()}
          </div>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-relaxed">
            {t('afterDarkUiFundsClearAfterSevenDays')}
          </p>
        </div>

        <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col justify-center rounded-none">
          <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-yellow-400" /> {t('afterDarkUiLifetimeGross')}
          </h4>
          <div className="text-2xl font-bold text-white tracking-widest mb-2">
            KES {channelStats.totalEarned.toLocaleString()}
          </div>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-relaxed">
            Gross earnings before 15% platform fee deduction.
          </p>
        </div>
      </div>

      {/* Payout History */}
      <div className="space-y-3">
        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
          {t('afterDarkUiRecentPayouts')}
        </h3>
        
        <div className="w-full overflow-x-auto custom-scrollbar border-2 border-zinc-800 bg-black rounded-none">
          <table className="w-full min-w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-950 border-b-2 border-zinc-800">
                <th className="p-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest sm:p-3 lg:p-4">{t('afterDarkUiDate')}</th>
                <th className="hidden p-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest sm:table-cell sm:p-3 lg:p-4">{t('afterDarkUiReferenceId')}</th>
                <th className="hidden p-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest md:table-cell md:p-3 lg:p-4">{t('afterDarkUiMethod')}</th>
                <th className="p-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest sm:p-3 lg:p-4">{t('afterDarkUiStatus')}</th>
                <th className="p-2 text-right text-[10px] font-bold text-zinc-500 uppercase tracking-widest sm:p-3 lg:p-4">{t('afterDarkUiAmountKes')}</th>
                <th className="p-2 text-center text-[10px] font-bold text-zinc-500 uppercase tracking-widest sm:p-3 lg:p-4">{t('afterDarkUiReceipt')}</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((tx) => (
                <tr key={tx.id} className="border-b-2 border-zinc-800 last:border-b-0 hover:bg-zinc-950 transition-colors">
                  <td className="p-2 text-[10px] font-bold text-zinc-300 uppercase tracking-widest sm:p-3 sm:text-xs lg:p-4">{tx.date}</td>
                  <td className="hidden p-2 text-xs font-bold text-white tracking-widest sm:table-cell sm:p-3 lg:p-4">{tx.ref}</td>
                  <td className="hidden p-2 text-xs font-bold text-zinc-400 uppercase tracking-widest md:table-cell md:p-3 lg:p-4">{tx.method}</td>
                  <td className="p-2 sm:p-3 lg:p-4">
                    <span className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest border-2 bg-black border-green-500 text-green-500 rounded-none">
                      {tx.status}
                    </span>
                  </td>
                  <td className="p-2 text-right text-[10px] font-bold text-white tracking-widest sm:p-3 sm:text-xs lg:p-4">{tx.amount.toLocaleString()}</td>
                  <td className="p-2 text-center sm:p-3 lg:p-4">
                    <button 
                      type="button"
                      onClick={() => downloadReceipt(tx)} 
                      aria-label={t('afterDarkUiDownloadReceipt', { reference: tx.ref })}
                      className="p-2 bg-black border-2 border-zinc-700 text-zinc-300 hover:text-black hover:bg-white hover:border-white transition-colors mx-auto rounded-none inline-flex"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {payouts.length === 0 && (
                <tr>
                  <td colSpan="6" className="p-10 text-center text-xs font-bold uppercase tracking-widest text-zinc-500">
                    {t('afterDarkUiNoPayoutTransactions')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderSettingsTab = () => (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('afterDarkUiSubscriptionSettings')}</h2>
        <div className="bg-black border-2 border-zinc-800 p-4 md:p-6 space-y-6 rounded-none">
          
          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('afterDarkUiMonthlyVipPriceKes')}</label>
            <input 
              type="number" 
              value={vipPrice} 
              onChange={event => setVipPrice(event.target.value)}
              placeholder="1500"
              className="w-full max-w-xs bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-sm font-bold text-white focus:outline-none focus:border-white transition-colors"
            />
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-2">
              {t('afterDarkUiSetZeroFreeChannel')}
            </p>
          </div>

          <div className="pt-6 border-t-2 border-zinc-800">
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2 flex items-center justify-between">
              <span>{t('afterDarkUiAutomatedWelcomeMessage')}</span>
              <span className="text-yellow-400 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> {t('afterDarkUiActive')}</span>
            </label>
            <textarea 
              value={welcomeMessage} 
              onChange={event => setWelcomeMessage(event.target.value)}
              placeholder={t('afterDarkUiWelcomeVipRoom')}
              className="min-h-[clamp(6rem,15vh,9rem)] w-full resize-none border-2 border-zinc-800 bg-black px-4 py-3 text-sm font-bold text-white transition-colors focus:outline-none focus:border-white rounded-none custom-scrollbar"
            />
          </div>

          <div className="pt-2">
            <button 
              type="button"
              onClick={async () => {
                setIsSavingChannel(true);
                try {
                  await afterDarkService.updateMyPerformerProfile({
                    subscription_price_cents: Math.round(Number(vipPrice || 0) * 100),
                    welcome_message: welcomeMessage,
                  });
                  toast.success(t('afterDarkUiChannelSettingsSaved'));
                  await loadChannel();
                } catch (error) {
                  toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiChannelSettingsSaveFailed')));
                } finally {
                  setIsSavingChannel(false);
                }
              }} 
              disabled={isSavingChannel} 
              className="px-6 py-3 bg-white text-black border-2 border-white text-xs font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors disabled:opacity-50 rounded-none"
            >
              {isSavingChannel ? t('afterDarkUiSaving') : t('afterDarkUiSaveChannelSettings')}
            </button>
          </div>
        </div>
      </section>

      <section className="pt-6 border-t-2 border-zinc-800 space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-red-500">{t('afterDarkUiDangerZone')}</h2>
        <div className="bg-black border-2 border-red-900 p-4 md:p-6 shadow-[4px_4px_0px_rgba(var(--danger-rgb), 0.1)] rounded-none">
          <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" /> {t('afterDarkUiDeactivateCreatorChannel')}
          </h3>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-relaxed mb-6">
            {t('afterDarkUiDeactivateCreatorWarning')}
          </p>
          <button 
            type="button"
            onClick={() => navigate('/afterdark/settings?tab=danger')} 
            className="px-6 py-3 bg-black text-red-500 border-2 border-red-900 font-bold uppercase text-xs tracking-widest hover:bg-red-950 hover:border-red-500 transition-colors rounded-none"
          >
            {t('afterDarkUiDeactivateCreatorAccount')}
          </button>
        </div>
      </section>
    </div>
  );

  // ==========================================
  // MAIN RENDER
  // ==========================================
  if (!isCreator) return <Navigate to="/afterdark/feed" replace />;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-black w-full relative overflow-hidden text-zinc-300 rounded-none font-mono">
      
      {/* HERO HEADER: Cover & Profile Summary */}
      <div className="relative shrink-0 border-b-2 border-zinc-800 bg-zinc-950 rounded-none">
        
        {/* Cover Photo */}
        <div className="relative aspect-[4/1] w-full overflow-hidden border-b-2 border-zinc-800 bg-black rounded-none group">
          {creatorProfile.cover_url || creatorProfile.cover ? (
            <img src={creatorProfile.cover_url || creatorProfile.cover} alt={t('afterDarkUiCreatorCover')} className="w-full h-full object-cover opacity-60 grayscale group-hover:opacity-40 transition-opacity rounded-none" />
          ) : (
            <div className="h-full w-full bg-zinc-950" />
          )}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-sm">
            <button 
              type="button"
              onClick={() => navigate('/afterdark/settings')} 
              className="px-4 py-2 bg-white text-black font-bold uppercase tracking-widest text-xs border-2 border-white hover:bg-zinc-200 flex items-center gap-2 rounded-none"
            >
              <Camera className="w-4 h-4" /> {t('afterDarkUiEditCover')}
            </button>
          </div>
        </div>

        {/* Profile Details & Stats Bar */}
        <div className="px-4 md:px-8 pb-6 relative z-10 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="flex items-end gap-4 -mt-12 md:-mt-16">
            <button 
              type="button" 
              onClick={() => navigate('/afterdark/settings')} 
              className="relative group shrink-0 rounded-none focus:outline-none"
            >
              {(creatorProfile.avatar_url || currentUser?.avatar) ? (
                <img 
                  src={creatorProfile.avatar_url || currentUser.avatar} 
                  alt={t('afterDarkUiAvatar')}
                  className="size-[clamp(5.5rem,12vw,8rem)] object-cover border-2 border-zinc-600 bg-black rounded-none"
                />
              ) : (
                <div className="size-[clamp(5.5rem,12vw,8rem)] border-2 border-zinc-600 bg-black flex items-center justify-center text-xl font-bold text-white rounded-none">
                  {(creatorProfile.display_name || creatorAlias || currentUser?.name || 'C').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 cursor-pointer border-2 border-white rounded-none">
                <Camera className="w-6 h-6 text-white" />
              </div>
            </button>
            <div className="pb-1 min-w-0">
              <h1 className="text-xl md:text-2xl font-bold text-white uppercase tracking-widest flex items-center gap-2 truncate">
                <span className="truncate">{creatorProfile.display_name || creatorAlias || currentUser?.name || t('afterDarkUiCreator')}</span>
                <CheckCircle2 className="w-5 h-5 text-yellow-400 shrink-0" />
              </h1>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mt-1 truncate">
                @{creatorProfile.username || (creatorAlias || currentUser?.name || 'creator').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}
              </p>
            </div>
          </div>

          <div className="flex items-center border-2 border-zinc-800 bg-black shrink-0 overflow-x-auto custom-scrollbar rounded-none">
            <div className="text-center px-5 py-3 border-r-2 border-zinc-800">
              <div className="text-base md:text-lg font-bold text-white">{channelStats.activeSubs}</div>
              <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">{t('afterDarkUiActiveVips')}</div>
            </div>
            <div className="text-center px-5 py-3 border-r-2 border-zinc-800">
              <div className="text-base md:text-lg font-bold text-white">{channelStats.totalLikes}</div>
              <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">{t('afterDarkUiTotalLikes')}</div>
            </div>
            <div className="text-center px-5 py-3">
              <div className="text-base md:text-lg font-bold text-green-500">KES {(channelStats.totalEarned / 1000).toFixed(0)}k</div>
              <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">{t('afterDarkUiGrossEarned')}</div>
            </div>
          </div>
        </div>

        {/* SHARP SEGMENTED TAB NAVIGATION (Exact match to UserSettings 'Show Me' group) */}
        <div className="flex overflow-x-auto custom-scrollbar border-t-2 border-zinc-800 bg-black rounded-none">
          {[
            { id: 'vault', labelKey: 'afterDarkUiMediaVault', icon: ImageIcon },
            { id: 'subscribers', labelKey: 'afterDarkUiSubscribers', icon: Users },
            { id: 'finance', labelKey: 'afterDarkUiFinancePayouts', icon: DollarSign },
            { id: 'settings', labelKey: 'afterDarkUiSettings', icon: Settings },
          ].map(tab => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => changeChannelTab(tab.id)}
                className={`min-w-[clamp(7rem,15vw,9rem)] flex-1 py-3.5 px-4 text-xs font-bold uppercase tracking-widest transition-colors border-r-2 border-zinc-800 last:border-r-0 flex items-center justify-center gap-2 rounded-none focus:outline-none ${
                  isActive 
                    ? 'bg-white text-black' 
                    : 'bg-black text-zinc-500 hover:text-white hover:bg-zinc-950'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{t(tab.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB CONTENT AREA */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-black p-2 sm:p-3 lg:p-4">
        <div className="w-full">
          {channelError && (
            <div role="alert" className="mb-6 border-2 border-red-900 bg-black p-4 text-xs font-bold uppercase tracking-widest text-red-500 rounded-none">
              {channelError}
            </div>
          )}
          {isLoadingChannel && (
            <div role="status" className="mb-6 flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin text-white" /> {t('afterDarkUiLoadingCreatorChannel')}
            </div>
          )}
          {activeTab === 'vault' && renderVaultTab()}
          {activeTab === 'subscribers' && renderSubscribersTab()}
          {activeTab === 'finance' && renderFinanceTab()}
          {activeTab === 'settings' && renderSettingsTab()}
        </div>
      </div>

      {/* MODALS PORTAL */}
      <EditPostModal 
        post={editPost} 
        onClose={() => setEditPost(null)}
        onSave={(updatedPost) => {
          const normalized = normalizeVaultPost(updatedPost);
          setVaultPosts(prev => prev.map(p => p.id === normalized.id ? normalized : p));
        }}
      />
      
      <SubscriberMessageModal 
        subscriber={selectedSubscriber} 
        onClose={() => setSelectedSubscriber(null)} 
      />

      {isWithdrawOpen && (
        <WithdrawModal 
          balance={balance}
          pending={channelStats.pendingClearance}
          payoutMethods={payoutMethods}
          onClose={() => setIsWithdrawOpen(false)}
          onSuccess={async () => {
            setIsWithdrawOpen(false);
            await loadChannel();
          }}
        />
      )}
    </div>
  );
}