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
import PlaidIdentityVerificationModal from '../modals/PlaidIdentityVerificationModal';
import { useI18n } from '../../i18n';

const isVerifiedValue = value => value === true || (
  typeof value === 'string' && ['true', 'verified'].includes(value.trim().toLowerCase())
);
const hasVerificationValue = value => typeof value === 'boolean' || (
  typeof value === 'string' && ['true', 'false', 'verified', 'unverified', 'pending', 'pending_review'].includes(value.trim().toLowerCase())
);

export default function OptInGateModal({ isOpen, onClose, onSuccess }) {
  const { t } = useI18n();
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
        toast.error(t('afterDarkUiVerificationStatusFailed'));
        return;
      }
      if (!isIdentityVerified) {
        setShowIdentityVerification(true);
        return;
      }
    }
    
    if (step === 3) {
      if (mpesaNumber && !/^[17]\d{8}$/.test(mpesaNumber)) {
        toast.error(t('afterDarkUiValidSafaricomNumber'));
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
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('afterDarkUiCreatorApplicationFailed')));
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
      
      <div className="relative flex h-[90dvh] min-h-0 w-full max-w-4xl flex-col border-4 border-zinc-700 bg-black font-mono shadow-[16px_16px_0px_rgba(var(--highlight-rgb), 0.05)] animate-in fade-in zoom-in-95 duration-200">
        
        {/* HEADER */}
        <div className="flex items-center justify-between border-b-4 border-zinc-800 bg-zinc-950 p-5 shrink-0 relative z-20">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-yellow-500/10 border-2 border-yellow-500 flex items-center justify-center text-yellow-500 shadow-[2px_2px_0px_rgba(var(--warning-rgb), 0.2)]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-widest">{t('afterDarkUiCreatorOnboarding')}</h2>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">{t('afterDarkUiCreatorProtocol18Plus')}</p>
            </div>
          </div>
          <button onClick={handleClose} aria-label={t('afterDarkUiCloseCreatorSetup')} className="p-2 border-2 border-transparent text-zinc-500 hover:text-white hover:border-zinc-700 hover:bg-zinc-900 transition-all">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* PROGRESS BAR */}
        <div className="flex border-b-2 border-zinc-800 bg-zinc-950 shrink-0">
          {['afterDarkUiIntro', 'afterDarkUiDetails', 'afterDarkUiPayoutPreview', 'afterDarkUiRules'].map((labelKey, idx) => {
            const stepNum = idx + 1;
            const isActive = step === stepNum;
            const isPast = step > stepNum;
            return (
              <div 
                key={labelKey}
                className={`flex-1 min-w-0 p-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-zinc-800 last:border-r-0 flex items-center justify-center gap-2 transition-all duration-300
                  ${isActive ? 'bg-yellow-500 text-black border-b-4 border-b-yellow-600' : 
                    isPast ? 'bg-zinc-900 text-zinc-400' : 'bg-black text-zinc-600'}`}
              >
                {isPast ? <Check className="w-3.5 h-3.5 text-green-500 stroke-[3]" /> : <span>0{stepNum}</span>}
                <span className="hidden sm:inline truncate">{t(labelKey)}</span>
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
                <div className="size-[clamp(5rem,12vw,6rem)] bg-zinc-950 border-4 border-zinc-800 flex items-center justify-center mb-2 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.02)]">
                  <ShieldAlert className="w-12 h-12 text-yellow-500" />
                </div>
                <h1 className="text-3xl font-black text-white uppercase tracking-widest">{t('afterDarkUiMonetizeContent')}</h1>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest leading-relaxed max-w-xl">
                  {t('afterDarkUiApplyForCreatorTools')}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col gap-3 hover:border-green-500/50 transition-colors">
                  <Banknote className="w-8 h-8 text-green-500" />
                  <h3 className="text-xs font-black text-white uppercase tracking-widest">{t('afterDarkUiRevenueShare85')}</h3>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase leading-relaxed">
                    {t('afterDarkUiPayoutPreviewOnly')}
                  </p>
                </div>
                <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col gap-3 hover:border-blue-500/50 transition-colors">
                  <Lock className="w-8 h-8 text-blue-500" />
                  <h3 className="text-xs font-black text-white uppercase tracking-widest">{t('afterDarkUiUltimateControl')}</h3>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase leading-relaxed">
                    {t('afterDarkUiPreviewMonetizationOptions')}
                  </p>
                </div>
              </div>

              <div className="bg-red-500/5 border-2 border-red-900/50 p-6 flex items-start gap-5 shadow-[4px_4px_0px_rgba(var(--danger-rgb), 0.1)]">
                <AlertTriangle className="w-8 h-8 text-red-500 shrink-0" />
                <div>
                  <h3 className="text-xs font-black text-red-500 uppercase tracking-widest mb-2">{t('afterDarkUiIdentityCheckStatus')}</h3>
                  <p className="text-[10px] font-bold text-red-400/80 uppercase leading-relaxed">
                    {isIdentityVerified
                      ? t('afterDarkUiChattieAccountVerified')
                      : t('afterDarkUiVerifyIdentityFirst')}
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
                  <UserCheck className="w-6 h-6 text-zinc-400" /> {t('afterDarkUiCreatorDisplayName')}
                </h3>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                  {t('afterDarkUiCreatorNameSeparateOptional')}
                </p>
                {profileLoadError && (
                  <p role="status" className="mt-3 text-[10px] font-bold uppercase tracking-widest text-amber-500 bg-amber-500/10 border border-amber-500/50 p-2">
                    {t('afterDarkUiCreatorProfileVerificationLoadFailed')}
                  </p>
                )}
                {!hasVerificationStatus && !profileLoadError && !isLoadingProfile && (
                  <p role="alert" className="mt-3 text-[10px] font-bold uppercase tracking-widest text-amber-500 bg-amber-500/10 border border-amber-500/50 p-2">
                    {t('afterDarkUiVerificationStatusMissing')}
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
                  <label htmlFor="afterdark-creator-alias" className="text-xs font-black text-zinc-400 uppercase tracking-widest block mb-3">{t('afterDarkUiCreatorNameOptional')}</label>
                  <input
                    id="afterdark-creator-alias"
                    type="text"
                    value={creatorAlias}
                    onChange={e => setCreatorAlias(e.target.value)}
                    maxLength={50}
                    placeholder={t('afterDarkUiCreatorAliasExample', { name: profileName || t('afterDarkUiYourAlterEgo') })}
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
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('afterDarkUiPayoutSetupPreview')}</p>
              </div>

              <div className="bg-zinc-950 border-2 border-zinc-800 p-8 space-y-8">
                <div className="flex items-center gap-5 border-b-2 border-dashed border-zinc-800 pb-8">
                  <div className="w-14 h-14 bg-green-500/10 border-2 border-green-500 flex items-center justify-center shrink-0">
                    <Smartphone className="w-7 h-7 text-green-500" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-widest mb-1">{t('afterDarkUiMpesaPayoutPreview')}</h4>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase">{t('afterDarkUiOptionalPrototypeStep')}</p>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-black text-zinc-400 uppercase tracking-widest block mb-3">{t('afterDarkUiSafaricomPayoutNumber')}</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-5 flex items-center text-zinc-500 font-bold border-r-2 border-zinc-800 pr-4">
                      +254
                    </span>
                    <input
                      type="text"
                      value={mpesaNumber}
                      onChange={(e) => setMpesaNumber(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder={t('afterDarkUiPhoneNumberPlaceholder')}
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
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('afterDarkUiCreatorRulesReview')}</p>
              </div>

              <div className="h-[min(35dvh,30rem)] overflow-y-auto border-2 border-dashed border-zinc-800 bg-zinc-950 p-6 text-[10px] font-bold text-zinc-400 uppercase leading-loose custom-scrollbar">
                <p className="mb-6"><span className="text-yellow-500 font-black">{t('afterDarkUiEligibilityHeading')}</span> {t('afterDarkUiEligibilityAgreement')}</p>
                <p className="mb-6"><span className="text-yellow-500 font-black">{t('afterDarkUiContentOwnershipHeading')}</span> {t('afterDarkUiContentOwnershipAgreement')}</p>
                <p className="mb-6"><span className="text-yellow-500 font-black">{t('afterDarkUiRevenueSplitHeading')}</span> {t('afterDarkUiRevenueSplitAgreement')}</p>
                <p><span className="text-red-500 font-black">{t('afterDarkUiProhibitedContentHeading')}</span> {t('afterDarkUiProhibitedContentAgreement')}</p>
              </div>

              <div className="space-y-4 pt-2">
                {[
                  { key: 'age', textKey: 'afterDarkUiConfirmAdultAndCapacity' },
                  { key: 'contentOwnership', textKey: 'afterDarkUiConfirmOwnershipOrConsent' },
                  { key: 'revenueSplit', textKey: 'afterDarkUiConfirmRevenuePreview' },
                  { key: 'zeroTolerance', textKey: 'afterDarkUiConfirmContentGuidelines' },
                ].map((item) => (
                  <label
                    key={item.key} 
                    className={`flex items-center gap-5 p-4 border-2 cursor-pointer transition-all duration-200 ${agreements[item.key] ? 'border-yellow-500 bg-yellow-500/10 shadow-[4px_4px_0px_rgba(var(--warning-rgb), 0.15)]' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'}`}
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
                      {t(item.textKey)}
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
                <div className={`size-[clamp(6rem,16vw,8rem)] rounded-full border-4 flex items-center justify-center mb-8 ${isApplicationApproved ? 'bg-green-500/10 border-green-500 shadow-[0_0_40px_rgba(var(--success-rgb), 0.3)]' : 'bg-yellow-500/10 border-yellow-500 shadow-[0_0_40px_rgba(var(--warning-rgb), 0.2)]'}`}>
                  {isApplicationApproved ? <Check className="w-16 h-16 text-green-500" /> : <ShieldCheck className="w-16 h-16 text-yellow-500" />}
                </div>
                <h3 className="text-xl font-black text-white uppercase tracking-widest mb-4">
                  {isApplicationApproved ? t('afterDarkUiApplicationApproved') : t('afterDarkUiApplicationVerifying')}
                </h3>
                <div className="bg-zinc-950 border-2 border-zinc-800 p-6 w-full">
                  <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed">
                    {isApplicationApproved
                      ? t('afterDarkUiApplicationApprovedDetails')
                      : t('afterDarkUiApplicationVerifyingDetails')}
                  </p>
                  {applicationStatusError && !isApplicationApproved && (
                    <p role="alert" className="mt-3 text-[10px] font-bold uppercase tracking-widest text-amber-400">
                      {t('afterDarkUiApplicationRefreshFailed')}
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
              className="ml-auto px-10 py-4 bg-yellow-500 text-black font-black uppercase tracking-widest text-[11px] border-2 border-yellow-500 transition-all hover:bg-yellow-400 shadow-[4px_4px_0px_rgba(var(--warning-rgb), 0.2)] hover:shadow-[8px_8px_0px_rgba(var(--warning-rgb), 0.4)] hover:-translate-y-1 flex items-center gap-2"
            >
              <ShieldCheck className="w-5 h-5" /> {t('afterDarkUiAcknowledgeFinish')}
            </button>
          ) : (
            <>
              {step > 1 ? (
                <button 
                  onClick={handlePrev}
                  className="px-8 py-4 bg-black text-zinc-400 font-black uppercase tracking-widest text-[11px] border-2 border-zinc-700 transition-all hover:text-white hover:border-zinc-500 hover:bg-zinc-900 flex items-center gap-2"
                >
                  <ChevronLeft className="w-5 h-5" /> {t('afterDarkUiBack')}
                </button>
              ) : <div />}

              {step < 4 ? (
                <button 
                  onClick={handleNext}
                  disabled={isLoadingProfile || (step === 2 && (profileLoadError || !hasVerificationStatus))}
                  className="px-10 py-4 bg-white text-black font-black uppercase tracking-widest text-[11px] border-2 border-white transition-all hover:bg-zinc-200 shadow-[4px_4px_0px_rgba(var(--highlight-rgb), 0.2)] hover:shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.4)] hover:-translate-y-1 disabled:shadow-none disabled:hover:translate-y-0 flex items-center gap-2"
                >
                  {isLoadingProfile ? t('afterDarkUiCheckingProfile') : t('afterDarkUiContinue')} <ChevronRight className="w-5 h-5" />
                </button>
              ) : (
                <button 
                  onClick={handleSubmit}
                  disabled={!allAgreed || isSubmitting}
                  className="px-10 py-4 bg-yellow-500 text-black font-black uppercase tracking-widest text-[11px] border-2 border-yellow-500 transition-all hover:bg-yellow-400 shadow-[4px_4px_0px_rgba(var(--warning-rgb), 0.2)] hover:shadow-[8px_8px_0px_rgba(var(--warning-rgb), 0.4)] hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:translate-y-0 flex items-center gap-2"
                >
                  <ShieldCheck className="w-5 h-5" /> {isSubmitting ? t('afterDarkUiSubmitting') : t('afterDarkUiSubmitApplication')}
                </button>
              )}
            </>
          )}
        </div>

      </div>
    </div>
    <PlaidIdentityVerificationModal
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