import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  ShieldAlert, Check, X, Sparkles, Lock,
  ChevronRight, ChevronLeft,
  Smartphone, AlertTriangle, FileSignature,
  UserCheck, Banknote, ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';
import { settingsService } from '../../api/settings.service';
import { AFTER_DARK_CREATOR_POLICY_VERSION, afterDarkService } from '../../api/afterdark.service';
import { useAppStore } from '../../store/useAppStore';
import IdentityVerificationModal from '../modals/IdentityVerificationModal';

const isVerifiedValue = value => value === true || (
  typeof value === 'string' && ['true', 'verified'].includes(value.trim().toLowerCase())
);
const hasVerificationValue = value => typeof value === 'boolean' || (
  typeof value === 'string' && ['true', 'false', 'verified', 'unverified', 'pending', 'pending_review'].includes(value.trim().toLowerCase())
);

export default function OptInGateModal({ isOpen, onClose, onSuccess }) {
  // --- Core State ---
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [application, setApplication] = useState(null);
  const [applicationStatusError, setApplicationStatusError] = useState(false);
  const isApplicationApproved = ['approved', 'active'].includes(
    String(application?.status || application?.application_status || '').toLowerCase()
  );

  const accountUser = useAppStore(state => state.user);
  const savedCreatorAlias = useAppStore(state => state.afterDarkCreatorAlias);
  const storedVerificationStatus = useAppStore(state => state.isIdentityVerified);
  const [creatorAlias, setCreatorAlias] = useState('');
  const [profileName, setProfileName] = useState('');
  const [isIdentityVerified, setIsIdentityVerified] = useState(false);
  const [hasVerificationStatus, setHasVerificationStatus] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [profileLoadError, setProfileLoadError] = useState(false);
  const [showIdentityVerification, setShowIdentityVerification] = useState(false);
  const [profileCheckAttempt, setProfileCheckAttempt] = useState(0);
  const setIdentityVerificationStatus = useAppStore(state => state.setIdentityVerificationStatus);

  // --- Payout State ---
  const [mpesaNumber, setMpesaNumber] = useState('');
  
  // --- Legal Consent State ---
  const [agreements, setAgreements] = useState({
    age: false,
    contentOwnership: false,
    revenueSplit: false,
    zeroTolerance: false,
  });

  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    const accountName = accountUser?.name || accountUser?.displayName || accountUser?.username || '';
    const accountVerification = [
      accountUser?.verified,
      accountUser?.isVerified,
      accountUser?.identityVerified,
      accountUser?.verificationStatus,
    ];
    const accountVerified = storedVerificationStatus || accountVerification.some(isVerifiedValue);

    setProfileName(accountName);
    setCreatorAlias(savedCreatorAlias || '');
    setIsIdentityVerified(accountVerified);
    setHasVerificationStatus(false);
    setProfileLoadError(false);
    setIsLoadingProfile(true);

    settingsService.getSettings()
      .then(settings => {
        if (!active) return;
        const name = settings?.name || settings?.display_name || accountName;
        const verification = settings?.verified ?? settings?.is_verified ?? settings?.isVerified
          ?? settings?.identity_verified ?? settings?.verification_status;
        const verified = isVerifiedValue(verification);
        setProfileName(name);
        setIsIdentityVerified(verified);
        setHasVerificationStatus(hasVerificationValue(verification));
        if (hasVerificationValue(verification)) setIdentityVerificationStatus(verified);
      })
      .catch(() => {
        if (!active) return;
        setProfileLoadError(true);
        setHasVerificationStatus(false);
        setIsIdentityVerified(accountVerified);
      })
      .finally(() => {
        if (active) setIsLoadingProfile(false);
      });

    return () => { active = false; };
  }, [isOpen, accountUser, savedCreatorAlias, storedVerificationStatus, profileCheckAttempt, setIdentityVerificationStatus]);

  useEffect(() => {
    if (!isOpen || step !== 5 || !application?.id || isApplicationApproved) return undefined;
    let active = true;
    const refreshApplication = async () => {
      try {
        const response = await afterDarkService.getMyCreatorApplication();
        const currentApplication = response?.application;
        if (active && currentApplication) {
          setApplication(currentApplication);
          setApplicationStatusError(false);
        }
      } catch (error) {
        if (active) {
          console.error('[AFTER DARK ONBOARDING] Failed to refresh application status:', error);
          setApplicationStatusError(true);
        }
      }
    };
    const interval = window.setInterval(refreshApplication, 5000);
    refreshApplication();
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [application?.id, isApplicationApproved, isOpen, step]);

  if (!isOpen) return null;

  // ==========================================
  // HANDLERS & VALIDATION
  // ==========================================
  const handleNext = () => {
    if (isLoadingProfile) return;
    if (step === 2) {
      if (profileLoadError || !hasVerificationStatus) {
        toast.error('Could not confirm your Chattie verification status. Retry before continuing.');
        return;
      }
      if (!isIdentityVerified) {
        setShowIdentityVerification(true);
        return;
      }
    }
    
    if (step === 3) {
      if (mpesaNumber && !/^[17]\d{8}$/.test(mpesaNumber)) {
        toast.error('Enter a valid 9-digit Safaricom number starting with 1 or 7.');
        return;
      }
    }

    setStep(prev => prev + 1);
  };

  const handlePrev = () => setStep(prev => prev - 1);

  const toggleAgreement = (key) => {
    setAgreements(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const allAgreed = Object.values(agreements).every(Boolean);
  const handleClose = () => {
    setStep(1);
    setApplication(null);
    setApplicationStatusError(false);
    setCreatorAlias(savedCreatorAlias || '');
    setShowIdentityVerification(false);
    setMpesaNumber('');
    setAgreements({ age: false, contentOwnership: false, revenueSplit: false, zeroTolerance: false });
    onClose();
  };

  const handleSubmit = async () => {
    if (!allAgreed) return;
    setIsSubmitting(true);
    setApplicationStatusError(false);
    try {
      const result = await afterDarkService.submitCreatorApplication({
        alias: creatorAlias.trim() || profileName || accountUser?.username || 'Creator',
        consents: {
          age: agreements.age,
          content_ownership: agreements.contentOwnership,
          revenue_split: agreements.revenueSplit,
          zero_tolerance: agreements.zeroTolerance,
        },
        policy_version: AFTER_DARK_CREATOR_POLICY_VERSION,
      });
      setApplication(result);
      setStep(5);
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Creator application failed.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEnableCreatorMode = () => {
    const alias = creatorAlias.trim() || profileName || accountUser?.username || 'Creator';
    onSuccess?.({ ...application, creatorAlias: alias });
    handleClose();
  };

  // ==========================================
  // RENDER BLOCKS
  // ==========================================
  return createPortal((
    <>
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-sm transition-opacity duration-300" onClick={handleClose} />
      
      <div className="relative w-full max-w-4xl bg-black border-4 border-zinc-700 shadow-[16px_16px_0px_rgba(255,255,255,0.05)] flex flex-col z-10 font-mono h-[90vh] md:h-[750px] animate-in fade-in zoom-in-95 duration-200">
        
        {/* HEADER */}
        <div className="flex items-center justify-between border-b-4 border-zinc-800 bg-zinc-950 p-5 shrink-0 relative z-20">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-yellow-500/10 border-2 border-yellow-500 flex items-center justify-center text-yellow-500 shadow-[2px_2px_0px_rgba(234,179,8,0.2)]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-widest">AFTER DARK CREATOR ONBOARDING</h2>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">18+ Creator Protocol</p>
            </div>
          </div>
          <button onClick={handleClose} aria-label="Close creator setup" className="p-2 border-2 border-transparent text-zinc-500 hover:text-white hover:border-zinc-700 hover:bg-zinc-900 transition-all">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* PROGRESS BAR */}
        <div className="flex border-b-2 border-zinc-800 bg-zinc-950 shrink-0">
          {['Intro', 'Details', 'Payout Preview', 'Rules'].map((label, idx) => {
            const stepNum = idx + 1;
            const isActive = step === stepNum;
            const isPast = step > stepNum;
            return (
              <div 
                key={label}
                className={`flex-1 min-w-0 p-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-zinc-800 last:border-r-0 flex items-center justify-center gap-2 transition-all duration-300
                  ${isActive ? 'bg-yellow-500 text-black border-b-4 border-b-yellow-600' : 
                    isPast ? 'bg-zinc-900 text-zinc-400' : 'bg-black text-zinc-600'}`}
              >
                {isPast ? <Check className="w-3.5 h-3.5 text-green-500 stroke-[3]" /> : <span>0{stepNum}</span>}
                <span className="hidden sm:inline truncate">{label}</span>
              </div>
            );
          })}
        </div>

        {/* CONTENT AREA */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-black relative">
          
          {/* STEP 1: INTRO */}
          {step === 1 && (
            <div className="p-6 md:p-12 max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex flex-col items-center text-center space-y-4 mb-10">
                <div className="w-24 h-24 bg-zinc-950 border-4 border-zinc-800 flex items-center justify-center mb-2 shadow-[8px_8px_0px_rgba(255,255,255,0.02)]">
                  <ShieldAlert className="w-12 h-12 text-yellow-500" />
                </div>
                <h1 className="text-3xl font-black text-white uppercase tracking-widest">MONETIZE YOUR CONTENT</h1>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest leading-relaxed max-w-xl">
                  Apply to enable creator tools. Your application and any payout contact details are sent to After Dark.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col gap-3 hover:border-green-500/50 transition-colors">
                  <Banknote className="w-8 h-8 text-green-500" />
                  <h3 className="text-xs font-black text-white uppercase tracking-widest">85% Revenue Share</h3>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase leading-relaxed">
                    Earnings and payout screens are previews only. No payments or M-Pesa transfers are processed.
                  </p>
                </div>
                <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col gap-3 hover:border-blue-500/50 transition-colors">
                  <Lock className="w-8 h-8 text-blue-500" />
                  <h3 className="text-xs font-black text-white uppercase tracking-widest">Ultimate Control</h3>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase leading-relaxed">
                    Preview Pay-Per-View (PPV) and monthly subscription options. Publishing and watermarking are not connected.
                  </p>
                </div>
              </div>

              <div className="bg-red-500/5 border-2 border-red-900/50 p-6 flex items-start gap-5 shadow-[4px_4px_0px_rgba(239,68,68,0.1)]">
                <AlertTriangle className="w-8 h-8 text-red-500 shrink-0" />
                <div>
                  <h3 className="text-xs font-black text-red-500 uppercase tracking-widest mb-2">IDENTITY CHECK STATUS</h3>
                  <p className="text-[10px] font-bold text-red-400/80 uppercase leading-relaxed">
                    {isIdentityVerified
                      ? 'Your Chattie account is verified. You can continue without repeating verification.'
                      : 'Verify your identity with Chattie after entering your creator details. Verification is required before setup can continue.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: CREATOR NAME AND AGE CHECK */}
          {step === 2 && (
            <div className="p-6 md:p-12 max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="border-b-2 border-zinc-800 pb-6">
                <h3 className="text-base font-black text-white uppercase tracking-widest mb-2 flex items-center gap-3">
                  <UserCheck className="w-6 h-6 text-zinc-400" /> CREATOR DISPLAY NAME
                </h3>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                  Your Chattie profile name stays unchanged. Creator name is separate and optional.
                </p>
                {profileLoadError && (
                  <p role="status" className="mt-3 text-[10px] font-bold uppercase tracking-widest text-amber-500 bg-amber-500/10 border border-amber-500/50 p-2">
                    Could not load your Chattie profile or verification status. Retry before continuing.
                  </p>
                )}
                {!hasVerificationStatus && !profileLoadError && !isLoadingProfile && (
                  <p role="alert" className="mt-3 text-[10px] font-bold uppercase tracking-widest text-amber-500 bg-amber-500/10 border border-amber-500/50 p-2">
                    Chattie did not return a verification status. Retry the check before continuing.
                  </p>
                )}
                {(profileLoadError || (!hasVerificationStatus && !isLoadingProfile)) && (
                  <button type="button" onClick={() => setProfileCheckAttempt(attempt => attempt + 1)} className="mt-3 border border-amber-500/50 bg-amber-500/10 p-2 text-[10px] font-bold uppercase tracking-widest text-amber-400 hover:bg-amber-500/20">
                    Retry Chattie verification check
                  </button>
                )}
                {isLoadingProfile && (
                  <p role="status" className="mt-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                    <span className="w-2 h-2 bg-yellow-500 animate-ping rounded-full" /> Checking your Chattie profile…
                  </p>
                )}
              </div>

              <div className="space-y-8">
                <div>
                  <label htmlFor="afterdark-creator-alias" className="text-xs font-black text-zinc-400 uppercase tracking-widest block mb-3">Creator name (optional)</label>
                  <input
                    id="afterdark-creator-alias"
                    type="text"
                    value={creatorAlias}
                    onChange={e => setCreatorAlias(e.target.value)}
                    maxLength={50}
                    placeholder={`e.g., ${profileName || 'Your Alter Ego'}`}
                    className="w-full bg-zinc-900 border-2 border-zinc-700 text-white p-5 text-sm font-bold outline-none focus:border-yellow-500 focus:bg-black transition-colors placeholder:text-zinc-600"
                  />
                  <div className="mt-4 flex items-start justify-between">
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest max-w-[60%] leading-relaxed">
                      Leave blank to use <span className="text-zinc-300">{profileName || accountUser?.username || 'your Chattie name'}</span>.
                    </p>
                    {(profileName || accountUser?.username) && (
                      <button
                        type="button"
                        onClick={() => setCreatorAlias(profileName || accountUser.username)}
                        className="text-[9px] font-black uppercase tracking-widest bg-zinc-800 text-zinc-300 border-2 border-zinc-700 px-3 py-1.5 hover:bg-zinc-700 hover:text-white hover:border-zinc-500 transition-colors"
                      >
                        Use Chattie Name
                      </button>
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* STEP 3: PAYOUT CONFIGURATION */}
          {step === 3 && (
            <div className="p-6 md:p-12 max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="border-b-2 border-zinc-800 pb-6">
                <h3 className="text-base font-black text-white uppercase tracking-widest mb-2 flex items-center gap-3">
                  <Banknote className="w-6 h-6 text-zinc-400" /> PAYOUT CONFIGURATION
                </h3>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Payout setup preview. No money will be sent.</p>
              </div>

              <div className="bg-zinc-950 border-2 border-zinc-800 p-8 space-y-8">
                <div className="flex items-center gap-5 border-b-2 border-dashed border-zinc-800 pb-8">
                  <div className="w-14 h-14 bg-green-500/10 border-2 border-green-500 flex items-center justify-center shrink-0">
                    <Smartphone className="w-7 h-7 text-green-500" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-widest mb-1">M-PESA PAYOUT PREVIEW</h4>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase">Optional Prototype Step</p>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-black text-zinc-400 uppercase tracking-widest block mb-3">Safaricom Payout Number</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-5 flex items-center text-zinc-500 font-bold border-r-2 border-zinc-800 pr-4">
                      +254
                    </span>
                    <input
                      type="text"
                      value={mpesaNumber}
                      onChange={(e) => setMpesaNumber(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="7XX XXX XXX"
                      maxLength={9}
                      className="w-full bg-black border-2 border-zinc-700 text-white p-5 pl-[85px] text-sm font-bold outline-none focus:border-green-500 transition-colors"
                    />
                  </div>
                  <div className="mt-4 p-4 bg-zinc-900 border border-zinc-800 flex items-start gap-3">
                    <ShieldCheck className="w-4 h-4 text-zinc-500 shrink-0" />
                    <p className="text-[9px] font-bold text-zinc-500 uppercase leading-relaxed">
                      Use a sample 9-digit number. This value is discarded when you finish setup. Leave blank to skip.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: LEGAL REVIEW & CONSENT */}
          {step === 4 && (
            <div className="p-6 md:p-12 max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="border-b-2 border-zinc-800 pb-6">
                <h3 className="text-base font-black text-white uppercase tracking-widest mb-2 flex items-center gap-3">
                  <FileSignature className="w-6 h-6 text-zinc-400" /> LEGAL AGREEMENT
                </h3>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Review the creator rules and confirm each item to submit your application.</p>
              </div>

              <div className="bg-zinc-950 border-2 border-zinc-800 h-56 overflow-y-auto custom-scrollbar p-6 text-[10px] font-bold text-zinc-400 uppercase leading-loose border-dashed">
                <p className="mb-6"><span className="text-yellow-500 font-black">1. ELIGIBILITY:</span> YOU REPRESENT AND WARRANT THAT YOU ARE AT LEAST EIGHTEEN (18) YEARS OF AGE AND HAVE THE LEGAL CAPACITY TO ENTER INTO THIS BINDING AGREEMENT.</p>
                <p className="mb-6"><span className="text-yellow-500 font-black">2. CONTENT OWNERSHIP:</span> ONLY UPLOAD CONTENT YOU OWN OR HAVE PERMISSION TO SHARE. EVERYONE SHOWN MUST BE AN ADULT WHO CONSENTS.</p>
                <p className="mb-6"><span className="text-yellow-500 font-black">3. REVENUE SPLIT:</span> THIS IS A PREVIEW ONLY. PAYMENTS AND PAYOUTS ARE NOT ENABLED IN THIS PROTOTYPE.</p>
                <p><span className="text-red-500 font-black">4. PROHIBITED CONTENT:</span> ZERO TOLERANCE POLICY FOR NON-CONSENSUAL CONTENT, MINORS, BESTIALITY, OR EXTREME VIOLENCE. VIOLATION RESULTS IN IMMEDIATE TERMINATION AND REPORTING TO AUTHORITIES.</p>
              </div>

              <div className="space-y-4 pt-2">
                {[
                  { key: 'age', text: 'I CONFIRM I AM 18+ YEARS OLD AND HAVE THE CAPACITY TO FORM A BINDING CONTRACT.' },
                  { key: 'contentOwnership', text: 'I AM THE SOLE CREATOR OR HAVE EXPLICIT RECORDED CONSENT FOR ALL MEDIA I PUBLISH.' },
                  { key: 'revenueSplit', text: 'I UNDERSTAND THAT REVENUE AND PAYOUTS ARE ONLY A PREVIEW IN THIS PROTOTYPE.' },
                  { key: 'zeroTolerance', text: 'I AGREE TO THE STRICT CONTENT GUIDELINES AND ZERO TOLERANCE POLICY FOR PROHIBITED MATERIAL.' },
                ].map((item) => (
                  <label
                    key={item.key} 
                    className={`flex items-center gap-5 p-4 border-2 cursor-pointer transition-all duration-200 ${agreements[item.key] ? 'border-yellow-500 bg-yellow-500/10 shadow-[4px_4px_0px_rgba(234,179,8,0.15)]' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'}`}
                  >
                    <input
                      type="checkbox"
                      checked={agreements[item.key]}
                      onChange={() => toggleAgreement(item.key)}
                      className="sr-only"
                    />
                    <div aria-hidden="true" className={`w-8 h-8 border-2 flex items-center justify-center shrink-0 transition-colors ${agreements[item.key] ? 'bg-yellow-500 border-yellow-500 text-black' : 'border-zinc-600 bg-black'}`}>
                      {agreements[item.key] && <Check className="w-5 h-5 stroke-[3]" />}
                    </div>
                    <span className={`text-[10px] font-black uppercase tracking-widest leading-relaxed select-none ${agreements[item.key] ? 'text-white' : 'text-zinc-500'}`}>
                      {item.text}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* STEP 5: APPLICATION STATUS */}
          {step === 5 && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 h-full animate-in zoom-in-95 duration-500">
              <div className="text-center w-full max-w-md flex flex-col items-center animate-in slide-in-from-bottom-8 duration-500">
                <div className={`w-32 h-32 rounded-full border-4 flex items-center justify-center mb-8 ${isApplicationApproved ? 'bg-green-500/10 border-green-500 shadow-[0_0_40px_rgba(34,197,94,0.3)]' : 'bg-yellow-500/10 border-yellow-500 shadow-[0_0_40px_rgba(234,179,8,0.2)]'}`}>
                  {isApplicationApproved ? <Check className="w-16 h-16 text-green-500" /> : <ShieldCheck className="w-16 h-16 text-yellow-500" />}
                </div>
                <h3 className="text-xl font-black text-white uppercase tracking-widest mb-4">
                  {isApplicationApproved ? 'APPLICATION APPROVED' : 'APPLICATION BEING VERIFIED'}
                </h3>
                <div className="bg-zinc-950 border-2 border-zinc-800 p-6 w-full">
                  <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed">
                    {isApplicationApproved
                      ? 'Your creator application is approved. You can now access the creator studio and upload content.'
                      : 'We are checking your verified Chattie identity, age eligibility, and recorded agreements. Applications that do not meet every check remain pending for manual review.'}
                  </p>
                  {applicationStatusError && !isApplicationApproved && (
                    <p role="alert" className="mt-3 text-[10px] font-bold uppercase tracking-widest text-amber-400">
                      Could not refresh the application status. Check your connection or close and reopen this flow.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* FOOTER CONTROLS */}
        <div className="p-5 border-t-4 border-zinc-800 bg-zinc-950 shrink-0 flex justify-between items-center z-20 relative">
          {step === 5 ? (
            <button
              type="button"
              onClick={handleEnableCreatorMode}
              disabled={isSubmitting}
              className="ml-auto px-10 py-4 bg-yellow-500 text-black font-black uppercase tracking-widest text-[11px] border-2 border-yellow-500 transition-all hover:bg-yellow-400 shadow-[4px_4px_0px_rgba(234,179,8,0.2)] hover:shadow-[8px_8px_0px_rgba(234,179,8,0.4)] hover:-translate-y-1 flex items-center gap-2"
            >
              <ShieldCheck className="w-5 h-5" /> ACKNOWLEDGE & FINISH
            </button>
          ) : (
            <>
              {step > 1 ? (
                <button 
                  onClick={handlePrev}
                  className="px-8 py-4 bg-black text-zinc-400 font-black uppercase tracking-widest text-[11px] border-2 border-zinc-700 transition-all hover:text-white hover:border-zinc-500 hover:bg-zinc-900 flex items-center gap-2"
                >
                  <ChevronLeft className="w-5 h-5" /> BACK
                </button>
              ) : <div />}

              {step < 4 ? (
                <button 
                  onClick={handleNext}
                  disabled={isLoadingProfile || (step === 2 && (profileLoadError || !hasVerificationStatus))}
                  className="px-10 py-4 bg-white text-black font-black uppercase tracking-widest text-[11px] border-2 border-white transition-all hover:bg-zinc-200 shadow-[4px_4px_0px_rgba(255,255,255,0.2)] hover:shadow-[8px_8px_0px_rgba(255,255,255,0.4)] hover:-translate-y-1 disabled:shadow-none disabled:hover:translate-y-0 flex items-center gap-2"
                >
                  {isLoadingProfile ? 'CHECKING PROFILE…' : 'CONTINUE'} <ChevronRight className="w-5 h-5" />
                </button>
              ) : (
                <button 
                  onClick={handleSubmit}
                  disabled={!allAgreed || isSubmitting}
                  className="px-10 py-4 bg-yellow-500 text-black font-black uppercase tracking-widest text-[11px] border-2 border-yellow-500 transition-all hover:bg-yellow-400 shadow-[4px_4px_0px_rgba(234,179,8,0.2)] hover:shadow-[8px_8px_0px_rgba(234,179,8,0.4)] hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:translate-y-0 flex items-center gap-2"
                >
                  <ShieldCheck className="w-5 h-5" /> {isSubmitting ? 'SUBMITTING…' : 'SUBMIT APPLICATION'}
                </button>
              )}
            </>
          )}
        </div>

      </div>
    </div>
    <IdentityVerificationModal
      isOpen={showIdentityVerification}
      onClose={() => setShowIdentityVerification(false)}
      onVerified={() => {
        setIsIdentityVerified(true);
        setHasVerificationStatus(true);
        setIdentityVerificationStatus(true);
        setShowIdentityVerification(false);
        setStep(3);
      }}
      zIndex={110}
    />
    </>
  ), document.body);
}