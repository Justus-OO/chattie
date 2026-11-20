import React, { useEffect, useMemo, useState } from 'react';
import { Activity, CalendarDays, Download, RefreshCcw, Wallet } from 'lucide-react';
import { adminService } from '../../api/admin.service';
import { useI18n } from '../../i18n';

const periods = ['7D', '30D', '90D', 'YTD'];
const usdStatuses = new Set(['PENDING', 'APPROVED']);
const afterDarkPendingStatuses = new Set(['REQUESTED', 'SUBMITTING', 'SUBMISSION_UNKNOWN', 'PROCESSING']);

const getErrorMessage = (error, fallback) => error?.response?.data?.error
  || (typeof error?.response?.data === 'string' ? error.response.data.trim() : '')
  || (error instanceof Error ? error.message : fallback);

const formatMoney = (currency, minorUnits) => {
  const amount = Number(minorUnits || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return `${currency || 'Unknown'} ${amount.toFixed(2)}`;
  }
};

const payoutTotals = (rows, pendingStatuses) => rows.reduce((totals, row) => {
  if (pendingStatuses.has(String(row.status || '').toUpperCase())) {
    totals.count += Number(row.requestCount || 0);
    totals.amountMinor += Number(row.amountMinor || 0);
  }
  return totals;
}, { count: 0, amountMinor: 0 });

const escapeCsv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export default function AdminFinance() {
  const { t } = useI18n();
  const [period, setPeriod] = useState('30D');
  const [refreshKey, setRefreshKey] = useState(0);
  const [finance, setFinance] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError('');

    adminService.getFinanceAnalytics(period)
      .then((response) => {
        if (!response || !Array.isArray(response.revenueBySource)
          || !Array.isArray(response.dailyRevenue)
          || !Array.isArray(response.creatorPayouts)
          || !Array.isArray(response.afterDarkWithdrawals)) {
          throw new Error(t('adminUiInvalidFinanceResponse'));
        }
        if (active) setFinance(response);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(getErrorMessage(error, t('adminUiLoadFinanceError')));
        setFinance(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => { active = false; };
  }, [period, refreshKey, t]);

  const collectionTotals = useMemo(() => {
    const totals = new Map();
    for (const row of finance?.revenueBySource || []) {
      const currency = row.currency || 'Unknown';
      totals.set(currency, (totals.get(currency) || 0) + Number(row.amountMinor || 0));
    }
    return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [finance]);

  const paymentCount = useMemo(
    () => (finance?.revenueBySource || []).reduce((count, row) => count + Number(row.paymentCount || 0), 0),
    [finance],
  );
  const cryptoPending = payoutTotals(finance?.creatorPayouts || [], usdStatuses);
  const afterDarkPending = payoutTotals(finance?.afterDarkWithdrawals || [], afterDarkPendingStatuses);

  const exportReport = () => {
    if (!finance) return;
    const rows = [
      [t('adminUiSection'), t('adminUiDate'), t('adminUiSourceOrStatus'), t('adminUiCurrency'), t('adminUiAmountMinorUnits'), t('adminUiCount')],
      ...finance.revenueBySource.map((item) => [
        t('adminUiCollectedPayments'), '', item.source, item.currency, item.amountMinor, item.paymentCount,
      ]),
      ...finance.dailyRevenue.map((item) => [
        t('adminUiDailyCollections'), item.date, item.source, item.currency, item.amountMinor, item.paymentCount,
      ]),
      ...finance.creatorPayouts.map((item) => [
        t('adminUiCreatorCryptoPayouts'), '', item.status, 'USD', item.amountMinor, item.requestCount,
      ]),
      ...finance.afterDarkWithdrawals.map((item) => [
        t('adminUiAfterDarkWithdrawals'), '', item.status, 'KES', item.amountMinor, item.requestCount,
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `finance-${period.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    setIsExportingPdf(true);
    try {
      const blob = await adminService.downloadReport('financial');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `financial-ledger-${new Date().toISOString().slice(0, 7)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setIsExportingPdf(false);
    }
  };

  const activeSubscriptions = Number(finance?.activeMainSubscriptions || 0)
    + Number(finance?.activeAfterDarkSubscriptions || 0);

  return (
    <main className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-black p-2 font-mono text-zinc-300 sm:p-3 lg:p-4">
      <div className="w-full space-y-4">
        <header className="flex flex-col justify-between gap-5 border-b-2 border-zinc-800 pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-green-400">
              <Activity className="h-4 w-4" /> {t('adminUiFinanceLiveLedger')}
            </p>
            <h1 className="text-2xl font-black uppercase tracking-widest text-white sm:text-3xl">{t('adminUiPlatformFinance')}</h1>
            <p className="mt-2 max-w-3xl text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
              {t('adminUiFinanceDescription')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center border-2 border-zinc-800 bg-zinc-950 p-1" aria-label={t('adminUiSelectReportingPeriod')}>
              {periods.map((option) => (
                <button
                  type="button"
                  key={option}
                  aria-pressed={period === option}
                  onClick={() => setPeriod(option)}
                  className={`px-3 py-2 text-[9px] font-black tracking-widest ${period === option ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}
                >
                  {option}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setRefreshKey((key) => key + 1)}
              disabled={isLoading}
              className="flex items-center gap-2 border-2 border-zinc-700 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:border-white disabled:opacity-50"
            >
              <RefreshCcw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> {t('adminUiRefresh')}
            </button>
            <button
              type="button"
              onClick={exportReport}
              disabled={!finance || isLoading}
              className="flex items-center gap-2 border-2 border-white bg-white px-4 py-2 text-[9px] font-black uppercase tracking-widest text-black hover:bg-zinc-200 disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> {t('adminUiExportCsv')}
            </button>
            <button
              type="button"
              onClick={exportPdf}
              disabled={isExportingPdf}
              className="flex items-center gap-2 border-2 border-emerald-700 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-emerald-200 hover:border-emerald-400 disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> {isExportingPdf ? t('adminUiGeneratingPdf') : t('adminUiExportMonthlyPdf')}
            </button>
          </div>
        </header>

        {loadError && (
          <section role="alert" className="border-2 border-red-900 bg-red-950/30 p-4 text-xs text-red-300">
            <p>{loadError}</p>
            <button type="button" className="mt-3 text-[10px] font-black uppercase underline" onClick={() => setRefreshKey((key) => key + 1)}>
              {t('adminUiRetry')}
            </button>
          </section>
        )}

        {isLoading && !finance ? (
          <p role="status" className="border-2 border-zinc-800 p-8 text-center text-xs text-zinc-500">{t('adminUiLoadingFinanceRecords')}</p>
        ) : !finance ? (
          <p className="border-2 border-dashed border-zinc-800 p-8 text-center text-xs text-zinc-500">{t('adminUiFinanceUnavailable')}</p>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <article className="border-2 border-zinc-800 bg-zinc-950 p-5">
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{t('adminUiConfirmedCheckouts')} · {finance.period}</p>
                <p className="mt-3 text-3xl font-black text-white">{paymentCount.toLocaleString()}</p>
                <p className="mt-2 text-[9px] uppercase tracking-widest text-zinc-600">{t('adminUiMainAndAfterDarkPayments')}</p>
              </article>
              <article className="border-2 border-zinc-800 bg-zinc-950 p-5">
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{t('adminUiActiveSubscriptions')}</p>
                <p className="mt-3 text-3xl font-black text-white">{activeSubscriptions.toLocaleString()}</p>
                <p className="mt-2 text-[9px] uppercase tracking-widest text-zinc-600">
                  {t('adminUiMainApp')} {Number(finance.activeMainSubscriptions).toLocaleString()} · {t('adminUiAfterDark')} {Number(finance.activeAfterDarkSubscriptions).toLocaleString()}
                </p>
              </article>
              <article className="border-2 border-zinc-800 bg-zinc-950 p-5">
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{t('adminUiCreatorPayoutsReserved')}</p>
                <p className="mt-3 text-2xl font-black text-amber-300">{formatMoney('USD', cryptoPending.amountMinor)}</p>
                <p className="mt-2 text-[9px] uppercase tracking-widest text-zinc-600">{t('adminUiPendingOrApprovedRequests', { count: cryptoPending.count })}</p>
              </article>
              <article className="border-2 border-zinc-800 bg-zinc-950 p-5">
                <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-zinc-500">
                  <Wallet className="h-3 w-3" /> {t('adminUiAfterDarkWithdrawalsInProgress')}
                </p>
                <p className="mt-3 text-2xl font-black text-amber-300">{formatMoney('KES', afterDarkPending.amountMinor)}</p>
                <p className="mt-2 text-[9px] uppercase tracking-widest text-zinc-600">{t('adminUiActiveWithdrawalRequests', { count: afterDarkPending.count })}</p>
              </article>
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.1fr_1.9fr]">
              <div className="border-2 border-zinc-800 bg-zinc-950">
                <header className="border-b-2 border-zinc-800 bg-black p-4">
                  <h2 className="text-xs font-black uppercase tracking-widest text-white">{t('adminUiConfirmedCollectionsBySource')}</h2>
                  <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-600">{t('adminUiNoCrossCurrencyTotals')}</p>
                </header>
                {finance.revenueBySource.length === 0 ? (
                  <p className="p-6 text-center text-[10px] uppercase tracking-widest text-zinc-600">{t('adminUiNoConfirmedPayments')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-full text-left text-[10px]">
                      <thead className="text-[9px] uppercase tracking-widest text-zinc-500">
                        <tr><th className="p-3">{t('adminUiSource')}</th><th className="p-3">{t('adminUiCurrency')}</th><th className="p-3 text-right">{t('adminUiCollected')}</th><th className="p-3 text-right">{t('adminUiPayments')}</th></tr>
                      </thead>
                      <tbody>
                        {finance.revenueBySource.map((row) => (
                          <tr key={`${row.source}-${row.currency}`} className="border-t border-zinc-800">
                            <td className="p-3 font-bold text-white">{String(row.source).replaceAll('_', ' ')}</td>
                            <td className="p-3 text-zinc-400">{row.currency}</td>
                            <td className="p-3 text-right font-black text-green-300">{formatMoney(row.currency, row.amountMinor)}</td>
                            <td className="p-3 text-right text-zinc-400">{Number(row.paymentCount).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {collectionTotals.length > 1 && (
                  <p className="border-t border-zinc-800 p-3 text-[9px] uppercase tracking-widest text-zinc-600">
                    {t('adminUiCollectionsSplit', { currencies: collectionTotals.map(([currency]) => currency).join(', ') })}
                  </p>
                )}
              </div>

              <div className="border-2 border-zinc-800 bg-zinc-950">
                <header className="flex items-center justify-between border-b-2 border-zinc-800 bg-black p-4">
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-widest text-white">{t('adminUiDailyConfirmedPayments')}</h2>
                    <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-600">{t('adminUiSettlementDate')} · {finance.period}</p>
                  </div>
                  <CalendarDays className="h-4 w-4 text-zinc-500" />
                </header>
                <div className="max-h-[60dvh] overflow-auto">
                  {finance.dailyRevenue.length === 0 ? (
                    <p className="p-6 text-center text-[10px] uppercase tracking-widest text-zinc-600">{t('adminUiNoConfirmedPayments')}</p>
                  ) : (
                    <table className="w-full min-w-full text-left text-[10px]">
                      <thead className="sticky top-0 bg-zinc-950 text-[9px] uppercase tracking-widest text-zinc-500">
                        <tr><th className="p-3">{t('adminUiDate')}</th><th className="p-3">{t('adminUiSource')}</th><th className="p-3">{t('adminUiCurrency')}</th><th className="p-3 text-right">{t('adminUiAmount')}</th><th className="p-3 text-right">{t('adminUiCount')}</th></tr>
                      </thead>
                      <tbody>
                        {finance.dailyRevenue.map((row) => (
                          <tr key={`${row.date}-${row.source}-${row.currency}`} className="border-t border-zinc-800">
                            <td className="p-3 text-zinc-400">{row.date}</td>
                            <td className="p-3 font-bold text-white">{String(row.source).replaceAll('_', ' ')}</td>
                            <td className="p-3 text-zinc-400">{row.currency}</td>
                            <td className="p-3 text-right font-black text-green-300">{formatMoney(row.currency, row.amountMinor)}</td>
                            <td className="p-3 text-right text-zinc-400">{Number(row.paymentCount).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              {[
                { title: t('adminUiCreatorCryptoPayoutRequestsUsd'), rows: finance.creatorPayouts, currency: 'USD' },
                { title: t('adminUiAfterDarkWithdrawalsKes'), rows: finance.afterDarkWithdrawals, currency: 'KES' },
              ].map((group) => (
                <div key={group.title} className="border-2 border-zinc-800 bg-zinc-950">
                  <header className="border-b-2 border-zinc-800 bg-black p-4">
                    <h2 className="text-xs font-black uppercase tracking-widest text-white">{group.title}</h2>
                  </header>
                  {group.rows.length === 0 ? (
                    <p className="p-5 text-center text-[10px] uppercase tracking-widest text-zinc-600">{t('adminUiNoPayoutRequests')}</p>
                  ) : (
                    <div className="divide-y divide-zinc-800">
                      {group.rows.map((row) => (
                        <div key={row.status} className="flex items-center justify-between gap-4 p-4">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-white">{row.status}</p>
                            <p className="mt-1 text-[9px] text-zinc-500">{t('adminUiRequestCount', { count: Number(row.requestCount).toLocaleString() })}</p>
                          </div>
                          <p className="text-sm font-black text-zinc-200">{formatMoney(group.currency, row.amountMinor)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </section>

            <footer className="border-t-2 border-zinc-800 pt-4 text-[9px] uppercase tracking-widest text-zinc-600">
              <p>{t('adminUiGenerated')} {finance.generatedAt ? new Date(finance.generatedAt).toLocaleString() : t('adminUiJustNow')} · {t('adminUiConfirmedCheckoutsOnly')}</p>
              <p className="mt-2">{t('adminUiFinanceMetricsUnavailable')}</p>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
