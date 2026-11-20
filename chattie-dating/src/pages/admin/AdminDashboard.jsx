import React, { useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, Database, MessageSquare, RefreshCcw,
  ShieldAlert, Users, UserCheck, Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { adminService } from '../../api/admin.service';
import { useI18n } from '../../i18n';

const getErrorMessage = (error, t) => error?.response?.data?.error
  || (typeof error?.response?.data === 'string' ? error.response.data.trim() : '')
  || (error instanceof Error && error.message === t('adminDashInvalidResponse')
    ? error.message
    : t('adminDashError'));

const MetricCard = ({ label, value, detail, icon: Icon, tone = 'text-zinc-300' }) => (
  <article className="border-2 border-zinc-800 bg-zinc-950 p-5">
    <div className="mb-4 flex items-start justify-between gap-3">
      <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{label}</span>
      <Icon className={`h-4 w-4 ${tone}`} />
    </div>
    <p className="text-2xl font-black text-white">{Number(value || 0).toLocaleString()}</p>
    <p className="mt-2 text-[9px] font-bold uppercase tracking-widest text-zinc-600">{detail}</p>
  </article>
);

export default function AdminDashboard() {
  const { t, locale } = useI18n();
  const [telemetry, setTelemetry] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError('');
    adminService.getDashboardTelemetry()
      .then((response) => {
        if (!response || !Array.isArray(response.recentActivity)) {
          throw new Error(t('adminDashInvalidResponse'));
        }
        if (active) setTelemetry(response);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(getErrorMessage(error, t));
        setTelemetry(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [refreshKey, t]);

  return (
    <main className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-black p-2 font-mono text-zinc-300 sm:p-3 lg:p-4">
      <div className="w-full space-y-4">
        <header className="flex flex-col justify-between gap-4 border-b-2 border-zinc-800 pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-red-400">
              <ShieldAlert className="h-4 w-4" /> {t('adminDashCommandCenter')}
            </p>
            <h1 className="text-2xl font-black uppercase tracking-widest text-white sm:text-3xl">{t('adminDashPlatformOverview')}</h1>
            <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              {t('adminDashOperationalSummary')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {telemetry && (
              <span className="text-[9px] uppercase tracking-widest text-zinc-600">
                {t('adminDashUpdated', { time: new Date(telemetry.generatedAt).toLocaleTimeString(locale) })}
              </span>
            )}
            <button
              type="button"
              onClick={() => setRefreshKey((key) => key + 1)}
              disabled={isLoading}
              className="flex items-center gap-2 border-2 border-zinc-700 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:border-white disabled:opacity-50"
            >
              <RefreshCcw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> {t('adminDashRefresh')}
            </button>
          </div>
        </header>

        {loadError && (
          <section role="alert" className="flex flex-wrap items-center justify-between gap-4 border-2 border-red-900 bg-red-950/30 p-4 text-xs text-red-300">
            <span>{loadError}</span>
            <button type="button" className="text-[10px] font-black uppercase underline" onClick={() => setRefreshKey((key) => key + 1)}>
              {t('adminDashRetry')}
            </button>
          </section>
        )}

        {isLoading && !telemetry ? (
          <p role="status" className="border-2 border-zinc-800 p-8 text-center text-xs text-zinc-500">{t('adminDashLoading')}</p>
        ) : !telemetry ? (
          <p className="border-2 border-dashed border-zinc-800 p-8 text-center text-xs text-zinc-500">{t('adminDashUnavailable')}</p>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label={t('adminDashRegisteredClients')} value={telemetry.totalUsers} detail={t('adminDashClientAccounts')} icon={Users} tone="text-cyan-400" />
              <MetricCard label={t('adminDashRecentlyActive')} value={telemetry.activeUsers24h} detail={t('adminDashSignedIn24h')} icon={Activity} tone="text-green-400" />
              <MetricCard label={t('adminDashOnlineCreators')} value={telemetry.onlineCreators} detail={t('adminDashCreatorAccounts', { count: Number(telemetry.totalCreators || 0).toLocaleString(locale) })} icon={UserCheck} tone="text-purple-400" />
              <MetricCard label={t('adminDashOpenReports')} value={telemetry.pendingReports} detail={t('adminDashAwaitingModeration')} icon={AlertTriangle} tone="text-amber-400" />
              <MetricCard label={t('adminDashOpenTextRooms')} value={telemetry.openTextRooms} detail={t('adminDashRoomsActive')} icon={MessageSquare} tone="text-blue-400" />
              <MetricCard label={t('adminDashActiveVoiceSpaces')} value={telemetry.activeVoiceRooms} detail={t('adminDashVoiceSessions')} icon={Activity} tone="text-yellow-400" />
              <MetricCard label={t('adminDashPaidCheckouts')} value={telemetry.paidCheckouts24h} detail={t('adminDashConfirmed24h')} icon={Wallet} tone="text-green-400" />
              <article className="border-2 border-zinc-800 bg-zinc-950 p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{t('adminDashDataStore')}</span>
                  <Database className={`h-4 w-4 ${telemetry.databaseHealthy ? 'text-green-400' : 'text-red-400'}`} />
                </div>
                <p className={`text-lg font-black uppercase ${telemetry.databaseHealthy ? 'text-green-400' : 'text-red-400'}`}>
                  {telemetry.databaseHealthy ? t('adminDashConnected') : t('adminDashUnavailableState')}
                </p>
                <p className="mt-2 text-[9px] font-bold uppercase tracking-widest text-zinc-600">{t('adminDashQueriesOk')}</p>
              </article>
            </section>

            <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
              <div className="border-2 border-zinc-800 bg-zinc-950">
                <header className="flex items-center justify-between border-b-2 border-zinc-800 bg-black p-4">
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-widest text-white">{t('adminDashRecentActivity')}</h2>
                    <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-600">{t('adminDashAuditEvents')}</p>
                  </div>
                  <Activity className="h-4 w-4 text-yellow-400" />
                </header>
                {telemetry.recentActivity.length === 0 ? (
                  <p className="p-8 text-center text-[10px] uppercase tracking-widest text-zinc-600">{t('adminDashNoAuditActivity')}</p>
                ) : (
                  <div className="max-h-[60dvh] divide-y divide-zinc-800 overflow-y-auto">
                    {telemetry.recentActivity.map((event) => (
                      <article key={event.id} className="flex flex-col justify-between gap-2 p-4 sm:flex-row sm:items-center">
                        <div className="flex items-start gap-3">
                          <span className={`mt-0.5 border px-2 py-1 text-[8px] font-black uppercase tracking-widest ${event.type === 'ADMIN' ? 'border-red-900 text-red-300' : 'border-zinc-700 text-zinc-400'}`}>
                            {event.type}
                          </span>
                          <p className="text-[10px] font-bold uppercase leading-relaxed text-zinc-300">{event.description}</p>
                        </div>
                        <time className="shrink-0 text-[9px] text-zinc-600">{new Date(event.createdAt).toLocaleString(locale)}</time>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <aside className="space-y-4">
                <div className="border-2 border-zinc-800 bg-zinc-950 p-5">
                  <h2 className="text-xs font-black uppercase tracking-widest text-white">{t('adminDashFollowUp')}</h2>
                  <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">{t('adminDashFollowUpDescription')}</p>
                  <Link to="/admin/moderation" className="mt-4 inline-flex border-2 border-zinc-700 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:border-white">
                    {t('adminDashOpenModeration')}
                  </Link>
                </div>
                <div className="border-2 border-zinc-800 bg-zinc-950 p-5">
                  <h2 className="text-xs font-black uppercase tracking-widest text-white">{t('adminDashFinancePayouts')}</h2>
                  <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">{t('adminDashFinancePayoutDescription')}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link to="/admin/finance" className="border-2 border-zinc-700 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:border-white">{t('adminDashFinance')}</Link>
                    <Link to="/admin/creator-payouts" className="border-2 border-zinc-700 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:border-white">{t('adminDashCreatorPayouts')}</Link>
                  </div>
                </div>
              </aside>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
