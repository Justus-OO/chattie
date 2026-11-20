import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Smartphone, Lock, X, Loader2, CheckCircle2, ShieldCheck, 
  CreditCard, AlertTriangle, Receipt, ChevronRight, Eye, EyeOff,
  RefreshCcw, Copy, Shield, History, Wallet
} from 'lucide-react';
import { toast } from 'sonner';
import { afterDarkService } from '../../api/afterdark.service';
import { PagePrivacyShield, usePageFocus } from '../../hooks/usePageFocus';
import { useAppStore } from '../../store/useAppStore';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';

const PAYSTACK_SCRIPT_URL = 'https://js.paystack.co/v2/inline.js';

const loadPaystackScript = () => new Promise((resolve, reject) => {
  const script = document.querySelector(`script[src="${PAYSTACK_SCRIPT_URL}"]`);
  if (window.PaystackPop && script) {
    resolve();
    return;
  }
  const paystackScript = script || document.createElement('script');
  paystackScript.src = PAYSTACK_SCRIPT_URL;
  paystackScript.async = true;
  paystackScript.onload = () => resolve();
  paystackScript.onerror = () => reject(new Error('Could not load Paystack checkout.'));
  if (!script) document.body.appendChild(paystackScript);
});

export default function CheckoutModal({
  isOpen,
  onClose,
  postItem,
  onSuccess,
  defaultProvider = 'mpesa',
  initialPhoneNumber = '',
}) {
  const navigate = useNavigate();
  // --- Core State ---
  const [activeTab, setActiveTab] = useState('mpesa'); // 'mpesa' | 'card' | 'wallet'
  const [step, setStep] = useState('checkout'); // 'checkout' | 'processing' | 'polling' | 'success' | 'failed'
  
  const isLivePassPurchase = postItem?.id?.startsWith('live-pass-');
  const isLiveSubscriptionPurchase = postItem?.id?.startsWith('live-subscription-');
  const isChatPurchase = postItem?.id?.startsWith('chat-');
  const isPostPurchase = !isChatPurchase && !isLivePassPurchase && !isLiveSubscriptionPurchase
    && (!postItem?.paymentType || postItem.paymentType === 'ppv');
  const isWalletPurchase = isChatPurchase;
  
  // --- M-Pesa State ---
  const [phoneNumber, setPhoneNumber] = useState('');
  const [savedNumbers, setSavedNumbers] = useState([]);
  const [showSaved, setShowSaved] = useState(false);
  const [showPhoneNumber, setShowPhoneNumber] = useState(false);
  const isPageFocused = usePageFocus();
  const [countdown, setCountdown] = useState(180);
  
  // --- Polling & Error State ---
  const [errorMessage, setErrorMessage] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [confirmedAmountCents, setConfirmedAmountCents] = useState(null);
  const [confirmedChargeCents, setConfirmedChargeCents] = useState(null);
  const [chargeCurrency, setChargeCurrency] = useState('KES');
  const [checkoutConfig, setCheckoutConfig] = useState(null);
  const [checkoutProvider, setCheckoutProvider] = useState('');
  const [stripePromise, setStripePromise] = useState(null);
  const [stripeCheckout, setStripeCheckout] = useState(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [isLoadingWallet, setIsLoadingWallet] = useState(false);
  const [useWalletBalance, setUseWalletBalance] = useState(false);
  const [checkoutWalletAmountCents, setCheckoutWalletAmountCents] = useState(0);
  const setGlobalWalletBalance = useAppStore(state => state.setWalletBalance);
  const updateUser = useAppStore(state => state.updateUser);
  const pollIntervalRef = useRef(null);
  const timerRef = useRef(null);
  const pollInFlightRef = useRef(false);

  // --- Financial Calculation ---
  const listedPriceCents = Number(postItem?.amountCents ?? postItem?.price_cents ?? Math.round(Number(postItem?.price ?? 0) * 100));
  const totalAmount = listedPriceCents / 100;
  const selectedWalletAmountCents = isPostPurchase && useWalletBalance
    ? Math.min(Math.max(0, Math.round(walletBalance * 100)), listedPriceCents)
    : 0;
  const walletAmountCents = step === 'checkout' ? selectedWalletAmountCents : checkoutWalletAmountCents;
  const itemPrice = confirmedAmountCents === null
    ? Math.max(0, listedPriceCents - selectedWalletAmountCents) / 100
    : confirmedAmountCents / 100;
  const platformFee = 0; // Assuming absorbed
  const vatAmount = totalAmount * 0.16; // 16% Kenyan VAT for receipt display
  const estimatedCharge = chargeCurrency === 'USD' && checkoutConfig?.kes_per_usd > 0
    ? itemPrice / checkoutConfig.kes_per_usd
    : itemPrice;
  const paymentCurrency = checkoutConfig?.currency || 'KES';
  const paymentAmount = confirmedChargeCents === null
    ? (paymentCurrency === 'USD' && checkoutConfig?.kes_per_usd > 0
      ? itemPrice / checkoutConfig.kes_per_usd
      : itemPrice)
    : confirmedChargeCents / 100;

  // ==========================================
  // HELPERS & VALIDATION
  // ==========================================
  const validateKenyanPhone = (phone) => {
    // Matches 07xx, 01xx, 2547xx, 2541xx, +2547xx, +2541xx
    const regex = /^(?:254|\+254|0)?([71]\d{8})$/;
    const match = phone.replace(/\s+/g, '').match(regex);
    if (match) return `254${match[1]}`; // Normalize to 254XXXXXXXX
    return null;
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Transaction reference copied.');
    } catch {
      toast.error('Unable to copy the transaction reference from this browser.');
    }
  };

  const resetModal = () => {
    setStep('checkout');
    setErrorMessage('');
    setCountdown(180);
    setConfirmedAmountCents(null);
    setConfirmedChargeCents(null);
    setCheckoutWalletAmountCents(0);
    setUseWalletBalance(isPostPurchase && walletBalance > 0);
    setChargeCurrency('KES');
    setCheckoutProvider('');
    setStripePromise(null);
    setStripeCheckout(null);
    clearInterval(pollIntervalRef.current);
    clearInterval(timerRef.current);
  };

  useEffect(() => {
    if (!isOpen) return;
    setStep('checkout');
    setErrorMessage('');
    setCountdown(180);
    setConfirmedAmountCents(null);
    setConfirmedChargeCents(null);
    setCheckoutWalletAmountCents(0);
    setUseWalletBalance(false);
    setCheckoutProvider('');
    setStripePromise(null);
    setStripeCheckout(null);
    clearInterval(pollIntervalRef.current);
    clearInterval(timerRef.current);
    setActiveTab(isWalletPurchase ? 'wallet' : defaultProvider === 'paystack' ? 'card' : 'mpesa');
    setPhoneNumber(initialPhoneNumber.replace(/\D/g, '').replace(/^254/, ''));
    if (!isWalletPurchase && !isPostPurchase) return;

    let active = true;
    setIsLoadingWallet(true);
    afterDarkService.getWallet()
      .then(response => {
        if (!active) return;
        const wallet = response?.wallet || response || {};
        const balance = Number(wallet.available_balance ?? wallet.available_balance_cents ?? 0) /
          (wallet.available_balance_cents !== undefined ? 100 : 1);
        setWalletBalance(balance);
        setGlobalWalletBalance(balance);
        updateUser({ walletBalance: balance });
        setUseWalletBalance(isPostPurchase && balance > 0);
      })
      .catch(error => {
        if (active) setErrorMessage(error?.response?.data?.error || 'Could not load your wallet balance.');
      })
      .finally(() => {
        if (active) setIsLoadingWallet(false);
      });

    return () => { active = false; };
  }, [defaultProvider, initialPhoneNumber, isOpen, isPostPurchase, isWalletPurchase, postItem?.id, setGlobalWalletBalance, updateUser]);

  useEffect(() => {
    if (!isOpen || isWalletPurchase) {
      setCheckoutConfig(null);
      return undefined;
    }
    let active = true;
    setCheckoutConfig(null);
    afterDarkService.getCheckoutConfig()
      .then((config) => {
        if (!active) return;
        if (!config || !Array.isArray(config.supported_providers) || !config.default_provider) {
          throw new Error('Regional checkout settings are unavailable.');
        }
        setCheckoutConfig(config);
        setChargeCurrency(config.currency || 'KES');
        setActiveTab(config.default_provider === 'stripe'
          ? 'card'
          : defaultProvider === 'paystack' ? 'card' : 'mpesa');
      })
      .catch((error) => {
        if (active) setErrorMessage(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load regional checkout settings.'));
      });
    return () => { active = false; };
  }, [defaultProvider, isOpen, isWalletPurchase]);

  const handleClose = () => {
    resetModal();
    onClose();
  };

  const startCheckout = async (provider, phoneNumberValue) => {
    const paymentType = postItem.paymentType
      || (isLivePassPurchase ? 'live_pass' : isLiveSubscriptionPurchase ? 'subscription' : 'ppv');
    const targetID = paymentType === 'deposit'
      ? ''
      : postItem.targetId
        || postItem.resourceId
        || postItem.productId
        || (isLivePassPurchase || isLiveSubscriptionPurchase || isChatPurchase
          ? postItem.id.replace(/^(live-pass|live-subscription|chat)-/, '')
          : postItem.id);
    const checkout = await afterDarkService.startPayment({
      payment_type: paymentType,
      target_id: targetID,
      amount_cents: postItem.amountCents ?? postItem.price_cents ?? Math.round(totalAmount * 100),
      use_wallet: isPostPurchase && useWalletBalance,
      provider,
      phone_number: phoneNumberValue || undefined,
      message: postItem.message || '',
    });
    if (checkout?.status === 'completed') {
      setCheckoutWalletAmountCents(listedPriceCents);
      setTransactionRef(`WALLET-${targetID}`);
      setActiveTab('wallet');
      setStep('success');
      await refreshWalletBalance();
      onSuccess?.(checkout);
      return;
    }
    const intentId = checkout?.id;
    if (!intentId) throw new Error('The checkout service did not return a valid payment reference.');
    if (Number.isFinite(Number(checkout.settlement_amount_cents))) {
      setConfirmedAmountCents(Number(checkout.provider_settlement_amount_cents ?? checkout.settlement_amount_cents));
    }
    const walletContribution = Math.max(0, Number(checkout.wallet_amount_cents) || 0);
    setCheckoutWalletAmountCents(walletContribution);
    if (walletContribution > 0) {
      const nextWalletBalance = Math.max(0, walletBalance - walletContribution / 100);
      setWalletBalance(nextWalletBalance);
      setGlobalWalletBalance(nextWalletBalance);
      updateUser({ walletBalance: nextWalletBalance });
      void refreshWalletBalance();
    }
    if (Number.isFinite(Number(checkout.amount_cents))) {
      setConfirmedChargeCents(Number(checkout.amount_cents));
      setChargeCurrency(checkout.currency || 'KES');
    }
    const actualProvider = checkout.provider;
    setCheckoutProvider(actualProvider);
    setTransactionRef(intentId);
    setStep('polling');
    setCountdown(actualProvider === 'stripe' ? 600 : 180);

    if (actualProvider === 'paystack') {
      await loadPaystackScript();
      if (typeof window.PaystackPop !== 'function' || !checkout.client_secret) {
        throw new Error('Paystack checkout could not initialize.');
      }
      const popup = new window.PaystackPop();
      popup.resumeTransaction(checkout.client_secret);
    } else if (actualProvider === 'stripe') {
      if (!checkout.client_secret || !checkout.public_key) {
        throw new Error('Stripe checkout could not initialize.');
      }
      setStripePromise(loadStripe(checkout.public_key));
      setStripeCheckout(checkout);
    } else if (actualProvider !== 'mpesa') {
      throw new Error('The server returned an unsupported payment provider.');
    }

    pollIntervalRef.current = window.setInterval(async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const result = await afterDarkService.getPaymentStatus(intentId);
        setErrorMessage('');
        const nextStatus = String(result?.status || '').toLowerCase();
        
        if (nextStatus === 'completed') {
          clearInterval(pollIntervalRef.current);
          clearInterval(timerRef.current);
          setStep('success');
          await refreshWalletBalance();
          onSuccess?.(result);
        } else if (nextStatus === 'failed') {
          clearInterval(pollIntervalRef.current);
          clearInterval(timerRef.current);
          setStep('failed');
          setErrorMessage('The transaction was cancelled or failed.');
          await refreshWalletBalance();
        }
      } catch (error) {
        setErrorMessage(error?.response?.data?.error || (error instanceof Error ? error.message : 'Payment status check failed. Retrying.'));
      } finally {
        pollInFlightRef.current = false;
      }
    }, 5000);
  };

  const refreshWalletBalance = async () => {
    try {
      const response = await afterDarkService.getWallet();
      const wallet = response?.wallet || response || {};
      const balance = Number(wallet.available_balance ?? wallet.available_balance_cents ?? 0) /
        (wallet.available_balance_cents !== undefined ? 100 : 1);
      setWalletBalance(balance);
      setGlobalWalletBalance(balance);
      updateUser({ walletBalance: balance });
      return balance;
    } catch (error) {
      console.error('Could not refresh the After Dark wallet balance.', error);
      toast.error('Payment status updated, but your wallet balance could not refresh. Reload the wallet to verify it.');
      return null;
    }
  };

  const handleWalletPostUnlock = async () => {
    if (isChatPurchase) {
      const conversationId = postItem?.resourceId || postItem?.id?.replace(/^chat-/, '');
      if (!conversationId) return;
      setStep('processing');
      setErrorMessage('');
      try {
        const result = await afterDarkService.unlockChatWithWallet(conversationId);
        if (String(result?.status || '').toLowerCase() !== 'success' || result?.has_access !== true) {
          throw new Error('The server did not confirm chat access.');
        }
        setStep('success');
        await refreshWalletBalance();
        onSuccess?.({ type: 'chat_unlock', conversationId });
      } catch (error) {
        setStep('failed');
        setErrorMessage(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not unlock this chat.'));
        await refreshWalletBalance();
      }
      return;
    }

    const postId = postItem?.productId || postItem?.id;
    if (!postId) return;

    setStep('processing');
    setErrorMessage('');
    try {
      const result = await afterDarkService.startPayment({
        payment_type: 'ppv',
        target_id: postId,
        amount_cents: listedPriceCents,
        use_wallet: true,
        wallet_only: true,
      });
      if (String(result?.status || '').toLowerCase() !== 'completed') {
        throw new Error('The server did not confirm the post unlock.');
      }
      await refreshWalletBalance();
      setCheckoutWalletAmountCents(listedPriceCents);
      setTransactionRef(result.id || `WALLET-${postId}`);
      setActiveTab('wallet');
      setStep('success');
      onSuccess?.(result);
    } catch (error) {
      setStep('failed');
      setErrorMessage(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not unlock this post.'));
      await refreshWalletBalance();
    }
  };

  // ==========================================
  // TIMERS & CLEANUP
  // ==========================================
  useEffect(() => {
    if (step === 'polling') {
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            clearInterval(pollIntervalRef.current);
            setStep('failed');
            setErrorMessage('Payment is still pending. Check your provider, then retry or contact support if it does not complete.');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      clearInterval(timerRef.current);
      clearInterval(pollIntervalRef.current);
    };
  }, [step]);

  useEffect(() => {
    if (!isPageFocused) {
      setShowSaved(false);
      setShowPhoneNumber(false);
    }
  }, [isPageFocused]);

  if (!isOpen || !postItem) return null;

  // ==========================================
  // PAYMENT HANDLERS
  // ==========================================
  const handleMpesaSubmit = async (e) => {
    e.preventDefault();
    
    const formattedPhone = validateKenyanPhone(phoneNumber);
    if (!formattedPhone) {
      toast.error('Invalid phone number. Ensure it is a valid Kenyan number (e.g., 07XX XXX XXX).');
      return;
    }

    setStep('processing');
    setErrorMessage('');

    try {
      await startCheckout('mpesa', formattedPhone);
      // Save number for next time if successful initiation
      if (!savedNumbers.includes(formattedPhone)) {
        setSavedNumbers(prev => [formattedPhone, ...prev].slice(0, 3));
      }
    } catch (err) {
      setStep('failed');
      setErrorMessage(err?.response?.data?.error || (err instanceof Error ? err.message : 'Failed to reach Safaricom Daraja API.'));
      await refreshWalletBalance();
    }
  };

  const handlePaystackCardSubmit = async (e) => {
    e.preventDefault();
    setStep('processing');
    setErrorMessage('');
    try {
      await startCheckout(checkoutConfig?.default_provider === 'stripe' ? 'stripe' : 'paystack');
    } catch (err) {
      setStep('failed');
      setErrorMessage(err?.response?.data?.error || (err instanceof Error ? err.message : 'Failed to reach Paystack secure gateway.'));
      await refreshWalletBalance();
    }
  };

  // ==========================================
  // RENDER BLOCKS
  // ==========================================
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 md:p-12">
      <div 
        className="absolute inset-0 bg-black/90 backdrop-blur-md transition-opacity duration-300" 
        onClick={() => (step === 'checkout' || step === 'failed' || step === 'success') && handleClose()} 
      />
      
      <div className="relative flex h-[90dvh] min-h-0 w-full max-w-4xl flex-col border-2 border-zinc-700 bg-black font-mono shadow-[12px_12px_0px_rgba(var(--highlight-rgb), 0.05)] animate-in fade-in zoom-in-95 duration-200 md:flex-row">
        
        {/* LEFT PANEL: ORDER SUMMARY */}
        <div className="w-full md:w-[40%] bg-zinc-950 border-b-2 md:border-b-0 md:border-r-2 border-zinc-800 flex flex-col">
          <div className="p-6 border-b-2 border-zinc-800 flex justify-between items-center bg-black">
            <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
              <Receipt className="w-4 h-4 text-zinc-400" /> ORDER SUMMARY
            </h2>
            <button onClick={handleClose} disabled={step === 'processing' || step === 'polling'} className="md:hidden p-2 text-zinc-500 hover:text-white disabled:opacity-0">
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="p-6 flex-1 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
            
            {/* Item Card */}
            <div className="bg-black border-2 border-zinc-800 p-5 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-2 bg-yellow-500/10 border-b-2 border-l-2 border-yellow-500">
                <Lock className="w-4 h-4 text-yellow-500" />
              </div>
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">Item to Unlock</span>
              <p className="text-sm font-bold text-white leading-relaxed pr-8 line-clamp-3">
                {postItem.caption || (isLivePassPurchase ? 'Live Room Access Pass' : isLiveSubscriptionPurchase ? 'Creator VIP Subscription' : 'Exclusive Vault Media')}
              </p>
              
              <div className="mt-5 flex items-center gap-2 pt-4 border-t-2 border-dashed border-zinc-900">
                <ShieldCheck className="w-4 h-4 text-green-500" />
                <span className="text-[9px] font-bold text-green-500 uppercase tracking-widest">End-to-End Encrypted Access</span>
              </div>
            </div>

            {/* Price Breakdown */}
            <div className="space-y-4 bg-black p-5 border-2 border-zinc-900">
              <div className="flex justify-between items-center text-xs font-bold text-zinc-400 uppercase tracking-widest">
                <span>Subtotal</span>
                <span className="text-white">KES {totalAmount.toFixed(2)}</span>
              </div>
              {walletAmountCents > 0 && (
                <div className="flex justify-between items-center text-xs font-bold text-yellow-400 uppercase tracking-widest">
                  <span>Wallet applied</span>
                  <span>- KES {(walletAmountCents / 100).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-xs font-bold text-zinc-400 uppercase tracking-widest">
                <span>Pay with selected method</span>
                <span className="text-white">KES {itemPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-bold text-zinc-400 uppercase tracking-widest">
                <span>Network Fee</span>
                <span className="text-white">KES {platformFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-bold text-zinc-600 uppercase tracking-widest pt-4 border-t border-zinc-900 border-dashed">
                <span>Includes 16% VAT</span>
                <span>KES {vatAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="p-6 bg-zinc-900 border-t-2 border-zinc-800 shrink-0">
            <div className="flex justify-between items-end">
              <span className="text-[11px] font-black text-zinc-400 uppercase tracking-widest">
                {walletAmountCents > 0 ? 'Remaining Due' : 'Total Due'}
              </span>
              <div className="text-right">
                <span className="text-2xl font-black text-yellow-500 tracking-wider">
                  {paymentCurrency} {paymentAmount.toFixed(paymentCurrency === 'USD' ? 2 : 0)}
                </span>
                {paymentCurrency === 'USD' && <span className="mt-1 block text-[9px] text-zinc-500">KES {totalAmount.toFixed(2)} settlement · approx. USD {estimatedCharge.toFixed(2)}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: PAYMENT INTERFACE */}
        <div className="w-full md:w-[60%] flex flex-col bg-black relative">
          
          <div className="hidden md:block absolute top-4 right-4 z-20">
            <button 
              onClick={handleClose} 
              disabled={step === 'processing' || step === 'polling'} 
              className="p-2 border-2 border-transparent text-zinc-500 hover:text-white hover:border-zinc-700 hover:bg-zinc-900 transition-colors disabled:opacity-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {step === 'checkout' && (
            <div className="flex-1 flex flex-col h-full overflow-y-auto custom-scrollbar">
              
              <div className="px-8 pt-8 pb-4">
                <h2 className="text-lg font-black text-white uppercase tracking-widest">Select Payment Method</h2>
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mt-1">Secure & Encrypted Checkout</p>
              </div>

              {/* Payment Tabs */}
              {!isWalletPurchase && checkoutConfig && <div className="flex px-8 gap-4 shrink-0">
                {checkoutConfig.supported_providers.includes('mpesa') && <button
                  onClick={() => setActiveTab('mpesa')}
                  className={`flex-1 p-4 border-2 transition-all flex flex-col items-center justify-center gap-3 ${activeTab === 'mpesa' ? 'border-green-500 bg-green-500/10 shadow-[4px_4px_0px_rgba(var(--success-rgb), 0.2)]' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'}`}
                >
                  <Smartphone className={`w-7 h-7 ${activeTab === 'mpesa' ? 'text-green-500' : 'text-zinc-500'}`} />
                  <span className={`text-[10px] font-black uppercase tracking-widest ${activeTab === 'mpesa' ? 'text-green-500' : 'text-zinc-500'}`}>M-Pesa Express</span>
                </button>}
                {(checkoutConfig.supported_providers.includes('paystack') || checkoutConfig.supported_providers.includes('stripe')) && <button
                  onClick={() => setActiveTab('card')}
                  className={`flex-1 p-4 border-2 transition-all flex flex-col items-center justify-center gap-3 ${activeTab === 'card' ? 'border-blue-500 bg-blue-500/10 shadow-[4px_4px_0px_rgba(var(--info-rgb), 0.2)]' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'}`}
                >
                  <CreditCard className={`w-7 h-7 ${activeTab === 'card' ? 'text-blue-500' : 'text-zinc-500'}`} />
                  <span className={`text-[10px] font-black uppercase tracking-widest ${activeTab === 'card' ? 'text-blue-500' : 'text-zinc-500'}`}>
                    {checkoutConfig.default_provider === 'stripe' ? 'Stripe card' : 'Paystack card'}
                  </span>
                </button>}
              </div>}

              {/* Tab Content */}
              <div className="p-8 flex-1 flex flex-col">
                {isPostPurchase && (
                  <div className="mx-auto mb-6 w-full max-w-md border-2 border-zinc-800 bg-zinc-950 p-5">
                    <div className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white">
                        <Wallet className="h-4 w-4 text-yellow-400" /> After Dark balance
                      </span>
                      <span className="text-xs font-bold tabular-nums text-zinc-300">
                        {isLoadingWallet ? 'Loading…' : `KES ${walletBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </span>
                    </div>
                    <label className="mt-4 flex cursor-pointer items-start gap-3 text-xs font-bold text-zinc-300">
                      <input
                        type="checkbox"
                        checked={useWalletBalance}
                        onChange={event => setUseWalletBalance(event.target.checked)}
                        disabled={isLoadingWallet || walletBalance <= 0}
                        className="mt-0.5 accent-yellow-400"
                      />
                      <span>
                        Apply {selectedWalletAmountCents > 0
                          ? `KES ${(selectedWalletAmountCents / 100).toFixed(2)}`
                          : 'available balance'} to this post
                        {selectedWalletAmountCents > 0 && selectedWalletAmountCents < listedPriceCents
                          ? ` and pay the remaining KES ${itemPrice.toFixed(2)} with the selected method`
                          : ''}
                      </span>
                    </label>
                    {selectedWalletAmountCents > 0 && selectedWalletAmountCents < listedPriceCents && (
                      <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                        The wallet portion is held during checkout and returned automatically if the provider payment fails.
                      </p>
                    )}
                    {isLoadingWallet && <p role="status" className="mt-3 text-[10px] text-zinc-500">Loading wallet balance…</p>}
                    {!isLoadingWallet && walletBalance >= totalAmount && (
                      <button
                        type="button"
                        onClick={handleWalletPostUnlock}
                        className="mt-4 flex w-full items-center justify-center gap-2 border-2 border-yellow-400 bg-yellow-400 py-3 text-xs font-black uppercase tracking-widest text-black hover:bg-yellow-300"
                      >
                        <Wallet className="h-4 w-4" /> Unlock with balance
                      </button>
                    )}
                    {errorMessage && <p role="alert" className="mt-3 text-xs text-red-400">{errorMessage}</p>}
                  </div>
                )}
                {isWalletPurchase ? (
                  <div className="mx-auto flex w-full max-w-md flex-col gap-5 border-2 border-zinc-800 bg-zinc-950 p-6">
                    <div className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white"><Wallet className="h-4 w-4 text-yellow-400" /> Chattie wallet</span>
                      <span className="text-xs font-bold tabular-nums text-zinc-300">KES {walletBalance.toLocaleString()}</span>
                    </div>
                    <p className="text-[10px] leading-relaxed text-zinc-500">                    {'A one-time wallet payment unlocks ongoing access to this creator’s chat.'}</p>
                    {errorMessage && <p role="alert" className="text-xs text-red-400">{errorMessage}</p>}
                    <button type="button" onClick={handleWalletPostUnlock} disabled={isLoadingWallet || walletBalance < totalAmount} className="flex w-full items-center justify-center gap-2 border-2 border-yellow-400 bg-yellow-400 py-4 text-xs font-black uppercase tracking-widest text-black hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-50">
                      {isLoadingWallet ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                      {walletBalance < totalAmount ? 'Insufficient balance' : `${isChatPurchase ? 'Unlock chat' : 'Unlock'} for KES ${totalAmount.toFixed(2)}`}
                    </button>
                    {walletBalance < totalAmount && (
                      <button
                        type="button"
                        onClick={() => { handleClose(); navigate('/afterdark/wallet'); }}
                        className="w-full border-2 border-zinc-700 py-3 text-xs font-bold uppercase tracking-widest text-zinc-300 hover:border-white hover:text-white"
                      >
                        Go to wallet
                      </button>
                    )}
                  </div>
                ) : !checkoutConfig ? (
                  <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 text-center">
                    {errorMessage
                      ? <AlertTriangle className="h-8 w-8 text-red-400" />
                      : <Loader2 className="h-8 w-8 animate-spin text-blue-400" />}
                    <p role={errorMessage ? 'alert' : 'status'} className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                      {errorMessage || 'Loading regional payment options...'}
                    </p>
                  </div>
                ) : <>
                
                {/* M-PESA CHECKOUT */}
                {activeTab === 'mpesa' && (
                  <form onSubmit={handleMpesaSubmit} className="space-y-6 max-w-md mx-auto w-full animate-in fade-in duration-300">
                    <div className="relative">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-3 flex items-center justify-between">
                        <span>Safaricom Number</span>
                        {savedNumbers.length > 0 && (
                          <button type="button" onClick={() => setShowSaved(!showSaved)} className="text-green-500 hover:text-green-400 flex items-center gap-1">
                            <History className="w-3 h-3" /> Recent
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowPhoneNumber(value => !value)}
                          aria-label={showPhoneNumber ? 'Hide phone number' : 'Show phone number'}
                          className="text-zinc-400 hover:text-white"
                        >
                          {showPhoneNumber ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-5 flex items-center text-zinc-500 font-bold border-r-2 border-zinc-800 pr-4">
                          +254
                        </span>
                        <input
                          type={showPhoneNumber ? 'tel' : 'password'}
                          inputMode="numeric"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="7XX XXX XXX"
                          maxLength={10}
                          autoFocus
                          className="w-full bg-zinc-950 border-2 border-zinc-800 text-white p-5 pl-[85px] text-base font-bold outline-none focus:border-green-500 transition-colors placeholder:text-zinc-700"
                        />
                      </div>

                      {showSaved && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-black border-2 border-zinc-700 shadow-xl z-20">
                          {savedNumbers.map(num => (
                            <button 
                              key={num} 
                              type="button"
                              onClick={() => { setPhoneNumber(num); setShowSaved(false); }}
                              className="w-full text-left px-5 py-4 text-xs font-bold text-white uppercase tracking-widest hover:bg-zinc-900 border-b-2 border-zinc-800 last:border-0"
                            >
                              +254 *** *** {num.slice(-3)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="bg-zinc-900 border border-zinc-800 p-4 flex gap-3 items-start">
                      <Lock className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                      <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed">
                        An STK push will be sent to your phone. Ensure it is unlocked to enter your M-Pesa PIN.
                      </p>
                    </div>

                    {itemPrice > 0 ? (
                      <button
                        type="submit"
                        disabled={isLoadingWallet || !phoneNumber || phoneNumber.length < 9}
                        className="w-full py-5 bg-green-500 text-black border-2 border-green-500 font-black uppercase tracking-widest text-xs hover:bg-green-400 transition-all shadow-[4px_4px_0px_rgba(var(--success-rgb), 0.2)] hover:shadow-[6px_6px_0px_rgba(var(--success-rgb), 0.4)] disabled:opacity-50 disabled:hover:shadow-none flex items-center justify-center gap-2 mt-4"
                      >
                        PAY KES {itemPrice.toFixed(2)}
                      </button>
                    ) : (
                      <p role="status" className="text-center text-xs font-bold text-yellow-400">
                        Your wallet covers the full price. Use the balance button above or uncheck wallet to pay with M-Pesa.
                      </p>
                    )}
                  </form>
                )}

                {/* PAYSTACK / CARD CHECKOUT */}
                {activeTab === 'card' && (
                  <form onSubmit={handlePaystackCardSubmit} className="space-y-6 max-w-md mx-auto w-full animate-in fade-in duration-300">
                    
                    <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col gap-6">
                      <div className="flex items-center justify-between border-b-2 border-dashed border-zinc-800 pb-6">
                        <div className="flex items-center gap-3">
                          <Shield className="w-6 h-6 text-blue-500" />
                          <div>
                            <p className="text-xs font-black text-white uppercase tracking-widest">PCI-DSS COMPLIANT</p>
                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">
                              Processed securely by {checkoutConfig.default_provider === 'stripe' ? 'Stripe' : 'Paystack'}
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between opacity-60">
                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Accepts</span>
                        <div className="flex gap-2">
                          <div className="px-2 py-1 border border-zinc-700 text-[8px] font-black text-white">VISA</div>
                          <div className="px-2 py-1 border border-zinc-700 text-[8px] font-black text-white">MASTERCARD</div>
                        </div>
                      </div>
                    </div>

                    {itemPrice > 0 ? (
                      <button
                        type="submit"
                        disabled={isLoadingWallet}
                        className="w-full py-5 bg-blue-500 text-black border-2 border-blue-500 font-black uppercase tracking-widest text-xs hover:bg-blue-400 transition-all shadow-[4px_4px_0px_rgba(var(--info-rgb), 0.2)] hover:shadow-[6px_6px_0px_rgba(var(--info-rgb), 0.4)] flex items-center justify-center gap-2"
                      >
                        PROCEED TO {checkoutConfig.default_provider === 'stripe' ? 'STRIPE' : 'PAYSTACK'} CHECKOUT <ChevronRight className="w-4 h-4" />
                      </button>
                    ) : (
                      <p role="status" className="text-center text-xs font-bold text-yellow-400">
                        Your wallet covers the full price. Use the balance button above or uncheck wallet to pay by card.
                      </p>
                    )}
                  </form>
                )}
                </>}
              </div>
            </div>
          )}

          {/* STATE: PROCESSING (Initial Request) */}
          {step === 'processing' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in zoom-in-95 duration-300">
              <Loader2 className={`w-16 h-16 animate-spin mb-8 ${activeTab === 'mpesa' ? 'text-green-500' : 'text-blue-500'}`} />
              <h3 className="text-base font-black text-white uppercase tracking-widest mb-3">CONTACTING GATEWAY</h3>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest max-w-sm leading-relaxed">
                Establishing a secure connection with {activeTab === 'mpesa' ? 'Safaricom Daraja API' : checkoutConfig?.default_provider === 'stripe' ? 'Stripe' : 'Paystack'}...
              </p>
            </div>
          )}

          {/* STATE: POLLING (Waiting for provider confirmation) */}
          {step === 'polling' && (
            <div className={`flex-1 flex flex-col items-center ${checkoutProvider === 'stripe' ? 'justify-start overflow-y-auto' : 'justify-center'} p-8 text-center animate-in zoom-in-95 duration-300`}>
              {checkoutProvider === 'stripe' ? (
                <div className="w-full max-w-lg space-y-4">
                  <h3 className="text-base font-black text-white uppercase tracking-widest">Complete secure checkout</h3>
                  <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed">
                    Pay USD {paymentAmount.toFixed(2)}. The creator receives KES {totalAmount.toFixed(2)}.
                  </p>
                  {stripePromise && stripeCheckout?.client_secret ? (
                    <div className="min-h-[min(45dvh,28rem)] border-2 border-zinc-800 bg-white p-3 text-left">
                      <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: stripeCheckout.client_secret }}>
                        <EmbeddedCheckout />
                      </EmbeddedCheckoutProvider>
                    </div>
                  ) : <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-400" />}
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    This page will confirm the payment automatically.
                  </p>
                </div>
              ) : <>
              <div className="relative mb-10 group">
                {/* SVG Progress Ring */}
                <svg viewBox="0 0 128 128" className="size-[clamp(7rem,20vw,8rem)] transform -rotate-90">
                  <circle cx="64" cy="64" r="60" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-zinc-900" />
                  <circle 
                    cx="64" cy="64" r="60" stroke="currentColor" strokeWidth="4" fill="transparent" 
                    className="text-green-500 transition-all duration-1000 ease-linear drop-shadow-[0_0_8px_rgba(var(--success-rgb), 0.5)]"
                    strokeDasharray={2 * Math.PI * 60}
                    strokeDashoffset={2 * Math.PI * 60 * (1 - countdown / 180)}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center flex-col">
                  <span className="text-3xl font-black text-white">{countdown}</span>
                  <span className="text-[9px] font-bold text-green-500 uppercase tracking-widest mt-1">SECONDS</span>
                </div>
              </div>

              <h3 className="text-base font-black text-white uppercase tracking-widest mb-3 animate-pulse">{checkoutProvider === 'mpesa' ? 'CHECK YOUR PHONE' : 'AWAITING PAYMENT'}</h3>
              <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest max-w-xs leading-relaxed mb-8">
                {checkoutProvider === 'mpesa'
                  ? <>An STK Push has been sent to <span className="text-white font-black">+{phoneNumber}</span>. Enter your M-Pesa PIN to pay KES {itemPrice.toFixed(2)}.</>
                  : <>Complete the payment in the Paystack checkout window for KES {itemPrice.toFixed(2)}. This page will confirm the result automatically.</>}
              </p>

              {errorMessage && <p role="status" className="mb-4 max-w-sm text-xs text-amber-400">{errorMessage}</p>}
              <div className="flex items-center gap-3 text-[10px] font-black text-zinc-500 uppercase tracking-widest bg-zinc-950 px-5 py-3 border-2 border-zinc-800">
                <Loader2 className="w-4 h-4 animate-spin text-green-500" /> Awaiting {checkoutProvider === 'mpesa' ? 'Safaricom' : 'Paystack'} confirmation...
              </div>
              </>}
            </div>
          )}

          {/* STATE: SUCCESS (Receipt View) */}
          {step === 'success' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 animate-in slide-in-from-bottom-8 duration-500 bg-green-500/5">
              <div className="size-[clamp(5rem,12vw,6rem)] bg-green-500/10 border-4 border-green-500 rounded-full flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(var(--success-rgb), 0.2)]">
                <CheckCircle2 className="w-12 h-12 text-green-500" />
              </div>
              <h3 className="text-xl font-black text-white uppercase tracking-widest mb-3">PAYMENT SUCCESSFUL</h3>
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-8 text-center max-w-md leading-relaxed">
                {isLivePassPurchase
                  ? `Your payment was confirmed. Live access has been granted.`
                  : isLiveSubscriptionPurchase
                    ? `Your payment was confirmed. Your VIP subscription is active.`
                    : isChatPurchase
                      ? `Your payment was confirmed. You can now message this creator.`
                      : `Your payment was confirmed. The post is unlocked and added to your vault.`}
              </p>

              <div className="w-full max-w-sm bg-black border-2 border-green-500/30 p-6 space-y-4">
                <div className="flex justify-between items-center pb-4 border-b-2 border-dashed border-zinc-800">
                  <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Transaction Ref</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white uppercase tracking-widest">{transactionRef}</span>
                    <button onClick={() => copyToClipboard(transactionRef)} aria-label="Copy reference" className="text-zinc-500 hover:text-white"><Copy className="w-3 h-3" /></button>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Payment Method</span>
                  <span className="text-[10px] font-bold text-white uppercase tracking-widest">{activeTab === 'wallet' ? 'WALLET' : checkoutProvider === 'mpesa' ? 'M-PESA' : checkoutProvider === 'stripe' ? 'STRIPE' : 'PAYSTACK'}</span>
                </div>
                {checkoutProvider && (
                  <>
                    {walletAmountCents > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Wallet contribution</span>
                        <span className="text-xs font-bold text-yellow-300">KES {(walletAmountCents / 100).toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Customer charge</span>
                      <span className="text-xs font-bold text-white">{chargeCurrency} {paymentAmount.toFixed(chargeCurrency === 'USD' ? 2 : 0)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">KES settlement</span>
                      <span className="text-xs font-bold text-white">KES {totalAmount.toFixed(2)}</span>
                    </div>
                  </>
                )}
              </div>

              <button 
                onClick={handleClose} 
                className="mt-8 px-10 py-5 bg-green-500 text-black font-black uppercase tracking-widest text-xs hover:bg-green-400 transition-all shadow-[4px_4px_0px_rgba(var(--success-rgb), 0.2)] hover:-translate-y-1"
              >
                PROCEED
              </button>
            </div>
          )}

          {/* STATE: FAILED / TIMEOUT */}
          {step === 'failed' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in zoom-in-95 duration-300">
              <div className="size-[clamp(5rem,12vw,6rem)] bg-red-500/10 border-4 border-red-500 flex items-center justify-center mb-6">
                <AlertTriangle className="w-12 h-12 text-red-500" />
              </div>
              <h3 className="text-xl font-black text-white uppercase tracking-widest mb-3">TRANSACTION FAILED</h3>
              <div className="border-2 border-red-900/50 bg-red-500/5 p-5 mb-8 max-w-md w-full">
                <p className="text-[11px] font-bold text-red-400 uppercase tracking-widest leading-relaxed">
                  {errorMessage}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm">
                <button 
                  onClick={resetModal} 
                  className="flex-1 py-4 bg-white text-black font-black uppercase tracking-widest text-[10px] border-2 border-white hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 shadow-[4px_4px_0px_rgba(var(--highlight-rgb), 0.2)]"
                >
                  <RefreshCcw className="w-4 h-4" /> TRY AGAIN
                </button>
                <button 
                  onClick={handleClose} 
                  className="flex-1 py-4 bg-black text-zinc-500 font-black uppercase tracking-widest text-[10px] border-2 border-zinc-800 hover:text-white hover:border-zinc-600 transition-colors"
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}
          
          {/* Security Footer */}
          {(step === 'checkout' || step === 'polling') && (
            <div className="p-4 border-t-2 border-zinc-800 bg-zinc-950 shrink-0 flex items-center justify-center gap-6 opacity-60">
              <div className="flex items-center gap-2 text-[9px] font-black text-zinc-500 uppercase tracking-widest">
                <Lock className="w-3.5 h-3.5" /> 256-BIT ENCRYPTION
              </div>
              <div className="w-1 h-1 bg-zinc-700 rounded-full"></div>
              <div className="flex items-center gap-2 text-[9px] font-black text-zinc-500 uppercase tracking-widest">
                <ShieldCheck className="w-3.5 h-3.5" /> SECURE CHECKOUT
              </div>
            </div>
          )}

        </div>
      </div>
      <PagePrivacyShield active={!isPageFocused} message="Checkout details are hidden while this window is inactive." />
    </div>
  );
}