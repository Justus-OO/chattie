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
  const [walletBalance, setWalletBalance] = useState(0);
  const [isLoadingWallet, setIsLoadingWallet] = useState(false);
  const pollIntervalRef = useRef(null);
  const timerRef = useRef(null);
  const pollInFlightRef = useRef(false);

  // --- Financial Calculation ---
  const itemPrice = confirmedAmountCents === null
    ? Number(postItem?.price ?? (postItem?.amountCents ? postItem.amountCents / 100 : 0))
    : confirmedAmountCents / 100;
  const platformFee = 0; // Assuming absorbed
  const vatAmount = itemPrice * 0.16; // 16% Kenyan VAT for receipt display
  const totalAmount = itemPrice; 

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
    clearInterval(pollIntervalRef.current);
    clearInterval(timerRef.current);
  };

  useEffect(() => {
    if (!isOpen) return;
    setStep('checkout');
    setErrorMessage('');
    setCountdown(180);
    setConfirmedAmountCents(null);
    clearInterval(pollIntervalRef.current);
    clearInterval(timerRef.current);
    setActiveTab(isWalletPurchase ? 'wallet' : defaultProvider === 'paystack' ? 'card' : 'mpesa');
    setPhoneNumber(initialPhoneNumber.replace(/\D/g, '').replace(/^254/, ''));
    if (!isWalletPurchase) return;

    let active = true;
    setIsLoadingWallet(true);
    afterDarkService.getWallet()
      .then(response => {
        if (!active) return;
        const wallet = response?.wallet || response || {};
        const balance = Number(wallet.available_balance ?? wallet.available_balance_cents ?? 0) /
          (wallet.available_balance_cents !== undefined ? 100 : 1);
        setWalletBalance(balance);
      })
      .catch(error => {
        if (active) setErrorMessage(error?.response?.data?.error || 'Could not load your wallet balance.');
      })
      .finally(() => {
        if (active) setIsLoadingWallet(false);
      });

    return () => { active = false; };
  }, [defaultProvider, initialPhoneNumber, isOpen, isWalletPurchase, postItem?.id]);

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
      amount_cents: postItem.amountCents ?? Math.round(itemPrice * 100),
      provider,
      phone_number: phoneNumberValue || undefined,
      message: postItem.message || '',
    });
    const intentId = checkout?.id;
    if (!intentId) throw new Error('The checkout service did not return a valid payment reference.');
    if (Number.isFinite(Number(checkout.amount_cents))) {
      setConfirmedAmountCents(Number(checkout.amount_cents));
    }
    setTransactionRef(intentId);
    setStep('polling');
    setCountdown(180);

    if (provider === 'paystack') {
      await loadPaystackScript();
      if (typeof window.PaystackPop !== 'function' || !checkout.client_secret) {
        throw new Error('Paystack checkout could not initialize.');
      }
      const popup = new window.PaystackPop();
      popup.resumeTransaction(checkout.client_secret);
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
          onSuccess?.(result);
        } else if (nextStatus === 'failed') {
          clearInterval(pollIntervalRef.current);
          clearInterval(timerRef.current);
          setStep('failed');
          setErrorMessage('The transaction was cancelled or failed.');
        }
      } catch (error) {
        setErrorMessage(error?.response?.data?.error || (error instanceof Error ? error.message : 'Payment status check failed. Retrying.'));
      } finally {
        pollInFlightRef.current = false;
      }
    }, 5000);
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
        onSuccess?.({ type: 'chat_unlock', conversationId });
      } catch (error) {
        setStep('failed');
        setErrorMessage(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not unlock this chat.'));
      }
      return;
    }

    const postId = postItem?.productId || postItem?.id;
    if (!postId) return;

    setStep('processing');
    setErrorMessage('');
    try {
      const result = await afterDarkService.unlockPostWithWallet({ post_id: postId });
      if (String(result?.status || '').toLowerCase() !== 'success') {
        throw new Error('The server did not confirm the post unlock.');
      }
      setStep('success');
      onSuccess?.({ type: 'post_unlock', postId });
    } catch (error) {
      setStep('failed');
      setErrorMessage(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not unlock this post.'));
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
    }
  };

  const handlePaystackCardSubmit = async (e) => {
    e.preventDefault();
    setStep('processing');
    setErrorMessage('');
    try {
      await startCheckout('paystack');
    } catch (err) {
      setStep('failed');
      setErrorMessage(err?.response?.data?.error || (err instanceof Error ? err.message : 'Failed to reach Paystack secure gateway.'));
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
      
      <div className="relative w-full max-w-4xl bg-black border-2 border-zinc-700 shadow-[12px_12px_0px_rgba(255,255,255,0.05)] flex flex-col md:flex-row z-10 font-mono h-[90vh] md:h-[600px] animate-in fade-in zoom-in-95 duration-200">
        
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
              <span className="text-[11px] font-black text-zinc-400 uppercase tracking-widest">Total Due</span>
              <span className="text-2xl font-black text-yellow-500 tracking-wider">KES {totalAmount.toFixed(2)}</span>
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
              {!isWalletPurchase && <div className="flex px-8 gap-4 shrink-0">
                <button 
                  onClick={() => setActiveTab('mpesa')}
                  className={`flex-1 p-4 border-2 transition-all flex flex-col items-center justify-center gap-3 ${activeTab === 'mpesa' ? 'border-green-500 bg-green-500/10 shadow-[4px_4px_0px_rgba(34,197,94,0.2)]' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'}`}
                >
                  <Smartphone className={`w-7 h-7 ${activeTab === 'mpesa' ? 'text-green-500' : 'text-zinc-500'}`} />
                  <span className={`text-[10px] font-black uppercase tracking-widest ${activeTab === 'mpesa' ? 'text-green-500' : 'text-zinc-500'}`}>M-Pesa Express</span>
                </button>
                <button 
                  onClick={() => setActiveTab('card')}
                  className={`flex-1 p-4 border-2 transition-all flex flex-col items-center justify-center gap-3 ${activeTab === 'card' ? 'border-blue-500 bg-blue-500/10 shadow-[4px_4px_0px_rgba(59,130,246,0.2)]' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'}`}
                >
                  <CreditCard className={`w-7 h-7 ${activeTab === 'card' ? 'text-blue-500' : 'text-zinc-500'}`} />
                  <span className={`text-[10px] font-black uppercase tracking-widest ${activeTab === 'card' ? 'text-blue-500' : 'text-zinc-500'}`}>Card / Bank</span>
                </button>
              </div>}

              {/* Tab Content */}
              <div className="p-8 flex-1 flex flex-col">
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

                    <button
                      type="submit"
                      disabled={!phoneNumber || phoneNumber.length < 9}
                      className="w-full py-5 bg-green-500 text-black border-2 border-green-500 font-black uppercase tracking-widest text-xs hover:bg-green-400 transition-all shadow-[4px_4px_0px_rgba(34,197,94,0.2)] hover:shadow-[6px_6px_0px_rgba(34,197,94,0.4)] disabled:opacity-50 disabled:hover:shadow-none flex items-center justify-center gap-2 mt-4"
                    >
                      PAY KES {totalAmount.toFixed(2)}
                    </button>
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
                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Processed securely by Paystack</p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between opacity-60">
                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Accepts</span>
                        <div className="flex gap-2">
                          {/* Generic card icons representing Visa/MC without loading external images if possible, using text for now to maintain brute aesthetic */}
                          <div className="px-2 py-1 border border-zinc-700 text-[8px] font-black text-white">VISA</div>
                          <div className="px-2 py-1 border border-zinc-700 text-[8px] font-black text-white">MASTERCARD</div>
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-5 bg-blue-500 text-black border-2 border-blue-500 font-black uppercase tracking-widest text-xs hover:bg-blue-400 transition-all shadow-[4px_4px_0px_rgba(59,130,246,0.2)] hover:shadow-[6px_6px_0px_rgba(59,130,246,0.4)] flex items-center justify-center gap-2"
                    >
                      PROCEED TO SECURE CHECKOUT <ChevronRight className="w-4 h-4" />
                    </button>
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
                Establishing a secure connection with {activeTab === 'mpesa' ? 'Safaricom Daraja API' : 'Paystack'}...
              </p>
            </div>
          )}

          {/* STATE: POLLING (Waiting for M-Pesa PIN) */}
          {step === 'polling' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in zoom-in-95 duration-300">
              <div className="relative mb-10 group">
                {/* SVG Progress Ring */}
                <svg className="w-32 h-32 transform -rotate-90">
                  <circle cx="64" cy="64" r="60" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-zinc-900" />
                  <circle 
                    cx="64" cy="64" r="60" stroke="currentColor" strokeWidth="4" fill="transparent" 
                    className="text-green-500 transition-all duration-1000 ease-linear drop-shadow-[0_0_8px_rgba(34,197,94,0.5)]"
                    strokeDasharray={2 * Math.PI * 60}
                    strokeDashoffset={2 * Math.PI * 60 * (1 - countdown / 180)}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center flex-col">
                  <span className="text-3xl font-black text-white">{countdown}</span>
                  <span className="text-[9px] font-bold text-green-500 uppercase tracking-widest mt-1">SECONDS</span>
                </div>
              </div>

              <h3 className="text-base font-black text-white uppercase tracking-widest mb-3 animate-pulse">CHECK YOUR PHONE</h3>
              <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest max-w-xs leading-relaxed mb-8">
                {activeTab === 'mpesa'
                  ? <>An STK Push has been sent to <span className="text-white font-black">+{phoneNumber}</span>. Enter your M-Pesa PIN to complete the payment of KES {totalAmount.toFixed(2)}.</>
                  : <>Complete the payment in the Paystack checkout window for KES {totalAmount.toFixed(2)}. This page will confirm the result automatically.</>}
              </p>

              {errorMessage && <p role="status" className="mb-4 max-w-sm text-xs text-amber-400">{errorMessage}</p>}
              <div className="flex items-center gap-3 text-[10px] font-black text-zinc-500 uppercase tracking-widest bg-zinc-950 px-5 py-3 border-2 border-zinc-800">
                <Loader2 className="w-4 h-4 animate-spin text-green-500" /> Awaiting Safaricom Confirmation...
              </div>
            </div>
          )}

          {/* STATE: SUCCESS (Receipt View) */}
          {step === 'success' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 animate-in slide-in-from-bottom-8 duration-500 bg-green-500/5">
              <div className="w-24 h-24 bg-green-500/10 border-4 border-green-500 rounded-full flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(34,197,94,0.2)]">
                <CheckCircle2 className="w-12 h-12 text-green-500" />
              </div>
              <h3 className="text-xl font-black text-white uppercase tracking-widest mb-3">PAYMENT SUCCESSFUL</h3>
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-8 text-center max-w-md leading-relaxed">
                {isLivePassPurchase
                  ? `Your payment of KES ${totalAmount.toFixed(2)} was confirmed. Live access has been granted.`
                  : isLiveSubscriptionPurchase
                    ? `Your payment of KES ${totalAmount.toFixed(2)} was confirmed. Your VIP subscription is active.`
                    : isChatPurchase
                      ? `Your payment of KES ${totalAmount.toFixed(2)} was confirmed. You can now message this creator.`
                      : `Your payment of KES ${totalAmount.toFixed(2)} was confirmed. The post is unlocked and added to your vault.`}
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
                  <span className="text-[10px] font-bold text-white uppercase tracking-widest">{activeTab === 'wallet' ? 'WALLET' : activeTab === 'mpesa' ? 'M-PESA' : 'CARD'}</span>
                </div>
              </div>

              <button 
                onClick={handleClose} 
                className="mt-8 px-10 py-5 bg-green-500 text-black font-black uppercase tracking-widest text-xs hover:bg-green-400 transition-all shadow-[4px_4px_0px_rgba(34,197,94,0.2)] hover:-translate-y-1"
              >
                PROCEED
              </button>
            </div>
          )}

          {/* STATE: FAILED / TIMEOUT */}
          {step === 'failed' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in zoom-in-95 duration-300">
              <div className="w-24 h-24 bg-red-500/10 border-4 border-red-500 flex items-center justify-center mb-6">
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
                  className="flex-1 py-4 bg-white text-black font-black uppercase tracking-widest text-[10px] border-2 border-white hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 shadow-[4px_4px_0px_rgba(255,255,255,0.2)]"
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