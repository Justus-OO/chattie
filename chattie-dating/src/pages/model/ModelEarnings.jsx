import React, { useState, useEffect, useMemo } from 'react';
import { 
  Download, ArrowRight, DollarSign, Calendar, Search, 
  Filter, CheckCircle2, Clock, AlertCircle, Wallet, 
  TrendingUp, CreditCard, X, Building, History, Loader2
} from 'lucide-react';
import { toast } from 'sonner';

// Services
import { creatorService } from '../../api/creator.service';

export default function ModelEarnings() {
  const [transactions, setTransactions] = useState([]);
  const [balance, setBalance] = useState(0);
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

  // --- FETCH REAL DATA FROM BACKEND ---
  useEffect(() => {
    const fetchEarningsData = async () => {
      try {
        const [statsRes, ledgerRes] = await Promise.all([
          creatorService.getDashboardStats(),
          creatorService.getLedger()
        ]);
        setBalance(statsRes.balance || 0);
        setTransactions(ledgerRes || []);
      } catch (error) {
        console.error("Failed to load earnings data:", error);
        toast.error('Failed to load financial data');
      } finally {
        setIsLoading(false);
      }
    };
    fetchEarningsData();
  }, []);

  // --- ANALYTICS ENGINE ---
  const analytics = useMemo(() => {
    return transactions.reduce((acc, tx) => {
      if (tx.amount > 0) {
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
    toast.info("SYSTEM: Compiling CSV ledger. Download will begin shortly.");
  };

  const executePayout = async () => {
    const amountNum = Number(payoutAmount);
    if (!payoutAmount || isNaN(amountNum) || amountNum <= 0 || amountNum > balance) return;
    
    setIsProcessing(true);
    
    try {
      // Call real backend payout endpoint
      await creatorService.requestPayout(amountNum);
      
      // Update local state instantly to reflect the change
      setBalance(prev => prev - amountNum);
      const newTx = {
        id: `tx_${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
        type: 'PAYOUT_WIRE',
        user: 'SYSTEM_BANK',
        amount: -amountNum,
        status: 'PENDING'
      };

      setTransactions(prev => [newTx, ...prev]);
      setIsProcessing(false);
      setPayoutSuccess(true);
      
      toast.success("Wire transfer successfully initiated.");

      // Auto-close success modal after 2s
      setTimeout(() => {
        setIsPayoutModalOpen(false);
        setPayoutSuccess(false);
        setPayoutAmount('');
      }, 2000);
      
    } catch (error) {
      console.error("Payout error:", error);
      toast.error(error.message || 'Payout request failed');
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 bg-black min-h-screen flex items-center justify-center text-zinc-300">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 bg-black min-h-screen text-zinc-300 font-mono rounded-none overflow-y-auto custom-scrollbar relative" style={{ fontFamily: 'Roboto, sans-serif' }}>
      
      {/* =========================================================
          HEADER & METRICS
          ========================================================= */}
      <div className="p-6 md:p-10 pb-0">
        <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b-2 border-zinc-800 pb-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-3">
              <Wallet className="w-8 h-8 text-zinc-500" /> Financial Ledger
            </h1>
            <p className="text-xs text-zinc-500 uppercase font-bold tracking-widest">
              EARNINGS, TIPS & PAYOUT PROTOCOLS
            </p>
          </div>
          <div className="text-[10px] bg-zinc-950 border-2 border-zinc-800 px-4 py-2 font-black uppercase text-zinc-400">
            STATEMENT DATE: {new Date().toISOString().split('T')[0]}
          </div>
        </header>

        {/* Primary Balance Module */}
        <div className="bg-zinc-950 border-2 border-zinc-800 p-6 md:p-10 mb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6 rounded-none relative overflow-hidden">
          <div className="absolute -top-10 -right-10 opacity-[0.03] pointer-events-none">
            <DollarSign className="w-64 h-64" />
          </div>
          
          <div className="relative z-10">
            <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
              <TrendingUp className="w-3 h-3 text-green-400" /> Available for Payout
            </h2>
            <div className="text-5xl md:text-6xl font-black text-white tracking-tighter mb-4">
              ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest flex items-center gap-2">
              <Calendar className="w-3 h-3" /> NEXT AUTO-PAYOUT: AUG 10, 2026
            </p>
          </div>

          <div className="relative z-10 flex flex-col gap-3">
            <button 
              onClick={() => setIsPayoutModalOpen(true)}
              className="flex items-center justify-center gap-2 px-8 py-4 bg-white border-2 border-white text-black text-xs font-black uppercase tracking-widest hover:bg-black hover:text-white transition-all rounded-none shadow-[8px_8px_0px_0px_rgba(255,255,255,0.1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1"
            >
              Request Wire Transfer <ArrowRight className="w-4 h-4" />
            </button>
            <button 
              onClick={handleExport}
              className="flex items-center justify-center gap-2 px-8 py-3 bg-black border-2 border-zinc-700 text-zinc-400 text-[10px] font-black uppercase tracking-widest hover:border-white hover:text-white transition-colors rounded-none"
            >
              <Download className="w-3 h-3" /> Export Tax Statement
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
              <div className="flex items-center bg-black border-2 border-zinc-800 px-3 py-2 w-full md:w-64 focus-within:border-white transition-colors">
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
          <div className="overflow-x-auto min-h-100">
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
          <div className="bg-zinc-950 border-2 border-white w-full max-w-md rounded-none shadow-[12px_12px_0px_0px_rgba(255,255,255,0.1)] flex flex-col relative overflow-hidden">
            
            {payoutSuccess ? (
              <div className="p-12 flex flex-col items-center justify-center text-center">
                <CheckCircle2 className="w-16 h-16 text-green-400 mb-4" />
                <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2">Wire Initiated</h2>
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">
                  FUNDS WILL ARRIVE IN 3-5 BUSINESS DAYS.
                </p>
              </div>
            ) : (
              <>
                <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-white text-black">
                  <h2 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                    <Building className="w-4 h-4" /> Bank Transfer
                  </h2>
                  <button onClick={() => setIsPayoutModalOpen(false)} disabled={isProcessing} className="hover:text-red-500">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="p-6 space-y-6">
                  <div>
                    <label className="text-[9px] text-zinc-500 font-black uppercase tracking-widest block mb-2">AMOUNT TO WITHDRAW (USD)</label>
                    <div className="flex items-center border-2 border-zinc-700 bg-black p-3 focus-within:border-white transition-colors">
                      <DollarSign className="w-5 h-5 text-zinc-500 mr-2" />
                      <input 
                        type="number"
                        min="50"
                        max={balance}
                        value={payoutAmount}
                        onChange={(e) => setPayoutAmount(e.target.value)}
                        placeholder="0.00"
                        disabled={isProcessing}
                        className="w-full bg-transparent border-none outline-none text-2xl font-black text-white placeholder:text-zinc-700"
                      />
                      <button 
                        onClick={() => setPayoutAmount(balance.toString())}
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

                  <div className="bg-black border-2 border-zinc-800 p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <CreditCard className="w-5 h-5 text-zinc-500" />
                      <div>
                        <div className="text-[10px] font-black text-white uppercase">CHASE BANK ****4491</div>
                        <div className="text-[9px] text-zinc-500 font-bold uppercase">WIRE TRANSFER (FEE: $0.00)</div>
                      </div>
                    </div>
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
                      disabled={isProcessing || !payoutAmount || Number(payoutAmount) > balance || Number(payoutAmount) < 50}
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