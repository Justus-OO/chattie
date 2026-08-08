import React, { useState, useEffect } from 'react';
import { 
  Zap, CheckCircle2, Star, Crown, Eye, Heart, 
  MessageSquare, Undo2, ChevronDown, ShieldCheck, 
  CreditCard, Loader2, X, Lock
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

// Services
import { extrasService } from '../../api/extras.service';

// ============================================================================
// MOCK DATA (Pricing and feature display data remains static for UI)
// ============================================================================
const SUBSCRIPTION_PLANS = [
  { id: 1, duration: '1 Month', price: 14.99, monthly: 14.99, save: 0, isPopular: false },
  { id: 6, duration: '6 Months', price: 53.94, monthly: 8.99, save: 40, isPopular: true },
  { id: 12, duration: '12 Months', price: 71.88, monthly: 5.99, save: 60, isPopular: false },
];

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
// MAIN COMPONENT
// ============================================================================
export default function PremiumUpgrade() {
  const navigate = useNavigate();
  
  // --- STATE ---
  const [selectedPlan, setSelectedPlan] = useState(SUBSCRIPTION_PLANS[1]);
  const [expandedFaq, setExpandedFaq] = useState(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // --- HANDLERS ---
  const handlePurchase = async (e) => {
    e.preventDefault();
    setIsProcessing(true);
    
    try {
      // Call the real backend API to upgrade the user
      await extrasService.upgradeSubscription(selectedPlan.id, selectedPlan.price, 'tok_mock123');
      
      setShowCheckout(false);
      toast.success('PAYMENT SUCCESSFUL. VIP STATUS ACTIVATED.');
      
      // Redirect to discover after a brief success delay
      setTimeout(() => navigate('/discover'), 1500);
    } catch (error) {
      console.error('Checkout error:', error);
      toast.error(error.message || 'Payment failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleFaq = (idx) => {
    setExpandedFaq(prev => prev === idx ? null : idx);
  };

  useEffect(() => {
    if (showCheckout) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [showCheckout]);

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div 
      className="flex-1 flex flex-col bg-black w-full h-full relative overflow-hidden text-zinc-300 rounded-none"
      style={{ fontFamily: 'Roboto, sans-serif', fontWeight: 400 }}
    >
      
      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pb-32 md:pb-12 bg-black">
        <div className="max-w-4xl mx-auto w-full px-4 py-8 md:py-12 flex flex-col items-center">
          
          {/* =====================================================================
              HERO SECTION
              ===================================================================== */}
          <div className="text-center mb-10 w-full flex flex-col items-center border-b-2 border-zinc-800 pb-10">
            <div className="relative mb-6">
              <div className="w-16 h-16 bg-black border-2 border-yellow-400 flex items-center justify-center relative shadow-[4px_4px_0px_rgba(250,204,21,0.2)]">
                <Crown className="w-8 h-8 text-yellow-400" />
              </div>
              <div className="absolute -top-3 -right-3 px-2 py-0.5 bg-yellow-400 text-black border-2 border-black text-[9px] font-bold uppercase tracking-widest shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                VIP
              </div>
            </div>
            
            <h1 className="text-3xl md:text-5xl font-black text-white mb-4 uppercase tracking-widest">
              Upgrade to <span className="text-yellow-400">Gold</span>
            </h1>
            <p className="text-zinc-500 text-[10px] md:text-xs font-bold uppercase tracking-widest max-w-md mx-auto leading-relaxed">
              Stand out in the factory, see who likes you instantly, and triple your matches with premium tools.
            </p>
          </div>

          {/* =====================================================================
              PRICING TIERS
              ===================================================================== */}
          <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-12">
            {SUBSCRIPTION_PLANS.map((plan) => {
              const isSelected = selectedPlan.id === plan.id;
              
              return (
                <div 
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan)}
                  className={`
                    relative p-6 cursor-pointer transition-colors flex flex-col text-center border-2
                    ${isSelected 
                      ? 'bg-zinc-900 border-yellow-400 z-10 shadow-[8px_8px_0px_rgba(250,204,21,0.1)]' 
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
                    <span className="text-[10px] text-zinc-500 font-bold pb-1">$</span>
                    <span className="text-3xl font-black text-white leading-none">{plan.monthly}</span>
                    <span className="text-[10px] text-zinc-500 font-bold pb-1">/MO</span>
                  </div>
                  
                  <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mb-6">
                    BILLED ${plan.price} EVERY {plan.id} MONTHS
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

          {/* Desktop Checkout Button (Hidden on Mobile) */}
          <div className="hidden md:flex justify-center w-full mb-16">
            <button 
              onClick={() => setShowCheckout(true)}
              className="w-full max-w-md py-4 bg-yellow-400 text-black border-2 border-yellow-400 text-xs font-bold uppercase tracking-widest hover:bg-yellow-500 transition-colors shadow-[8px_8px_0px_rgba(255,255,255,0.1)]"
            >
              CONTINUE WITH {selectedPlan.duration}
            </button>
          </div>

          {/* =====================================================================
              FEATURE SHOWCASE GRID
              ===================================================================== */}
          <div className="w-full mb-16">
            <div className="text-center mb-8 border-b-2 border-zinc-800 pb-4">
              <h2 className="text-sm font-bold text-white uppercase tracking-widest mb-2">EVERYTHING INCLUDED IN GOLD</h2>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">UNLOCK THE ULTIMATE TEXTING FACTORY EXPERIENCE.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {PREMIUM_FEATURES.map((feat, i) => (
                <div key={i} className="bg-black border-2 border-zinc-800 p-5 flex items-start gap-4 hover:border-zinc-600 transition-colors">
                  <div className="w-10 h-10 bg-zinc-950 border-2 border-zinc-800 flex items-center justify-center shrink-0">
                    <feat.icon className="w-4 h-4 text-yellow-400" />
                  </div>
                  <div>
                    <h3 className="text-[10px] font-bold text-white uppercase tracking-widest mb-2">{feat.title}</h3>
                    <p className="text-[9px] text-zinc-500 uppercase tracking-widest leading-relaxed font-bold">{feat.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* =====================================================================
              FAQ SECTION
              ===================================================================== */}
          <div className="w-full max-w-2xl mx-auto mb-10">
            <div className="text-center mb-8 border-b-2 border-zinc-800 pb-4">
              <h2 className="text-sm font-bold text-white uppercase tracking-widest mb-2">FREQUENTLY ASKED QUESTIONS</h2>
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
                      className="w-full p-4 flex items-center justify-between text-left"
                    >
                      <span className="text-[10px] font-bold text-white uppercase tracking-widest pr-4">{faq.q}</span>
                      <ChevronDown className={`w-4 h-4 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180 text-white' : 'text-zinc-600'}`} />
                    </button>
                    
                    <div className={`
                      grid transition-all duration-300 ease-in-out
                      ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}
                    `}>
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

      {/* =====================================================================
          STICKY MOBILE ACTION BAR
          ===================================================================== */}
      <div className="md:hidden absolute bottom-0 inset-x-0 p-4 bg-black border-t-2 border-zinc-800 z-20">
        <button 
          onClick={() => setShowCheckout(true)}
          className="w-full py-4 bg-yellow-400 text-black border-2 border-yellow-400 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center transition-colors"
        >
          GET {selectedPlan.duration} FOR ${selectedPlan.price}
        </button>
      </div>

      {/* =====================================================================
          CHECKOUT MODAL
          ===================================================================== */}
      {showCheckout && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={() => !isProcessing && setShowCheckout(false)} />
          
          <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] flex flex-col overflow-hidden animate-in slide-in-from-bottom-full md:zoom-in-95 duration-300 rounded-none">
            
            {/* Modal Header */}
            <div className="bg-zinc-950 p-4 flex justify-between items-center border-b-2 border-zinc-800 shrink-0">
              <h2 className="font-bold text-[10px] uppercase tracking-widest text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-green-500" /> SECURE CHECKOUT
              </h2>
              {!isProcessing && (
                <button onClick={() => setShowCheckout(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Order Summary */}
            <div className="p-6 bg-black">
              <div className="flex justify-between items-end mb-6 pb-6 border-b-2 border-zinc-800">
                <div>
                  <h3 className="text-[10px] font-bold text-white uppercase tracking-widest">CHATTIE GOLD</h3>
                  <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">{selectedPlan.duration} SUBSCRIPTION</p>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black text-white">${selectedPlan.price}</span>
                  <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">+ APPLICABLE TAXES</p>
                </div>
              </div>

              {/* Mock Payment Form */}
              <form onSubmit={handlePurchase} className="space-y-4">
                <div>
                  <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">CARD DETAILS</label>
                  <div className="relative">
                    <CreditCard className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input 
                      type="text" 
                      placeholder="•••• •••• •••• ••••"
                      required
                      disabled={isProcessing}
                      className="w-full bg-black border-2 border-zinc-800 rounded-none pl-10 pr-16 py-3 text-[10px] font-bold text-white uppercase tracking-widest focus:outline-none focus:border-white disabled:opacity-50 transition-colors placeholder:text-zinc-700"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                      <div className="px-1.5 py-0.5 bg-zinc-950 border border-zinc-800 flex items-center justify-center text-[8px] font-bold text-zinc-400">VISA</div>
                      <div className="px-1.5 py-0.5 bg-zinc-950 border border-zinc-800 flex items-center justify-center text-[8px] font-bold text-zinc-400">MC</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <input 
                    type="text" 
                    placeholder="MM / YY"
                    required
                    disabled={isProcessing}
                    className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-[10px] font-bold text-white uppercase tracking-widest focus:outline-none focus:border-white disabled:opacity-50 transition-colors placeholder:text-zinc-700"
                  />
                  <input 
                    type="text" 
                    placeholder="CVC"
                    required
                    disabled={isProcessing}
                    className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-[10px] font-bold text-white uppercase tracking-widest focus:outline-none focus:border-white disabled:opacity-50 transition-colors placeholder:text-zinc-700"
                  />
                </div>

                <div className="flex items-center gap-2 mt-4 text-[9px] font-bold text-zinc-500 uppercase tracking-widest bg-zinc-950 p-4 border-2 border-zinc-800 leading-relaxed">
                  <Lock className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  <p>PAYMENTS ARE ENCRYPTED AND PROCESSED SECURELY. YOUR SUBSCRIPTION WILL AUTO-RENEW. CANCEL ANYTIME.</p>
                </div>

                <button 
                  type="submit"
                  disabled={isProcessing}
                  className="w-full py-4 mt-6 bg-yellow-400 text-black border-2 border-yellow-400 text-[10px] font-bold uppercase tracking-widest hover:bg-yellow-500 disabled:bg-zinc-800 disabled:border-zinc-800 disabled:text-zinc-500 transition-colors flex items-center justify-center gap-2 rounded-none"
                >
                  {isProcessing ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> PROCESSING PAYMENT...</>
                  ) : (
                    `PAY $${selectedPlan.price}`
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}