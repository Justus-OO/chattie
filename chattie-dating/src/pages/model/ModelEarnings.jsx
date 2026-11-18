import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  Download, ArrowRight, DollarSign, Calendar, Search, 
  Filter, CheckCircle2, Clock, Wallet,
  TrendingUp, X, History, Loader2, Coins, Save
} from 'lucide-react';
import { toast } from 'sonner';

// Services
import { creatorService } from '../../api/creator.service';
import { useI18n } from '../../i18n';

const USD_AMOUNT_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

function parseUsdCents(value) {
  const match = USD_AMOUNT_PATTERN.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

export default function ModelEarnings() {
  const { t } = useI18n();
  const [transactions, setTransactions] = useState([]);
  const [balance, setBalance] = useState(0);
  const [payoutMethods, setPayoutMethods] = useState([]);
  const [payoutRequests, setPayoutRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Controls state
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [displayCount, setDisplayCount] = useState(15);
  
  // Payout Modal state
  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [payoutSuccess, setPayoutSuccess] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState('USDT-TRC20');
  const [walletAddress, setWalletAddress] = useState('');
  const [isSavingWallet, setIsSavingWallet] = useState(false);
  const [requestKey, setRequestKey] = useState('');
  const payoutSubmissionRef = useRef(false);

  const refreshEarningsData = useCallback(async () => {
    const [stats, ledger, methods, requests] = await Promise.all([
      creatorService.getDashboardStats(),
      creatorService.getLedger(),
      creatorService.getPayoutMethods(),
      creatorService.getPayoutRequests()
    ]);
    setBalance(Number(stats.balance) || 0);
    setTransactions(ledger || []);
    setPayoutMethods(methods || []);
    setPayoutRequests(requests || []);
  }, []);

  useEffect(() => {
    refreshEarningsData()
      .catch((error) => {
        console.error('Failed to load earnings data:', error);
        toast.error('Failed to load financial data.');
      })
      .finally(() => setIsLoading(false));
  }, [refreshEarningsData]);

  useEffect(() => {
    const method = payoutMethods.find((item) => item.asset_network === selectedNetwork);
    setWalletAddress(method?.wallet_address || '');
  }, [payoutMethods, selectedNetwork]);

  const selectedPayoutMethod = payoutMethods.find((item) => item.asset_network === selectedNetwork);
  const payoutAmountCents = parseUsdCents(payoutAmount);

  // --- ANALYTICS ENGINE ---
  const analytics = useMemo(() => {
    return transactions.reduce((acc, tx) => {
      if (tx.amount > 0 && tx.type !== 'PAYOUT_REVERSAL') {
        if (tx.type.includes('TIP')) acc.tips += tx.amount;
        if (tx.type.includes('CHAT') || tx.type.includes('VIDEO')) acc.chats += tx.amount;
        if (tx.type === 'SUBSCRIPTION') acc.subs += tx.amount;
        acc.totalEarned += tx.amount;
      }
      return acc;
    }, { tips: 0, chats: 0, subs: 0, totalEarned: 0 });
  }, [transactions]);

  // --- FILTER ENGINE ---
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      const matchesSearch = tx.id.includes(searchTerm) || (tx.user && tx.user.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesFilter = activeFilter === 'ALL' 
        || (activeFilter === 'EARNINGS' && tx.amount > 0)
        || (activeFilter === 'PAYOUTS' && tx.amount < 0)
        || tx.type === activeFilter;
      return matchesSearch && matchesFilter;
    });
  }, [transactions, searchTerm, activeFilter]);

  // --- ACTIONS ---
  const handleExport = () => {
    toast.info(t('exportLedger'));
  };

  const savePayoutWallet = async () => {
    setIsSavingWallet(true);
    try {
      const savedMethod = await creatorService.savePayoutMethod(selectedNetwork, walletAddress);
      setPayoutMethods((current) => [
        ...current.filter((method) => method.asset_network !== savedMethod.asset_network),
        savedMethod
      ]);
      setRequestKey('');
      toast.success(t('payoutWalletSaved'));
    } catch (error) {
      toast.error(error.response?.data?.error || t('payoutWalletSaveFailed'));
    } finally {
      setIsSavingWallet(false);
    }
  };

  const executePayout = async () => {
    if (payoutSubmissionRef.current) return;
    if (
      payoutAmountCents === null ||
      payoutAmountCents < 5000 ||
      payoutAmountCents > Math.round(balance * 100) ||
      !selectedPayoutMethod ||
      selectedPayoutMethod.wallet_address !== walletAddress.trim()
    ) return;

    payoutSubmissionRef.current = true;
    setIsProcessing(true);
    try {
      if (!requestKey && !window.crypto?.randomUUID) {
        throw new Error('Secure payout request keys are unavailable in this browser.');
      }
      const idempotencyKey = requestKey || window.crypto.randomUUID();
      setRequestKey(idempotencyKey);
      const response = await creatorService.requestCryptoPayout({
        amount_cents: payoutAmountCents,
        asset_network: selectedNetwork,
        idempotency_key: idempotencyKey
      });
      if (response.duplicate) {
        setRequestKey('');
        try {
          await refreshEarningsData();
        } catch (refreshError) {
          console.error('Duplicate payout response received but history refresh failed:', refreshError);
          toast.error(t('financialDataFailed'));
        }
        toast.info('This payout request already exists. Check its current status in payout history.');
        return;
      }
      setPayoutSuccess(true);
      setRequestKey('');
      toast.success(t('creatorPayoutSubmitted'));
      try {
        await refreshEarningsData();
      } catch (refreshError) {
        console.error('Payout submitted but earnings refresh failed:', refreshError);
        toast.error(t('financialDataFailed'));
      }
      window.setTimeout(() => {
        setIsPayoutModalOpen(false);
        setPayoutSuccess(false);
        setPayoutAmount('');
      }, 2000);
    } catch (error) {
      console.error('Payout error:', error);
      toast.error(error.response?.data?.error || t('payoutFailed'));
    } finally {
      payoutSubmissionRef.current = false;
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 items-center justify-center bg-black text-zinc-300">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-black font-mono text-zinc-300 custom-scrollbar rounded-none" style={{ fontFamily: 'Roboto, sans-serif' }}>
      
      {/* =========================================================
          HEADER & METRICS
          ========================================================= */}
      <div className="p-2 pb-0 sm:p-3 lg:p-4">
        <header className="mb-4 flex flex-col justify-between gap-3 border-b-2 border-zinc-800 pb-4 md:flex-row md:items-end">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-3">
              <Wallet className="w-8 h-8 text-zinc-500" /> {t('financialLedger')}
            </h1>
            <p className="text-xs text-zinc-500 uppercase font-bold tracking-widest">
              {t('earningsTipsPayouts')}
            </p>
          </div>
          <div className="text-[10px] bg-zinc-950 border-2 border-zinc-800 px-4 py-2 font-black uppercase text-zinc-400">
            STATEMENT DATE: {new Date().toISOString().split('T')[0]}
          </div>
        </header>

        {/* Primary Balance Module */}
        <div className="bg-zinc-950 border-2 border-zinc-800 p-6 md:p-10 mb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6 rounded-none relative overflow-hidden">
          <div className="absolute -top-10 -right-10 opacity-[0.03] pointer-events-none">
            <DollarSign className="size-[clamp(8rem,22vw,16rem)]" />
          </div>
          
          <div className="relative z-10">
            <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
              <TrendingUp className="w-3 h-3 text-green-400" /> {t('availableForPayout')}
            </h2>
            <div className="text-5xl md:text-6xl font-black text-white tracking-tighter mb-4">
              ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest flex items-center gap-2">
              <Calendar className="w-3 h-3" /> Crypto payouts are reserved immediately and sent after admin approval.
            </p>
          </div>

          <div className="relative z-10 flex flex-col gap-3">
            <button 
              onClick={() => setIsPayoutModalOpen(true)}
              className="flex items-center justify-center gap-2 px-8 py-4 bg-white border-2 border-white text-black text-xs font-black uppercase tracking-widest hover:bg-black hover:text-white transition-all rounded-none shadow-[8px_8px_0px_0px_rgba(255,255,255,0.1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1"
            >
              Request USDT payout <ArrowRight className="w-4 h-4" />
            </button>
            <button 
              onClick={handleExport}
              className="flex items-center justify-center gap-2 px-8 py-3 bg-black border-2 border-zinc-700 text-zinc-400 text-[10px] font-black uppercase tracking-widest hover:border-white hover:text-white transition-colors rounded-none"
            >
              <Download className="w-3 h-3" /> {t('exportTax')}
            </button>
          </div>
        </div>

        {/* Analytics Breakdown Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          <StatCard title="Total Earned (30D)" value={analytics.totalEarned} color="text-white" />
          <StatCard title="From Subscriptions" value={analytics.subs} color="text-blue-400" />
          <StatCard title="From Private Chats" value={analytics.chats} color="text-yellow-400" />
          <StatCard title="From Direct Tips" value={analytics.tips} color="text-green-400" />
        </div>

        <section className="border-2 border-zinc-800 bg-zinc-950 mb-10">
          <div className="p-4 border-b-2 border-zinc-800 flex items-center justify-between">
            <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
              <Coins className="w-4 h-4" /> Crypto payout requests
            </h3>
            <button
              type="button"
              onClick={() => refreshEarningsData().catch(() => toast.error(t('financialDataFailed')))}
              className="text-[9px] font-black uppercase tracking-widest text-zinc-400 hover:text-white"
            >
              Refresh
            </button>
          </div>
          {payoutRequests.length === 0 ? (
            <p className="p-6 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">No crypto payout requests yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-zinc-800 text-[9px] text-zinc-500 uppercase tracking-widest">
                    <th className="p-4">Requested</th>
                    <th className="p-4">Network / Destination</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Amount</th>
                    <th className="p-4">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {payoutRequests.map((request) => (
                    <tr key={request.id} className="border-b border-zinc-800 last:border-0">
                      <td className="p-4 text-[10px] text-zinc-300">{new Date(request.created_at).toLocaleDateString()}</td>
                      <td className="p-4 text-[10px] text-zinc-300">
                        <div className="font-black text-white">{request.asset_network}</div>
                        <div className="font-mono text-zinc-500">{request.wallet_address}</div>
                      </td>
                      <td className="p-4">
                        <span className="border border-zinc-700 px-2 py-1 text-[9px] font-black uppercase text-zinc-300">{request.status}</span>
                      </td>
                      <td className="p-4 text-right text-xs font-black text-white">${(request.amount_cents / 100).toFixed(2)}</td>
                      <td className="p-4 text-[10px] text-zinc-400">
                        {request.crypto_amount ? `${request.crypto_amount} USDT` : request.rejection_reason || 'Admin review pending'}
                        {request.transaction_hash && (
                          <div className="max-w-[clamp(10rem,20vw,14rem)] truncate font-mono text-zinc-600">{request.transaction_hash}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* =========================================================
          TRANSACTION LEDGER
          ========================================================= */}
      <div className="px-6 md:px-10 pb-10">
        <div className="border-2 border-zinc-800 bg-zinc-950 rounded-none flex flex-col">
          
          {/* Controls Bar */}
          <div className="p-4 border-b-2 border-zinc-800 flex flex-col md:flex-row justify-between items-center gap-4">
            <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2 w-full md:w-auto">
              <History className="w-4 h-4" /> Transaction History
            </h3>
            
            <div className="flex flex-col md:flex-row items-center gap-3 w-full md:w-auto">
              {/* Search */}
              <div className="flex w-full items-center border-2 border-zinc-800 bg-black px-3 py-2 transition-colors focus-within:border-white md:w-[clamp(12rem,24vw,18rem)]">
                <Search className="w-3 h-3 text-zinc-500 mr-2" />
                <input 
                  type="text" 
                  placeholder="SEARCH ID OR USER..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-transparent border-none outline-none text-[10px] text-white font-bold uppercase w-full placeholder:text-zinc-600"
                />
              </div>

              {/* Filter Dropdown */}
              <div className="flex items-center bg-black border-2 border-zinc-800 px-3 py-2 w-full md:w-auto">
                <Filter className="w-3 h-3 text-zinc-500 mr-2" />
                <select 
                  value={activeFilter}
                  onChange={(e) => setActiveFilter(e.target.value)}
                  className="bg-transparent border-none outline-none text-[10px] text-white font-bold uppercase cursor-pointer"
                >
                  <option value="ALL">ALL TRANSACTIONS</option>
                  <option value="EARNINGS">EARNINGS ONLY</option>
                  <option value="PAYOUTS">PAYOUTS ONLY</option>
                  <option value="SUBSCRIPTION">SUBSCRIPTIONS</option>
                  <option value="DIRECT_TIP">DIRECT TIPS</option>
                </select>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="min-h-0 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-zinc-800 bg-black">
                  <th className="p-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest whitespace-nowrap">Status</th>
                  <th className="p-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest whitespace-nowrap">Date / Time</th>
                  <th className="p-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest whitespace-nowrap">TX_ID</th>
                  <th className="p-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest whitespace-nowrap">Type</th>
                  <th className="p-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest whitespace-nowrap">Source</th>
                  <th className="p-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest whitespace-nowrap text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="p-12 text-center text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                      NO TRANSACTIONS MATCH YOUR CRITERIA.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.slice(0, displayCount).map((tx) => (
                    <tr key={tx.id} className="border-b border-zinc-800 hover:bg-black transition-colors group">
                      <td className="p-4">
                        {tx.status === 'COMPLETED' ? (
                          <span className="flex items-center gap-1 text-[9px] font-black text-green-400 bg-green-400/10 px-2 py-1 w-fit border border-green-500/30 uppercase">
                            <CheckCircle2 className="w-3 h-3" /> COMPLETE
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[9px] font-black text-yellow-400 bg-yellow-400/10 px-2 py-1 w-fit border border-yellow-500/30 uppercase">
                            <Clock className="w-3 h-3" /> PENDING
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="text-[10px] text-white font-bold uppercase">{tx.date}</div>
                        <div className="text-[9px] text-zinc-500 uppercase">{tx.time}</div>
                      </td>
                      <td className="p-4 text-[10px] font-mono text-zinc-400 group-hover:text-white transition-colors">{tx.id}</td>
                      <td className="p-4 text-[10px] font-black text-white uppercase tracking-wider">{tx.type.replace('_', ' ')}</td>
                      <td className="p-4 text-[10px] text-zinc-400 uppercase font-bold">{tx.user}</td>
                      <td className={`p-4 text-xs font-black text-right tracking-widest ${tx.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {tx.amount > 0 ? '+' : '-'}${Math.abs(tx.amount).toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          {/* Load More */}
          {displayCount < filteredTransactions.length && (
            <div className="p-4 bg-black border-t-2 border-zinc-800 flex justify-center">
              <button 
                onClick={() => setDisplayCount(prev => prev + 15)}
                className="px-6 py-2 bg-zinc-900 border-2 border-zinc-700 text-[10px] font-black text-white hover:border-white hover:bg-white hover:text-black uppercase tracking-widest transition-colors"
              >
                Load More History
              </button>
            </div>
          )}
        </div>
      </div>

      {/* =========================================================
          PAYOUT MODAL (OVERLAY)
          ========================================================= */}
      {isPayoutModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-y-auto border-2 border-white bg-zinc-950 shadow-[12px_12px_0px_0px_rgba(255,255,255,0.1)] rounded-none">
            
            {payoutSuccess ? (
              <div className="p-12 flex flex-col items-center justify-center text-center">
                <CheckCircle2 className="w-16 h-16 text-green-400 mb-4" />
                <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2">Request submitted</h2>
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">
                  Funds are reserved and awaiting admin review.
                </p>
              </div>
            ) : (
              <>
                <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-white text-black">
                  <h2 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                    <Coins className="w-4 h-4" /> USDT crypto payout
                  </h2>
                  <button onClick={() => setIsPayoutModalOpen(false)} disabled={isProcessing} className="hover:text-red-500">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="p-6 space-y-6">
                  <div>
                    <label className="text-[9px] text-zinc-500 font-black uppercase tracking-widest block mb-2">USDT NETWORK</label>
                    <select
                      value={selectedNetwork}
                      disabled={isProcessing || isSavingWallet}
                      onChange={(event) => {
                        setSelectedNetwork(event.target.value);
                        setRequestKey('');
                      }}
                      className="w-full border-2 border-zinc-700 bg-black p-3 text-xs font-black text-white uppercase outline-none focus:border-white"
                    >
                      <option value="USDT-TRC20">USDT — TRON (TRC20)</option>
                      <option value="USDT-ERC20">USDT — Ethereum (ERC20)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[9px] text-zinc-500 font-black uppercase tracking-widest block mb-2">YOUR RECEIVING WALLET</label>
                    <input
                      type="text"
                      value={walletAddress}
                      onChange={(event) => setWalletAddress(event.target.value)}
                      disabled={isProcessing || isSavingWallet}
                      autoComplete="off"
                      spellCheck="false"
                      placeholder={selectedNetwork === 'USDT-TRC20' ? 'TRON wallet address (starts with T)' : 'Ethereum wallet address (starts with 0x)'}
                      className="w-full border-2 border-zinc-700 bg-black p-3 text-xs font-mono text-white outline-none focus:border-white"
                    />
                    <button
                      type="button"
                      onClick={savePayoutWallet}
                      disabled={isProcessing || isSavingWallet || !walletAddress.trim() || walletAddress.trim() === selectedPayoutMethod?.wallet_address}
                      className="mt-2 flex items-center gap-2 border border-zinc-700 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:border-white hover:text-white disabled:opacity-40"
                    >
                      <Save className="w-3 h-3" /> {isSavingWallet ? 'Saving wallet…' : 'Save wallet'}
                    </button>
                    <p className="mt-2 text-[9px] text-zinc-500">
                      Verify the network and address carefully. A request uses a snapshot of this wallet.
                    </p>
                  </div>

                  <div>
                    <label className="text-[9px] text-zinc-500 font-black uppercase tracking-widest block mb-2">AMOUNT TO WITHDRAW (USD)</label>
                    <div className="flex items-center border-2 border-zinc-700 bg-black p-3 focus-within:border-white transition-colors">
                      <DollarSign className="w-5 h-5 text-zinc-500 mr-2" />
                      <input 
                        type="number"
                        min="50"
                        step="0.01"
                        max={balance}
                        value={payoutAmount}
                        onChange={(e) => {
                          setPayoutAmount(e.target.value);
                          setRequestKey('');
                        }}
                        placeholder="0.00"
                        disabled={isProcessing}
                        className="w-full bg-transparent border-none outline-none text-2xl font-black text-white placeholder:text-zinc-700"
                      />
                      <button 
                        onClick={() => {
                          setPayoutAmount(balance.toFixed(2));
                          setRequestKey('');
                        }}
                        disabled={isProcessing}
                        className="text-[9px] font-black uppercase text-zinc-400 hover:text-white px-2 border-l-2 border-zinc-800"
                      >
                        MAX
                      </button>
                    </div>
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-[9px] text-zinc-500 uppercase font-bold">MIN WITHDRAWAL: $50.00</span>
                      <span className="text-[9px] text-zinc-500 uppercase font-bold">AVAILABLE: ${balance.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="bg-black border-2 border-zinc-800 p-4 text-[9px] leading-relaxed text-zinc-400">
                    The requested USD amount is reserved immediately. An administrator reviews and sends USDT on the selected network; the final USDT amount and transaction hash will appear in your payout history. Rejected requests release the reserved balance.
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button 
                      onClick={() => setIsPayoutModalOpen(false)}
                      disabled={isProcessing}
                      className="flex-1 py-4 border-2 border-zinc-700 text-zinc-400 text-xs font-black uppercase tracking-widest hover:border-white hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={executePayout}
                      disabled={isProcessing || payoutAmountCents === null || payoutAmountCents > Math.round(balance * 100) || payoutAmountCents < 5000 || !selectedPayoutMethod || selectedPayoutMethod.wallet_address !== walletAddress.trim()}
                      className="flex-1 py-4 bg-white border-2 border-white text-black text-xs font-black uppercase tracking-widest hover:bg-zinc-200 disabled:opacity-50 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:border-zinc-800 transition-colors flex justify-center items-center gap-2"
                    >
                      {isProcessing ? (
                        <span className="animate-pulse">PROCESSING...</span>
                      ) : (
                        <>CONFIRM <ArrowRight className="w-4 h-4" /></>
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// --- SUB-COMPONENTS ---
function StatCard({ title, value, color }) {
  return (
    <div className="p-4 border-2 border-zinc-800 bg-zinc-950 flex flex-col justify-between hover:border-zinc-600 transition-colors rounded-none">
      <h3 className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">{title}</h3>
      <div className={`text-xl md:text-2xl font-black tracking-tighter ${color}`}>
        ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
    </div>
  );
}