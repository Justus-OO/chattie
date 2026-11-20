import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, Clock3, Copy, Loader2, RefreshCw, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import { adminService } from '../../api/admin.service';

const STATUSES = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'PAID'];
const CRYPTO_AMOUNT_PATTERN = /^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,12})?$/;

function isValidTransactionHash(network, value) {
  return network === 'USDT-ERC20'
    ? /^0x[a-fA-F0-9]{64}$/.test(value)
    : /^[a-fA-F0-9]{64}$/.test(value);
}

export default function AdminCreatorPayouts() {
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [isLoading, setIsLoading] = useState(true);
  const [activeReview, setActiveReview] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [cryptoAmount, setCryptoAmount] = useState('');
  const [transactionHash, setTransactionHash] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadRequests = useCallback(async () => {
    const data = await adminService.getCreatorPayoutRequests('ALL');
    setRequests(data || []);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    loadRequests()
      .catch((error) => {
        console.error('Failed to load creator payout requests:', error);
        toast.error(error.response?.data?.error || 'Unable to load creator payout requests.');
      })
      .finally(() => setIsLoading(false));
  }, [loadRequests]);

  const counts = useMemo(() => requests.reduce((result, request) => {
    result[request.status] = (result[request.status] || 0) + 1;
    return result;
  }, {}), [requests]);
  const visibleRequests = statusFilter === 'ALL'
    ? requests
    : requests.filter((request) => request.status === statusFilter);

  const beginReview = (request, action) => {
    setActiveReview({ request, action });
    setRejectionReason('');
    setCryptoAmount('');
    setTransactionHash('');
  };

  const closeReview = () => {
    if (isSubmitting) return;
    setActiveReview(null);
  };

  const submitReview = async () => {
    if (!activeReview) return;
    const { request, action } = activeReview;
    setIsSubmitting(true);
    try {
      await adminService.reviewCreatorPayout(request.id, {
        action,
        reason: rejectionReason.trim(),
        crypto_amount: cryptoAmount.trim(),
        transaction_hash: transactionHash.trim()
      });
      toast.success(`Creator payout ${action.toLowerCase()} action completed.`);
      setActiveReview(null);
      try {
        await loadRequests();
      } catch (refreshError) {
        console.error('Payout action succeeded but the list refresh failed:', refreshError);
        toast.error('Action completed, but the payout list could not be refreshed.');
      }
    } catch (error) {
      console.error(`Failed to ${action.toLowerCase()} creator payout:`, error);
      toast.error(error.response?.data?.error || 'Unable to update creator payout request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyWallet = async (address) => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success('Wallet address copied.');
    } catch (error) {
      console.error('Could not copy payout wallet:', error);
      toast.error('Could not copy wallet address.');
    }
  };

  const reviewIsValid = activeReview?.action === 'APPROVE'
    || (activeReview?.action === 'REJECT' && rejectionReason.trim().length > 0)
    || (activeReview?.action === 'PAID'
      && CRYPTO_AMOUNT_PATTERN.test(cryptoAmount.trim())
      && Number(cryptoAmount) > 0
      && isValidTransactionHash(activeReview.request.asset_network, transactionHash.trim()));

  return (
    <div className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-black p-2 font-mono text-zinc-300 sm:p-3 lg:p-4">
      <header className="mb-8 flex flex-col gap-4 border-b-2 border-zinc-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-black uppercase tracking-widest text-white md:text-3xl">
            <Wallet className="h-7 w-7 text-emerald-400" /> Creator crypto payouts
          </h1>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Review and record USDT payouts for the creator portal. After Dark payouts are managed separately.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadRequests().catch((error) => toast.error(error.response?.data?.error || 'Refresh failed.'))}
          disabled={isLoading}
          className="flex items-center justify-center gap-2 border-2 border-zinc-700 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white hover:border-white disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      <div className="mb-6 flex flex-wrap gap-2">
        {STATUSES.map((status) => (
          <button
            type="button"
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`border-2 px-4 py-2 text-[9px] font-black uppercase tracking-widest ${
              statusFilter === status
                ? 'border-white bg-white text-black'
                : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-500 hover:text-white'
            }`}
          >
            {status} {status !== 'ALL' && <span className="ml-1">{counts[status] || 0}</span>}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto border-2 border-zinc-800 bg-zinc-950">
        <table className="w-full min-w-full border-collapse text-left">
          <thead className="bg-black">
            <tr className="border-b-2 border-zinc-800 text-[9px] font-black uppercase tracking-widest text-zinc-500">
              <th className="p-4">Creator / Requested</th>
              <th className="p-4">Destination</th>
              <th className="p-4">Status</th>
              <th className="p-4">Submission</th>
              <th className="p-4 text-right">Amount (USD)</th>
              <th className="p-4 text-right">Review actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan="6" className="p-12 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></td></tr>
            ) : visibleRequests.length === 0 ? (
              <tr><td colSpan="6" className="p-12 text-center text-[10px] font-bold uppercase tracking-widest text-zinc-500">No payout requests found.</td></tr>
            ) : visibleRequests.map((request) => (
              <tr key={request.id} className="border-b border-zinc-800 align-top last:border-0 hover:bg-black/50">
                <td className="p-4">
                  <div className="text-xs font-black text-white">{request.creator_name || 'Creator'}</div>
                  <div className="mt-1 text-[9px] text-zinc-500">{request.creator_email}</div>
                  <div className="mt-2 font-mono text-[9px] text-zinc-600">{request.id}</div>
                </td>
                <td className="p-4">
                  <div className="text-[10px] font-black text-emerald-300">{request.asset_network}</div>
                  <div className="mt-1 max-w-xs break-all font-mono text-[10px] text-zinc-300">{request.wallet_address}</div>
                  <button
                    type="button"
                    onClick={() => copyWallet(request.wallet_address)}
                    className="mt-2 flex items-center gap-1 text-[9px] font-bold uppercase text-zinc-500 hover:text-white"
                  >
                    <Copy className="h-3 w-3" /> Copy address
                  </button>
                </td>
                <td className="p-4">
                  <span className="inline-flex items-center gap-1 border border-zinc-700 px-2 py-1 text-[9px] font-black uppercase text-zinc-200">
                    {request.status === 'PAID' ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Clock3 className="h-3 w-3 text-amber-400" />}
                    {request.status}
                  </span>
                  {request.rejection_reason && <p className="mt-2 max-w-xs text-[9px] text-red-300">{request.rejection_reason}</p>}
                </td>
                <td className="p-4 text-[10px] text-zinc-400">
                  <div>{new Date(request.created_at).toLocaleString()}</div>
                  {request.crypto_amount && <div className="mt-2 text-emerald-300">{request.crypto_amount} USDT sent</div>}
                  {request.transaction_hash && <div className="mt-1 max-w-xs break-all font-mono text-[9px] text-zinc-500">{request.transaction_hash}</div>}
                </td>
                <td className="p-4 text-right text-sm font-black text-white">${(request.amount_cents / 100).toFixed(2)}</td>
                <td className="p-4 text-right">
                  <div className="flex justify-end gap-2">
                    {request.status === 'PENDING' && (
                      <>
                        <button type="button" onClick={() => beginReview(request, 'APPROVE')} className="flex items-center gap-1 border border-emerald-800 px-2 py-2 text-[9px] font-black uppercase text-emerald-300 hover:bg-emerald-950">
                          <Check className="h-3 w-3" /> Approve
                        </button>
                        <button type="button" onClick={() => beginReview(request, 'REJECT')} className="flex items-center gap-1 border border-red-900 px-2 py-2 text-[9px] font-black uppercase text-red-300 hover:bg-red-950">
                          <X className="h-3 w-3" /> Reject
                        </button>
                      </>
                    )}
                    {request.status === 'APPROVED' && (
                      <>
                        <button type="button" onClick={() => beginReview(request, 'PAID')} className="flex items-center gap-1 border border-emerald-800 px-2 py-2 text-[9px] font-black uppercase text-emerald-300 hover:bg-emerald-950">
                          <CheckCircle2 className="h-3 w-3" /> Mark paid
                        </button>
                        <button type="button" onClick={() => beginReview(request, 'REJECT')} className="flex items-center gap-1 border border-red-900 px-2 py-2 text-[9px] font-black uppercase text-red-300 hover:bg-red-950">
                          <X className="h-3 w-3" /> Reject
                        </button>
                      </>
                    )}
                    {(request.status === 'PAID' || request.status === 'REJECTED') && <span className="text-[9px] uppercase text-zinc-600">Final</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activeReview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <section className="w-full max-w-xl border-2 border-white bg-zinc-950 shadow-[12px_12px_0px_0px_rgba(var(--highlight-rgb), 0.1)]">
            <header className="flex items-center justify-between border-b-2 border-zinc-800 bg-white p-4 text-black">
              <h2 className="text-xs font-black uppercase tracking-widest">{activeReview.action} payout request</h2>
              <button type="button" disabled={isSubmitting} onClick={closeReview} aria-label="Close review dialog">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="space-y-5 p-6">
              <div className="border border-zinc-800 bg-black p-4 text-[10px]">
                <div className="flex justify-between gap-4"><span className="text-zinc-500">Creator</span><span className="text-white">{activeReview.request.creator_name} ({activeReview.request.creator_email})</span></div>
                <div className="mt-2 flex justify-between gap-4"><span className="text-zinc-500">Requested USD</span><span className="font-black text-white">${(activeReview.request.amount_cents / 100).toFixed(2)}</span></div>
                <div className="mt-2 flex justify-between gap-4"><span className="text-zinc-500">Network</span><span className="font-black text-emerald-300">{activeReview.request.asset_network}</span></div>
                <div className="mt-2 break-all"><span className="text-zinc-500">Wallet </span><span className="font-mono text-white">{activeReview.request.wallet_address}</span></div>
              </div>

              {activeReview.action === 'REJECT' && (
                <>
                  <p className="text-[10px] leading-relaxed text-amber-200">Rejecting releases the reserved balance immediately. Confirm that no crypto has been sent before rejecting.</p>
                  <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                    Required reason
                    <textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} maxLength={1000} rows={4} className="mt-2 w-full border-2 border-zinc-700 bg-black p-3 text-xs normal-case text-white outline-none focus:border-white" />
                  </label>
                </>
              )}
              {activeReview.action === 'PAID' && (
                <>
                  <p className="text-[10px] leading-relaxed text-amber-200">Enter the actual USDT amount sent and its blockchain transaction hash. The request reserves the USD amount shown above.</p>
                  <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                    Actual USDT sent
                    <input type="number" min="0.000000000001" step="any" value={cryptoAmount} onChange={(event) => setCryptoAmount(event.target.value)} className="mt-2 w-full border-2 border-zinc-700 bg-black p-3 text-xs text-white outline-none focus:border-white" />
                  </label>
                  <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                    Blockchain transaction hash
                    <input type="text" value={transactionHash} onChange={(event) => setTransactionHash(event.target.value)} spellCheck="false" className="mt-2 w-full border-2 border-zinc-700 bg-black p-3 font-mono text-xs text-white outline-none focus:border-white" />
                  </label>
                </>
              )}
              {activeReview.action === 'APPROVE' && <p className="text-[10px] leading-relaxed text-zinc-400">This approves the request but does not send funds. Mark it paid only after the on-chain transfer is confirmed.</p>}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeReview} disabled={isSubmitting} className="flex-1 border-2 border-zinc-700 py-3 text-[10px] font-black uppercase tracking-widest hover:border-white">Cancel</button>
                <button type="button" onClick={submitReview} disabled={isSubmitting || !reviewIsValid} className="flex flex-1 items-center justify-center gap-2 border-2 border-white bg-white py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-zinc-200 disabled:border-zinc-800 disabled:bg-zinc-800 disabled:text-zinc-500">
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
