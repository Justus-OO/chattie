import React, { useState, useEffect, useCallback } from 'react';
import { 
  Wallet, ArrowUpRight, ArrowDownLeft, RefreshCcw, 
  History, CreditCard, Smartphone, ShieldCheck, 
  Filter, CheckCircle2, X, Download,
  Clock, Plus, Banknote
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { afterDarkService } from '../../api/afterdark.service';
import MpesaPaystackModal from '../../components/afterdark/MpesaPaystackModal';

const normalizeTransaction = tx => ({
  ...tx,
  id: tx.id || tx.transaction_id,
  type: tx.type || tx.direction || (Number(tx.amount_cents ?? tx.amount) < 0 ? 'debit' : 'credit'),
  amount: Math.abs(Number(tx.amount ?? tx.amount_cents ?? 0)) / (tx.amount_cents !== undefined ? 100 : 1),
  date: tx.date || tx.created_at || '',
  status: tx.status || 'pending',
  desc: tx.desc || tx.description || tx.category || 'Wallet transaction',
  ref: tx.ref || tx.reference || tx.transaction_reference || '',
});

// ============================================================================
// INLINE COMPONENT: TRANSACTION ROW
// ============================================================================
const TransactionRow = ({ tx }) => {
  const isCredit = tx.type === 'credit';
  
  return (
    <div className="group flex min-w-0 flex-col justify-between gap-4 border-2 border-zinc-800 bg-black p-4 transition-colors hover:border-zinc-600 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center border-2 ${isCredit ? 'border-zinc-600 bg-zinc-950 text-white' : 'border-zinc-800 bg-black text-zinc-500'}`}>
          {isCredit ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
        </div>
        <div className="min-w-0">
          <h4 className="text-[10px] font-black text-white uppercase tracking-widest">{tx.desc}</h4>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">{tx.date}</span>
            <span className="text-zinc-700">•</span>
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">REF: {tx.ref}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-6 border-t-2 border-zinc-900 pt-4 sm:w-[clamp(9rem,18vw,12rem)] sm:shrink-0 sm:justify-end sm:border-0 sm:pt-0">
        <span className={`px-2 py-1 text-[8px] font-black uppercase tracking-widest border ${
          tx.status === 'completed' || tx.status === 'cleared' ? 'bg-zinc-900 border-zinc-700 text-zinc-300' : 
          tx.status === 'pending' ? 'bg-zinc-950 border-zinc-700 text-zinc-400' : 
          'bg-red-500/10 border-red-500 text-red-500'
        }`}>
          {tx.status}
        </span>
        <span className={`text-xs font-black tracking-widest ${isCredit ? 'text-white' : 'text-zinc-400'}`}>
          {isCredit ? '+' : '-'}KES {tx.amount.toLocaleString()}
        </span>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT: WALLET DASHBOARD
// ============================================================================
export default function AfterDarkWallet() {
  const navigate = useNavigate();
  const currentUser = useAppStore(state => state.user);
  const isCreator = useAppStore(state => state.isCreator) || currentUser?.isCreator || false;
  const setWalletBalance = useAppStore(state => state.setWalletBalance);
  const updateUser = useAppStore(state => state.updateUser);
  
  // State
  const [balance, setBalance] = useState(0);
  const [pendingBalance, setPendingBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [payoutMethods, setPayoutMethods] = useState([]);
  const [payoutMethodId, setPayoutMethodId] = useState('');
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'credit', 'debit'
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('mpesa');
  const [depositPhone, setDepositPhone] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentCheckout, setPaymentCheckout] = useState(null);

  // Derived Data
  const filteredTransactions = transactions;
  const selectedPayoutMethod = payoutMethods.find(method => String(method.id || method.payout_method_id) === String(payoutMethodId));
  const isMpesaPayout = selectedPayoutMethod?.provider === 'mpesa';

  const loadWallet = useCallback(async () => {
    const [walletResponse, transactionResponse, methodsResponse, withdrawalsResponse] = await Promise.all([
      afterDarkService.getWallet(),
      afterDarkService.getTransactions({ type: activeFilter === 'all' ? undefined : activeFilter }),
      isCreator ? afterDarkService.getPayoutMethods() : Promise.resolve([]),
      isCreator ? afterDarkService.getWithdrawals() : Promise.resolve([]),
    ]);
    const wallet = walletResponse?.wallet || walletResponse || {};
    const available = Number(wallet.available_balance ?? wallet.available_balance_cents ?? 0) /
      (wallet.available_balance_cents !== undefined ? 100 : 1);
    setBalance(available);
    setPendingBalance(Number(wallet.pending_balance ?? wallet.pending_balance_cents ?? 0) /
      (wallet.pending_balance_cents !== undefined ? 100 : 1));
    setWalletBalance(available);
    updateUser({ walletBalance: available });
    const records = Array.isArray(transactionResponse)
      ? transactionResponse
      : transactionResponse?.transactions || transactionResponse?.items || [];
    if (!Array.isArray(records)) throw new Error('The wallet service returned invalid transaction history.');
    setTransactions(records.map(normalizeTransaction));
    const methods = Array.isArray(methodsResponse) ? methodsResponse : methodsResponse?.methods || methodsResponse?.items || [];
    if (!Array.isArray(methods)) throw new Error('The payout service returned invalid payout methods.');
    setPayoutMethods(methods);
    setPayoutMethodId(current => current || methods[0]?.id || methods[0]?.payout_method_id || '');
    const payoutRecords = Array.isArray(withdrawalsResponse) ? withdrawalsResponse : withdrawalsResponse?.withdrawals || [];
    if (!Array.isArray(payoutRecords)) throw new Error('The payout service returned invalid withdrawal history.');
    setWithdrawals(payoutRecords);
  }, [activeFilter, isCreator, setWalletBalance, updateUser]);

  useEffect(() => {
    let active = true;
    setLoadError('');
    setIsLoading(true);
    loadWallet().catch(error => {
      if (active) setLoadError(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load wallet data.'));
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => { active = false; };
  }, [loadWallet]);

  // Action Handlers
  const handleTransaction = async (type) => {
    const val = Number(amountInput);
    const minimum = type === 'withdraw' ? 1000 : 100;
    if (!Number.isFinite(val) || !val || val < minimum) {
      toast.error(`Minimum ${type === 'withdraw' ? 'withdrawal' : 'deposit'} is KES ${minimum}.`);
      return;
    }
    if (Math.abs(val * 100 - Math.round(val * 100)) > 1e-7) {
      toast.error('Enter an amount with no more than two decimal places.');
      return;
    }

    if (type === 'deposit' && paymentMethod === 'mpesa' && !/^(?:254|\+254|0)?[71]\d{8}$/.test(depositPhone.replace(/\s+/g, ''))) {
      toast.error('Enter a valid Kenyan M-Pesa number.');
      return;
    }

    if (type === 'withdraw' && !payoutMethodId) {
      toast.error('Add a payout method in After Dark settings before withdrawing.');
      return;
    }

    if (type === 'withdraw' && selectedPayoutMethod?.provider === 'mpesa' && !Number.isInteger(val)) {
      toast.error('M-Pesa payouts must be a whole number of Kenyan shillings.');
      return;
    }

    if (type === 'withdraw' && val > balance) {
      toast.error('Insufficient cleared funds.');
      return;
    }

    if (type === 'deposit') {
      setPaymentCheckout({
        id: 'wallet-deposit',
        paymentType: 'deposit',
        amountCents: Math.round(val * 100),
        price: val,
        caption: 'After Dark wallet deposit',
      });
      setShowDeposit(false);
      setAmountInput('');
      return;
    }

    setIsProcessing(true);
    try {
      await afterDarkService.requestWithdrawal({
        amount_cents: Math.round(val * 100),
        payout_method_id: payoutMethodId,
      });
      toast.success('Payout submitted. Its status will update after the provider confirms delivery.');
      setShowWithdraw(false);
      await loadWallet();
      setAmountInput('');
      setDepositPhone('');
    } catch (error) {
      toast.error(error?.response?.data?.error || (typeof error?.response?.data === 'string' ? error.response.data.trim() : '') || (error instanceof Error ? error.message : `Could not ${type === 'deposit' ? 'deposit funds' : 'request withdrawal'}.`));
    } finally {
      setIsProcessing(false);
    }
  };

  const exportTransactions = () => {
    const rows = [
      ['Date', 'Type', 'Amount (KES)', 'Status', 'Description', 'Reference'],
      ...filteredTransactions.map(tx => [tx.date, tx.type, tx.amount, tx.status, tx.desc, tx.ref]),
    ];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'afterdark-transactions.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  // ==========================================
  // RENDER BLOCKS
  // ==========================================
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black font-mono text-zinc-300">
      
      {/* HEADER */}
      <header className="z-20 flex shrink-0 flex-col justify-between gap-4 border-b-2 border-zinc-800 bg-zinc-950 p-4 sm:flex-row sm:items-center md:p-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-zinc-600 bg-black">
            <Wallet className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black text-white uppercase tracking-widest leading-none">My Wallet</h1>
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Manage funds and transactions</p>
          </div>
        </div>
        
        <div className="flex w-full gap-3 sm:w-auto">
          <button 
            onClick={() => setShowDeposit(true)}
            className="flex flex-1 items-center justify-center gap-2 border-2 border-white bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-zinc-200 sm:flex-none sm:px-6"
          >
            <Plus className="w-4 h-4" /> ADD FUNDS
          </button>
          {isCreator && (
            <button 
              onClick={() => setShowWithdraw(true)}
              className="flex flex-1 items-center justify-center gap-2 border-2 border-zinc-700 bg-black px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:border-white hover:bg-zinc-950 sm:flex-none sm:px-6"
            >
              <Banknote className="w-4 h-4" /> WITHDRAW
            </button>
          )}
        </div>
      </header>

      {/* SCROLLABLE CONTENT */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-black p-2 custom-scrollbar sm:p-3 lg:p-4">
        <div className="flex min-h-0 w-full flex-1 flex-col gap-4 md:gap-5">
          {loadError && <p role="alert" className="border-2 border-red-900 bg-black p-4 text-xs text-red-500">{loadError}</p>}
          
          {/* BALANCE CARDS */}
          <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 ${isCreator ? 'lg:grid-cols-3' : ''}`}>
            <div className="group relative min-w-0 overflow-hidden border-2 border-zinc-800 bg-black p-4 sm:p-6">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <Wallet className="size-[clamp(6rem,14vw,8rem)] text-white" />
              </div>
              <div className="relative z-10">
                <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-white" /> AVAILABLE BALANCE
                </h4>
                <div className="mb-2 break-words text-2xl font-black tracking-widest text-white sm:text-3xl">{isLoading ? 'Loading…' : `KES ${balance.toLocaleString()}`}</div>
                <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Ready for use or withdrawal</p>
              </div>
            </div>

            {isCreator && (
              <div className="flex min-w-0 flex-col justify-center border-2 border-zinc-800 bg-black p-4 opacity-80 sm:p-6">
                <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-zinc-400" /> PENDING CLEARANCE
                </h4>
                <div className="text-2xl font-black text-zinc-300 tracking-widest mb-2">KES {pendingBalance.toLocaleString()}</div>
                <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest">Earnings become withdrawable after admin clearance.</p>
              </div>
            )}

            <div className="flex min-w-0 flex-col justify-center border-2 border-zinc-800 bg-black p-4 sm:p-6">
              <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-white" /> PAYOUT AUDIT TRAIL
              </h4>
              <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed mb-4">
                Payout requests are tracked here and updated when the selected provider confirms delivery.
              </p>
              <button type="button" onClick={() => navigate('/afterdark/settings?tab=monetization')} className="w-full border-2 border-zinc-800 bg-black py-2 text-[9px] font-black uppercase tracking-widest text-zinc-400 transition-colors hover:border-white hover:text-white">
                VIEW PAYMENT METHODS
              </button>
            </div>
          </div>

          {isCreator && (
            <section aria-labelledby="payout-history-title">
              <div className="mb-4 border-b-2 border-zinc-800 pb-3">
                <h3 id="payout-history-title" className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-white">
                  <Banknote className="h-5 w-5 text-zinc-400" /> PAYOUT STATUS
                </h3>
              </div>
              {withdrawals.length === 0 ? (
                <p className="border-2 border-dashed border-zinc-800 p-4 text-[9px] font-bold uppercase tracking-widest text-zinc-500">No creator payouts yet.</p>
              ) : (
                <div className="space-y-2">
                  {withdrawals.map(withdrawal => (
                    <div key={withdrawal.id} className="flex flex-col justify-between gap-2 border-2 border-zinc-800 bg-black p-4 sm:flex-row sm:items-center">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-white">{withdrawal.provider || 'Payout'} · {withdrawal.status}</p>
                        <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500">{new Date(withdrawal.created_at).toLocaleString()}</p>
                        {withdrawal.failure_reason && <p className="mt-1 text-[9px] font-bold text-red-400">{withdrawal.failure_reason}</p>}
                      </div>
                      <span className="text-xs font-black uppercase tracking-widest text-zinc-300">
                        KES {(Number(withdrawal.amount_cents || 0) / 100).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* TRANSACTION HISTORY */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex flex-col justify-between gap-3 border-b-2 border-zinc-800 pb-3 sm:flex-row sm:items-center">
              <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                <History className="w-5 h-5 text-zinc-400" /> TRANSACTION LEDGER
              </h3>
              
              <div className="grid w-full grid-cols-3 gap-1 border-2 border-zinc-800 bg-black p-1 sm:w-auto">
                {[
                  { id: 'all', label: 'ALL' },
                  { id: 'credit', label: 'IN (CREDIT)' },
                  { id: 'debit', label: 'OUT (DEBIT)' }
                ].map(filter => (
                  <button 
                    key={filter.id}
                    onClick={() => setActiveFilter(filter.id)}
                    className={`min-w-0 px-2 py-2 text-[8px] font-black uppercase tracking-widest transition-colors sm:px-4 sm:text-[9px] ${activeFilter === filter.id ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {isLoading ? (
                <p role="status" className="flex min-h-32 flex-1 items-center justify-center text-center text-xs text-zinc-500">Loading transactions…</p>
              ) : filteredTransactions.length === 0 ? (
                <div className="flex min-h-[clamp(8rem,20vh,14rem)] flex-1 flex-col items-center justify-center border-2 border-dashed border-zinc-800 bg-black p-4 text-center">
                  <Filter className="w-8 h-8 text-zinc-600 mb-3" />
                  <h3 className="text-[10px] font-black text-white uppercase tracking-widest mb-1">NO TRANSACTIONS FOUND</h3>
                  <p className="text-[9px] font-bold text-zinc-500 uppercase">Try adjusting your filters.</p>
                </div>
              ) : (
                filteredTransactions.map(tx => <TransactionRow key={tx.id} tx={tx} />)
              )}
            </div>

            {filteredTransactions.length > 0 && (
              <div className="mt-6 flex justify-center">
                <button onClick={exportTransactions} className="flex items-center gap-2 border-2 border-zinc-800 bg-black px-6 py-3 text-[9px] font-black uppercase tracking-widest text-zinc-400 transition-colors hover:border-white hover:text-white">
                  <Download className="w-4 h-4" /> EXPORT CSV
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ==========================================
          MODALS PORTAL
          ========================================== */}
      
      {/* DEPOSIT MODAL */}
      {showDeposit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={() => !isProcessing && setShowDeposit(false)} />
          <div className="relative z-10 flex max-h-[90dvh] w-full max-w-md flex-col overflow-y-auto border-2 border-zinc-700 bg-black animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b-2 border-zinc-800 bg-zinc-950 p-4">
              <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                <Plus className="w-4 h-4 text-white" /> ADD FUNDS TO WALLET
              </h2>
              <button onClick={() => setShowDeposit(false)} disabled={isProcessing} className="text-zinc-500 hover:text-white disabled:opacity-50"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-6 p-4 sm:p-6">
              <div>
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2">Deposit Amount</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-zinc-500 font-bold">KES</span>
                  <input 
                    type="number" value={amountInput} onChange={(e) => setAmountInput(e.target.value)}
                    placeholder="1000"
                    className="w-full bg-black border-2 border-zinc-700 text-white p-4 pl-14 text-xl font-black outline-none focus:border-white transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-1">Select Payment Method</label>
                <button type="button" onClick={() => setPaymentMethod('mpesa')} className={`flex w-full items-center gap-4 border-2 p-4 text-left transition-colors ${paymentMethod === 'mpesa' ? 'border-white bg-zinc-950' : 'border-zinc-800 bg-black hover:border-zinc-600'}`}>
                  <div className={`flex h-4 w-4 items-center justify-center border-2 ${paymentMethod === 'mpesa' ? 'border-white' : 'border-zinc-600'}`}>{paymentMethod === 'mpesa' && <div className="h-2 w-2 bg-white" />}</div>
                  <Smartphone className="h-5 w-5 text-zinc-300" />
                  <div className="flex-1">
                    <span className="text-[10px] font-black text-white uppercase tracking-widest block">M-Pesa Express</span>
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mt-0.5">Instant • Zero Fees</span>
                  </div>
                </button>
                <button type="button" onClick={() => setPaymentMethod('card')} className={`flex w-full items-center gap-4 border-2 p-4 text-left transition-colors ${paymentMethod === 'card' ? 'border-white bg-zinc-950' : 'border-zinc-800 bg-black hover:border-zinc-600'}`}>
                  <div className={`flex h-4 w-4 items-center justify-center border-2 ${paymentMethod === 'card' ? 'border-white' : 'border-zinc-600'}`}>{paymentMethod === 'card' && <div className="h-2 w-2 bg-white" />}</div>
                  <CreditCard className="h-5 w-5 text-zinc-300" />
                  <div className="flex-1">
                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Card / Paystack</span>
                    <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest block mt-0.5">Visa, Mastercard</span>
                  </div>
                </button>
              </div>

              {paymentMethod === 'mpesa' ? (
                <input type="tel" value={depositPhone} onChange={event => setDepositPhone(event.target.value)} placeholder="M-Pesa number (07XX XXX XXX)" className="w-full bg-black border-2 border-zinc-700 text-white p-3 text-xs" />
              ) : (
                <p className="border-2 border-zinc-800 bg-zinc-950 p-3 text-[9px] font-bold uppercase text-zinc-400">Paystack opens securely here without leaving After Dark.</p>
              )}

              <button 
                onClick={() => handleTransaction('deposit')} 
                disabled={isProcessing || !amountInput || (paymentMethod === 'mpesa' && !depositPhone)}
                className="w-full py-4 bg-white text-black font-black uppercase text-xs tracking-widest border-2 border-white hover:bg-zinc-200 disabled:opacity-50 disabled:bg-zinc-800 disabled:border-zinc-800 disabled:text-zinc-500 transition-colors flex items-center justify-center gap-2"
              >
                {isProcessing ? <RefreshCcw className="w-4 h-4 animate-spin" /> : `DEPOSIT VIA ${paymentMethod === 'mpesa' ? 'M-PESA' : 'PAYSTACK'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WITHDRAW MODAL */}
      {showWithdraw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={() => !isProcessing && setShowWithdraw(false)} />
          <div className="relative z-10 flex max-h-[90dvh] w-full max-w-md flex-col overflow-y-auto border-2 border-zinc-700 bg-black animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b-2 border-zinc-800 bg-zinc-950 p-4">
              <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                <Banknote className="w-4 h-4 text-white" /> WITHDRAW EARNINGS
              </h2>
              <button onClick={() => setShowWithdraw(false)} disabled={isProcessing} className="text-zinc-500 hover:text-white disabled:opacity-50"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-6 p-4 sm:p-6">
              
              <div className="flex flex-col justify-between gap-2 border-2 border-zinc-800 bg-zinc-950 p-4 sm:flex-row sm:items-center">
                <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Available to Withdraw</span>
                <span className="text-sm font-black tracking-widest text-white">KES {balance.toLocaleString()}</span>
              </div>

              <div>
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2">Payout method</label>
                {payoutMethods.length ? (
                  <select value={payoutMethodId} onChange={event => setPayoutMethodId(event.target.value)} className="w-full border-2 border-zinc-700 bg-black p-3 text-xs text-white outline-none focus:border-white">
                    {payoutMethods.map(method => (
                      <option key={method.id || method.payout_method_id} value={method.id || method.payout_method_id}>
                        {method.provider || method.type || 'Payout'} • {method.account_number || method.phone_number || method.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="border-2 border-zinc-800 bg-zinc-950 p-3 text-[9px] font-bold uppercase text-zinc-400">Add a payout method in creator settings before requesting a withdrawal.</p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 flex justify-between">
                  <span>Withdrawal Amount</span>
                  <button onClick={() => setAmountInput((isMpesaPayout ? Math.floor(balance) : balance).toFixed(isMpesaPayout ? 0 : 2))} className="text-white underline-offset-4 hover:underline">MAX</button>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-zinc-500 font-bold">KES</span>
                  <input 
                    type="number" min="1000" step={isMpesaPayout ? '1' : '0.01'} value={amountInput} onChange={(e) => setAmountInput(e.target.value)}
                    placeholder="1000"
                    className="w-full border-2 border-zinc-700 bg-black p-4 pl-14 text-xl font-black text-white outline-none transition-colors focus:border-white"
                  />
                </div>
                <p className="mt-2 text-[8px] font-bold uppercase tracking-widest text-zinc-600">
                  Minimum withdrawal: KES 1,000. Destination: {selectedPayoutMethod?.account_number || selectedPayoutMethod?.phone_number || 'select a saved method'}.
                </p>
                <p className="mt-2 border-2 border-zinc-800 bg-zinc-950 p-3 text-[9px] font-bold uppercase tracking-widest text-zinc-400">
                  {isMpesaPayout
                    ? `KES 50 fee is deducted from the amount. Net payout: KES ${Math.max(0, Number(amountInput || 0) - 50).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
                    : `No fixed payout fee is deducted by Chattie for this Paystack method. Net payout: KES ${Number(amountInput || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`}
                </p>
              </div>

              <button 
                onClick={() => handleTransaction('withdraw')} 
                disabled={isProcessing || !payoutMethodId || !amountInput || Number(amountInput) < 1000 || Number(amountInput) > balance}
                className="flex w-full items-center justify-center gap-2 border-2 border-white bg-white py-4 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-zinc-200 disabled:border-zinc-800 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:opacity-50"
              >
                {isProcessing ? <RefreshCcw className="w-4 h-4 animate-spin" /> : `WITHDRAW KES ${Number(amountInput || 0).toLocaleString()}`}
              </button>
            </div>
          </div>
        </div>
      )}
      <MpesaPaystackModal
        isOpen={Boolean(paymentCheckout)}
        onClose={() => setPaymentCheckout(null)}
        postItem={paymentCheckout}
        defaultProvider={paymentMethod === 'card' ? 'paystack' : 'mpesa'}
        initialPhoneNumber={depositPhone}
        onSuccess={async () => {
          setPaymentCheckout(null);
          setDepositPhone('');
          toast.success('Wallet deposit confirmed.');
          try {
            await loadWallet();
          } catch (error) {
            toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Wallet balance refresh failed.'));
          }
        }}
      />
    </div>
  );
}