import React, { useState, useEffect } from 'react';
import { 
  Users, Search, Filter, ShieldCheck, 
  Activity, DollarSign, Clock, MessageSquare, 
  ChevronRight, AlertTriangle, X, Lock, Unlock,
  Crown, CreditCard, ShieldAlert, Shield, Ban,
  RefreshCcw, ArrowUpRight, ArrowDownRight, UserCheck, KeyRound, Terminal, Loader2, Flag
} from 'lucide-react';
import { toast } from 'sonner';
import { adminService } from '../../api/admin.service';

const displayRecordedValue = (value, fallback = 'Not recorded') => {
  const text = String(value || '').trim();
  return !text || text.toLowerCase() === 'unknown' ? fallback : text;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function AdminUsers() {
  const [activeTab, setActiveTab] = useState('DIRECTORY'); // DIRECTORY, TIERS
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTier, setFilterTier] = useState('ALL'); // ALL, VIP, PREMIUM, STANDARD
  const [filterStatus, setFilterStatus] = useState('ALL'); // ALL, ACTIVE, FLAGGED, BANNED

  // Drawers & Modals
  const [selectedUser, setSelectedUser] = useState(null);
  const [drawerTab, setDrawerTab] = useState('OVERVIEW'); // OVERVIEW, BILLING, MODERATION

  // Telemetry State
  const [telemetry, setTelemetry] = useState({
    totalUsers: 0,
    vipCount: 0,
    premiumCount: 0,
    dailyActive: 0
  });

  // ============================================================================
  // DATA FETCHING
  // ============================================================================
  const fetchClientData = async (showSuccess = false) => {
    try {
      setIsLoading(true);
      setLoadError('');
      const [directoryData, telemetryData] = await Promise.all([
        adminService.getClientDirectory(),
        adminService.getClientTelemetry()
      ]);

      if (!Array.isArray(directoryData) || !telemetryData || typeof telemetryData !== 'object') {
        throw new Error('The server returned invalid client directory data.');
      }
      setUsers(directoryData.map(user => ({
        ...user,
        status: String(user.status || '').toUpperCase(),
        tier: String(user.tier || 'STANDARD').toUpperCase(),
      })));
      setTelemetry({
        totalUsers: Number(telemetryData.totalUsers) || 0,
        vipCount: Number(telemetryData.vipCount) || 0,
        premiumCount: Number(telemetryData.premiumCount) || 0,
        dailyActive: Number(telemetryData.dailyActive) || 0,
      });
      if (showSuccess) toast.success('Client directory synced.');
    } catch (error) {
      console.error("Failed to fetch client directory data", error);
      const message = error.response?.data?.error || error.message || "Failed to sync with client directory.";
      setLoadError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchClientData();
  }, []);

  // ============================================================================
  // ACTIONS & API CALLS
  // ============================================================================
  const handleToggleBan = async (id) => {
    const user = users.find(u => u.id === id);
    if (!user) return;

    const isBanned = user.status === 'BANNED';
    const nextStatus = isBanned ? 'ACTIVE' : 'BANNED';

    try {
      await adminService.toggleClientBan(id);
      
      setUsers(prev => prev.map(u => u.id === id ? { ...u, status: nextStatus } : u));

      if (selectedUser?.id === id) {
        setSelectedUser(prev => ({ ...prev, status: nextStatus }));
      }

      toast.success(isBanned ? 'User access restored.' : 'User permanently banned.');
    } catch (error) {
      toast.error(error.response?.data?.error || "Failed to update user ban status");
    }
  };

  const handleRevokeTier = async (id) => {
    try {
      await adminService.revokeClientTier(id);
      
      setUsers(prev => prev.map(u => u.id === id ? { ...u, tier: 'STANDARD' } : u));
      toast('Premium/VIP status revoked. Downgraded to Standard.');
      
      if (selectedUser?.id === id) {
        setSelectedUser(prev => ({ ...prev, tier: 'STANDARD' }));
      }
    } catch (error) {
      toast.error(error.response?.data?.error || "Failed to revoke subscription tier");
    }
  };

  const filteredUsers = users.filter(u => {
    const matchTier = filterTier === 'ALL' || u.tier === filterTier;
    const matchStatus = filterStatus === 'ALL' || u.status === filterStatus;
    const matchSearch = (u.username || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
                        (u.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                        (u.id || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchTier && matchStatus && matchSearch;
  });

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black font-mono text-zinc-300 rounded-none" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      
      {/* =========================================
          TOP TELEMETRY BAR
          ========================================= */}
      <div className="border-b-2 border-zinc-800 bg-zinc-950 p-4 flex flex-wrap justify-between items-center text-[10px] uppercase font-black tracking-widest shrink-0 gap-4 z-10 relative">
        <div className="flex items-center gap-6">
          <span className={`flex items-center gap-2 ${loadError ? 'text-red-500' : isLoading ? 'text-yellow-500' : 'text-green-500'}`}>
            <UserCheck className={`w-4 h-4 ${isLoading ? 'animate-pulse' : ''}`} /> {loadError ? 'CLIENT NETWORK ERROR' : isLoading ? 'SYNCING CLIENT NETWORK' : 'CLIENT NETWORK ONLINE'}
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden sm:inline-block">
            TOTAL REGISTERED: <span className="text-white">{telemetry.totalUsers.toLocaleString()}</span>
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden md:inline-block">
            DAILY ACTIVE: <span className="text-blue-400">{telemetry.dailyActive.toLocaleString()}</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-zinc-500 hidden sm:inline-block">
            VIP CONVERSION: <span className="text-yellow-400">{telemetry.totalUsers > 0 ? ((telemetry.vipCount / telemetry.totalUsers) * 100).toFixed(1) : '0.0'}%</span>
          </span>
          <button 
            onClick={() => fetchClientData(true)}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors bg-black border-2 border-zinc-800 px-3 py-1"
          >
            <RefreshCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">SYNC</span>
          </button>
        </div>
      </div>

      {/* =========================================
          MAIN HEADER & TABS
          ========================================= */}
      <div className="shrink-0 border-b-2 border-zinc-800 bg-black p-3 sm:p-4 flex flex-col gap-4 z-10 relative">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-3">
              <Users className="w-8 h-8 text-blue-500" /> Client Directory
            </h1>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
              MANAGE CONSUMER ACCOUNTS, SUBSCRIPTION TIERS, AND SPEND HISTORIES
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-2 border-b-2 border-zinc-800">
          {[
            { id: 'DIRECTORY', label: `USER DIRECTORY (${users.length})`, icon: Search },
            { id: 'TIERS', label: 'SUBSCRIPTION TIERS', icon: Crown },
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
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar relative bg-black">
        {loadError && !isLoading && (
            <div className="mx-2 mt-3 border-2 border-red-900/60 bg-red-950/20 p-4 flex flex-wrap items-center justify-between gap-3 sm:mx-3 lg:mx-4">
            <p className="text-xs text-red-300">{loadError}</p>
            <button
              onClick={() => fetchClientData()}
              className="border-2 border-red-800 px-3 py-2 text-[9px] font-black uppercase text-red-300 hover:bg-red-950"
            >
              Retry
            </button>
          </div>
        )}
        
        {isLoading ? (
          <div className="flex items-center justify-center h-full w-full p-20">
            <Loader2 className="w-10 h-10 text-zinc-600 animate-spin" />
          </div>
        ) : (
          <>
            {/* =========================================
                TAB 1: DIRECTORY (MAIN TABLE)
                ========================================= */}
            {activeTab === 'DIRECTORY' && (
              <div className="p-2 sm:p-3 lg:p-4 space-y-4">
                
                {/* Filters & Search */}
                <div className="flex flex-col xl:flex-row gap-4 justify-between items-start xl:items-center bg-zinc-950 p-4 border-2 border-zinc-800">
                  <div className="flex items-center gap-2 w-full xl:w-auto border-b-2 xl:border-b-0 xl:border-r-2 border-zinc-800 pb-4 xl:pb-0 xl:pr-6">
                    <Search className="w-4 h-4 text-zinc-500" />
                    <input 
                      type="text" 
                      placeholder="SEARCH USERNAME, EMAIL, OR ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full border-none bg-transparent text-xs font-bold uppercase tracking-widest text-white outline-none placeholder:text-zinc-600 md:w-[clamp(16rem,26vw,20rem)]"
                    />
                  </div>

                  <div className="flex flex-col md:flex-row gap-4 w-full xl:w-auto overflow-x-auto custom-scrollbar">
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest hidden md:inline">TIER:</span>
                      {['ALL', 'VIP', 'PREMIUM', 'STANDARD'].map(tier => (
                        <button
                          key={tier}
                          onClick={() => setFilterTier(tier)}
                          className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest border-2 transition-colors ${
                            filterTier === tier ? 'bg-white text-black border-white' : 'bg-black text-zinc-500 border-zinc-800 hover:border-zinc-600'
                          }`}
                        >
                          {tier}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 md:border-l-2 border-zinc-800 md:pl-4">
                      <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest hidden md:inline">STATUS:</span>
                      {['ALL', 'ACTIVE', 'FLAGGED', 'BANNED'].map(status => (
                        <button
                          key={status}
                          onClick={() => setFilterStatus(status)}
                          className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest border-2 transition-colors ${
                            filterStatus === status ? 'bg-white text-black border-white' : 'bg-black text-zinc-500 border-zinc-800 hover:border-zinc-600'
                          }`}
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Client Roster Table */}
                <div className="bg-zinc-950 border-2 border-zinc-800 overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono whitespace-nowrap">
                    <thead className="bg-black border-b-2 border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-widest">
                      <tr>
                        <th className="p-4">User Details</th>
                        <th className="p-4">Tier</th>
                        <th className="p-4">Status / Risk</th>
                        <th className="p-4">Lifetime Value</th>
                        <th className="p-4">Last Active</th>
                        <th className="p-4 text-right">Inspect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-zinc-900 text-zinc-300 font-bold uppercase tracking-wide">
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan="6" className="p-12 text-center text-zinc-500">
                            <Users className="w-8 h-8 mx-auto mb-3 opacity-50" />
                            NO CLIENTS MATCHING CRITERIA
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map(user => (
                          <tr key={user.id} className="hover:bg-zinc-900 transition-colors group cursor-pointer" onClick={() => setSelectedUser(user)}>
                            <td className="p-4">
                              <div className="flex flex-col">
                                <span className="text-white font-black text-sm">{user.username}</span>
                                <span className="text-[10px] text-zinc-500">
                                  {user.id} | {user.email}
                                </span>
                              </div>
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-1 text-[9px] font-black border flex items-center gap-1.5 w-max ${
                                user.tier === 'VIP' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' :
                                user.tier === 'PREMIUM' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                                'bg-zinc-800 text-zinc-400 border-zinc-600'
                              }`}>
                                {user.tier === 'VIP' && <Crown className="w-3 h-3" />}
                                {user.tier}
                              </span>
                            </td>
                            <td className="p-4">
                              <div className="flex flex-col gap-1.5">
                                <span className={`px-2 py-0.5 text-[9px] font-black border w-max ${
                                  user.status === 'ACTIVE' ? 'bg-green-500/10 text-green-400 border-green-500/30' :
                                  user.status === 'FLAGGED' ? 'bg-orange-500/10 text-orange-400 border-orange-500/30' :
                                  'bg-red-500/10 text-red-500 border-red-500/30'
                                }`}>
                                  {user.status}
                                </span>
                                {user.behavior?.riskScore > 50 && (
                                  <span className="text-[8px] text-red-500 font-bold flex items-center gap-1">
                                    <AlertTriangle className="w-2.5 h-2.5" /> HIGH RISK ({user.behavior.riskScore})
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-4">
                              <span className="text-green-400 font-black">${(user.totalSpend || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
                            </td>
                            <td className="p-4 text-[10px] text-zinc-400">
                              {user.lastActive}
                            </td>
                            <td className="p-4 text-right">
                              <button 
                                className="p-2 border-2 border-zinc-700 hover:border-white hover:text-white transition-colors bg-black group-hover:bg-zinc-800"
                                onClick={(e) => { e.stopPropagation(); setSelectedUser(user); }}
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
                TAB 2: TIERS & REVENUE
                ========================================= */}
            {activeTab === 'TIERS' && (
              <div className="p-2 sm:p-3 lg:p-4 space-y-4">
                <div className="mb-6">
                  <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-2">
                    <Crown className="w-5 h-5 text-yellow-400" /> Subscription Ecosystem
                  </h2>
                  <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
                    DISTRIBUTION AND REVENUE METRICS ACROSS ALL CONSUMER TIERS
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  
                  {/* VIP TIER */}
                  <div className="border-2 border-yellow-500 bg-zinc-950 p-6 flex flex-col hover:border-yellow-400 transition-colors">
                    <div className="flex justify-between items-start mb-6">
                      <div className="bg-yellow-500/10 border-2 border-yellow-500 p-3">
                        <Crown className="w-6 h-6 text-yellow-400" />
                      </div>
                      <span className="px-2 py-1 bg-yellow-500 text-black text-[9px] font-black uppercase tracking-widest">
                        Top Tier
                      </span>
                    </div>
                    <h3 className="text-2xl font-black text-white uppercase tracking-widest mb-1">VIP ACCESS</h3>
                    <p className="text-xs text-zinc-400 font-mono mb-6">$49.99 / month</p>

                    <div className="space-y-4 flex-1">
                      <div className="flex justify-between items-center border-b-2 border-zinc-800 pb-2">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Active Subs</span>
                        <span className="text-sm font-black text-white">{telemetry.vipCount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center border-b-2 border-zinc-800 pb-2">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">MRR (Est)</span>
                        <span className="text-sm font-black text-green-400">${(telemetry.vipCount * 49.99).toLocaleString('en-US', {maximumFractionDigits: 0})}</span>
                      </div>
                      <div className="flex justify-between items-center pb-2">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Growth (30d)</span>
                        <span className="text-[10px] font-black text-green-400 flex items-center gap-1"><ArrowUpRight className="w-3 h-3" /> +14.2%</span>
                      </div>
                    </div>
                  </div>

                  {/* PREMIUM TIER */}
                  <div className="border-2 border-blue-500 bg-zinc-950 p-6 flex flex-col hover:border-blue-400 transition-colors">
                    <div className="flex justify-between items-start mb-6">
                      <div className="bg-blue-500/10 border-2 border-blue-500 p-3">
                        <ShieldCheck className="w-6 h-6 text-blue-400" />
                      </div>
                      <span className="px-2 py-1 bg-zinc-800 text-zinc-300 border border-zinc-600 text-[9px] font-black uppercase tracking-widest">
                        Mid Tier
                      </span>
                    </div>
                    <h3 className="text-2xl font-black text-white uppercase tracking-widest mb-1">PREMIUM</h3>
                    <p className="text-xs text-zinc-400 font-mono mb-6">$14.99 / month</p>

                    <div className="space-y-4 flex-1">
                      <div className="flex justify-between items-center border-b-2 border-zinc-800 pb-2">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Active Subs</span>
                        <span className="text-sm font-black text-white">{telemetry.premiumCount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center border-b-2 border-zinc-800 pb-2">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">MRR (Est)</span>
                        <span className="text-sm font-black text-green-400">${(telemetry.premiumCount * 14.99).toLocaleString('en-US', {maximumFractionDigits: 0})}</span>
                      </div>
                      <div className="flex justify-between items-center pb-2">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Growth (30d)</span>
                        <span className="text-[10px] font-black text-green-400 flex items-center gap-1"><ArrowUpRight className="w-3 h-3" /> +5.8%</span>
                      </div>
                    </div>
                  </div>

                  {/* STANDARD TIER */}
                  <div className="border-2 border-zinc-700 bg-zinc-950 p-6 flex flex-col hover:border-zinc-500 transition-colors">
                    <div className="flex justify-between items-start mb-6">
                      <div className="bg-zinc-800 border-2 border-zinc-600 p-3">
                        <Users className="w-6 h-6 text-zinc-400" />
                      </div>
                      <span className="px-2 py-1 bg-zinc-800 text-zinc-400 border border-zinc-700 text-[9px] font-black uppercase tracking-widest">
                        Base Tier
                      </span>
                    </div>
                    <h3 className="text-2xl font-black text-white uppercase tracking-widest mb-1">STANDARD</h3>
                    <p className="text-xs text-zinc-400 font-mono mb-6">$0.00 / month (Pay Per Action)</p>

                    <div className="space-y-4 flex-1">
                      <div className="flex justify-between items-center border-b-2 border-zinc-800 pb-2">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Active Accounts</span>
                        <span className="text-sm font-black text-white">{Math.max(0, telemetry.totalUsers - telemetry.vipCount - telemetry.premiumCount).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center border-b-2 border-zinc-800 pb-2">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Tip Revenue (30d)</span>
                        <span className="text-sm font-black text-green-400">$18,450</span>
                      </div>
                      <div className="flex justify-between items-center pb-2">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Growth (30d)</span>
                        <span className="text-[10px] font-black text-red-400 flex items-center gap-1"><ArrowDownRight className="w-3 h-3" /> -1.2%</span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* =====================================================================
          USER INVESTIGATION / MANAGEMENT DRAWER
          ==================================================================== */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedUser(null)} />
          
          <div className="relative w-full max-w-2xl h-full bg-black border-l-2 border-zinc-800 shadow-[[-10px_0_30px_rgba(var(--shadow-rgb), 0.8)]] flex flex-col animate-in slide-in-from-right-full duration-300">
            
            {/* Drawer Header */}
            <div className="p-6 bg-zinc-950 border-b-2 border-zinc-800 shrink-0 flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 text-[9px] font-black uppercase border ${
                    selectedUser.status === 'ACTIVE' ? 'bg-green-500/10 text-green-400 border-green-500' : 
                    selectedUser.status === 'FLAGGED' ? 'bg-orange-500/10 text-orange-400 border-orange-500' : 
                    'bg-red-500/10 text-red-500 border-red-500'
                  }`}>
                    {selectedUser.status}
                  </span>
                  <span className={`px-2 py-0.5 text-[9px] font-black uppercase border ${
                    selectedUser.tier === 'VIP' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500' : 
                    selectedUser.tier === 'PREMIUM' ? 'bg-blue-500/10 text-blue-400 border-blue-500' : 
                    'bg-zinc-800 text-zinc-400 border-zinc-600'
                  }`}>
                    {selectedUser.tier}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-bold font-mono ml-2">ID: {selectedUser.id}</span>
                </div>
                <h2 className="text-2xl font-black text-white uppercase tracking-widest flex items-center gap-3">
                  {selectedUser.username}
                  {selectedUser.tier === 'VIP' && <Crown className="w-5 h-5 text-yellow-500" />}
                </h2>
                <span className="text-xs text-zinc-400 font-mono mt-1 block">{selectedUser.email}</span>
              </div>
              <button onClick={() => setSelectedUser(null)} className="p-2 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 bg-black transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Tabs */}
            <div className="flex bg-black border-b-2 border-zinc-800 shrink-0 px-6 pt-4 gap-4 overflow-x-auto custom-scrollbar">
              {['OVERVIEW', 'BILLING', 'MODERATION'].map(tab => (
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
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
              
              {/* TAB: OVERVIEW */}
              {drawerTab === 'OVERVIEW' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-zinc-950 border-2 border-zinc-800 p-4">
                      <span className="block text-[9px] text-zinc-500 font-black uppercase tracking-widest mb-1 flex items-center gap-1">
                        <DollarSign className="w-3 h-3 text-green-500" /> Total LTV
                      </span>
                      <span className="text-2xl font-black text-green-400">${(selectedUser.totalSpend || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
                    </div>
                    <div className="bg-zinc-950 border-2 border-zinc-800 p-4">
                      <span className="block text-[9px] text-zinc-500 font-black uppercase tracking-widest mb-1 flex items-center gap-1">
                        <MessageSquare className="w-3 h-3 text-blue-500" /> Messages Sent
                      </span>
                      <span className="text-2xl font-black text-white">{(selectedUser.behavior?.messagesSent || 0).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="bg-black border-2 border-zinc-800 p-6 space-y-4 font-mono">
                    <h4 className="text-[10px] font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-3 flex items-center gap-2">
                      <Terminal className="w-3 h-3 text-zinc-400" /> Account Metadata
                    </h4>
                    
                    <div className="flex justify-between items-center text-xs uppercase font-bold border-b border-zinc-900 pb-2">
                      <span className="text-zinc-500">Join Date</span>
                      <span className="text-white bg-zinc-900 px-2 py-1">{selectedUser.joinDate}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs uppercase font-bold border-b border-zinc-900 pb-2">
                      <span className="text-zinc-500">Last Active</span>
                      <span className="text-white bg-zinc-900 px-2 py-1">{selectedUser.lastActive}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs uppercase font-bold border-b border-zinc-900 pb-2">
                      <span className="text-zinc-500">Known Location</span>
                      <span className="text-white">{displayRecordedValue(selectedUser.security?.location, 'No location estimate')}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs uppercase font-bold border-b border-zinc-900 pb-2">
                      <span className="text-zinc-500">Last IP Address</span>
                      <span className="text-zinc-400">{displayRecordedValue(selectedUser.security?.lastIp)}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs uppercase font-bold">
                      <span className="text-zinc-500">Primary Device</span>
                      <span className="text-zinc-400">{displayRecordedValue(selectedUser.security?.device, 'Device not reported')}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: BILLING */}
              {drawerTab === 'BILLING' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  
                  <div className="bg-zinc-950 border-2 border-zinc-800 p-6">
                    <h4 className="text-[10px] font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-blue-400" /> Payment Info
                    </h4>
                    <div className="space-y-3 font-mono text-xs">
                      <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                        <span className="text-zinc-500 font-bold uppercase">Method</span>
                        <span className="text-white font-bold">{selectedUser.billing?.paymentMethod || 'None'}</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
                        <span className="text-zinc-500 font-bold uppercase">Auto-Renew</span>
                        <span className={`font-black ${selectedUser.billing?.recurring ? 'text-green-400' : 'text-zinc-500'}`}>
                          {selectedUser.billing?.recurring ? 'ENABLED' : 'DISABLED'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500 font-bold uppercase">Next Billing</span>
                        <span className="text-white font-bold">{selectedUser.billing?.nextBilling || 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  {selectedUser.tier !== 'STANDARD' && (
                    <div className="pt-4 border-t-2 border-zinc-800">
                      <button 
                        onClick={() => handleRevokeTier(selectedUser.id)}
                        className="w-full py-3 bg-black border-2 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                      >
                        <UserCheck className="w-4 h-4" /> Revoke {selectedUser.tier} Status
                      </button>
                      <p className="text-[8px] text-center text-zinc-600 font-bold uppercase mt-2">Downgrades user to Standard. Does not process a refund.</p>
                    </div>
                  )}

                </div>
              )}

              {/* TAB: MODERATION */}
              {drawerTab === 'MODERATION' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-zinc-950 border-2 border-zinc-800 p-4 text-center">
                      <span className="block text-[9px] text-zinc-500 font-black uppercase tracking-widest mb-1 flex items-center justify-center gap-1">
                        <Activity className="w-3 h-3" /> Risk Score
                      </span>
                      <span className={`text-3xl font-black ${(selectedUser.behavior?.riskScore || 0) > 80 ? 'text-red-500' : (selectedUser.behavior?.riskScore || 0) > 40 ? 'text-yellow-500' : 'text-green-500'}`}>
                        {selectedUser.behavior?.riskScore || 0}
                        <span className="text-xs text-zinc-600">/100</span>
                      </span>
                    </div>
                    <div className="bg-zinc-950 border-2 border-zinc-800 p-4 text-center">
                      <span className="block text-[9px] text-zinc-500 font-black uppercase tracking-widest mb-1 flex items-center justify-center gap-1">
                        <Flag className="w-3 h-3 text-orange-500" /> Active Flags
                      </span>
                      <span className={`text-3xl font-black ${(selectedUser.behavior?.flags || 0) > 0 ? 'text-orange-500' : 'text-zinc-600'}`}>
                        {selectedUser.behavior?.flags || 0}
                      </span>
                    </div>
                  </div>

                  <div className="bg-zinc-950 border-2 border-red-900/50 p-6 space-y-4">
                    <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> Enforcement Action
                    </h4>
                    <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest leading-relaxed">
                      Banning a user immediately terminates all active web socket connections, nullifies their auth tokens, and blocks their IP address from future registration.
                    </p>
                    
                    <button 
                      onClick={() => handleToggleBan(selectedUser.id)}
                      className={`w-full py-4 border-2 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-colors ${
                        selectedUser.status === 'BANNED' 
                          ? 'border-green-500 text-green-500 hover:bg-green-500 hover:text-black'
                          : 'border-red-500 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-black shadow-[4px_4px_0px_rgba(var(--danger-rgb), 0.2)] hover:shadow-none translate-y-0 hover:translate-y-1 hover:translate-x-1'
                      }`}
                    >
                      {selectedUser.status === 'BANNED' ? (
                        <><ShieldCheck className="w-4 h-4" /> Remove Ban & Restore Access</>
                      ) : (
                        <><Ban className="w-4 h-4" /> Terminate Account (Ban)</>
                      )}
                    </button>
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