import React, { useState, useEffect } from 'react';
import { 
  Server, Users, Activity, ShieldAlert, Database, 
  ArrowUpRight, ArrowDownRight, RefreshCcw, 
  Radio, Terminal, DollarSign, MessageSquare, 
  Mic, UserCheck, UserPlus, Cpu, AlertTriangle
} from 'lucide-react';
import { useI18n } from '../../i18n';

const INITIAL_LOGS = [
  { id: 1, time: '14:52:01', type: 'SECURE', text: 'ADMIN_ROOT OVERRODE PAYOUT LOCKOUT FOR MOD_02', color: 'border-yellow-500', badge: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30' },
  { id: 2, time: '14:50:12', type: 'SYS', text: 'NODE REBALANCING COMPLETE (LATENCY 14ms)', color: 'border-green-500', badge: 'text-green-400 bg-green-500/10 border-green-500/30' },
  { id: 3, time: '14:45:00', type: 'ROUTING', text: 'PROFILE ROUTE MAPPED: PR_104 > MOD_04', color: 'border-blue-500', badge: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  { id: 4, time: '14:41:22', type: 'ALERT', text: 'HIGH TRAFFIC DETECTED ON NODE EU-WEST-SECURE', color: 'border-red-500', badge: 'text-red-500 bg-red-500/10 border-red-500/30' },
];

const INITIAL_NODES = [
  { id: 'US-EAST-CORE', status: 'ONLINE', load: 42, color: 'text-green-400 bg-green-500/10 border-green-500/30' },
  { id: 'EU-WEST-SECURE', status: 'ONLINE', load: 88, color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30' },
  { id: 'AP-TOKYO-RELAY', status: 'OFFLINE', load: 0, color: 'text-red-500 bg-red-500/10 border-red-500/30' },
  { id: 'SA-BRAZIL-NODE', status: 'ONLINE', load: 24, color: 'text-green-400 bg-green-500/10 border-green-500/30' },
];

export default function AdminDashboard() {
  const { t } = useI18n();
  // Technical Metrics
  const [systemLoad, setSystemLoad] = useState(18.4);
  const [activeConnections, setActiveConnections] = useState(1428);
  const [routingLatency, setRoutingLatency] = useState(14.2);
  const [securityFlags, setSecurityFlags] = useState(0);

  // Business Metrics
  const [dailyRevenue, setDailyRevenue] = useState(12450.00);
  const [activeTextRooms, setActiveTextRooms] = useState(342);
  const [activeVoiceRooms, setActiveVoiceRooms] = useState(89);
  const [onlineCreators, setOnlineCreators] = useState(156);

  // Dynamic Data
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [logs, setLogs] = useState(INITIAL_LOGS);
  const [nodes, setNodes] = useState(INITIAL_NODES);

  // Simulate real-time dashboard activity
  useEffect(() => {
    const interval = setInterval(() => {
      // Fluctuate metrics slightly
      setSystemLoad(prev => Math.max(10, Math.min(95, prev + (Math.random() * 4 - 2))));
      setActiveConnections(prev => Math.max(1000, prev + Math.floor(Math.random() * 20 - 10)));
      setRoutingLatency(prev => Math.max(8, prev + (Math.random() * 2 - 1)));
      
      // Update Node Loads
      setNodes(prevNodes => prevNodes.map(node => {
        if (node.status === 'OFFLINE') return node;
        const newLoad = Math.max(10, Math.min(98, node.load + (Math.random() * 10 - 5)));
        let newColor = 'text-green-400 bg-green-500/10 border-green-500/30';
        if (newLoad > 85) newColor = 'text-red-500 bg-red-500/10 border-red-500/30';
        else if (newLoad > 65) newColor = 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
        return { ...node, load: newLoad, color: newColor };
      }));

      // Randomly inject new logs
      if (Math.random() > 0.7) {
        const eventTypes = [
          { type: 'AUTH', text: `NEW USER SIGNUP: USR_${Math.floor(Math.random() * 9000) + 1000}`, color: 'border-zinc-500', badge: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30' },
          { type: 'ROUTING', text: `CHAT ASSIGNED TO CREATOR_${Math.floor(Math.random() * 900) + 100}`, color: 'border-blue-500', badge: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
          { type: 'PAYMENT', text: `TIP RECEIVED: $${(Math.random() * 50 + 5).toFixed(2)}`, color: 'border-green-500', badge: 'text-green-400 bg-green-500/10 border-green-500/30' },
          { type: 'SECURE', text: `SPAM FILTER CAUGHT MESSAGES IN RM_${Math.floor(Math.random() * 9000)}`, color: 'border-yellow-500', badge: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30' }
        ];
        const newEvent = eventTypes[Math.floor(Math.random() * eventTypes.length)];
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        
        setLogs(prev => [{ id: Date.now(), time: timeStr, ...newEvent }, ...prev].slice(0, 15));
      }
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const handleRefreshTelemetry = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setSystemLoad(Math.random() * 10 + 15);
      setActiveConnections(Math.floor(Math.random() * 200) + 1350);
      setRoutingLatency(Math.random() * 5 + 10);
      setIsRefreshing(false);
    }, 800);
  };

  return (
    <div className="flex-1 bg-black min-h-screen text-zinc-300 font-mono flex flex-col rounded-none overflow-y-auto custom-scrollbar" style={{ fontFamily: 'Roboto, sans-serif' }}>
      
      {/* Top Admin Telemetry Bar */}
      <div className="border-b-2 border-zinc-800 bg-zinc-950 p-4 flex flex-wrap justify-between items-center text-[10px] uppercase font-black tracking-widest shrink-0 gap-4">
        <div className="flex flex-wrap items-center gap-6">
          <span className="flex items-center gap-2 text-red-500">
            <ShieldAlert className="w-4 h-4 animate-pulse" /> ROOT_ACCESS_ACTIVE
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden sm:inline-block">
            CLUSTER SYNC: <span className="text-green-400">OPTIMAL</span>
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden md:inline-block">
            ENCRYPTION: <span className="text-white">AES-256-GCM</span>
          </span>
        </div>
        <button 
          onClick={handleRefreshTelemetry}
          className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors bg-black border-2 border-zinc-800 px-3 py-1"
        >
          <RefreshCcw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-white' : ''}`} /> 
          <span className="hidden sm:inline">{t('refreshMetrics')}</span>
        </button>
      </div>

      {/* Header */}
      <div className="p-6 md:p-8 border-b-2 border-zinc-800 bg-black shrink-0 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-3">
            <Terminal className="w-8 h-8 text-red-500" /> {t('commandCenter')}
          </h1>
          <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
            {t('commandSubtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2 bg-zinc-950 border-2 border-zinc-800 px-4 py-2">
          <Radio className="w-4 h-4 text-green-500 animate-pulse" />
          <span className="text-xs font-black text-white uppercase tracking-widest">{t('gatewayOnline')}</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6 md:p-8 space-y-8 flex-1">
        
        {/* =========================================
            ROW 1: BUSINESS & TRAFFIC METRICS
            ========================================= */}
        <div>
          <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4" /> {t('platformTrafficRevenue')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            <div className="border-2 border-zinc-800 bg-zinc-950 p-5 relative overflow-hidden group hover:border-white transition-colors">
              <div className="flex justify-between items-start mb-4">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">24h Revenue</span>
                <DollarSign className="w-4 h-4 text-green-400" />
              </div>
              <div className="text-2xl font-black text-white uppercase tracking-wider mb-1">
                ${dailyRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-[9px] text-green-400 font-bold uppercase flex items-center gap-1">
                <ArrowUpRight className="w-3 h-3" /> +12.4% vs Yesterday
              </div>
            </div>

            <div className="border-2 border-zinc-800 bg-zinc-950 p-5 relative overflow-hidden group hover:border-white transition-colors">
              <div className="flex justify-between items-start mb-4">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Active Rooms</span>
                <MessageSquare className="w-4 h-4 text-blue-400" />
              </div>
              <div className="flex items-end gap-3 mb-1">
                <div className="text-2xl font-black text-white uppercase tracking-wider">{activeTextRooms} <span className="text-xs text-zinc-500">TXT</span></div>
                <div className="text-2xl font-black text-yellow-400 uppercase tracking-wider">{activeVoiceRooms} <span className="text-xs text-yellow-600">VOX</span></div>
              </div>
              <div className="text-[9px] text-zinc-400 font-bold uppercase flex items-center gap-1">
                Current Concurrency
              </div>
            </div>

            <div className="border-2 border-zinc-800 bg-zinc-950 p-5 relative overflow-hidden group hover:border-white transition-colors">
              <div className="flex justify-between items-start mb-4">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Online Creators</span>
                <UserCheck className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-2xl font-black text-white uppercase tracking-wider mb-1">{onlineCreators}</div>
              <div className="text-[9px] text-zinc-400 font-bold uppercase flex items-center gap-1">
                Out of 450 Registered
              </div>
            </div>

            <div className="border-2 border-zinc-800 bg-zinc-950 p-5 relative overflow-hidden group hover:border-white transition-colors">
              <div className="flex justify-between items-start mb-4">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Active Connections</span>
                <Users className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-2xl font-black text-white uppercase tracking-wider mb-1">{activeConnections.toLocaleString()}</div>
              <div className="text-[9px] text-green-400 font-bold uppercase flex items-center gap-1">
                <ArrowUpRight className="w-3 h-3" /> Peak Ingress Active
              </div>
            </div>

          </div>
        </div>

        {/* =========================================
            ROW 2: SYSTEM & NETWORK HEALTH
            ========================================= */}
        <div>
          <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4" /> {t('nodeTelemetry')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            
            <div className="border-2 border-zinc-800 bg-zinc-950 p-5">
              <div className="flex justify-between items-start mb-4">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Global Sys Load</span>
                <Activity className="w-4 h-4 text-red-500" />
              </div>
              <div className="text-2xl font-black text-white uppercase tracking-wider mb-1">{systemLoad.toFixed(1)}%</div>
              <div className="w-full bg-zinc-900 h-1.5 mt-3 border border-zinc-800">
                <div className="bg-red-500 h-full transition-all duration-500" style={{ width: `${systemLoad}%` }}></div>
              </div>
            </div>

            <div className="border-2 border-zinc-800 bg-zinc-950 p-5">
              <div className="flex justify-between items-start mb-4">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Routing Latency</span>
                <Server className="w-4 h-4 text-yellow-400" />
              </div>
              <div className="text-2xl font-black text-white uppercase tracking-wider mb-1">{routingLatency.toFixed(1)}ms</div>
              <div className="text-[9px] text-zinc-400 font-bold uppercase mt-2">Stable Across Clusters</div>
            </div>

            <div className="border-2 border-zinc-800 bg-zinc-950 p-5">
              <div className="flex justify-between items-start mb-4">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Security Flags</span>
                <ShieldAlert className={`w-4 h-4 ${securityFlags > 0 ? 'text-red-500 animate-pulse' : 'text-zinc-600'}`} />
              </div>
              <div className={`text-2xl font-black uppercase tracking-wider mb-1 ${securityFlags > 0 ? 'text-red-500' : 'text-zinc-600'}`}>
                {securityFlags} Active
              </div>
              <div className="text-[9px] text-green-400 font-bold uppercase mt-2">Firewall Intact</div>
            </div>

          </div>
        </div>

        {/* =========================================
            ROW 3: CLUSTERS & AUDIT LOGS
            ========================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Cluster Node Status Box */}
          <div className="border-2 border-zinc-800 bg-zinc-950 p-6 lg:col-span-1 flex flex-col h-[400px]">
            <h3 className="text-xs font-black text-white uppercase tracking-widest mb-4 border-b-2 border-zinc-800 pb-3 flex items-center justify-between">
              <span className="flex items-center gap-2"><Database className="w-4 h-4 text-red-500" /> Cluster Map</span>
              <span className="text-[9px] text-zinc-500 border border-zinc-800 px-2 py-0.5">AUTO-BALANCING</span>
            </h3>
            
            <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar pr-2">
              {nodes.map(node => (
                <div key={node.id} className="bg-black p-3 border-2 border-zinc-900 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-300 uppercase font-black text-[10px]">{node.id}</span>
                    <span className={`font-black text-[9px] px-2 py-0.5 border ${node.color}`}>
                      {node.status}
                    </span>
                  </div>
                  {node.status === 'ONLINE' && (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-zinc-900 h-1.5 border border-zinc-800">
                        <div 
                          className={`h-full transition-all duration-1000 ${node.load > 85 ? 'bg-red-500' : node.load > 65 ? 'bg-yellow-400' : 'bg-green-400'}`} 
                          style={{ width: `${node.load}%` }}
                        ></div>
                      </div>
                      <span className="text-[9px] font-bold text-zinc-500 w-8 text-right">{node.load.toFixed(0)}%</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Real-time System Event Stream */}
          <div className="border-2 border-zinc-800 bg-zinc-950 p-6 lg:col-span-2 flex flex-col h-[400px]">
            <div className="flex justify-between items-center mb-4 border-b-2 border-zinc-800 pb-3">
              <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
                <Activity className="w-4 h-4 text-yellow-400" /> Live Audit Stream
              </h3>
              <div className="flex items-center gap-2 text-[9px] font-bold text-zinc-500">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> LISTENING PORT 8080
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2 font-mono">
              {logs.map((log) => (
                <div key={log.id} className={`p-3 bg-black border-l-4 ${log.color} flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 border-y-2 border-r-2 border-y-zinc-900 border-r-zinc-900 animate-in slide-in-from-left-2 duration-300`}>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-zinc-600">[{log.time}]</span>
                    <span className="text-[11px] font-black text-zinc-200 uppercase tracking-wide">{log.text}</span>
                  </div>
                  <span className={`text-[9px] font-black px-2 py-0.5 border ${log.badge} self-start sm:self-auto`}>
                    {log.type}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}