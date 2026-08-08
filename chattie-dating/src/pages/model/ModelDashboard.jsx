import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, Users, Flame, TrendingUp, Power, 
  Settings, AlertTriangle, Video, BarChart2, Maximize2, 
  Cpu, Globe, Shield, Bell, Server, Lock, MessageSquare, Loader2
} from 'lucide-react';
import { toast } from 'sonner';

// Services
import { creatorService } from '../../api/creator.service';

// --- MOCK DATA & GENERATORS (Logs and Telemetry remain for dashboard UI atmosphere) ---
const generateLog = (type = 'RANDOM', customMsg = null) => {
  const events = [
    { type: 'TIP', msg: 'USER_8821 SENT $50.00 TIP', color: 'text-green-400', border: 'border-green-500' },
    { type: 'REQ', msg: 'NEW PRIVATE REQUEST: VIP_99', color: 'text-yellow-400', border: 'border-yellow-500' },
    { type: 'SYS', msg: 'PROFILE CHANGES SAVED', color: 'text-zinc-500', border: 'border-zinc-700' },
    { type: 'SUB', msg: 'NEW SUBSCRIBER: GHOST_PRIME', color: 'text-blue-400', border: 'border-blue-500' },
    { type: 'MOD', msg: 'AUTO-MOD: BLOCKED INAPPROPRIATE IMAGE', color: 'text-red-500', border: 'border-red-500' }
  ];
  
  let event = events[Math.floor(Math.random() * events.length)];
  
  if (type === 'MSG') {
    event = { type: 'MSG', msg: customMsg, color: 'text-white', border: 'border-white' };
  } else if (type === 'ERR') {
    event = { type: 'ERR', msg: customMsg, color: 'text-red-500', border: 'border-red-500' };
  }

  return { ...event, id: Date.now() + Math.random(), time: new Date().toLocaleTimeString('en-US', { hour12: false }) };
};

const WEEKLY_DATA = [45, 80, 30, 90, 120, 60, 110];

const INITIAL_VIPS = [
  { id: 'v1', user: 'MARCUS_T', duration: '14:20', rate: '$5/min', status: 'ACTIVE', location: 'NYC' },
  { id: 'v2', user: 'CYBER_PUNK', duration: '08:45', rate: '$10/min', status: 'ACTIVE', location: 'LDN' },
  { id: 'v3', user: 'GHOST_X', duration: '02:10', rate: '$5/min', status: 'PAUSED', location: 'TYO' },
];

export default function ModelDashboard() {
  const [isOnline, setIsOnline] = useState(true);
  const [sessionTime, setSessionTime] = useState(0);
  const [logs, setLogs] = useState([{ type: 'SYS', msg: 'DASHBOARD LOADED...', color: 'text-zinc-500', border: 'border-zinc-700', id: 'init', time: new Date().toLocaleTimeString('en-US', { hour12: false }) }]);
  
  // Real Database Metrics State
  const [metrics, setMetrics] = useState({ balance: 0, total_earned: 0, pending_reqs: 0, earnings_24h: 0 });
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(true);

  const [telemetry, setTelemetry] = useState({ cpu: 42, ping: 18, ram: 64 });
  const [vipSessions, setVipSessions] = useState(INITIAL_VIPS);
  const [broadcastInput, setBroadcastInput] = useState('');
  const logEndRef = useRef(null);

  // --- FETCH REAL METRICS FROM BACKEND ---
  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const data = await creatorService.getDashboardStats();
        setMetrics(data);
      } catch (err) {
        console.error("Failed to load dashboard metrics:", err);
        toast.error("Failed to sync live dashboard data");
      } finally {
        setIsLoadingMetrics(false);
      }
    };

    fetchDashboardData();
    // Poll every 10 seconds for live updates
    const interval = setInterval(fetchDashboardData, 10000);
    return () => clearInterval(interval);
  }, []);

  // --- ENGINE SIMULATION ---
  useEffect(() => {
    let ticker;
    if (isOnline) {
      ticker = setInterval(() => setSessionTime(p => p + 1), 1000);
    }
    return () => clearInterval(ticker);
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline) return;
    const engineInterval = setInterval(() => {
      // 1. Generate Log
      setLogs(prev => [...prev.slice(-49), generateLog()]);

      // 2. Fluctuate Server Health (UI visual only)
      setTelemetry(prev => ({
        cpu: Math.max(10, Math.min(99, prev.cpu + Math.floor(Math.random() * 21) - 10)),
        ping: Math.max(5, Math.min(150, prev.ping + Math.floor(Math.random() * 11) - 5)),
        ram: Math.max(40, Math.min(90, prev.ram + Math.floor(Math.random() * 5) - 2)),
      }));
    }, 2500);

    return () => clearInterval(engineInterval);
  }, [isOnline]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // --- QUICK BROADCAST / COMMANDS ---
  const handleBroadcastSubmit = (e) => {
    if (e.key === 'Enter' && broadcastInput.trim()) {
      const msg = broadcastInput.trim();
      let responseLog = null;

      if (msg.toUpperCase() === '/CLEAR') {
        setLogs([]);
      } else if (msg.toUpperCase() === '/PURGE') {
        responseLog = generateLog('SYS', `PENDING QUEUE CLEARED.`);
      } else {
        responseLog = generateLog('MSG', `BROADCAST SENT: "${msg}"`);
      }

      if (responseLog) {
        setLogs(prev => [...prev.slice(-49), responseLog]);
      }
      setBroadcastInput('');
    }
  };

  const formatTime = (secs) => {
    const h = Math.floor(secs / 3600).toString().padStart(2, '0');
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  return (
    <div className="flex flex-col md:flex-row w-full h-full bg-black text-zinc-300 font-mono rounded-none overflow-hidden" style={{ fontFamily: 'Roboto, sans-serif' }}>
      
      {/* LEFT PANE: Core Dashboard (70%) */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 flex flex-col gap-6 border-r-2 border-zinc-800">
        
        {/* Header & Server Health */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b-2 border-zinc-800 pb-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-widest flex items-center gap-3">
              <Video className={`w-8 h-8 ${isOnline ? 'text-red-500 animate-pulse' : 'text-zinc-600'}`} />
              Creator Dashboard
            </h1>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
                SESSION: <span className="text-white">{formatTime(sessionTime)}</span>
              </span>
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold flex items-center gap-1">
                <Globe className="w-3 h-3 text-blue-400" /> PING: {telemetry.ping}ms
              </span>
            </div>
          </div>
          <button 
            onClick={() => setIsOnline(!isOnline)}
            className={`group relative px-6 py-3 border-2 font-black uppercase tracking-widest transition-none rounded-none overflow-hidden ${
              isOnline ? 'bg-black border-red-500 text-red-500 hover:bg-red-500 hover:text-black' : 'bg-black border-green-500 text-green-500 hover:bg-green-500 hover:text-black'
            }`}
          >
            <div className="flex items-center gap-2 relative z-10">
              <Power className="w-4 h-4" />
              {isOnline ? 'GO OFFLINE' : 'GO ONLINE'}
            </div>
            <div className="absolute inset-0 bg-white scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-100 z-0 opacity-10" />
          </button>
        </header>

        {/* Top Metrics Matrix (6 Cards - Connected to Database) */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <MetricCard 
            title="Earnings (24H)" 
            value={isLoadingMetrics ? '...' : `$${(metrics.earnings_24h || 0).toFixed(2)}`} 
            icon={<TrendingUp />} 
            color="text-green-400" 
          />
          <MetricCard 
            title="Current Balance" 
            value={isLoadingMetrics ? '...' : `$${(metrics.balance || 0).toFixed(2)}`} 
            icon={<Users />} 
            color="text-blue-400" 
          />
          <MetricCard 
            title="Pending Chats" 
            value={isLoadingMetrics ? '...' : metrics.pending_reqs} 
            icon={<MessageSquare />} 
            color="text-yellow-400" 
            alert={metrics.pending_reqs > 10} 
          />
          <MetricCard title="Subscribers" value="412" icon={<Flame />} color="text-white" />
          <MetricCard title="Spam Filtered" value="12" icon={<Shield />} color="text-zinc-400" />
          <MetricCard title="Managed Profiles" value="1/1" icon={<Server />} color="text-zinc-400" />
        </div>

        {/* Charts & Tables */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1">
          
          {/* Weekly Earnings Chart */}
          <div className="border-2 border-zinc-800 bg-zinc-950 p-4 md:p-6 rounded-none flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 p-2 opacity-10">
              <BarChart2 className="w-32 h-32" />
            </div>
            <div className="flex justify-between items-center mb-6 relative z-10">
              <h2 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <BarChart2 className="w-4 h-4" /> Weekly Earnings
              </h2>
              <span className="text-[9px] bg-white text-black px-2 py-1 font-bold uppercase">USD</span>
            </div>
            <div className="flex-1 flex items-end gap-2 justify-between pt-10 relative z-10 min-h-37.5">
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-20">
                {[1, 2, 3, 4, 5].map(i => <div key={i} className="w-full h-px bg-white border-b border-dashed border-zinc-700" />)}
              </div>
              {WEEKLY_DATA.map((val, idx) => (
                <div key={idx} className="w-full flex flex-col items-center gap-2 relative z-10 group cursor-crosshair">
                  <span className="text-[9px] text-white font-bold opacity-0 group-hover:opacity-100 transition-opacity absolute -top-5 bg-black px-1 border-2 border-white">${val}0</span>
                  <div 
                    className="w-full bg-zinc-800 border-t-2 border-zinc-500 group-hover:bg-white transition-colors" 
                    style={{ height: `${val}%` }} 
                  />
                  <span className="text-[9px] text-zinc-500 font-bold uppercase">DAY {idx+1}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Active Private Chats Table */}
          <div className="border-2 border-zinc-800 bg-zinc-950 rounded-none flex flex-col">
            <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center">
              <h2 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <Lock className="w-4 h-4" /> Active Private Chats
              </h2>
              <span className="text-[9px] font-bold uppercase text-green-400 bg-green-400/10 px-2 py-1 border border-green-500">LIVE</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-zinc-800 bg-black">
                    <th className="p-3 text-[9px] font-black text-zinc-500 uppercase tracking-widest">USER</th>
                    <th className="p-3 text-[9px] font-black text-zinc-500 uppercase tracking-widest">LOCATION</th>
                    <th className="p-3 text-[9px] font-black text-zinc-500 uppercase tracking-widest">DURATION</th>
                    <th className="p-3 text-[9px] font-black text-zinc-500 uppercase tracking-widest text-right">RATE</th>
                  </tr>
                </thead>
                <tbody>
                  {vipSessions.map((vip) => (
                    <tr key={vip.id} className="border-b border-zinc-800 hover:bg-black transition-colors group">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 ${vip.status === 'ACTIVE' ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
                          <span className="text-[10px] font-black text-white uppercase">{vip.user}</span>
                        </div>
                      </td>
                      <td className="p-3 text-[9px] text-zinc-400 uppercase font-bold">{vip.location}</td>
                      <td className="p-3 text-[10px] text-zinc-300 font-mono">{vip.duration}</td>
                      <td className="p-3 text-[10px] font-black text-green-400 text-right">{vip.rate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-auto p-2 bg-black border-t-2 border-zinc-800">
               <button className="w-full text-[9px] font-black text-zinc-500 hover:text-white uppercase tracking-widest transition-colors">VIEW ALL CHATS -{'>'}</button>
            </div>
          </div>
        </div>

        {/* Quick Actions Base */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-auto">
          <ActionModule title="Start Stream" icon={<Video />} alert />
          <ActionModule title="Settings" icon={<Settings />} />
          <ActionModule title="Mass Message" icon={<Users />} />
          <ActionModule title="Pause Queue" icon={<AlertTriangle />} danger />
        </div>
      </div>

      {/* RIGHT PANE: Live Activity Feed (30%) */}
      <div className="w-full md:w-[30%] lg:w-[35%] bg-black flex flex-col min-h-100 md:min-h-full shrink-0 relative border-t-2 md:border-t-0 border-zinc-800">
        <div className="p-4 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center shrink-0">
          <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
            <Bell className="w-4 h-4" /> Live Feed
          </h3>
        </div>
        
        {/* Logs Feed */}
        <div className="flex-1 p-3 overflow-y-auto custom-scrollbar space-y-1">
          {logs.map((log) => (
            <div key={log.id} className="flex flex-col mb-2 group">
              <div className="flex items-center gap-2 text-[9px] font-mono text-zinc-600">
                <span>[{log.time}]</span>
                <span className={`px-1 bg-black border ${log.border} ${log.color} font-black`}>{log.type}</span>
              </div>
              <p className={`text-[10px] font-bold tracking-wider uppercase mt-0.5 ${log.type === 'MSG' ? 'text-white' : log.type === 'ERR' ? 'text-red-500' : 'text-zinc-400'}`}>
                {log.msg}
              </p>
            </div>
          ))}
          <div ref={logEndRef} className="h-1" />
        </div>
        
        {/* Quick Broadcast Input */}
        <div className="p-3 border-t-2 border-zinc-800 bg-zinc-950 shrink-0">
          <div className="flex flex-col gap-1 mb-2">
            <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest">SEND MASS MESSAGE TO ACTIVE CHATS...</span>
          </div>
          <div className="flex items-center gap-2 bg-black border-2 border-zinc-700 p-2 focus-within:border-white transition-colors shadow-inner">
            <MessageSquare className="w-4 h-4 text-zinc-500" />
            <input 
              type="text" 
              value={broadcastInput}
              onChange={(e) => setBroadcastInput(e.target.value)}
              onKeyDown={handleBroadcastSubmit}
              placeholder="Type message and press enter..." 
              className="bg-transparent border-none outline-none text-[10px] text-white uppercase tracking-widest w-full font-bold placeholder:text-zinc-700"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// --- SUB-COMPONENTS ---

function MetricCard({ title, value, icon, color, alert }) {
  return (
    <div className={`p-4 border-2 ${alert ? 'border-red-500/50 bg-red-500/10' : 'border-zinc-800 bg-zinc-950'} rounded-none relative overflow-hidden group hover:border-white transition-colors`}>
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest z-10 relative">{title}</h3>
        <div className={`${color} z-10 relative`}>{icon}</div>
      </div>
      <div className={`text-xl md:text-2xl font-black tracking-tighter z-10 relative ${alert ? 'text-red-500' : 'text-white'}`}>
        {value}
      </div>
      {alert && <div className="absolute inset-0 bg-red-500/5 animate-pulse pointer-events-none" />}
    </div>
  );
}

function ActionModule({ title, icon, alert, danger }) {
  const baseColor = danger 
    ? 'hover:bg-red-500 hover:text-black hover:border-red-500 border-zinc-800 text-red-500' 
    : alert 
      ? 'hover:bg-white hover:text-black border-zinc-800 text-white' 
      : 'hover:bg-zinc-800 border-zinc-800 text-zinc-400';
      
  return (
    <button className={`p-3 border-2 bg-zinc-950 flex items-center gap-3 transition-all rounded-none group ${baseColor}`}>
      <div className={`p-1.5 border-2 ${danger ? 'border-red-500/30 group-hover:border-black' : 'border-zinc-800 group-hover:border-black'}`}>
        {icon}
      </div>
      <span className="text-[10px] font-black uppercase tracking-widest text-left">
        {title}
      </span>
    </button>
  );
}