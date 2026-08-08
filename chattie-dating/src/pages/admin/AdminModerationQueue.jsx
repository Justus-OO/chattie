import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, ShieldCheck, UserX, UserCheck, 
  Search, Flag, AlertTriangle, MessageSquare, 
  ExternalLink, RefreshCcw, Filter, CheckCircle2,
  Terminal, Shield, EyeOff, Gavel, FileText, 
  Settings, Lock, Unlock, Activity, Smartphone, Globe, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { adminService } from '../../api/admin.service';

// ============================================================================
// COMPONENT: ADMIN MODERATION QUEUE
// ============================================================================
export default function AdminModerationQueue() {
  // Navigation & Filter State
  const [activeTab, setActiveTab] = useState('QUEUE'); // QUEUE, AUDIT, RULES
  const [filterSeverity, setFilterSeverity] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Data State
  const [isLoading, setIsLoading] = useState(true);
  const [queue, setQueue] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [firewallRules, setFirewallRules] = useState([]);
  
  // Incident Review Drawer State
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [investigationTab, setInvestigationTab] = useState('EVIDENCE');
  const [actionNote, setActionNote] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Stats Telemetry Simulation
  const [telemetry, setTelemetry] = useState({
    scanned: 14592,
    autoBlocked: 142,
    firewall: 'STABLE'
  });

  // ============================================================================
  // DATA FETCHING
  // ============================================================================
  const fetchModerationData = async () => {
    setIsLoading(true);
    try {
      const [queueData, auditData, rulesData] = await Promise.all([
        adminService.getModerationQueue(),
        adminService.getModerationAuditLogs(),
        adminService.getFirewallRules()
      ]);
      
      setQueue(queueData || []);
      setAuditLogs(auditData || []);
      setFirewallRules(rulesData || []);
    } catch (error) {
      console.error("Failed to load T&S data:", error);
      toast.error("Failed to connect to Moderation Engine");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchModerationData();

    // Fun background telemetry ticker
    const interval = setInterval(() => {
      setTelemetry(prev => ({
        ...prev,
        scanned: prev.scanned + Math.floor(Math.random() * 50),
        autoBlocked: prev.autoBlocked + (Math.random() > 0.8 ? 1 : 0),
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // ============================================================================
  // ACTION HANDLERS
  // ============================================================================
  const handleResolveIncident = async (actionType) => {
    if (!selectedIncident) return;
    if (!actionNote.trim() && actionType !== 'DISMISS') {
      toast.error('Audit notes are required for punitive actions.');
      return;
    }

    setIsProcessing(true);
    
    try {
      await adminService.resolveIncident(
        selectedIncident.id,
        selectedIncident.userId,
        actionType,
        actionNote
      );

      toast.success(`Action: [${actionType}] executed on ${selectedIncident.user}`);
      
      // Update UI state
      setQueue(prev => prev.filter(item => item.id !== selectedIncident.id));
      setSelectedIncident(null);
      setActionNote('');
      
      // Refresh audit logs in the background so the new action appears
      const updatedLogs = await adminService.getModerationAuditLogs();
      setAuditLogs(updatedLogs || []);
      
    } catch (error) {
      toast.error("Failed to execute moderation action");
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleRule = async (id) => {
    try {
      await adminService.toggleFirewallRule(id);
      setFirewallRules(prev => prev.map(r => r.id === id ? { ...r, active: !r.active } : r));
      toast.success('Firewall rule state toggled successfully.');
    } catch (error) {
      toast.error("Failed to toggle firewall rule");
    }
  };

  const filteredQueue = queue.filter(item => {
    const matchesSeverity = filterSeverity === 'ALL' || item.severity === filterSeverity;
    const matchesSearch = item.user.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.type.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSeverity && matchesSearch;
  });

  return (
    <div className="flex-1 bg-black min-h-screen text-zinc-300 font-mono flex flex-col rounded-none overflow-hidden relative" style={{ fontFamily: 'Roboto, sans-serif' }}>
      
      {/* =========================================
          TOP TELEMETRY BAR
          ========================================= */}
      <div className="border-b-2 border-zinc-800 bg-zinc-950 p-4 flex flex-wrap justify-between items-center text-[10px] uppercase font-black tracking-widest shrink-0 gap-4 z-10 relative">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2 text-red-500">
            <ShieldAlert className="w-4 h-4 animate-pulse" /> T&S FIREWALL ACTIVE
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden sm:inline-block">
            MESSAGES SCANNED (24H): <span className="text-white">{telemetry.scanned.toLocaleString()}</span>
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden md:inline-block">
            AUTO-BLOCKS: <span className="text-green-400">{telemetry.autoBlocked}</span>
          </span>
        </div>
        <button 
          onClick={() => { fetchModerationData(); toast('Refreshing Moderation Engine Data...'); }} 
          className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors bg-black border-2 border-zinc-800 px-3 py-1"
        >
          <RefreshCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">SYNC DATA</span>
        </button>
      </div>

      {/* =========================================
          MAIN HEADER & TABS
          ========================================= */}
      <div className="p-6 md:p-8 border-b-2 border-zinc-800 bg-black shrink-0 flex flex-col gap-6 z-10 relative">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-3">
              <Flag className="w-8 h-8 text-red-500" /> Trust & Safety Center
            </h1>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
              REVIEW FLAGS, ENFORCE COMPLIANCE, AND MANAGE AUTOMATED DEFENSES
            </p>
          </div>
          
          <div className="flex items-center gap-2 bg-zinc-950 border-2 border-zinc-800 px-4 py-2">
            <Activity className="w-4 h-4 text-green-500 animate-pulse" />
            <span className="text-xs font-black text-white uppercase tracking-widest">SYSTEM SECURE</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-2 border-b-2 border-zinc-800">
          {[
            { id: 'QUEUE', label: `ACTIVE QUEUE (${queue.length})`, icon: AlertTriangle },
            { id: 'AUDIT', label: 'AUDIT LOGS', icon: FileText },
            { id: 'RULES', label: 'FIREWALL RULES', icon: Settings }
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
      <div className="flex-1 overflow-y-auto custom-scrollbar relative">
        
        {isLoading ? (
          <div className="flex items-center justify-center h-full w-full p-20">
            <Loader2 className="w-10 h-10 text-zinc-600 animate-spin" />
          </div>
        ) : (
          <>
            {/* =========================================
                TAB: ACTIVE QUEUE
                ========================================= */}
            {activeTab === 'QUEUE' && (
              <div className="p-6 md:p-8 space-y-6">
                
                {/* Filters & Search */}
                <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-zinc-950 p-4 border-2 border-zinc-800">
                  <div className="flex items-center gap-2 w-full md:w-auto">
                    <Search className="w-4 h-4 text-zinc-500" />
                    <input 
                      type="text" 
                      placeholder="SEARCH USERS OR OFFENSES..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-transparent border-none outline-none text-xs font-bold text-white uppercase tracking-widest w-full md:w-64 placeholder:text-zinc-600"
                    />
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto custom-scrollbar pb-1 md:pb-0">
                    <Filter className="w-4 h-4 text-zinc-500 shrink-0" />
                    {['ALL', 'CRITICAL', 'HIGH', 'MEDIUM'].map(sev => (
                      <button
                        key={sev}
                        onClick={() => setFilterSeverity(sev)}
                        className={`px-4 py-1.5 text-[9px] font-black uppercase tracking-widest border-2 shrink-0 transition-colors ${
                          filterSeverity === sev ? 'bg-white text-black border-white' : 'bg-black text-zinc-500 border-zinc-800 hover:border-zinc-600'
                        }`}
                      >
                        {sev}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Queue List View */}
                <div className="space-y-4">
                  {filteredQueue.length === 0 ? (
                    <div className="p-16 border-2 border-dashed border-zinc-800 flex flex-col items-center justify-center text-center bg-zinc-950/50">
                      <ShieldCheck className="w-12 h-12 text-green-500 mb-4" />
                      <h3 className="text-xl font-black text-white uppercase tracking-widest mb-2">Queue Clear</h3>
                      <p className="text-xs text-zinc-500 uppercase font-bold">No active compliance flags matching filters.</p>
                    </div>
                  ) : (
                    filteredQueue.map(item => (
                      <div key={item.id} className="border-2 border-zinc-800 bg-zinc-950 p-0 flex flex-col lg:flex-row hover:border-zinc-600 transition-colors group">
                        
                        {/* Left Risk Indicator Bar */}
                        <div className={`w-full lg:w-2 ${item.severity === 'CRITICAL' ? 'bg-red-600' : item.severity === 'HIGH' ? 'bg-orange-500' : 'bg-yellow-400'}`}></div>
                        
                        {/* Content Section */}
                        <div className="flex-1 p-6 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                          <div className="space-y-3 flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`px-2 py-0.5 text-[9px] font-black uppercase border ${
                                item.severity === 'CRITICAL' ? 'bg-red-500/10 text-red-500 border-red-500/30' : 
                                item.severity === 'HIGH' ? 'bg-orange-500/10 text-orange-400 border-orange-500/30' : 
                                'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
                              }`}>
                                {item.severity} RISK
                              </span>
                              <span className="text-[9px] text-zinc-500 font-bold font-mono px-2 py-0.5 bg-black border border-zinc-800">
                                {item.time}
                              </span>
                              <span className="text-[9px] font-black text-blue-400 bg-blue-500/10 px-2 py-0.5 border border-blue-500/30">
                                TARGET: {item.targetProfile}
                              </span>
                            </div>

                            <div>
                              <h3 className="text-sm font-black text-white uppercase tracking-wider mb-1 flex items-center gap-2 truncate">
                                <AlertTriangle className={`w-4 h-4 ${item.severity === 'CRITICAL' ? 'text-red-500' : 'text-zinc-400'}`} /> 
                                {item.type}
                              </h3>
                              <p className="text-xs text-zinc-400 font-bold uppercase font-mono bg-black p-3 border border-zinc-900 mt-2 truncate">
                                "{item.content}"
                              </p>
                            </div>

                            <div className="text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-4">
                              <span>User: <span className="text-white font-mono">{item.user}</span></span>
                              <span className="hidden sm:inline">|</span>
                              <span className="hidden sm:inline">Score: <span className="text-red-400 font-black">{item.riskScore}/100</span></span>
                            </div>
                          </div>

                          {/* Action Area */}
                          <div className="flex flex-col items-end gap-3 w-full lg:w-48 shrink-0 border-t-2 lg:border-t-0 lg:border-l-2 border-zinc-800 pt-4 lg:pt-0 lg:pl-6">
                            <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-1">
                              <Activity className="w-3 h-3" /> Status: {item.status}
                            </span>
                            <button 
                              onClick={() => setSelectedIncident(item)}
                              className="w-full py-3 bg-white border-2 border-white text-black hover:bg-black hover:text-white text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2 shadow-[4px_4px_0px_rgba(255,255,255,0.2)] hover:shadow-none translate-y-0 hover:translate-y-1 hover:translate-x-1"
                            >
                              <Search className="w-4 h-4" /> Investigate
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* =========================================
                TAB: AUDIT LOGS
                ========================================= */}
            {activeTab === 'AUDIT' && (
              <div className="p-6 md:p-8">
                <div className="bg-zinc-950 border-2 border-zinc-800 overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono whitespace-nowrap">
                    <thead className="bg-black border-b-2 border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-widest">
                      <tr>
                        <th className="p-4">Date/Time</th>
                        <th className="p-4">Admin/System</th>
                        <th className="p-4">Action Taken</th>
                        <th className="p-4">Target User</th>
                        <th className="p-4">Reason / Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-zinc-900 text-zinc-300 font-bold uppercase tracking-wide">
                      {auditLogs.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="p-12 text-center text-zinc-500 uppercase tracking-widest">NO RECENT AUDIT ACTIVITY</td>
                        </tr>
                      ) : (
                        auditLogs.map(log => (
                          <tr key={log.id} className="hover:bg-zinc-900 transition-colors">
                            <td className="p-4 text-zinc-500">{log.date} {log.time}</td>
                            <td className="p-4 flex items-center gap-2">
                              {log.admin === 'SYSTEM_AUTO' ? <Terminal className="w-3 h-3 text-yellow-500" /> : <Shield className="w-3 h-3 text-blue-500" />}
                              {log.admin}
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-1 text-[9px] font-black border ${
                                log.action.includes('BAN') || log.action.includes('BLOCK') 
                                  ? 'bg-red-500/10 text-red-500 border-red-500/30' 
                                  : 'bg-zinc-800 text-white border-zinc-600'
                              }`}>
                                {log.action}
                              </span>
                            </td>
                            <td className="p-4 text-white">{log.target}</td>
                            <td className="p-4 truncate max-w-xs">{log.reason}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* =========================================
                TAB: FIREWALL RULES (AUTOMOD)
                ========================================= */}
            {activeTab === 'RULES' && (
              <div className="p-6 md:p-8 max-w-4xl space-y-6">
                <div className="mb-6">
                  <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-yellow-400" /> Automated Defenses
                  </h2>
                  <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
                    Configure threshold rules to instantly block or flag malicious behavior without human intervention.
                  </p>
                </div>

                <div className="space-y-4">
                  {firewallRules.map(rule => (
                    <div key={rule.id} className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 group hover:border-zinc-600 transition-colors">
                      <div className="flex-1">
                        <h3 className="text-sm font-black text-white uppercase tracking-wider mb-1 flex items-center gap-2">
                          {rule.active ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <AlertTriangle className="w-4 h-4 text-zinc-600" />}
                          {rule.name}
                        </h3>
                        <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
                          {rule.desc}
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-3">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${rule.active ? 'text-green-400' : 'text-zinc-600'}`}>
                          {rule.active ? 'ACTIVE' : 'DISABLED'}
                        </span>
                        <button 
                          onClick={() => toggleRule(rule.id)}
                          className={`relative inline-flex h-6 w-11 items-center border-2 transition-colors ${rule.active ? 'bg-green-500 border-green-500' : 'bg-black border-zinc-600'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform bg-white transition-transform ${rule.active ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 p-6 bg-black border-2 border-dashed border-zinc-800 text-center">
                  <Lock className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
                  <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-1">ADVANCED HEURISTICS LOCKED</h4>
                  <p className="text-[10px] text-zinc-600 font-bold uppercase">Root super-admin clearance required to modify deep-packet inspection rules.</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* =====================================================================
          INCIDENT INVESTIGATION DRAWER / MODAL
          ===================================================================== */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedIncident(null)} />
          
          <div className="relative w-full max-w-2xl h-full bg-black border-l-2 border-zinc-800 shadow-[[-10px_0_30px_rgba(0,0,0,0.8)]] flex flex-col animate-in slide-in-from-right-full duration-300">
            
            {/* Modal Header */}
            <div className="p-6 bg-zinc-950 border-b-2 border-zinc-800 shrink-0 flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 text-[9px] font-black uppercase border ${selectedIncident.severity === 'CRITICAL' ? 'bg-red-500/10 text-red-500 border-red-500' : 'bg-orange-500/10 text-orange-400 border-orange-500'}`}>
                    {selectedIncident.severity} PRIORITY
                  </span>
                  <span className="text-[10px] text-zinc-500 font-bold font-mono">ID: {selectedIncident.id}</span>
                </div>
                <h2 className="text-xl font-black text-white uppercase tracking-widest flex items-center gap-2">
                  INVESTIGATION: {selectedIncident.user}
                </h2>
              </div>
              <button onClick={() => setSelectedIncident(null)} className="p-2 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 bg-black transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Internal Tabs */}
            <div className="flex bg-black border-b-2 border-zinc-800 shrink-0 px-6 pt-4 gap-4">
              {['EVIDENCE', 'TELEMETRY', 'TAKE ACTION'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setInvestigationTab(tab)}
                  className={`pb-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-colors ${
                    investigationTab === tab ? 'border-white text-white' : 'border-transparent text-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Modal Content Scroll Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
              
              {investigationTab === 'EVIDENCE' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  <div className="bg-zinc-950 border-2 border-zinc-800 p-4">
                    <h4 className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">SYSTEM FLAG REASON</h4>
                    <p className="text-sm font-bold text-white uppercase font-mono">{selectedIncident.content}</p>
                  </div>

                  <div>
                    <h4 className="text-[10px] font-black text-white uppercase tracking-widest mb-3 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-blue-400" /> Chat Logs (Context)
                    </h4>
                    <div className="bg-black border-2 border-zinc-800 p-4 space-y-4 font-mono text-xs">
                      {selectedIncident.evidence && selectedIncident.evidence.length > 0 ? (
                        selectedIncident.evidence.map((msg, i) => (
                          <div key={i} className={`p-3 border-2 ${msg.sender === selectedIncident.user ? 'border-red-500/50 bg-red-500/5' : 'border-zinc-800 bg-zinc-950'} flex flex-col gap-1`}>
                            <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-zinc-500">
                              <span className={msg.sender === selectedIncident.user ? 'text-red-400' : 'text-zinc-400'}>{msg.sender}</span>
                              <span>{msg.time}</span>
                            </div>
                            <span className="text-zinc-200 font-bold uppercase leading-relaxed">{msg.text}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-zinc-500 italic">No chat evidence linked to this incident.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {investigationTab === 'TELEMETRY' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-zinc-950 border-2 border-zinc-800 p-4">
                      <h4 className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <Activity className="w-3 h-3" /> Fraud Risk Score
                      </h4>
                      <div className={`text-3xl font-black uppercase tracking-widest ${selectedIncident.riskScore > 80 ? 'text-red-500' : 'text-yellow-500'}`}>
                        {selectedIncident.riskScore}
                        <span className="text-xs text-zinc-600">/100</span>
                      </div>
                    </div>
                    <div className="bg-zinc-950 border-2 border-zinc-800 p-4">
                      <h4 className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <ShieldAlert className="w-3 h-3" /> User History
                      </h4>
                      <div className="text-sm font-black text-white uppercase tracking-widest mt-2">
                        {selectedIncident.history}
                      </div>
                    </div>
                  </div>

                  <div className="bg-black border-2 border-zinc-800 p-6 space-y-4">
                    <h4 className="text-[10px] font-black text-white uppercase tracking-widest mb-4 border-b-2 border-zinc-800 pb-2">Hardware & Network Fingerprint</h4>
                    
                    <div className="flex justify-between items-center text-xs font-mono uppercase font-bold">
                      <span className="text-zinc-500 flex items-center gap-2"><Globe className="w-4 h-4" /> IP Address</span>
                      <span className="text-white bg-zinc-900 px-2 py-1">{selectedIncident.ip}</span>
                    </div>
                    
                    <div className="flex justify-between items-center text-xs font-mono uppercase font-bold">
                      <span className="text-zinc-500 flex items-center gap-2"><MapPin className="w-4 h-4" /> Location (GeoIP)</span>
                      <span className="text-white bg-zinc-900 px-2 py-1">{selectedIncident.location}</span>
                    </div>

                    <div className="flex justify-between items-center text-xs font-mono uppercase font-bold">
                      <span className="text-zinc-500 flex items-center gap-2"><Smartphone className="w-4 h-4" /> Device Hash</span>
                      <span className="text-zinc-400 bg-zinc-900 px-2 py-1 truncate max-w-[150px]">a8f9d...29c</span>
                    </div>
                  </div>
                </div>
              )}

              {investigationTab === 'TAKE ACTION' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  
                  <div className="bg-zinc-950 border-2 border-zinc-800 p-4">
                    <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Required Internal Audit Note</label>
                    <textarea 
                      value={actionNote}
                      onChange={(e) => setActionNote(e.target.value)}
                      placeholder="ENTER REASONING FOR ACTION TAKEN (VISIBLE TO STAFF ONLY)..."
                      className="w-full bg-black border-2 border-zinc-700 p-3 text-xs text-white font-mono font-bold resize-none h-24 focus:border-white outline-none transition-colors"
                    />
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Punitive Actions</h4>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        onClick={() => handleResolveIncident('FORMAL WARNING')}
                        disabled={isProcessing}
                        className="py-3 px-4 bg-black border-2 border-yellow-500 text-yellow-500 hover:bg-yellow-500 hover:text-black font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <AlertTriangle className="w-3 h-3" /> Issue Warning
                      </button>
                      <button 
                        onClick={() => handleResolveIncident('SHADOWBAN')}
                        disabled={isProcessing}
                        className="py-3 px-4 bg-black border-2 border-purple-500 text-purple-500 hover:bg-purple-500 hover:text-black font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <EyeOff className="w-3 h-3" /> Shadowban (Ghost)
                      </button>
                      <button 
                        onClick={() => handleResolveIncident('DEVICE/IP BAN')}
                        disabled={isProcessing}
                        className="py-3 px-4 bg-black border-2 border-red-500 text-red-500 hover:bg-red-500 hover:text-black font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2 col-span-2 disabled:opacity-50"
                      >
                        <Gavel className="w-3 h-3" /> Hard Ban (Account + IP)
                      </button>
                    </div>
                  </div>

                  <div className="pt-6 border-t-2 border-zinc-800">
                    <button 
                      onClick={() => handleResolveIncident('DISMISS')}
                      disabled={isProcessing}
                      className="w-full py-4 bg-zinc-900 border-2 border-zinc-700 text-white hover:border-white font-black text-[10px] uppercase tracking-widest transition-colors disabled:opacity-50"
                    >
                      {isProcessing ? 'PROCESSING...' : 'DISMISS FLAG (FALSE ALARM)'}
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