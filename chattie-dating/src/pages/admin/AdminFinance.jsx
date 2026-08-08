import React, { useState, useEffect } from 'react';
import { 
  DollarSign, TrendingUp, TrendingDown, Activity, 
  BarChart3, PieChart, CreditCard, Wallet, Percent, 
  ArrowUpRight, ArrowDownRight, RefreshCcw, Download, 
  Filter, Calendar, ChevronDown, Terminal, Target,
  Zap, Users
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================================
// MOCK DATA: FINANCIAL TIME-SERIES & UNIT ECONOMICS
// ============================================================================
const generate30DayData = () => {
  return Array.from({ length: 30 }).map((_, i) => {
    const baseSubs = 12000 + (i * 150); // Upward trend
    const randomTips = 5000 + Math.floor(Math.random() * 4000);
    return {
      day: `AUG ${(i + 1).toString().padStart(2, '0')}`,
      subscriptions: baseSubs + Math.floor(Math.random() * 1000 - 500),
      tips: randomTips,
      total: baseSubs + randomTips,
    };
  });
};

const MOCK_CHART_DATA = generate30DayData();
const MAX_CHART_VAL = Math.max(...MOCK_CHART_DATA.map(d => d.total));

const MOCK_COHORTS = [
  { month: 'MAR 2026', users: 1240, m1: 88, m2: 74, m3: 65, m4: 52, m5: 48 },
  { month: 'APR 2026', users: 1855, m1: 91, m2: 78, m3: 70, m4: 61, m5: '-' },
  { month: 'MAY 2026', users: 2100, m1: 85, m2: 72, m3: 60, m4: '-', m5: '-' },
  { month: 'JUN 2026', users: 2840, m1: 93, m2: 81, m3: '-', m4: '-', m5: '-' },
  { month: 'JUL 2026', users: 3150, m1: 89, m2: '-', m3: '-', m4: '-', m5: '-' },
];

const TOP_EARNING_PERSONAS = [
  { id: 'P_108', name: 'Sarah_Viper', rev: 45200, growth: '+12%' },
  { id: 'P_102', name: 'Elena_NYC', rev: 38900, growth: '+5%' },
  { id: 'P_105', name: 'Mia_Tokyo', rev: 29150, growth: '-2%' },
  { id: 'P_112', name: 'Chloe_Fit', rev: 18400, growth: '+22%' },
];

// ============================================================================
// COMPONENT: ADMIN FINANCE & ANALYTICS
// ============================================================================
export default function AdminFinance() {
  const [activeTab, setActiveTab] = useState('REVENUE'); // REVENUE, ECONOMICS, COHORTS
  const [timeframe, setTimeframe] = useState('30D'); // 7D, 30D, 90D, YTD
  const [isExporting, setIsExporting] = useState(false);

  // Telemetry Simulation
  const [metrics, setMetrics] = useState({
    mrr: 485200.00,
    arpu: 42.15,
    churn: 4.2,
    cac: 12.50
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(prev => ({
        ...prev,
        mrr: prev.mrr + (Math.random() * 100 - 50),
      }));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleExport = () => {
    setIsExporting(true);
    toast('Compiling financial ledger and chart data...');
    setTimeout(() => {
      setIsExporting(false);
      toast.success('Financial_Report_AUG2026.csv downloaded.');
    }, 1500);
  };

  return (
    <div className="flex-1 bg-black min-h-screen text-zinc-300 font-mono flex flex-col rounded-none overflow-hidden relative" style={{ fontFamily: 'Roboto, sans-serif' }}>
      
      {/* =========================================
          TOP TELEMETRY BAR
          ========================================= */}
      <div className="border-b-2 border-zinc-800 bg-zinc-950 p-4 flex flex-wrap justify-between items-center text-[10px] uppercase font-black tracking-widest shrink-0 gap-4 z-10 relative">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2 text-green-500">
            <Activity className="w-4 h-4 animate-pulse" /> FINANCE TELEMETRY ONLINE
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden sm:inline-block">
            LATEST AGGREGATION: <span className="text-white">JUST NOW</span>
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden md:inline-block">
            DATA WAREHOUSE: <span className="text-blue-400">SYNCED</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-zinc-500 hidden sm:inline-block">PIPELINE: <span className="text-green-400">HEALTHY</span></span>
          <button 
            onClick={() => toast('Force re-calculating LTV metrics...')}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors bg-black border-2 border-zinc-800 px-3 py-1"
          >
            <RefreshCcw className="w-3.5 h-3.5" /> <span className="hidden sm:inline">RECALC</span>
          </button>
        </div>
      </div>

      {/* =========================================
          MAIN HEADER & TABS
          ========================================= */}
      <div className="p-6 md:p-8 border-b-2 border-zinc-800 bg-black shrink-0 flex flex-col gap-6 z-10 relative">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-3">
              <BarChart3 className="w-8 h-8 text-green-500" /> Platform Analytics
            </h1>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
              MONTHLY RECURRING REVENUE, UNIT ECONOMICS, AND COHORT RETENTION
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-zinc-950 border-2 border-zinc-800 p-1">
              {['7D', '30D', '90D', 'YTD'].map(tf => (
                <button 
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors ${
                    timeframe === tf ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
            <button 
              onClick={handleExport}
              disabled={isExporting}
              className="flex items-center gap-2 bg-zinc-900 text-zinc-300 border-2 border-zinc-700 px-6 py-3 font-black text-xs uppercase tracking-widest hover:border-white hover:text-white transition-colors disabled:opacity-50"
            >
              {isExporting ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} 
              <span className="hidden sm:inline">EXPORT</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-2 border-b-2 border-zinc-800">
          {[
            { id: 'REVENUE', label: 'REVENUE TRENDS', icon: TrendingUp },
            { id: 'ECONOMICS', label: 'UNIT ECONOMICS', icon: Target },
            { id: 'COHORTS', label: 'COHORT RETENTION', icon: Users }
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
            </button>
          ))}
        </div>
      </div>

      {/* =========================================
          TAB CONTENT AREA
          ========================================= */}
      <div className="flex-1 overflow-y-auto custom-scrollbar relative bg-black">
        
        {/* =========================================
            TAB 1: REVENUE TRENDS (CHARTS)
            ========================================= */}
        {activeTab === 'REVENUE' && (
          <div className="p-6 md:p-8 space-y-6">
            
            {/* Top KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col relative overflow-hidden group hover:border-green-500 transition-colors">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                  <DollarSign className="w-24 h-24 text-green-500" />
                </div>
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4 border-b-2 border-zinc-800 pb-2 relative z-10 flex items-center gap-2">
                  <TrendingUp className="w-3 h-3 text-green-500" /> Projected MRR
                </span>
                <span className="text-3xl font-black text-white mb-1 relative z-10">
                  ${metrics.mrr.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </span>
                <div className="text-[9px] text-green-400 font-bold uppercase tracking-widest flex items-center gap-1 relative z-10">
                  <ArrowUpRight className="w-3 h-3" /> +14.2% MoM
                </div>
              </div>

              <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col relative overflow-hidden group hover:border-blue-500 transition-colors">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4 border-b-2 border-zinc-800 pb-2 relative z-10 flex items-center gap-2">
                  <CreditCard className="w-3 h-3 text-blue-500" /> Avg Rev Per User (ARPU)
                </span>
                <span className="text-3xl font-black text-white mb-1 relative z-10">
                  ${metrics.arpu.toFixed(2)}
                </span>
                <div className="text-[9px] text-green-400 font-bold uppercase tracking-widest flex items-center gap-1 relative z-10">
                  <ArrowUpRight className="w-3 h-3" /> +$2.14 vs Last Month
                </div>
              </div>

              <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col relative overflow-hidden group hover:border-yellow-500 transition-colors">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4 border-b-2 border-zinc-800 pb-2 relative z-10 flex items-center gap-2">
                  <Wallet className="w-3 h-3 text-yellow-500" /> Gross Tip Volume (30D)
                </span>
                <span className="text-3xl font-black text-white mb-1 relative z-10">
                  $184,205
                </span>
                <div className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest flex items-center gap-1 relative z-10">
                  Excludes Subscription Revenue
                </div>
              </div>

              <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col relative overflow-hidden group hover:border-red-500 transition-colors">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4 border-b-2 border-zinc-800 pb-2 relative z-10 flex items-center gap-2">
                  <Activity className="w-3 h-3 text-red-500" /> Subscription Churn
                </span>
                <span className="text-3xl font-black text-red-400 mb-1 relative z-10">
                  {metrics.churn.toFixed(1)}%
                </span>
                <div className="text-[9px] text-red-500 font-bold uppercase tracking-widest flex items-center gap-1 relative z-10">
                  <ArrowUpRight className="w-3 h-3" /> +0.4% MoM (Needs Review)
                </div>
              </div>
            </div>

            {/* Main CSS Neo-Brutalist Chart */}
            <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col h-[500px]">
              <div className="flex justify-between items-center mb-8 border-b-2 border-zinc-800 pb-4">
                <div>
                  <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-green-500" /> Gross Revenue Velocity (30 Days)
                  </h2>
                  <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-1">
                    Stacked visual: Subscriptions (Blue) vs Direct Tips (Green)
                  </p>
                </div>
                <div className="flex gap-4">
                  <div className="flex items-center gap-2 text-[9px] font-black uppercase text-zinc-400">
                    <span className="w-3 h-3 bg-blue-500 border border-black"></span> Subscriptions
                  </div>
                  <div className="flex items-center gap-2 text-[9px] font-black uppercase text-zinc-400">
                    <span className="w-3 h-3 bg-green-500 border border-black"></span> Tips
                  </div>
                </div>
              </div>

              <div className="flex-1 flex items-end gap-1 sm:gap-2 relative">
                {/* Y-Axis Lines */}
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-20">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="w-full border-t border-dashed border-zinc-500 h-0 relative">
                      <span className="absolute -top-3 -left-2 text-[8px] font-mono text-zinc-400 bg-zinc-950 px-1">
                        {Math.floor(MAX_CHART_VAL * (4 - i) / 4 / 1000)}k
                      </span>
                    </div>
                  ))}
                </div>

                {/* Bars */}
                {MOCK_CHART_DATA.map((data, index) => {
                  const subHeight = (data.subscriptions / MAX_CHART_VAL) * 100;
                  const tipHeight = (data.tips / MAX_CHART_VAL) * 100;

                  return (
                    <div key={index} className="flex-1 flex flex-col justify-end items-center group relative h-full pb-6 z-10">
                      
                      {/* Tooltip */}
                      <div className="absolute -top-12 opacity-0 group-hover:opacity-100 bg-white text-black p-2 border-2 border-black pointer-events-none transition-opacity z-50 min-w-max text-center shadow-[4px_4px_0px_rgba(0,0,0,0.5)]">
                        <div className="text-[10px] font-black uppercase border-b border-black/20 pb-1 mb-1">{data.day}</div>
                        <div className="text-[9px] font-bold text-blue-600">SUB: ${data.subscriptions.toLocaleString()}</div>
                        <div className="text-[9px] font-bold text-green-600">TIP: ${data.tips.toLocaleString()}</div>
                        <div className="text-[9px] font-black mt-1">TOTAL: ${data.total.toLocaleString()}</div>
                      </div>

                      {/* Stacked Bar */}
                      <div className="w-full max-w-[24px] flex flex-col justify-end border-2 border-transparent group-hover:border-white transition-colors relative">
                        <div 
                          className="w-full bg-green-500 border-t border-black/20 transition-all duration-500 hover:brightness-110" 
                          style={{ height: `${tipHeight}%` }}
                        ></div>
                        <div 
                          className="w-full bg-blue-500 border-t border-black/20 transition-all duration-500 hover:brightness-110" 
                          style={{ height: `${subHeight}%` }}
                        ></div>
                      </div>

                      {/* X-Axis Label */}
                      <span className="text-[7px] font-mono text-zinc-600 uppercase mt-2 absolute bottom-0 -rotate-45 origin-top-left hidden sm:block">
                        {data.day.replace('AUG ', '')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}

        {/* =========================================
            TAB 2: UNIT ECONOMICS
            ========================================= */}
        {activeTab === 'ECONOMICS' && (
          <div className="p-6 md:p-8 space-y-6 max-w-6xl mx-auto">
            
            <div className="mb-6 bg-zinc-950 border-2 border-zinc-800 p-6 flex items-start gap-4">
              <Target className="w-8 h-8 text-blue-500 shrink-0" />
              <div>
                <h2 className="text-lg font-black text-white uppercase tracking-widest mb-2">Customer Acquisition & LTV</h2>
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest leading-relaxed">
                  Monitoring the fundamental profitability of the platform. Ensure Lifetime Value (LTV) remains significantly higher than Customer Acquisition Cost (CAC) for sustainable scaling.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* LTV:CAC Ratio Box */}
              <div className="bg-black border-2 border-zinc-800 p-8 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Percent className="w-4 h-4 text-purple-400" /> LTV : CAC Ratio
                </span>
                <div className="text-6xl font-black text-white mb-4">
                  4.8 <span className="text-3xl text-zinc-600">: 1</span>
                </div>
                <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-[9px] font-black px-3 py-1 uppercase tracking-widest">
                  EXCELLENT (Target  3:1)
                </div>
                <p className="text-[9px] text-zinc-500 uppercase font-bold mt-6 max-w-xs leading-relaxed">
                  For every $1 spent on marketing/acquisition, the platform generates $4.80 in net profit over the user's lifetime.
                </p>
              </div>

              {/* Specific Economics */}
              <div className="space-y-4">
                <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex justify-between items-center group hover:border-red-500 transition-colors">
                  <div>
                    <span className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Blended CAC</span>
                    <span className="text-2xl font-black text-white">${metrics.cac.toFixed(2)}</span>
                  </div>
                  <div className="text-right">
                    <span className="block text-[9px] text-red-400 font-bold uppercase tracking-widest mb-1 flex items-center gap-1 justify-end">
                      <ArrowUpRight className="w-3 h-3" /> +$1.10 MoM
                    </span>
                    <span className="text-[8px] text-zinc-600 uppercase font-mono">Ad spend increasing</span>
                  </div>
                </div>

                <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex justify-between items-center group hover:border-green-500 transition-colors">
                  <div>
                    <span className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Estimated LTV</span>
                    <span className="text-2xl font-black text-green-400">$60.00</span>
                  </div>
                  <div className="text-right">
                    <span className="block text-[9px] text-green-400 font-bold uppercase tracking-widest mb-1 flex items-center gap-1 justify-end">
                      <ArrowUpRight className="w-3 h-3" /> +$4.20 MoM
                    </span>
                    <span className="text-[8px] text-zinc-600 uppercase font-mono">Better retention</span>
                  </div>
                </div>

                <div className="bg-zinc-950 border-2 border-zinc-800 p-6 flex justify-between items-center group hover:border-blue-500 transition-colors">
                  <div>
                    <span className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Payback Period</span>
                    <span className="text-2xl font-black text-white">14 Days</span>
                  </div>
                  <div className="text-right">
                    <span className="block text-[9px] text-blue-400 font-bold uppercase tracking-widest mb-1 flex items-center gap-1 justify-end">
                      <CheckCircle2 className="w-3 h-3" /> Optimal
                    </span>
                    <span className="text-[8px] text-zinc-600 uppercase font-mono">Time to recover CAC</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Top Earners Box */}
            <div className="mt-6 bg-zinc-950 border-2 border-zinc-800 overflow-hidden flex flex-col lg:flex-row">
              <div className="p-6 bg-black border-b-2 lg:border-b-0 lg:border-r-2 border-zinc-800 lg:w-1/3 flex flex-col justify-center">
                <h3 className="text-sm font-black text-white uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Star className="w-4 h-4 text-yellow-400" /> Top Earner Personas
                </h3>
                <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest leading-relaxed">
                  These virtual personas drive the highest direct tip volume and engagement LTV. Ensure operators manning these profiles are retained.
                </p>
              </div>
              <div className="flex-1 p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {TOP_EARNING_PERSONAS.map((p, i) => (
                  <div key={p.id} className="border-2 border-zinc-800 bg-black p-4 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-black text-zinc-600">#{i+1}</span>
                      <div>
                        <span className="block text-[10px] font-black text-white uppercase">{p.name}</span>
                        <span className="block text-[8px] text-zinc-500 font-mono mt-0.5">{p.id}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="block text-sm font-black text-green-400">${p.rev.toLocaleString()}</span>
                      <span className={`block text-[8px] font-black uppercase ${p.growth.startsWith('+') ? 'text-green-500' : 'text-red-500'}`}>{p.growth}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* =========================================
            TAB 3: COHORT RETENTION
            ========================================= */}
        {activeTab === 'COHORTS' && (
          <div className="p-6 md:p-8 space-y-6">
            <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b-2 border-zinc-800 pb-6">
              <div>
                <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-400" /> Subscription Cohort Analysis
                </h2>
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                  TRACKING PERCENTAGE OF USERS RETAINED BY THE MONTH THEY SUBSCRIBED
                </p>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 bg-zinc-950 border-2 border-zinc-800">
                <span className="text-[10px] font-black text-zinc-500 uppercase">AVG M1 RETENTION:</span>
                <span className="text-[10px] font-black text-green-400 uppercase">89.2%</span>
              </div>
            </div>

            <div className="bg-zinc-950 border-2 border-zinc-800 overflow-x-auto">
              <table className="w-full text-center text-xs font-mono whitespace-nowrap">
                <thead className="bg-black border-b-2 border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-widest">
                  <tr>
                    <th className="p-4 text-left border-r-2 border-zinc-800">Cohort Month</th>
                    <th className="p-4 border-r-2 border-zinc-800">New Users</th>
                    <th className="p-4">Month 1</th>
                    <th className="p-4">Month 2</th>
                    <th className="p-4">Month 3</th>
                    <th className="p-4">Month 4</th>
                    <th className="p-4">Month 5</th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-zinc-900 text-white font-bold tracking-wide">
                  {MOCK_COHORTS.map(cohort => (
                    <tr key={cohort.month} className="hover:bg-zinc-900 transition-colors">
                      <td className="p-4 text-left border-r-2 border-zinc-800 bg-black">{cohort.month}</td>
                      <td className="p-4 border-r-2 border-zinc-800 text-zinc-400">{cohort.users.toLocaleString()}</td>
                      
                      {[cohort.m1, cohort.m2, cohort.m3, cohort.m4, cohort.m5].map((val, idx) => {
                        // Calculate color intensity based on retention percentage
                        let bgColor = 'bg-transparent';
                        let textColor = 'text-zinc-600';
                        if (val !== '-') {
                          if (val > 80) { bgColor = 'bg-green-500/20'; textColor = 'text-green-400'; }
                          else if (val > 60) { bgColor = 'bg-yellow-500/20'; textColor = 'text-yellow-400'; }
                          else { bgColor = 'bg-red-500/20'; textColor = 'text-red-400'; }
                        }
                        
                        return (
                          <td key={idx} className={`p-4 ${bgColor} ${textColor} border-l border-zinc-900/50`}>
                            {val !== '-' ? `${val}%` : '-'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-8 bg-zinc-950 border-2 border-zinc-800 p-6">
              <h3 className="text-[10px] font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-zinc-500" /> Retention Insight
              </h3>
              <p className="text-xs text-zinc-400 uppercase font-mono font-bold leading-relaxed">
                The Month 1 (M1) retention rate defines the percentage of users who renew their subscription after the first 30 days. High churn in M1 indicates a mismatch between user expectations and platform value. Current M1 retention is strong at 89.2%, significantly above the industry average of 65%.
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}