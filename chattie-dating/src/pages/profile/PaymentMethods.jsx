import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CreditCard, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { billingService } from '../../api/billing.service';
import { useAppDialogs } from '../../components/modals/useAppDialogs';
import { useI18n } from '../../i18n';

export default function PaymentMethods() {
  const navigate = useNavigate();
  const { confirm } = useAppDialogs();
  const { t } = useI18n();
  const [methods, setMethods] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [removingId, setRemovingId] = useState('');

  const loadMethods = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await billingService.getPaymentMethods();
      const savedMethods = response?.methods;
      if (!Array.isArray(savedMethods)) {
        throw new Error(t('paymentMethodsInvalidData'));
      }
      setMethods(savedMethods);
    } catch (error) {
      toast.error(error?.response?.data?.error || t('paymentMethodsLoadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadMethods();
  }, [loadMethods]);

  const removeMethod = async method => {
    if (!await confirm(t('paymentMethodsRemoveConfirm', { provider: method.provider, last4: method.last4 }), {
      title: t('paymentMethodsRemoveTitle'),
      confirmLabel: t('paymentMethodsRemove'),
      tone: 'danger',
    })) return;
    setRemovingId(method.id);
    try {
      await billingService.removePaymentMethod(method.id);
      setMethods(current => current.filter(item => item.id !== method.id));
      toast.success(t('paymentMethodsRemoved'));
    } catch (error) {
      toast.error(error?.response?.data?.error || t('paymentMethodsRemoveFailed'));
    } finally {
      setRemovingId('');
    }
  };

  return (
    <main className="h-full min-h-0 min-w-0 w-full overflow-y-auto bg-black px-2 py-4 text-white sm:px-4 lg:px-5">
      <div className="w-full space-y-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> {t('paymentMethodsBack')}
        </button>

        <header className="flex items-start justify-between gap-4 border-b-2 border-zinc-800 pb-5">
          <div>
            <h1 className="text-xl font-black uppercase tracking-widest">{t('paymentMethodsTitle')}</h1>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-zinc-500">
              {t('paymentMethodsDescription')}
            </p>
          </div>
          <button
            type="button"
            onClick={loadMethods}
            disabled={isLoading}
            aria-label={t('paymentMethodsRefresh')}
            className="border-2 border-zinc-800 p-2 text-zinc-400 hover:border-white hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </header>

        {isLoading ? (
          <div className="flex items-center gap-3 border-2 border-zinc-800 p-5 text-xs font-bold uppercase tracking-widest text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('paymentMethodsLoading')}
          </div>
        ) : methods.length > 0 ? (
          <section aria-label={t('paymentMethodsSavedCards')} className="space-y-3">
            {methods.map(method => (
              <article key={method.id} className="flex flex-col gap-4 border-2 border-zinc-800 bg-zinc-950 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <CreditCard className="h-5 w-5 shrink-0 text-zinc-400" />
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-widest">
                      {(method.card_brand || t('paymentMethodsCard')).toUpperCase()} •••• {method.last4}
                    </p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      {method.provider} {method.exp_month && method.exp_year ? `· ${t('paymentMethodsExpires')} ${String(method.exp_month).padStart(2, '0')}/${method.exp_year}` : ''}
                      {method.bank_name ? ` · ${method.bank_name}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={removingId === method.id}
                  onClick={() => removeMethod(method)}
                  className="inline-flex items-center justify-center gap-2 border-2 border-red-900 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-red-400 hover:border-red-500 hover:bg-red-950 disabled:opacity-50"
                >
                  {removingId === method.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  {t('paymentMethodsRemove')}
                </button>
              </article>
            ))}
          </section>
        ) : (
          <div className="border-2 border-dashed border-zinc-800 p-6 text-center">
            <CreditCard className="mx-auto h-7 w-7 text-zinc-600" />
            <h2 className="mt-3 text-xs font-black uppercase tracking-widest">{t('paymentMethodsEmptyTitle')}</h2>
            <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-zinc-500">
              {t('paymentMethodsEmptyDescription')}
            </p>
          </div>
        )}

        <section className="flex flex-col gap-4 border-2 border-zinc-800 bg-zinc-950 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest">{t('paymentMethodsAddCard')}</h2>
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">{t('paymentMethodsAddDescription')}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/upgrade')}
            className="inline-flex shrink-0 items-center justify-center gap-2 border-2 border-white bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-zinc-200"
          >
            <Plus className="h-4 w-4" /> {t('paymentMethodsContinueCheckout')}
          </button>
        </section>
      </div>
    </main>
  );
}
