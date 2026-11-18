import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CreditCard, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { billingService } from '../../api/billing.service';
import { useAppDialogs } from '../../components/modals/useAppDialogs';

export default function PaymentMethods() {
  const navigate = useNavigate();
  const { confirm } = useAppDialogs();
  const [methods, setMethods] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [removingId, setRemovingId] = useState('');

  const loadMethods = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await billingService.getPaymentMethods();
      const savedMethods = response?.methods;
      if (!Array.isArray(savedMethods)) {
        throw new Error('The payment-method service returned invalid data.');
      }
      setMethods(savedMethods);
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load payment methods.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMethods();
  }, [loadMethods]);

  const removeMethod = async method => {
    if (!await confirm(`Remove this ${method.provider} card ending in ${method.last4}?`, {
      title: 'Remove payment method',
      confirmLabel: 'Remove',
      tone: 'danger',
    })) return;
    setRemovingId(method.id);
    try {
      await billingService.removePaymentMethod(method.id);
      setMethods(current => current.filter(item => item.id !== method.id));
      toast.success('Payment method removed from your provider account.');
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not remove payment method.'));
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
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <header className="flex items-start justify-between gap-4 border-b-2 border-zinc-800 pb-5">
          <div>
            <h1 className="text-xl font-black uppercase tracking-widest">Payment methods</h1>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-zinc-500">
              Manage reusable cards saved with Stripe or Paystack at Chattie and After Dark checkout. Card details stay with the payment provider; Chattie stores only provider tokens and masked card details.
            </p>
          </div>
          <button
            type="button"
            onClick={loadMethods}
            disabled={isLoading}
            aria-label="Refresh payment methods"
            className="border-2 border-zinc-800 p-2 text-zinc-400 hover:border-white hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </header>

        {isLoading ? (
          <div className="flex items-center gap-3 border-2 border-zinc-800 p-5 text-xs font-bold uppercase tracking-widest text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading payment methods…
          </div>
        ) : methods.length > 0 ? (
          <section aria-label="Saved cards" className="space-y-3">
            {methods.map(method => (
              <article key={method.id} className="flex flex-col gap-4 border-2 border-zinc-800 bg-zinc-950 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <CreditCard className="h-5 w-5 shrink-0 text-zinc-400" />
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-widest">
                      {(method.card_brand || 'Card').toUpperCase()} •••• {method.last4}
                    </p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      {method.provider} {method.exp_month && method.exp_year ? `· Expires ${String(method.exp_month).padStart(2, '0')}/${method.exp_year}` : ''}
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
                  Remove
                </button>
              </article>
            ))}
          </section>
        ) : (
          <div className="border-2 border-dashed border-zinc-800 p-6 text-center">
            <CreditCard className="mx-auto h-7 w-7 text-zinc-600" />
            <h2 className="mt-3 text-xs font-black uppercase tracking-widest">No saved cards</h2>
            <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-zinc-500">
              A card is saved after a successful Stripe or Paystack card payment. M-Pesa and other mobile-money payments cannot be saved as cards.
            </p>
          </div>
        )}

        <section className="flex flex-col gap-4 border-2 border-zinc-800 bg-zinc-950 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest">Add a card</h2>
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">Choose Stripe or Paystack at checkout. The card is saved only after a successful payment.</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/upgrade')}
            className="inline-flex shrink-0 items-center justify-center gap-2 border-2 border-white bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-zinc-200"
          >
            <Plus className="h-4 w-4" /> Continue to checkout
          </button>
        </section>
      </div>
    </main>
  );
}
