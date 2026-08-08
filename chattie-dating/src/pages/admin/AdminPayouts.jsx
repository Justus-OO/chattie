import React, { useState, useEffect } from 'react';
import { 
  DollarSign, CreditCard, ArrowUpRight, ArrowDownRight, 
  Clock, CheckCircle2, XCircle, Search, Filter, 
  Activity, Wallet, Banknote, FileText, ChevronRight,
  ShieldCheck, AlertTriangle, Terminal, X, Check,
  RefreshCcw, Percent, Lock, Send, Download
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================================
// MOCK DATA: PAYOUTS, LEDGER, & FINANCIAL METRICS
// ============================================================================
const MOCK_PAYOUTS = [
  {
    id: 'PAY_10092', creatorId: 'OP_001', creatorName: 'Sarah Jenkins', 
    amount: 4500.00, method: 'WIRE TRANSFER', accountEnd: '****6789',
    status: 'PENDING', requestDate: '2026-08-07', riskStatus: 'CLEAN',
    history: { totalPaid: 38000.50, lastPayout: '2026-07-28' }
  },
  {
    id: 'PAY_10093', creatorId: 'OP_003', creatorName: 'Jessica Albie', 
    amount: 1250.75, method: 'CRYPTO (USDT)', accountEnd: '0x4F...a1b',
    status: 'PENDING', requestDate: '2026-08-08', riskStatus: 'CLEAN',
    history: { totalPaid: 8150.00, lastPayout: '2026-07-15' }
  },
  {
    id: 'PAY_10094', creatorId: 'OP_004', creatorName: 'David Thorne', 
    amount: 5200.00, method: 'ACH TRANSFER', accountEnd: '****1122',
    status: 'ON_HOLD', requestDate: '2026-08-08', riskStatus: 'HIGH_CHARGEBACK_RISK',
    history: { totalPaid: 0.00, lastPayout: 'NEVER' }
  },
  {
    id: 'PAY_10088', creatorId: 'OP_002', creatorName: 'Michael Chen', 
    amount: 2100.00, method: 'WIRE TRANSFER', accountEnd: '****3344',
    status: 'PROCESSED', requestDate: '2026-08-01', riskStatus: 'CLEAN',
    history: { totalPaid: 16100.00, lastPayout: '2026-08-02' }
  },
  {
    id: 'PAY_10085', creatorId: 'OP_009', creatorName: 'Lexi Rivera', 
    amount: 850.00, method: 'CRYPTO (USDC)', accountEnd: '0x99...4ed',
    status: 'REJECTED', requestDate: '2026-07-25', riskStatus: 'TOS_VIOLATION',
    history: { totalPaid: 450.00, lastPayout: '2026-06-10' }
  },
];

const MOCK_LEDGER = [
  { id: 'TXN_A1992', type: 'TIP', source: 'USR_88102', dest: 'P_102 (OP_001)', gross: 100.00, platformCut: 35.00, netCreator: 65.00, date: '2026-08-08 14:12:00' },
  { id: 'TXN_A1993', type: 'SUBSCRIPTION', source: 'USR_00411', dest: 'PLATFORM_FEE', gross: 49.99, platformCut: 49.99, netCreator: 0.00, date: '2026-08-08 14:10:22' },
  { id: 'TXN_A1994', type: 'TIP', source: 'USR_11204', dest: 'P_108 (OP_002)', gross: 20.00, platformCut: 10.00, netCreator: 10.00, date: '2026-08-08 13:45:11' },
  { id: 'TXN_A1995', type: 'MESSAGE_UNLOCK', source: 'USR_88911', dest: 'P_105 (OP_003)', gross: 5.00, platformCut: 2.25, netCreator: 2.75, date: '2026-08-08 13:30:05' },
  { id: 'TXN_A1996', type: 'REFUND', source: 'SYSTEM', dest: 'USR_99211', gross: -50.00, platformCut: -17.50, netCreator: -32.50, date: '2026-08-08 12:00:00' },
  { id: 'TXN_A1997', type: 'TIP', source: 'USR_88102', dest: 'P_108 (OP_002)', gross: 500.00, platformCut: 250.00, netCreator: 250.00, date: '2026-08-08 11:15:44' },
  { id: 'TXN_A1998', type: 'SUBSCRIPTION', source: 'USR_55122', dest: 'PLATFORM_FEE', gross: 14.99, platformCut: 14.99, netCreator: 0.00, date: '2026-08-08 10:05:12' },
];

// ============================================================================
// COMPONENT: ADMIN PAYOUTS & FINANCIALS
// ============================================================================
export default function AdminPayouts() {
  const [activeTab, setActiveTab] = useState('QUEUE'); // QUEUE, LEDGER, METRICS
  
  // Data State
  const [payouts, setPayouts] = useState(MOCK_PAYOUTS);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL'); // ALL, PENDING, PROCESSED, ON_HOLD
  
  // Drawer State
  const [selectedPayout, setSelectedPayout] = useState(null);
  const [drawerTab, setDrawerTab] = useState('PROCESSING'); // PROCESSING, HISTORY, RISK
  const [txnReference, setTxnReference] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Telemetry Simulation
  const [telemetry, setTelemetry] = useState({
    reserveBalance: 142500.85,
    pendingVolume: payouts.filter(p => p.status === 'PENDING').reduce((acc, curr) => acc + curr.amount, 0),
    h24Volume: 18450.00,
    platformMargin: 38.5
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setTelemetry(prev => ({
        ...prev,
        h24Volume: prev.h24Volume + (Math.random() * 50),
        reserveBalance: prev.reserveBalance + (Math.random() * 25 - 5)
      }));
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Handlers
  const handleProcessPayout = (action) => {
    if (action === 'APPROVE' && !txnReference.trim()) {
      toast.error('Transaction Reference / Hash is required for approval.');
      return;
    }
    if (action === 'REJECT' && !adminNotes.trim()) {
      toast.error('Audit notes are required to reject a payout.');
      return;
    }

    setIsProcessing(true);
    
    setTimeout(() => {
      setPayouts(prev => prev.map(p => {
        if (p.id === selectedPayout.id) {
          return { ...p, status: action === 'APPROVE' ? 'PROCESSED' : 'REJECTED' };
        }
        return p;
      }));
      
      if (action === 'APPROVE') {
        setTelemetry(prev => ({
          ...prev,
          reserveBalance: prev.reserveBalance - selectedPayout.amount,
          pendingVolume: prev.pendingVolume - selectedPayout.amount
        }));
      }

      toast.success(`Payout ${action === 'APPROVE' ? 'Processed' : 'Rejected'} Successfully.`);
      setIsProcessing(false);
      setSelectedPayout(null);
      setTxnReference('');
      setAdminNotes('');
    }, 1200);
  };

  const filteredPayouts = payouts.filter(p => {
    const matchStatus = filterStatus === 'ALL' || p.status === filterStatus;
    const matchSearch = p.creatorName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        p.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        p.creatorId.toLowerCase().includes(searchQuery.toLowerCase());
    return matchStatus && matchSearch;
  });

  return (
    <div className="flex-1 bg-black min-h-screen text-zinc-300 font-mono flex flex-col rounded-none overflow-hidden relative" style={{ fontFamily: 'Roboto, sans-serif' }}>
      
      {/* =========================================
          TOP TELEMETRY BAR
          ========================================= */}
      <div className="border-b-2 border-zinc-800 bg-zinc-950 p-4 flex flex-wrap justify-between items-center text-[10px] uppercase font-black tracking-widest shrink-0 gap-4 z-10 relative">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2 text-green-500">
            <DollarSign className="w-4 h-4 animate-pulse" /> FINANCE GATEWAY SECURE
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden sm:inline-block">
            PLATFORM RESERVE: <span className="text-white">${telemetry.reserveBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden md:inline-block">
            AWAITING SETTLEMENT: <span className="text-yellow-400">${telemetry.pendingVolume.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
          </span>
        </div>
        <button 
          onClick={() => toast('Ledger sync complete.')}
          className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors bg-black border-2 border-zinc-800 px-3 py-1"
        >
          <RefreshCcw className="w-3.5 h-3.5" /> <span className="hidden sm:inline">SYNC LEDGER</span>
        </button>
      </div>

      {/* =========================================
          MAIN HEADER & TABS
          ========================================= */}
      <div className="p-6 md:p-8 border-b-2 border-zinc-800 bg-black shrink-0 flex flex-col gap-6 z-10 relative">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-3">
              <Banknote className="w-8 h-8 text-green-500" /> Financials & Payouts
            </h1>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
              PROCESS CREATOR WITHDRAWALS, MONITOR GLOBAL LEDGER, AND ANALYZE REVENUE SPLITS
            </p>
          </div>
          
          <button className="flex items-center gap-2 bg-zinc-900 text-zinc-300 border-2 border-zinc-700 px-6 py-3 font-black text-xs uppercase tracking-widest hover:border-white hover:text-white transition-colors">
            <Download className="w-4 h-4" /> Export CSV Reports
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-2 border-b-2 border-zinc-800">
          {[
            { id: 'QUEUE', label: 'PAYOUT QUEUE', icon: Wallet },
            { id: 'LEDGER', label: 'GLOBAL LEDGER', icon: FileText },
            { id: 'METRICS', label: 'REVENUE SPLIT', icon: Percent }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-3 text-[10px] font-black uppercase tracking-widest border-b-4 transition-colors flex items-center gap-2 ${
                activeTab === tab.id 
                  ? 'border-white text-white bg-zinc-900' 
                  : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-950'
              }`}
            >
              <tab.icon className="w-4 h-4" /> {tab.label}
              {tab.id === 'QUEUE' && payouts.filter(p => p.status === 'PENDING').length > 0 && (
                <span className="ml-1 bg-yellow-500 text-black px-1.5 py-0.5 rounded-none font-black">{payouts.filter(p => p.status === 'PENDING').length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* =========================================
          TAB CONTENT AREA
          ========================================= */}
      <div className="flex-1 overflow-y-auto custom-scrollbar relative bg-black">
        
        {/* =========================================
            TAB 1: PAYOUT QUEUE
            ========================================= */}
        {activeTab === 'QUEUE' && (
          <div className="p-6 md:p-8 space-y-6">
            
            {/* Filters & Search */}
            <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-zinc-950 p-4 border-2 border-zinc-800">
              <div className="flex items-center gap-2 w-full md:w-auto">
                <Search className="w-4 h-4 text-zinc-500" />
                <input 
                  type="text" 
                  placeholder="SEARCH ID OR CREATOR NAME..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border-none outline-none text-xs font-bold text-white uppercase tracking-widest w-full md:w-80 placeholder:text-zinc-600"
                />
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto custom-scrollbar pb-1 md:pb-0">
                <Filter className="w-4 h-4 text-zinc-500 shrink-0" />
                {['ALL', 'PENDING', 'PROCESSED', 'ON_HOLD', 'REJECTED'].map(status => (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(status)}
                    className={`px-4 py-1.5 text-[9px] font-black uppercase tracking-widest border-2 shrink-0 transition-colors ${
                      filterStatus === status ? 'bg-white text-black border-white' : 'bg-black text-zinc-500 border-zinc-800 hover:border-zinc-600'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            {/* Payouts Table */}
            <div className="bg-zinc-950 border-2 border-zinc-800 overflow-x-auto">
              <table className="w-full text-left text-xs font-mono whitespace-nowrap">
                <thead className="bg-black border-b-2 border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-widest">
                  <tr>
                    <th className="p-4">Request ID & Date</th>
                    <th className="p-4">Creator / Operator</th>
                    <th className="p-4">Amount</th>
                    <th className="p-4">Method</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Process</th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-zinc-900 text-zinc-300 font-bold uppercase tracking-wide">
                  {filteredPayouts.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="p-12 text-center text-zinc-500">
                        <CheckCircle2 className="w-8 h-8 mx-auto mb-3 opacity-50" />
                        NO PAYOUT REQUESTS MATCHING CRITERIA
                      </td>
                    </tr>
                  ) : (
                    filteredPayouts.map(payout => (
                      <tr key={payout.id} className="hover:bg-zinc-900 transition-colors group cursor-pointer" onClick={() => setSelectedPayout(payout)}>
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="text-white font-black text-sm">{payout.id}</span>
                            <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {payout.requestDate}
                            </span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="text-white">{payout.creatorName}</span>
                            <span className="text-[9px] text-zinc-500">{payout.creatorId}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className="text-green-400 font-black text-sm">${payout.amount.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="text-zinc-300">{payout.method}</span>
                            <span className="text-[9px] text-zinc-500">{payout.accountEnd}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className={`px-2 py-1 text-[9px] font-black border flex items-center gap-1.5 w-max ${
                            payout.status === 'PROCESSED' ? 'bg-green-500/10 text-green-400 border-green-500/30' :
                            payout.status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' :
                            payout.status === 'ON_HOLD' ? 'bg-orange-500/10 text-orange-400 border-orange-500/30' :
                            'bg-red-500/10 text-red-500 border-red-500/30'
                          }`}>
                            {payout.status}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <button 
                            className={`p-2 border-2 transition-colors flex items-center justify-center ml-auto ${
                              payout.status === 'PENDING' 
                                ? 'border-white text-black bg-white hover:bg-zinc-200' 
                                : 'border-zinc-700 hover:border-white hover:text-white bg-black'
                            }`}
                            onClick={(e) => { e.stopPropagation(); setSelectedPayout(payout); }}
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* =========================================
            TAB 2: GLOBAL LEDGER
            ========================================= */}
        {activeTab === 'LEDGER' && (
          <div className="p-6 md:p-8 space-y-6">
            <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b-2 border-zinc-800 pb-6">
              <div>
                <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-400" /> Immutable Transaction Ledger
                </h2>
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                  RAW RECORD OF EVERY PLATFORM MONETIZATION EVENT (TIPS, SUBS, REFUNDS)
                </p>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 bg-zinc-950 border-2 border-zinc-800">
                <span className="text-[10px] font-black text-zinc-500 uppercase">24H GROSS VOLUME:</span>
                <span className="text-[10px] font-black text-green-400 uppercase">${telemetry.h24Volume.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
              </div>
            </div>

            <div className="bg-zinc-950 border-2 border-zinc-800 overflow-x-auto">
              <table className="w-full text-left text-xs font-mono whitespace-nowrap">
                <thead className="bg-black border-b-2 border-zinc-800 text-[9px] text-zinc-500 uppercase tracking-widest">
                  <tr>
                    <th className="p-4">TXN ID & Date</th>
                    <th className="p-4">Type</th>
                    <th className="p-4">Source &rarr; Destination</th>
                    <th className="p-4 text-right">Gross</th>
                    <th className="p-4 text-right">Platform Cut</th>
                    <th className="p-4 text-right">Creator Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-zinc-900 text-zinc-300 font-bold uppercase tracking-wide">
                  {MOCK_LEDGER.map(txn => (
                    <tr key={txn.id} className="hover:bg-zinc-900 transition-colors">
                      <td className="p-4">
                        <span className="block text-white font-black">{txn.id}</span>
                        <span className="block text-[8px] text-zinc-500 mt-0.5">{txn.date}</span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 text-[8px] font-black border ${
                          txn.type === 'REFUND' ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                          txn.type === 'SUBSCRIPTION' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                          'bg-zinc-800 text-zinc-300 border-zinc-600'
                        }`}>
                          {txn.type}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-zinc-400">{txn.source}</span>
                          <ChevronRight className="w-3 h-3 text-zinc-600" />
                          <span className="text-[10px] text-blue-400">{txn.dest}</span>
                        </div>
                      </td>
                      <td className={`p-4 text-right font-black ${txn.gross < 0 ? 'text-red-500' : 'text-white'}`}>
                        ${txn.gross.toFixed(2)}
                      </td>
                      <td className="p-4 text-right font-black text-green-400">
                        ${txn.platformCut.toFixed(2)}
                      </td>
                      <td className="p-4 text-right font-black text-zinc-400">
                        ${txn.netCreator.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* =========================================
            TAB 3: REVENUE METRICS
            ========================================= */}
        {activeTab === 'METRICS' && (
          <div className="p-6 md:p-8 space-y-6">
            <div className="mb-6 border-b-2 border-zinc-800 pb-6">
              <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-2">
                <Percent className="w-5 h-5 text-purple-400" /> Revenue Split Overview
              </h2>
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                AGGREGATE ANALYSIS OF PLATFORM PROFITABILITY VS CREATOR EARNINGS (30-DAY WINDOW)
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              <div className="border-2 border-zinc-800 bg-zinc-950 p-6 flex flex-col">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4 border-b-2 border-zinc-800 pb-2">Total Platform Gross (30d)</span>
                <span className="text-4xl font-black text-white mb-2">$542,800.00</span>
                <div className="text-[9px] text-green-400 font-bold uppercase tracking-widest flex items-center gap-1 mt-auto pt-4">
                  <ArrowUpRight className="w-3 h-3" /> +8.4% Month over Month
                </div>
              </div>

              <div className="border-2 border-green-500 bg-black p-6 flex flex-col relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <DollarSign className="w-24 h-24 text-green-500" />
                </div>
                <span className="text-[10px] font-black text-green-400 uppercase tracking-widest mb-4 border-b-2 border-green-900 pb-2 relative z-10">Platform Net Profit (Cut)</span>
                <span className="text-4xl font-black text-green-400 mb-2 relative z-10">${(542800 * (telemetry.platformMargin / 100)).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                <div className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest mt-auto pt-4 relative z-10">
                  Effective Margin: {telemetry.platformMargin}%
                </div>
              </div>

              <div className="border-2 border-blue-500 bg-zinc-950 p-6 flex flex-col relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Wallet className="w-24 h-24 text-blue-500" />
                </div>
                <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-4 border-b-2 border-blue-900 pb-2 relative z-10">Total Creator Earnings</span>
                <span className="text-4xl font-black text-white mb-2 relative z-10">${(542800 * ((100 - telemetry.platformMargin) / 100)).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                <div className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest mt-auto pt-4 relative z-10">
                  Distributed across 142 Active Creators
                </div>
              </div>

            </div>

            <div className="mt-8 bg-zinc-950 border-2 border-zinc-800 p-6">
              <h3 className="text-[10px] font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-zinc-500" /> System Note on Subscriptions
              </h3>
              <p className="text-xs text-zinc-400 uppercase font-mono font-bold leading-relaxed">
                VIP and Premium Subscription revenue is routed 100% to the Platform Net Profit. Creator earnings are derived strictly from Direct Tips, Message Unlocks, and Private Voice Stage per-minute billing based on their individual commission split configurations defined in the Creator Management suite.
              </p>
            </div>
          </div>
        )}

      </div>

      {/* =====================================================================
          PAYOUT PROCESSING DRAWER
          ===================================================================== */}
      {selectedPayout && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedPayout(null)} />
          
          <div className="relative w-full max-w-2xl h-full bg-black border-l-2 border-zinc-800 shadow-[[-10px_0_30px_rgba(0,0,0,0.8)]] flex flex-col animate-in slide-in-from-right-full duration-300">
            
            {/* Drawer Header */}
            <div className="p-6 bg-zinc-950 border-b-2 border-zinc-800 shrink-0 flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 text-[9px] font-black uppercase border ${
                    selectedPayout.status === 'PROCESSED' ? 'bg-green-500/10 text-green-400 border-green-500' :
                    selectedPayout.status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500' :
                    selectedPayout.status === 'ON_HOLD' ? 'bg-orange-500/10 text-orange-400 border-orange-500' :
                    'bg-red-500/10 text-red-500 border-red-500'
                  }`}>
                    {selectedPayout.status}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-bold font-mono ml-2">ID: {selectedPayout.id}</span>
                </div>
                <h2 className="text-3xl font-black text-white uppercase tracking-widest flex items-center gap-3">
                  ${selectedPayout.amount.toLocaleString('en-US', {minimumFractionDigits: 2})}
                </h2>
                <span className="text-xs text-zinc-400 font-mono mt-1 block">Requested by {selectedPayout.creatorName} ({selectedPayout.creatorId})</span>
              </div>
              <button onClick={() => setSelectedPayout(null)} className="p-2 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 bg-black transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Tabs */}
            <div className="flex bg-black border-b-2 border-zinc-800 shrink-0 px-6 pt-4 gap-4 overflow-x-auto custom-scrollbar">
              {['PROCESSING', 'HISTORY', 'RISK & COMPLIANCE'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setDrawerTab(tab)}
                  className={`pb-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-colors whitespace-nowrap ${
                    drawerTab === tab ? 'border-white text-white' : 'border-transparent text-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6 relative">
              
              {/* TAB: PROCESSING */}
              {drawerTab === 'PROCESSING' && (
                <div className="space-y-6 animate-in fade-in duration-200 flex flex-col min-h-full">
                  
                  <div className="bg-black border-2 border-zinc-800 p-6 space-y-4 font-mono">
                    <h4 className="text-[10px] font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-3 flex items-center gap-2">
                      <Banknote className="w-3 h-3 text-green-400" /> Transfer Details
                    </h4>
                    
                    <div className="flex justify-between items-center text-xs uppercase font-bold border-b border-zinc-900 pb-2">
                      <span className="text-zinc-500">Method</span>
                      <span className="text-white bg-zinc-900 px-2 py-1">{selectedPayout.method}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs uppercase font-bold border-b border-zinc-900 pb-2">
                      <span className="text-zinc-500">Destination Account</span>
                      <span className="text-blue-400 font-black tracking-widest">{selectedPayout.accountEnd}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs uppercase font-bold border-b border-zinc-900 pb-2">
                      <span className="text-zinc-500">Requested Date</span>
                      <span className="text-zinc-300">{selectedPayout.requestDate}</span>
                    </div>
                  </div>

                  {selectedPayout.status === 'PENDING' || selectedPayout.status === 'ON_HOLD' ? (
                    <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex-1 flex flex-col space-y-4">
                      <h4 className="text-[10px] font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-3 flex items-center gap-2">
                        <Lock className="w-3 h-3 text-yellow-400" /> Admin Settlement Actions
                      </h4>
                      
                      <div>
                        <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Wire Reference / Crypto TXID (Required for Approval)</label>
                        <input 
                          type="text" 
                          placeholder="ENTER CONFIRMATION HASH..."
                          value={txnReference}
                          onChange={(e) => setTxnReference(e.target.value)}
                          className="w-full bg-black border-2 border-zinc-700 p-3 text-xs text-white font-mono font-bold outline-none focus:border-green-500 transition-colors"
                        />
                      </div>
                      
                      <div className="flex-1">
                        <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2 mt-4">Internal Audit Notes (Required for Rejection)</label>
                        <textarea 
                          placeholder="ENTER REASON FOR HOLD/REJECTION..."
                          value={adminNotes}
                          onChange={(e) => setAdminNotes(e.target.value)}
                          className="w-full bg-black border-2 border-zinc-700 p-3 text-xs text-white font-mono font-bold resize-none h-24 outline-none focus:border-red-500 transition-colors"
                        />
                      </div>

                      <div className="flex gap-4 pt-4 mt-auto">
                        <button 
                          onClick={() => handleProcessPayout('REJECT')}
                          disabled={isProcessing}
                          className="flex-1 py-4 bg-black border-2 border-red-900 text-red-500 hover:bg-red-500 hover:text-black font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                        >
                          <XCircle className="w-4 h-4" /> Reject / Hold
                        </button>
                        <button 
                          onClick={() => handleProcessPayout('APPROVE')}
                          disabled={isProcessing}
                          className="flex-1 py-4 bg-green-600 border-2 border-green-500 text-black hover:bg-black hover:text-green-500 font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2 shadow-[4px_4px_0px_rgba(34,197,94,0.2)] hover:shadow-none translate-y-0 hover:translate-y-1 hover:translate-x-1"
                        >
                          <Send className="w-4 h-4" /> Approve & Record
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-12 border-2 border-dashed border-zinc-800 flex flex-col items-center justify-center text-center bg-zinc-950 flex-1">
                      {selectedPayout.status === 'PROCESSED' ? (
                        <CheckCircle2 className="w-12 h-12 text-green-500 mb-4" />
                      ) : (
                        <XCircle className="w-12 h-12 text-red-500 mb-4" />
                      )}
                      <h3 className="text-sm font-black text-white uppercase tracking-widest mb-2">Payout {selectedPayout.status}</h3>
                      <p className="text-xs text-zinc-500 uppercase font-bold max-w-xs">This request has already been handled and locked in the ledger.</p>
                    </div>
                  )}

                </div>
              )}

              {/* TAB: HISTORY */}
              {drawerTab === 'HISTORY' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-zinc-950 border-2 border-zinc-800 p-4">
                      <span className="block text-[9px] text-zinc-500 font-black uppercase tracking-widest mb-1 flex items-center gap-1">
                        <DollarSign className="w-3 h-3 text-blue-500" /> Lifetime Paid
                      </span>
                      <span className="text-2xl font-black text-white">${selectedPayout.history.totalPaid.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
                    </div>
                    <div className="bg-zinc-950 border-2 border-zinc-800 p-4">
                      <span className="block text-[9px] text-zinc-500 font-black uppercase tracking-widest mb-1 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-zinc-400" /> Last Payout Date
                      </span>
                      <span className="text-xl font-black text-zinc-300 font-mono mt-1 block">{selectedPayout.history.lastPayout}</span>
                    </div>
                  </div>
                  <div className="p-6 bg-black border-2 border-dashed border-zinc-800 text-center">
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                      Full historical ledger available in the main Global Ledger tab.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB: RISK */}
              {drawerTab === 'RISK & COMPLIANCE' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  <div className={`border-2 p-6 ${
                    selectedPayout.riskStatus === 'CLEAN' ? 'bg-zinc-950 border-green-900/50' : 'bg-red-950/10 border-red-900/50'
                  }`}>
                    <h4 className="text-[10px] font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                      <ShieldAlert className={`w-4 h-4 ${selectedPayout.riskStatus === 'CLEAN' ? 'text-green-500' : 'text-red-500'}`} /> Fraud Analysis
                    </h4>
                    
                    <div className="space-y-3 font-mono text-xs font-bold uppercase">
                      <div className="flex justify-between items-center border-b border-zinc-900/50 pb-2">
                        <span className="text-zinc-500">System Risk Status</span>
                        <span className={selectedPayout.riskStatus === 'CLEAN' ? 'text-green-400' : 'text-red-500'}>{selectedPayout.riskStatus}</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-zinc-900/50 pb-2">
                        <span className="text-zinc-500">Chargeback Velocity (30d)</span>
                        <span className="text-white">0.2% (Healthy)</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500">KYC/AML Status</span>
                        <span className="text-green-400 bg-green-500/10 px-2 py-1 border border-green-500/30">VERIFIED</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

    </div>
  );
}