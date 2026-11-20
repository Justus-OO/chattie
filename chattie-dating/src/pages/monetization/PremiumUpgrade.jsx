import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Zap, Crown, Eye, Heart, MessageSquare, Undo2,
  ChevronDown, ShieldCheck, Loader2, X, Lock, ExternalLink
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

// Stripe Elements
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';

// Services
import { billingService } from '../../api/billing.service';
import { useI18n } from '../../i18n';

// ============================================================================
// STATIC UI DATA
// ============================================================================
const PREMIUM_FEATURES = [
  { icon: Eye, title: 'See Who Likes You', desc: 'Stop guessing. See your admirers before you swipe.' },
  { icon: Heart, title: 'Unlimited Likes', desc: 'Swipe right as much as you want, no limits.' },
  { icon: Zap, title: '5 Free Super Likes', desc: 'Stand out from the crowd every single week.' },
  { icon: MessageSquare, title: 'Read Receipts', desc: 'Know exactly when they read your messages.' },
  { icon: Undo2, title: 'Unlimited Rewinds', desc: 'Accidentally swiped left? Bring them back instantly.' },
  { icon: Crown, title: 'VIP Badge', desc: 'Get a golden badge in public rooms to show your status.' }
];

const FAQS = [
  { q: 'Can I cancel my subscription anytime?', a: 'Yes! You can cancel your VIP status at any time from your account settings. You will continue to have premium access until the end of your billing period.' },
  { q: 'How does the billing work?', a: 'Subscriptions are billed in one upfront payment for the selected duration. They auto-renew unless cancelled 24 hours before the end of the current period.' },
  { q: 'Do I get a refund if I cancel early?', a: 'We do not offer partial refunds for unused time in a billing cycle. However, you retain all VIP features until the cycle ends.' }
];

// ============================================================================
// UTILITIES
// ============================================================================
const PAYSTACK_SCRIPT_URL = 'https://js.paystack.co/v2/inline.js';
const loadPaystackScript = () => new Promise((resolve, reject) => {
  const existing = document.querySelector(`script[src="${PAYSTACK_SCRIPT_URL}"]`);
  if (window.PaystackPop && existing) {
    resolve();
    return;
  }
  const script = existing || document.createElement('script');
  script.src = PAYSTACK_SCRIPT_URL;
  script.async = true;
  script.onload = () => resolve();
  script.onerror = () => reject(new Error('Could not load Paystack checkout.'));
  if (!existing) document.body.appendChild(script);
});

const formatPrice = (amount, currency = 'USD') => new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency,
  maximumFractionDigits: currency === 'KES' ? 0 : 2,
}).format(amount);

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function PremiumUpgrade() {
  const navigate = useNavigate();
  const { t } = useI18n();
  
  // --- STATE ---
  const [plans, setPlans] = useState([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [expandedFaq, setExpandedFaq] = useState(null);
  
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [paymentSession, setPaymentSession] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);
  const callbackStarted = useRef(false);
  const paystackPollRef = useRef(null);
  const paystackTimeoutRef = useRef(null);
  const paystackPollInFlight = useRef(false);

  // --- INITIALIZATION ---
  useEffect(() => {
    let isMounted = true;

    billingService.getPlans()
      .then(data => {
        if (!isMounted) return;
        setPlans(data);
        const popularPlan = data.find(p => p.isPopular) || data[0];
        setSelectedPlan(popularPlan);
      })
      .catch(err => {
        if (!isMounted) return;
        console.error('Failed to load plans:', err);
        toast.error('Could not load secure pricing. Please check your connection and refresh.');
      })
      .finally(() => {
        if (isMounted) setIsLoadingPlans(false);
      });

    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || params.get('trxref');
    if (!reference || callbackStarted.current) return;
    callbackStarted.current = true;
    setIsProcessing(true);

    billingService.verifyPayment({ reference })
      .then((verification) => {
        if (verification?.payment_method_saved === false) {
          toast.info('Your payment succeeded, but this card could not be saved. You can try again after checking your payment settings.');
        }
        toast.success('VIP Upgrade Successful! Welcome to Gold.');
        navigate('/discover', { replace: true });
      })
      .catch((error) => {
        toast.error(error.response?.data?.error || 'Payment could not be verified. If you were charged, contact support.');
      })
      .finally(() => setIsProcessing(false));
  }, [navigate]);

  useEffect(() => () => {
    window.clearInterval(paystackPollRef.current);
    window.clearTimeout(paystackTimeoutRef.current);
  }, []);

  // --- HANDLERS ---
  const toggleFaq = useCallback((idx) => {
    setExpandedFaq(prev => prev === idx ? null : idx);
  }, []);

  const handleProceedToPayment = async (e) => {
    e.preventDefault();
    if (!selectedPlan || isProcessing) return;
    setIsProcessing(true);
    
    try {
      const sessionData = await billingService.initiateUpgrade(selectedPlan.id);
      
      if (!sessionData || !sessionData.provider) {
        throw new Error('Invalid gateway response received.');
      }

      setShowSummaryModal(false); 

      if (sessionData.provider === 'paystack') {
        await launchPaystackModal(sessionData);
      } else if (sessionData.provider === 'stripe') {
        await launchStripeModal(sessionData);
      } else {
        throw new Error('No valid payment method returned.');
      }
    } catch (error) {
      console.error('[BILLING ERROR]', error);
      toast.error(error.response?.data?.error || error.message || t('paymentFailed'));
      setIsProcessing(false);
    }
  };

  const launchPaystackModal = async (data) => {
    if (!data.session_id) {
      throw new Error('Paystack did not return a transaction reference. Please try again or contact support.');
    }
    try {
      await loadPaystackScript();
      if (typeof window.PaystackPop !== 'function' || !data.client_secret) {
        throw new Error('Paystack checkout could not initialize.');
      }
      const popup = new window.PaystackPop();
      popup.resumeTransaction(data.client_secret);
    } catch (error) {
      if (data.payment_url) {
        window.location.assign(data.payment_url);
        return;
      }
      throw error;
    }

    window.clearInterval(paystackPollRef.current);
    window.clearTimeout(paystackTimeoutRef.current);
    const verify = async () => {
      if (paystackPollInFlight.current) return;
      paystackPollInFlight.current = true;
      try {
        const verification = await billingService.verifyPayment({ reference: data.session_id });
        window.clearInterval(paystackPollRef.current);
        window.clearTimeout(paystackTimeoutRef.current);
        if (verification?.payment_method_saved === false) {
          toast.info('Your payment succeeded, but this card could not be saved. You can try again after checking your payment settings.');
        }
        toast.success('VIP Upgrade Successful! Welcome to Gold.');
        setIsProcessing(false);
        navigate('/discover');
      } catch (error) {
        if (error.response?.status !== 402) {
          console.error('[VERIFICATION ERROR]', error);
        }
      } finally {
        paystackPollInFlight.current = false;
      }
    };
    paystackPollRef.current = window.setInterval(verify, 5000);
    paystackTimeoutRef.current = window.setTimeout(() => {
      window.clearInterval(paystackPollRef.current);
      setIsProcessing(false);
      toast.info('Payment is still pending. If you completed checkout, reopen Premium to verify it again.');
    }, 180000);
  };

  const launchStripeModal = async (data) => {
    try {
      const stripe = await loadStripe(data.public_key);
      if (!stripe) {
        throw new Error('Stripe SDK failed to initialize. Please check your network.');
      }
      setStripePromise(Promise.resolve(stripe));
      setPaymentSession(data);
      // isProcessing is intentionally left true here to prevent double clicks while modal renders.
      // It is cleared when the user closes the modal.
    } catch (error) {
      toast.error(error.message);
      setIsProcessing(false);
    }
  };

  const handleCloseStripeModal = useCallback(() => {
    setPaymentSession(null);
    setStripePromise(null);
    setIsProcessing(false);
  }, []);

  const handleStripeComplete = useCallback(async () => {
    if (!paymentSession?.session_id) return;
    try {
      const verification = await billingService.verifyPayment({ sessionId: paymentSession.session_id });
      setPaymentSession(null);
      setStripePromise(null);
      setIsProcessing(false);
      toast.success('VIP Upgrade Successful! Welcome to Gold.');
      if (verification?.payment_method_saved === false) {
        toast.info('Your payment succeeded, but this card could not be saved. You can try again after checking your payment settings.');
      }
      navigate('/discover');
    } catch (error) {
      console.error('[STRIPE VERIFICATION ERROR]', error);
      toast.error(error.response?.data?.error || 'Payment verification failed. Please contact support.');
      setIsProcessing(false);
    }
  }, [navigate, paymentSession]);

  // UX Lock scroll when modals are open
  useEffect(() => {
    if (showSummaryModal || paymentSession) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [showSummaryModal, paymentSession]);

  // ============================================================================
  // RENDER - LOADING STATE
  // ============================================================================
  if (isLoadingPlans) {
    return (
      <div className="relative flex h-full min-h-0 min-w-0 w-full flex-1 flex-col items-center justify-center bg-black">
        <Loader2 className="w-10 h-10 text-yellow-400 animate-spin mb-4" />
        <p className="text-zinc-500 text-xs font-mono tracking-widest font-bold uppercase">SECURELY LOADING PRICING...</p>
      </div>
    );
  }

  // ============================================================================
  // RENDER - MAIN UI
  // ============================================================================
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-black w-full relative overflow-hidden text-zinc-300 rounded-none font-mono">
      
      {/* Main Scrollable Content */}
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar bg-black">
        <div className="flex min-h-full w-full flex-col items-center px-2 py-4 sm:px-3 lg:px-4">
          
          {/* Hero Section */}
          <div className="text-center mb-10 w-full flex flex-col items-center border-b-2 border-zinc-800 pb-10">
            <div className="relative mb-6">
              <div className="w-16 h-16 bg-black border-2 border-yellow-400 flex items-center justify-center relative shadow-[4px_4px_0px_rgba(var(--warning-rgb), 0.2)]">
                <Crown className="w-8 h-8 text-yellow-400" />
              </div>
              <div className="absolute -top-3 -right-3 px-2 py-0.5 bg-yellow-400 text-black border-2 border-black text-[9px] font-bold uppercase tracking-widest shadow-[2px_2px_0px_rgba(var(--shadow-rgb),1)]">
                VIP
              </div>
            </div>
            
            <h1 className="text-3xl md:text-5xl font-black text-white mb-4 uppercase tracking-widest">
              CHATTIE <span className="text-yellow-400">GOLD</span>
            </h1>
            <p className="text-zinc-500 text-[10px] md:text-xs font-bold uppercase tracking-widest max-w-md mx-auto leading-relaxed">
              {t('premiumExperience') || 'Unlock advanced features and maximize your matches.'}
            </p>
          </div>

          {/* Pricing Tiers Grid */}
          <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-12">
            {plans.map((plan, index) => {
              const isSelected = selectedPlan?.id === plan.id;
              return (
                <div 
                 key={`${plan.id}-${index}`}
                  onClick={() => !isProcessing && setSelectedPlan(plan)}
                  className={`
                    relative p-6 transition-colors flex flex-col text-center border-2
                    ${isProcessing ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}
                    ${isSelected 
                      ? 'bg-zinc-900 border-yellow-400 z-10 shadow-[8px_8px_0px_rgba(var(--warning-rgb), 0.1)]'
                      : 'bg-black border-zinc-800 hover:border-zinc-600 hover:bg-zinc-950'
                    }
                  `}
                >
                  {plan.isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-white text-black border-2 border-black text-[9px] font-bold uppercase tracking-widest whitespace-nowrap">
                      Most Popular
                    </div>
                  )}

                  <h3 className={`text-[10px] font-bold uppercase tracking-widest mb-4 ${isSelected ? 'text-yellow-400' : 'text-zinc-400'}`}>
                    {plan.duration}
                  </h3>
                  
                  <div className="flex items-end justify-center gap-1 mb-3">
                    <span className="text-3xl font-black text-white leading-none">{formatPrice(plan.monthly, plan.currency)}</span>
                    <span className="text-[10px] text-zinc-500 font-bold pb-1">/MO</span>
                  </div>
                  
                  <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mb-6">
                    BILLED {formatPrice(plan.price, plan.currency)} EVERY {plan.id} MONTHS
                  </p>

                  {plan.save > 0 ? (
                    <div className={`mt-auto py-2 text-[10px] font-bold uppercase tracking-widest transition-colors border-2
                      ${isSelected ? 'bg-black border-yellow-400 text-yellow-400' : 'bg-black border-zinc-800 text-zinc-500'}
                    `}>
                      SAVE {plan.save}%
                    </div>
                  ) : (
                    <div className="mt-auto py-2 text-[10px] font-bold uppercase border-2 border-transparent text-transparent select-none">
                      SPACER
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop Continue Button */}
          <div className="hidden md:flex justify-center w-full mb-16">
            <button 
              onClick={() => setShowSummaryModal(true)}
              disabled={!selectedPlan || isProcessing}
              className="w-full max-w-md py-4 bg-yellow-400 text-black border-2 border-yellow-400 text-xs font-bold uppercase tracking-widest hover:bg-yellow-500 disabled:bg-zinc-800 disabled:border-zinc-800 disabled:text-zinc-500 transition-colors shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-black"
            >
              CONTINUE WITH {selectedPlan?.duration}
            </button>
          </div>

          {/* Feature Showcase Grid */}
          <div className="w-full mb-16">
            <div className="text-center mb-8 border-b-2 border-zinc-800 pb-4">
              <h2 className="text-sm font-bold text-white uppercase tracking-widest mb-2">{t('everythingGold') || 'EVERYTHING IN GOLD'}</h2>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">UNLOCK THE ULTIMATE EXPERIENCE.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {PREMIUM_FEATURES.map((feat, i) => (
                <div key={i} className="bg-black border-2 border-zinc-800 p-5 flex items-start gap-4 hover:border-zinc-600 transition-colors">
                  <div className="w-10 h-10 bg-zinc-950 border-2 border-zinc-800 flex items-center justify-center shrink-0">
                    <feat.icon className="w-4 h-4 text-yellow-400" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-[10px] font-bold text-white uppercase tracking-widest mb-2">{feat.title}</h3>
                    <p className="text-[9px] text-zinc-500 uppercase tracking-widest leading-relaxed font-bold">{feat.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* FAQ Section */}
          <div className="w-full max-w-2xl mx-auto mb-10">
            <div className="text-center mb-8 border-b-2 border-zinc-800 pb-4">
              <h2 className="text-sm font-bold text-white uppercase tracking-widest mb-2">FAQ</h2>
            </div>

            <div className="space-y-4">
              {FAQS.map((faq, idx) => {
                const isExpanded = expandedFaq === idx;
                return (
                  <div 
                    key={idx}
                    className={`bg-black border-2 transition-colors duration-200
                      ${isExpanded ? 'border-white' : 'border-zinc-800 hover:border-zinc-600'}
                    `}
                  >
                    <button 
                      onClick={() => toggleFaq(idx)}
                      aria-expanded={isExpanded}
                      className="w-full p-4 flex items-center justify-between text-left focus:outline-none focus:bg-zinc-900"
                    >
                      <span className="text-[10px] font-bold text-white uppercase tracking-widest pr-4">{faq.q}</span>
                      <ChevronDown className={`w-4 h-4 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180 text-white' : 'text-zinc-600'}`} aria-hidden="true" />
                    </button>
                    
                    <div 
                      className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                      aria-hidden={!isExpanded}
                    >
                      <div className="overflow-hidden">
                        <div className="p-4 pt-0 text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed border-t-2 border-zinc-800 mt-2 bg-zinc-950">
                          <div className="pt-4">{faq.a}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Mobile Action Bar */}
      <div className="md:hidden absolute bottom-0 inset-x-0 p-4 bg-black border-t-2 border-zinc-800 z-20">
        <button 
          onClick={() => setShowSummaryModal(true)}
          disabled={!selectedPlan || isProcessing}
          className="w-full py-4 bg-yellow-400 text-black border-2 border-yellow-400 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center transition-colors disabled:bg-zinc-800 disabled:border-zinc-800 disabled:text-zinc-500 shadow-[4px_4px_0px_rgba(var(--highlight-rgb), 0.1)] focus:outline-none"
        >
          GET {selectedPlan?.duration} FOR ${selectedPlan?.price}
        </button>
      </div>

      {/* =====================================================================
          STEP 1: PRE-CHECKOUT SUMMARY MODAL (WITH GATEWAY TOGGLE)
          ===================================================================== */}
      {showSummaryModal && selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={() => !isProcessing && setShowSummaryModal(false)} />
          
          <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] flex flex-col overflow-hidden animate-in slide-in-from-bottom-full md:zoom-in-95 duration-300 rounded-none">
            
            <div className="bg-zinc-950 p-4 flex justify-between items-center border-b-2 border-zinc-800 shrink-0">
              <h2 className="font-bold text-[10px] uppercase tracking-widest text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-green-500" aria-hidden="true" /> ORDER SUMMARY
              </h2>
              {!isProcessing && (
                <button 
                  onClick={() => setShowSummaryModal(false)} 
                  aria-label="Close summary"
                  className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors focus:outline-none focus:border-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="p-6 bg-black">
              <div className="flex justify-between items-end mb-6 pb-6 border-b-2 border-zinc-800">
                <div>
                  <h3 className="text-[10px] font-bold text-white uppercase tracking-widest">CHATTIE GOLD</h3>
                  <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">{selectedPlan.duration} SUBSCRIPTION</p>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black text-white">{formatPrice(selectedPlan.price, selectedPlan.currency)}</span>
                  <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">NO HIDDEN FEES</p>
                </div>
              </div>

              <div className="mb-6">
                <p className="border-2 border-zinc-800 bg-zinc-950 p-4 text-[9px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
                  {selectedPlan.currency === 'KES'
                    ? 'Kenya checkout uses KES through Paystack, including supported local payment methods.'
                    : 'Checkout uses USD through Stripe. Your payment provider and currency are selected automatically from your verified region.'}
                </p>
              </div>

              <div className="flex items-center gap-2 mb-6 text-[9px] font-bold text-zinc-500 uppercase tracking-widest bg-zinc-950 p-4 border-2 border-zinc-800 leading-relaxed">
                <Lock className="w-3.5 h-3.5 text-green-500 shrink-0" aria-hidden="true" />
                <p>A secure checkout window will open on this page. Payment processing is fully encrypted and PCI compliant.</p>
              </div>

              <button 
                onClick={handleProceedToPayment}
                disabled={isProcessing}
                className="w-full py-4 bg-yellow-400 text-black border-2 border-yellow-400 text-[10px] font-bold uppercase tracking-widest hover:bg-yellow-500 disabled:bg-zinc-800 disabled:border-zinc-800 disabled:text-zinc-500 transition-colors flex items-center justify-center gap-2 rounded-none focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-black"
              >
                {isProcessing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> SECURING CONNECTION...</>
                ) : (
                  <>PROCEED TO SECURE PAYMENT <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /></>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          STEP 2: STRIPE EMBEDDED CHECKOUT MODAL 
          ===================================================================== */}
      {paymentSession?.provider === 'stripe' && stripePromise && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:p-8 bg-black/95 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative h-[95dvh] max-h-[95dvh] w-full max-w-4xl overflow-hidden border-2 border-zinc-600 bg-white shadow-[8px_8px_0px_rgba(var(--warning-rgb), 0.3)] animate-in zoom-in-95 duration-300 md:h-auto">
            
            <button 
              onClick={handleCloseStripeModal}
              aria-label="Cancel payment"
              className="absolute top-4 right-4 z-[70] p-2 bg-black border-2 border-transparent text-white hover:border-white hover:bg-zinc-900 transition-colors rounded-none focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="w-full h-full overflow-y-auto bg-white pt-16 pb-4 px-2 custom-scrollbar">
              <EmbeddedCheckoutProvider 
                stripe={stripePromise} 
                options={{ clientSecret: paymentSession.client_secret, onComplete: handleStripeComplete }}
              >
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}