import React, { useState, useMemo } from 'react';
import { 
  ShieldCheck, AlertTriangle, Search, ChevronDown, 
  Flag, CheckCircle2, X, AlertOctagon, HeartHandshake, 
  UserCheck, ShieldBan, MessageSquareOff
} from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '../../i18n';

// ============================================================================
// STRUCTURED GUIDELINES DATA
// ============================================================================
const GUIDELINES_DATA = [
  {
    id: 'rule-1',
    icon: HeartHandshake,
    titleKey: 'coreUiGuidelineRespectTitle',
    shortKey: 'coreUiGuidelineRespectShort',
    detailsKey: 'coreUiGuidelineRespectDetails',
    bullets: [
      'coreUiGuidelineRespectBullet1',
      'coreUiGuidelineRespectBullet2',
      'coreUiGuidelineRespectBullet3'
    ]
  },
  {
    id: 'rule-2',
    icon: UserCheck,
    titleKey: 'coreUiGuidelineGenuineTitle',
    shortKey: 'coreUiGuidelineGenuineShort',
    detailsKey: 'coreUiGuidelineGenuineDetails',
    bullets: [
      'coreUiGuidelineGenuineBullet1',
      'coreUiGuidelineGenuineBullet2',
      'coreUiGuidelineGenuineBullet3'
    ]
  },
  {
    id: 'rule-3',
    icon: ShieldBan,
    titleKey: 'coreUiGuidelineSpamTitle',
    shortKey: 'coreUiGuidelineSpamShort',
    detailsKey: 'coreUiGuidelineSpamDetails',
    bullets: [
      'coreUiGuidelineSpamBullet1',
      'coreUiGuidelineSpamBullet2',
      'coreUiGuidelineSpamBullet3'
    ]
  },
  {
    id: 'rule-4',
    icon: MessageSquareOff,
    titleKey: 'coreUiGuidelinePrivacyTitle',
    shortKey: 'coreUiGuidelinePrivacyShort',
    detailsKey: 'coreUiGuidelinePrivacyDetails',
    bullets: [
      'coreUiGuidelinePrivacyBullet1',
      'coreUiGuidelinePrivacyBullet2',
      'coreUiGuidelinePrivacyBullet3'
    ]
  }
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function Guidelines() {
  const { t } = useI18n();
  // --- STATE ---
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState('rule-1');
  const [hasAgreed, setHasAgreed] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  // --- FILTERING ---
  const filteredGuidelines = useMemo(() => {
    const localizedGuidelines = GUIDELINES_DATA.map((rule) => ({
      ...rule,
      title: t(rule.titleKey),
      short: t(rule.shortKey),
      details: t(rule.detailsKey),
      bullets: rule.bullets.map((key) => t(key)),
    }));
    if (!searchQuery.trim()) return localizedGuidelines;
    const q = searchQuery.toLowerCase();
    return localizedGuidelines.filter(
      rule => rule.title.toLowerCase().includes(q) || rule.details.toLowerCase().includes(q)
    );
  }, [searchQuery, t]);

  // --- HANDLERS ---
  const toggleExpand = (id) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const handleReportSubmit = (e) => {
    e.preventDefault();
    setShowReportModal(false);
    toast.success(t('reportSubmitted'));
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-black w-full relative overflow-hidden font-mono text-zinc-300 rounded-none">
      
      {/* =====================================================================
          HEADER (Brutalist)
          ===================================================================== */}
      <header className="shrink-0 border-b-2 border-zinc-800 bg-zinc-950 p-2 sm:p-3 lg:p-4">
        <div className="flex w-full flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-zinc-100 border-2 border-zinc-100 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6 text-black" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white tracking-widest uppercase mb-1">
                {t('guidelines')}
              </h1>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
                {t('guidelinesSubtitle')}
              </p>
            </div>
          </div>
          
          <div className="relative w-full shrink-0 md:w-[clamp(14rem,22vw,18rem)]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input 
              type="text" 
              placeholder={t('coreUiSearchPolicies')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black border-2 border-zinc-800 rounded-none pl-9 pr-4 py-2.5 text-[10px] font-bold text-white uppercase tracking-widest focus:outline-none focus:border-white transition-colors placeholder:text-zinc-700"
            />
          </div>
        </div>
      </header>

      {/* =====================================================================
          MAIN CONTENT AREA
          ===================================================================== */}
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-2 sm:p-3 lg:p-4 relative bg-black">
        <div className="flex min-h-full w-full flex-col gap-4 pb-24 lg:flex-row lg:gap-6">
          
          {/* LEFT: Quick Links & Actions (Sticky on Desktop) */}
          <aside className="shrink-0 order-2 lg:order-1 lg:w-[clamp(13rem,20vw,17rem)]">
            <div className="sticky top-0 space-y-6">
              
              <div className="bg-zinc-950 border-2 border-zinc-800 p-4">
                <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">{t('quickLinks')}</h3>
                <nav className="space-y-2">
                  {localizedGuidelines.map(rule => (
                    <button
                      key={`link-${rule.id}`}
                      onClick={() => {
                        setExpandedId(rule.id);
                        document.getElementById(rule.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                      className={`w-full text-left text-[10px] font-bold uppercase tracking-widest py-2 px-3 transition-colors flex items-center justify-between border-2 group
                        ${expandedId === rule.id ? 'bg-white text-black border-white' : 'text-zinc-400 border-transparent hover:border-zinc-800 hover:bg-zinc-950'}
                      `}
                    >
                      <span className="truncate pr-2">{rule.title}</span>
                      <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${expandedId === rule.id ? '-rotate-90' : 'opacity-0 group-hover:opacity-100 -rotate-90'}`} />
                    </button>
                  ))}
                </nav>
              </div>

              <div className="bg-black border-2 border-red-500 p-4 text-center shadow-[4px_4px_0px_rgba(var(--danger-rgb), 0.2)]">
                <AlertOctagon className="w-8 h-8 text-red-500 mx-auto mb-3" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-widest mb-2">{t('seeViolation')}</h3>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-4 leading-relaxed font-bold">
                  {t('coreUiGuidelinesReportDescription')}
                </p>
                <button 
                  onClick={() => setShowReportModal(true)}
                  className="w-full py-2.5 bg-red-600 border-2 border-red-600 hover:bg-red-700 text-white text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                >
                  <Flag className="w-3.5 h-3.5" /> {t('coreUiReportUser')}
                </button>
              </div>
            </div>
          </aside>

          {/* RIGHT: Guidelines Feed */}
          <main className="flex-1 order-1 lg:order-2">
            
            {/* Zero Tolerance Banner */}
            <div className="p-4 bg-black border-2 border-red-500 mb-6 flex items-start gap-4">
              <AlertTriangle className="w-6 h-6 text-red-500 shrink-0" />
              <div>
                <h3 className="text-red-500 font-bold mb-1 text-xs uppercase tracking-widest">{t('zeroTolerance')}</h3>
                <p className="text-[10px] text-zinc-400 uppercase tracking-widest leading-relaxed font-bold">
                  {t('coreUiGuidelinesZeroTolerance')}
                </p>
              </div>
            </div>

            {/* Rules Accordion List */}
            {filteredGuidelines.length === 0 ? (
              <div className="py-12 text-center border-2 border-dashed border-zinc-800 bg-zinc-950">
                <Search className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-1">{t('noPolicies')}</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('adjustSearch')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredGuidelines.map((rule, index) => {
                  const isExpanded = expandedId === rule.id;
                  const Icon = rule.icon;

                  return (
                    <div 
                      key={rule.id}
                      id={rule.id}
                      className={`
                        bg-black border-2 transition-colors duration-200
                        ${isExpanded ? 'border-white' : 'border-zinc-800 hover:border-zinc-600'}
                      `}
                    >
                      {/* Accordion Header */}
                      <button 
                        onClick={() => toggleExpand(rule.id)}
                        className="w-full flex items-center justify-between p-4 text-left"
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 border-2 flex items-center justify-center shrink-0 transition-colors
                            ${isExpanded ? 'bg-white text-black border-white' : 'bg-zinc-950 text-zinc-500 border-zinc-800'}
                          `}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div>
                            <h2 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                              <span className="text-zinc-500">0{index + 1}.</span> {rule.title}
                            </h2>
                            {!isExpanded && <p className="mt-0.5 max-w-[clamp(10rem,30vw,28rem)] truncate text-[10px] font-bold uppercase tracking-widest text-zinc-500">{rule.short}</p>}
                          </div>
                        </div>
                        <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-white' : 'text-zinc-600'}`} />
                      </button>

                      {/* Accordion Body */}
                      <div className={`
                        grid transition-all duration-300 ease-in-out
                        ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}
                      `}>
                        <div className="overflow-hidden">
                          <div className="p-4 md:p-6 pt-0 border-t-2 border-zinc-800 mt-2 bg-zinc-950">
                            <p className="text-zinc-300 text-[10px] md:text-xs uppercase tracking-widest leading-relaxed mb-6 font-bold pt-4">
                              {rule.details}
                            </p>
                            <div className="bg-black border-2 border-zinc-800 p-4">
                              <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">{t('coreUiSpecificViolations')}</h4>
                              <ul className="space-y-3">
                                {rule.bullets.map((bullet, i) => (
                                  <li key={i} className="flex items-start gap-3 text-[10px] text-zinc-300 font-bold uppercase tracking-widest">
                                    <div className="w-1.5 h-1.5 bg-white border border-black mt-1 shrink-0" />
                                    <span className="leading-relaxed">{bullet}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>

        </div>
      </div>

      {/* =====================================================================
          STICKY ACKNOWLEDGMENT BAR (Bottom)
          ===================================================================== */}
      <div className="absolute bottom-0 inset-x-0 z-20 flex justify-center border-t-2 border-zinc-800 bg-black p-2 sm:p-3">
        <div className="flex w-full flex-col items-center justify-between gap-3 md:flex-row">
          <div className="flex items-center gap-4">
            <div className={`w-10 h-10 border-2 flex items-center justify-center shrink-0 transition-colors ${hasAgreed ? 'bg-green-500 border-green-500 text-black' : 'bg-black border-zinc-700 text-zinc-700'}`}>
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-widest leading-tight">{t('communityPledge')}</h4>
              <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-0.5">{t('pledgeAgree')}</p>
            </div>
          </div>
          <button 
            onClick={() => setHasAgreed(true)}
            disabled={hasAgreed}
            className={`w-full md:w-auto px-8 py-3 text-[10px] font-bold uppercase tracking-widest border-2 transition-colors shrink-0
              ${hasAgreed 
                ? 'bg-black text-green-500 border-green-500 cursor-default' 
                : 'bg-white text-black border-white hover:bg-zinc-200'
              }
            `}
          >
            {hasAgreed ? t('coreUiAgreed') : t('coreUiIAgree')}
          </button>
        </div>
      </div>

      {/* =====================================================================
          REPORT MODAL
          ===================================================================== */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={() => setShowReportModal(false)} />
          
          <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col rounded-none">
            
            <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-zinc-950 shrink-0">
              <h2 className="font-bold text-xs text-white uppercase tracking-widest flex items-center gap-2">
                <Flag className="w-4 h-4 text-zinc-400" /> {t('coreUiReportViolation')}
              </h2>
              <button onClick={() => setShowReportModal(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleReportSubmit} className="p-6 overflow-y-auto custom-scrollbar">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-6 leading-relaxed">
                {t('coreUiAnonymousReportNotice')}
              </p>
              
              <div className="space-y-4 mb-8">
                <div>
                  <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('coreUiViolationType')}</label>
                  <select required className="w-full h-10 bg-black border-2 border-zinc-800 px-3 text-[10px] font-bold uppercase tracking-widest text-white focus:border-white outline-none appearance-none cursor-pointer rounded-none">
                    <option value="" disabled selected>{t('coreUiSelectAnOption')}</option>
                    <option value="harassment">{t('coreUiHarassmentBullying')}</option>
                    <option value="fake">{t('coreUiFakeProfileImpersonation')}</option>
                    <option value="spam">{t('coreUiSpamSolicitation')}</option>
                    <option value="explicit">{t('coreUiUnsolicitedExplicitContent')}</option>
                    <option value="other">{t('coreUiOther')}</option>
                  </select>
                </div>

                <div>
                  <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('coreUiOffenderUsernameOptional')}</label>
                  <input 
                    type="text" 
                    placeholder={t('coreUiUsernameExample')}
                    className="w-full h-10 bg-black border-2 border-zinc-800 px-3 text-[10px] font-bold uppercase tracking-widest text-white focus:border-white outline-none placeholder:text-zinc-700 rounded-none"
                  />
                </div>

                <div>
                  <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('coreUiDescription')}</label>
                  <textarea 
                    required
                    rows="4"
                    placeholder={t('coreUiDescribeWhatHappened')}
                    className="w-full bg-black border-2 border-zinc-800 p-3 text-[10px] font-bold uppercase tracking-widest text-white focus:border-white outline-none resize-none custom-scrollbar placeholder:text-zinc-700 rounded-none"
                  ></textarea>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t-2 border-zinc-800">
                <button 
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  className="flex-1 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500 border-2 border-zinc-800 hover:text-white bg-black hover:border-zinc-500 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-3 text-[10px] font-bold uppercase tracking-widest text-black bg-white border-2 border-white hover:bg-zinc-200 transition-colors"
                >
                  {t('coreUiSubmitReport')}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}