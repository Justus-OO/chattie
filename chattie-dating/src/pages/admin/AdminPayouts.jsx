import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCcw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { adminService } from '../../api/admin.service';
import { useI18n } from '../../i18n';

const formatKes = cents => `KES ${(Number(cents || 0) / 100).toLocaleString()}`;
const getErrorMessage = (error, fallback) => error?.response?.data?.error
  || (typeof error?.response?.data === 'string' ? error.response.data.trim() : '')
  || (error instanceof Error ? error.message : fallback);

export default function AdminPayouts() {
  const { t } = useI18n();
  const [creators, setCreators] = useState([]);
  const [amounts, setAmounts] = useState({});
  const [reasons, setReasons] = useState({});
  const [sources, setSources] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState('');
  const [loadError, setLoadError] = useState('');

  const loadClearanceQueue = useCallback(async () => {
    setLoadError('');
    try {
      const response = await adminService.getPendingAfterDarkEarnings();
      const rows = Array.isArray(response) ? response : response?.creators || response?.items || [];
      if (!Array.isArray(rows)) throw new Error(t('adminUiEarningsServiceInvalidResponse'));
      setCreators(rows);
    } catch (error) {
      const message = getErrorMessage(error, t('adminUiLoadCreatorEarningsError'));
      setLoadError(message);
      throw error;
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    loadClearanceQueue().catch(() => {
      if (active) setCreators([]);
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => { active = false; };
  }, [loadClearanceQueue]);

  const clearEarnings = async creator => {
    const rawAmount = amounts[creator.user_id] || '';
    const amount = Number(rawAmount);
    const reason = (reasons[creator.user_id] || '').trim();
    const source = getManualSource(creator);
    const availableCents = Number(creator.pending_by_source?.[source] || 0);
    if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) > availableCents) {
      toast.error(t('adminUiPayoutAmountInvalid'));
      return;
    }
    if (!reason) {
      toast.error(t('adminUiAuditReasonRequired'));
      return;
    }
    setProcessingId(creator.user_id);
    try {
      await adminService.clearAfterDarkEarnings(creator.user_id, {
        amount_cents: Math.round(amount * 100),
        reason,
        source,
      });
      toast.success(t('adminUiCreatorEarningsCleared'));
      await loadClearanceQueue();
      setAmounts(current => ({ ...current, [creator.user_id]: '' }));
      setReasons(current => ({ ...current, [creator.user_id]: '' }));
    } catch (error) {
      toast.error(getErrorMessage(error, t('adminUiClearCreatorEarningsError')));
    } finally {
      setProcessingId('');
    }
  };

  const getManualSource = creator => {
    const availableSources = Object.entries(creator.pending_by_source || {})
      .filter(([source, amount]) => source !== 'ppv' && Number(amount) > 0);
    const selected = sources[creator.user_id];
    if (availableSources.some(([source]) => source === selected)) return selected;
    return availableSources.find(([source]) => source === 'tips')?.[0] || availableSources[0]?.[0] || '';
  };

  const autoClearPPV = async creator => {
    const eligible = Number(creator.eligible_ppv_cents || 0);
    if (eligible <= 0) return;
    setProcessingId(creator.user_id);
    try {
      const result = await adminService.autoClearAfterDarkPPEarnings(creator.user_id);
      toast.success(t('adminUiPpvEarningsReleased', { amount: formatKes(result.amount_cents) }));
      await loadClearanceQueue();
    } catch (error) {
      toast.error(getErrorMessage(error, t('adminUiAutoClearPpvError')));
    } finally {
      setProcessingId('');
    }
  };

  return (
    <main className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-black p-2 font-mono text-zinc-300 sm:p-3 lg:p-4">
      <div className="w-full space-y-4">
        <header className="flex flex-col justify-between gap-4 border-b-2 border-zinc-800 pb-5 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500">
              <ShieldCheck className="h-4 w-4" /> {t('adminUiAdminFinance')}
            </p>
            <h1 className="text-xl font-black uppercase tracking-widest text-white">{t('adminUiCreatorEarningsClearance')}</h1>
            <p className="mt-2 max-w-2xl text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
              {t('adminUiCreatorEarningsClearanceDescription')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadClearanceQueue().catch(error => toast.error(error?.response?.data?.error || t('adminUiRefreshClearanceQueueError')))}
            disabled={isLoading}
            className="flex items-center justify-center gap-2 border-2 border-zinc-700 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-white hover:border-white disabled:opacity-50"
          >
            <RefreshCcw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> {t('adminUiRefresh')}
          </button>
        </header>

        {loadError && <p role="alert" className="border-2 border-red-900 p-4 text-xs text-red-400">{loadError}</p>}

        {isLoading ? (
          <p role="status" className="border-2 border-zinc-800 p-6 text-center text-xs text-zinc-500">{t('adminUiLoadingCreatorEarnings')}</p>
        ) : creators.length === 0 ? (
          <p className="border-2 border-dashed border-zinc-800 p-8 text-center text-[10px] font-black uppercase tracking-widest text-zinc-500">
            {t('adminUiNoCreatorEarningsToClear')}
          </p>
        ) : (
          <div className="space-y-4">
            {creators.map(creator => (
              <section key={creator.user_id} className="space-y-4 border-2 border-zinc-800 bg-zinc-950 p-4 sm:p-6">
                <div className="flex flex-col justify-between gap-2 border-b-2 border-zinc-800 pb-4 sm:flex-row sm:items-center">
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-widest text-white">{creator.creator_name}</h2>
                    <p className="mt-1 break-all text-[9px] font-bold text-zinc-600">{creator.user_id}</p>
                  </div>
                  <p className="text-sm font-black uppercase tracking-widest text-white">
                    {t('adminUiHeld')}: {formatKes(creator.pending_cents)}
                  </p>
                </div>
                {creator.hold_reason && (
                    <p role="status" className="border border-amber-900 bg-amber-950/20 p-3 text-[10px] font-bold uppercase tracking-widest text-amber-300">
                      {t('adminUiClearanceHold')}: {creator.hold_reason}
                    </p>
                )}
                <div className="flex flex-col justify-between gap-3 border border-zinc-800 bg-black p-3 sm:flex-row sm:items-center">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{t('adminUiEligibleSettledPpv')}</p>
                      <p className="mt-1 text-sm font-black text-green-300">{formatKes(creator.eligible_ppv_cents)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => autoClearPPV(creator)}
                      disabled={processingId === creator.user_id || Number(creator.eligible_ppv_cents || 0) <= 0 || Boolean(creator.hold_reason)}
                      className="border-2 border-green-800 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-green-200 hover:border-green-400 disabled:opacity-40"
                    >
                      {processingId === creator.user_id ? t('adminUiProcessing') : t('adminUiAutoClearPpv')}
                    </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(creator.pending_by_source || {}).filter(([, amount]) => Number(amount) > 0).map(([source, amount]) => (
                      <p key={source} className="border border-zinc-800 p-3 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                        {source.replaceAll('_', ' ')} · {formatKes(amount)}
                      </p>
                    ))}
                </div>
                <div className="grid gap-4 md:grid-cols-[1fr_2fr_auto]">
                    <label className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                      {t('adminUiManualSource')}
                      <select
                        value={getManualSource(creator)}
                        onChange={event => setSources(current => ({ ...current, [creator.user_id]: event.target.value }))}
                        className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white"
                      >
                        {Object.entries(creator.pending_by_source || {})
                          .filter(([source, amount]) => source !== 'ppv' && Number(amount) > 0)
                          .map(([source]) => <option key={source} value={source}>{source.replaceAll('_', ' ')}</option>)}
                      </select>
                    </label>
                  <label className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                    {t('adminUiAmountKes')}
                    <input
                      type="number"
                      min="0.01"
                      max={Number(creator.pending_by_source?.[getManualSource(creator)] || 0) / 100}
                      step="0.01"
                      value={amounts[creator.user_id] || ''}
                      onChange={event => setAmounts(current => ({ ...current, [creator.user_id]: event.target.value }))}
                      className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white"
                    />
                  </label>
                  <label className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                    {t('adminUiAuditReason')}
                    <input
                      type="text"
                      maxLength="500"
                      value={reasons[creator.user_id] || ''}
                      onChange={event => setReasons(current => ({ ...current, [creator.user_id]: event.target.value }))}
                      placeholder={t('adminUiClearanceReasonRequired')}
                      className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => clearEarnings(creator)}
                    disabled={processingId === creator.user_id || Boolean(creator.hold_reason) || Object.entries(creator.pending_by_source || {}).every(([source, amount]) => source === 'ppv' || Number(amount) <= 0)}
                    className="self-end border-2 border-white bg-white px-4 py-3 text-[9px] font-black uppercase tracking-widest text-black hover:bg-zinc-200 disabled:opacity-50"
                  >
                    {processingId === creator.user_id ? t('adminUiClearing') : t('adminUiClearEarnings')}
                  </button>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
