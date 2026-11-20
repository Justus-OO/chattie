import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart2,
  Bell,
  DollarSign,
  Loader2,
  MessageSquare,
  Power,
  Server,
  TrendingUp,
  Users,
  Video,
} from 'lucide-react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import { creatorService } from '../../api/creator.service';
import { useI18n } from '../../i18n';

const formatMoney = (value) => {
  const amount = Number(value ?? 0);
  return `$${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`;
};

export default function ModelDashboard() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { setIsGlobalOnline } = useOutletContext();
  const dashboardErrorMessage = t('syncDashboardFailed');
  const financialErrorMessage = t('financialDataFailed');
  const [metrics, setMetrics] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(false);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const isOnline = metrics?.is_online === true;
  const weeklyEarnings = metrics?.weekly_earnings || [];
  const maxWeeklyEarning = Math.max(0, ...weeklyEarnings.map((day) => Number(day.amount) || 0));

  useEffect(() => {
    let active = true;
    let hasLoaded = false;

    const fetchDashboardData = async () => {
      const [statsResult, ledgerResult] = await Promise.allSettled([
        creatorService.getDashboardStats(),
        creatorService.getLedger(),
      ]);
      if (!active) return;

      if (statsResult.status === 'fulfilled') {
        setMetrics(statsResult.value);
        setIsGlobalOnline(statsResult.value.is_online === true);
        setDashboardError(false);
      } else {
        console.error('Failed to load creator dashboard metrics:', statsResult.reason);
        if (!hasLoaded) {
          setDashboardError(true);
          toast.error(dashboardErrorMessage);
        }
      }

      if (ledgerResult.status === 'fulfilled') {
        setTransactions(Array.isArray(ledgerResult.value) ? ledgerResult.value : []);
      } else {
        console.error('Failed to load creator dashboard activity:', ledgerResult.reason);
        if (!hasLoaded) toast.error(financialErrorMessage);
      }

      hasLoaded = true;
      setIsLoading(false);
    };

    void fetchDashboardData();
    const interval = setInterval(() => void fetchDashboardData(), 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [dashboardErrorMessage, financialErrorMessage, setIsGlobalOnline]);

  const handleStatusToggle = async () => {
    if (!metrics || isSavingStatus) return;

    setIsSavingStatus(true);
    try {
      const result = await creatorService.toggleOnlineStatus(!isOnline);
      setMetrics((current) => ({ ...current, is_online: result.is_online }));
      setIsGlobalOnline(result.is_online === true);
    } catch (error) {
      console.error('Failed to update creator availability:', error);
      toast.error(t('syncDashboardFailed'));
    } finally {
      setIsSavingStatus(false);
    }
  };

  const metricValue = (value) => (isLoading ? '...' : dashboardError && !metrics ? '—' : value);

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-none bg-black font-mono text-zinc-300 md:flex-row" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto border-r-2 border-zinc-800 p-2 custom-scrollbar sm:p-3 lg:p-4">
        <header className="flex flex-col items-start justify-between gap-4 border-b-2 border-zinc-800 pb-4 md:flex-row md:items-end">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-black uppercase tracking-widest text-white md:text-4xl">
              <Video className={`h-8 w-8 ${isOnline ? 'text-red-500' : 'text-zinc-600'}`} />
              {t('creatorDashboard')}
            </h1>
            <div className="mt-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              <span className={`h-2 w-2 ${isOnline ? 'bg-green-500' : 'bg-zinc-600'}`} />
              {isLoading ? '...' : isOnline ? t('online') : t('offline')}
            </div>
          </div>
          <button
            type="button"
            onClick={handleStatusToggle}
            disabled={isLoading || !metrics || isSavingStatus}
            className={`flex items-center gap-2 border-2 px-6 py-3 font-black uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isOnline
                ? 'border-red-500 bg-black text-red-500 hover:bg-red-500 hover:text-black'
                : 'border-green-500 bg-black text-green-500 hover:bg-green-500 hover:text-black'
            }`}
          >
            {isSavingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
            {isOnline ? t('goOffline') : t('goOnline')}
          </button>
        </header>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" aria-label={t('creatorDashboard')}>
          <MetricCard title={t('earnings24h')} value={metricValue(formatMoney(metrics?.earnings_24h))} icon={<TrendingUp />} color="text-green-400" />
          <MetricCard title={t('currentBalance')} value={metricValue(formatMoney(metrics?.balance))} icon={<DollarSign />} color="text-blue-400" />
          <MetricCard title={t('pendingChats')} value={metricValue(metrics?.pending_reqs ?? 0)} icon={<MessageSquare />} color="text-yellow-400" alert={(metrics?.pending_reqs || 0) > 10} />
          <MetricCard title={t('totalEarned')} value={metricValue(formatMoney(metrics?.total_earned))} icon={<Activity />} color="text-white" />
          <MetricCard title={t('activePrivateChats')} value={metricValue(metrics?.active_chats ?? 0)} icon={<Users />} color="text-green-400" />
          <MetricCard title={t('managedProfiles')} value={metricValue(metrics?.managed_profiles ?? 0)} icon={<Server />} color="text-zinc-400" />
        </section>

        {dashboardError && (
          <div role="alert" className="border-2 border-red-500/50 bg-red-500/10 p-3 text-xs font-bold text-red-400">
            {t('syncDashboardFailed')}
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="flex min-h-[clamp(15rem,38vh,22rem)] flex-col border-2 border-zinc-800 bg-zinc-950 p-4 md:p-6">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white">
                <BarChart2 className="h-4 w-4" /> {t('weeklyEarnings')}
              </h2>
              <span className="bg-white px-2 py-1 text-[9px] font-bold uppercase text-black">USD</span>
            </div>
            <div className="flex flex-1 items-end justify-between gap-2 border-b border-zinc-800 pb-2">
              {weeklyEarnings.map((day, index) => {
                const amount = Number(day.amount) || 0;
                const height = maxWeeklyEarning > 0 ? Math.max(3, (amount / maxWeeklyEarning) * 100) : 0;
                return (
                  <div key={`${day.day}-${index}`} className="flex h-[clamp(8rem,24vh,12rem)] min-w-0 flex-1 flex-col items-center justify-end gap-2" title={`${day.day}: ${formatMoney(amount)}`}>
                    <div className="flex w-full items-end" style={{ height: '100%' }}>
                      <div
                        className="w-full border-t-2 border-zinc-500 bg-zinc-800 transition-colors hover:bg-white"
                        style={{ height: `${height}%` }}
                      />
                    </div>
                    <span className="text-[9px] font-bold uppercase text-zinc-500">{day.day}</span>
                  </div>
                );
              })}
              {isLoading && weeklyEarnings.length === 0 && (
                <div className="flex h-[clamp(8rem,24vh,12rem)] w-full items-center justify-center text-zinc-600">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-[clamp(15rem,38vh,22rem)] flex-col border-2 border-zinc-800 bg-zinc-950">
            <div className="flex items-center justify-between border-b-2 border-zinc-800 p-4">
              <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white">
                <Bell className="h-4 w-4" /> {t('activity')}
              </h2>
              <button
                type="button"
                onClick={() => navigate('/model/earnings')}
                className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-zinc-400 hover:text-white"
              >
                {t('financialLedger')} <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
            <div className="flex-1 divide-y divide-zinc-800">
              {transactions.slice(0, 7).map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-black uppercase text-white">{transaction.type}</p>
                    <p className="mt-1 truncate text-[9px] font-bold uppercase text-zinc-500">
                      {[transaction.user, transaction.date, transaction.time].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-xs font-black ${Number(transaction.amount) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatMoney(transaction.amount)}
                    </p>
                    <p className="mt-1 text-[9px] font-bold uppercase text-zinc-500">{transaction.status}</p>
                  </div>
                </div>
              ))}
              {!isLoading && transactions.length === 0 && (
                <p className="p-4 text-xs font-bold text-zinc-500">{t('noRecentTransactions')}</p>
              )}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DashboardAction
            title={t('activePrivateChats')}
            subtitle={`${metrics?.active_chats ?? 0}`}
            icon={<MessageSquare />}
            onClick={() => navigate('/model/queue')}
          />
          <DashboardAction
            title={t('financialLedger')}
            subtitle={t('earningsTipsPayouts')}
            icon={<DollarSign />}
            onClick={() => navigate('/model/earnings')}
          />
        </section>
      </main>
    </div>
  );
}

function MetricCard({ title, value, icon, color, alert = false }) {
  return (
    <div className={`relative overflow-hidden border-2 p-4 transition-colors ${alert ? 'border-red-500/50 bg-red-500/10' : 'border-zinc-800 bg-zinc-950 hover:border-white'}`}>
      <div className="mb-3 flex items-start justify-between">
        <h3 className="relative z-10 text-[9px] font-bold uppercase tracking-widest text-zinc-500">{title}</h3>
        <div className={`relative z-10 ${color}`}>{icon}</div>
      </div>
      <div className={`relative z-10 text-xl font-black tracking-tighter md:text-2xl ${alert ? 'text-red-500' : 'text-white'}`}>
        {value}
      </div>
      {alert && <div className="pointer-events-none absolute inset-0 animate-pulse bg-red-500/5" />}
    </div>
  );
}

function DashboardAction({ title, subtitle, icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 border-2 border-zinc-800 bg-zinc-950 p-4 text-left transition-colors hover:border-white hover:bg-zinc-900"
    >
      <span className="border-2 border-zinc-800 p-2 text-zinc-400 transition-colors group-hover:border-white group-hover:text-white">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[10px] font-black uppercase tracking-widest text-white">{title}</span>
        <span className="mt-1 block truncate text-[9px] font-bold uppercase text-zinc-500">{subtitle}</span>
      </span>
      <ArrowUpRight className="ml-auto h-4 w-4 shrink-0 text-zinc-600 group-hover:text-white" />
    </button>
  );
}
