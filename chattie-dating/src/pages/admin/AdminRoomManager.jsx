import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, Mic, Lock, Unlock, Users, ShieldAlert, 
  Search, Filter, Activity, Server, Zap, X, ChevronRight, 
  CheckCircle2, Ban, Radio, RefreshCcw, PowerOff, ShieldCheck, 
  Terminal, UserX, AlertTriangle, KeyRound, ArrowRightLeft,
  Volume2, VolumeX, Eye, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { adminService } from '../../api/admin.service';

// ============================================================================
// COMPONENT: ADMIN ROOM MANAGER
// ============================================================================
export default function AdminRoomManager() {
  const [activeTab, setActiveTab] = useState('DIRECTORY'); // DIRECTORY, KNOCKS, BALANCER
  const [isLoading, setIsLoading] = useState(true);
  
  // Tab 1: Directory State
  const [rooms, setRooms] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('ALL'); // ALL, TEXT, VOICE, PRIVATE
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [roomParticipants, setRoomParticipants] = useState([]);
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(false);

  // Tab 2: Knocks State
  const [knocks, setKnocks] = useState([]);

  // Telemetry state
  const [telemetry, setTelemetry] = useState({
    globalCapacity: '42%',
    activeConnections: 1459,
    avgWaitTime: '14.2s',
    dropRate: '0.4%'
  });

  // ============================================================================
  // DATA FETCHING
  // ============================================================================
  const fetchRoomData = async () => {
    try {
      setIsLoading(true);
      const [roomsData, knocksData] = await Promise.all([
        adminService.getRooms(),
        adminService.getKnocks()
      ]);
      
      setRooms(roomsData || []);
      setKnocks(knocksData || []);
    } catch (error) {
      console.error("Failed to fetch space telemetry", error);
      toast.error("Failed to sync room control cluster");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRoomData();
  }, []);

  const openRoomInspector = async (room) => {
    setSelectedRoom(room);
    try {
      setIsLoadingParticipants(true);
      const participantsData = await adminService.getRoomParticipants(room.id);
      setRoomParticipants(participantsData || []);
    } catch (error) {
      toast.error("Failed to load room participants");
    } finally {
      setIsLoadingParticipants(false);
    }
  };

  // Simulate real-time routing fluctuations
  useEffect(() => {
    const interval = setInterval(() => {
      setTelemetry(prev => ({
        ...prev,
        activeConnections: prev.activeConnections + Math.floor(Math.random() * 10 - 4),
        globalCapacity: `${Math.floor(Math.random() * 5 + 40)}%`,
      }));
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  // ============================================================================
  // ACTIONS & API CALLS
  // ============================================================================
  const handleForceCloseRoom = async (roomId) => {
    try {
      await adminService.terminateRoom(roomId);
      setRooms(prev => prev.filter(r => r.id !== roomId));
      toast.error(`SYS: Room ${roomId} has been forcibly terminated.`);
      setSelectedRoom(null);
    } catch (error) {
      toast.error("Failed to terminate space");
    }
  };

  const handleKickUser = async (userId) => {
    if (!selectedRoom) return;
    try {
      await adminService.kickRoomParticipant(selectedRoom.id, userId);
      setRoomParticipants(prev => prev.filter(p => p.id !== userId));
      toast.success(`User kicked from the room.`);
      fetchRoomData(); // Refresh room counts
    } catch (error) {
      toast.error("Failed to kick participant");
    }
  };

  const handleResolveKnock = async (id, action) => {
    try {
      await adminService.resolveKnock(id, action);
      setKnocks(prev => prev.filter(k => k.id !== id));
      toast(action === 'APPROVE' ? 'Access Granted.' : 'Access Denied.');
    } catch (error) {
      toast.error("Failed to resolve access request");
    }
  };

  // Filters
  const filteredRooms = rooms.filter(r => {
    const matchesSearch = (r.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (r.id || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (r.host || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    let matchesType = true;
    if (filterType === 'TEXT') matchesType = r.type === 'TEXT';
    if (filterType === 'VOICE') matchesType = r.type === 'VOICE';
    if (filterType === 'PRIVATE') matchesType = r.isPrivate === true;

    return matchesSearch && matchesType;
  });

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black font-mono text-zinc-300 rounded-none" style={{ fontFamily: 'Roboto, sans-serif' }}>
      
      {/* =========================================
          TOP TELEMETRY BAR
          ========================================= */}
      <div className="border-b-2 border-zinc-800 bg-zinc-950 p-4 flex flex-wrap justify-between items-center text-[10px] uppercase font-black tracking-widest shrink-0 gap-4 z-10 relative">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2 text-blue-500">
            <Radio className="w-4 h-4 animate-pulse" /> NETWORK ROUTER ACTIVE
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden sm:inline-block">
            ACTIVE WEBSOCKETS: <span className="text-white">{telemetry.activeConnections.toLocaleString()}</span>
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden md:inline-block">
            GLOBAL CAPACITY: <span className={parseInt(telemetry.globalCapacity) > 80 ? 'text-red-500' : 'text-green-400'}>{telemetry.globalCapacity}</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-zinc-500 hidden sm:inline-block">AVG QUEUE WAIT: <span className="text-yellow-400">{telemetry.avgWaitTime}</span></span>
          <button 
            onClick={() => { fetchRoomData(); toast('Telemetry refreshed.'); }}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors bg-black border-2 border-zinc-800 px-3 py-1"
          >
            <RefreshCcw className="w-3.5 h-3.5" /> <span className="hidden sm:inline">SYNC</span>
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
              <ArrowRightLeft className="w-8 h-8 text-blue-500" /> Space & Routing Control
            </h1>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
              MANAGE PUBLIC LOUNGES, VOICE STAGES, PRIVATE KNOCKS, AND TRAFFIC BALANCING
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-2 border-b-2 border-zinc-800">
          {[
            { id: 'DIRECTORY', label: `ACTIVE SPACES (${rooms.length})`, icon: Server },
            { id: 'KNOCKS', label: `GLOBAL KNOCKS (${knocks.length})`, icon: KeyRound },
            { id: 'BALANCER', label: 'LOAD BALANCER', icon: Zap }
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
              {tab.id === 'KNOCKS' && knocks.length > 0 && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse ml-1" />}
            </button>
          ))}
        </div>
      </div>

      {/* =========================================
          TAB CONTENT AREA
          ========================================= */}
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar relative">
        
        {isLoading ? (
          <div className="flex items-center justify-center h-full w-full p-20">
            <Loader2 className="w-10 h-10 text-zinc-600 animate-spin" />
          </div>
        ) : (
          <>
            {/* =========================================
                TAB 1: DIRECTORY (ROOM MANAGER)
                ========================================= */}
            {activeTab === 'DIRECTORY' && (
              <div className="p-2 sm:p-3 lg:p-4 space-y-4">
                
                {/* Filters & Search */}
                <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-zinc-950 p-4 border-2 border-zinc-800">
                  <div className="flex items-center gap-2 w-full md:w-auto">
                    <Search className="w-4 h-4 text-zinc-500" />
                    <input 
                      type="text" 
                      placeholder="SEARCH ROOM ID, NAME, OR HOST..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full border-none bg-transparent text-xs font-bold uppercase tracking-widest text-white outline-none placeholder:text-zinc-600 md:w-[clamp(16rem,26vw,20rem)]"
                    />
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto custom-scrollbar pb-1 md:pb-0">
                    <Filter className="w-4 h-4 text-zinc-500 shrink-0" />
                    {['ALL', 'TEXT', 'VOICE', 'PRIVATE'].map(type => (
                      <button
                        key={type}
                        onClick={() => setFilterType(type)}
                        className={`px-4 py-1.5 text-[9px] font-black uppercase tracking-widest border-2 shrink-0 transition-colors ${
                          filterType === type ? 'bg-white text-black border-white' : 'bg-black text-zinc-500 border-zinc-800 hover:border-zinc-600'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Room Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredRooms.length === 0 ? (
                    <div className="col-span-full p-16 border-2 border-dashed border-zinc-800 text-center bg-zinc-950/50">
                      <Server className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                      <h3 className="text-xl font-black text-white uppercase tracking-widest mb-2">No Active Spaces</h3>
                      <p className="text-xs text-zinc-500 uppercase font-bold">No rooms match your current filters.</p>
                    </div>
                  ) : (
                    filteredRooms.map(room => (
                      <div 
                        key={room.id} 
                        onClick={() => openRoomInspector(room)}
                        className={`bg-zinc-950 border-2 p-5 flex flex-col cursor-pointer transition-all group ${
                          room.warningLevel > 0 ? 'border-red-900/50 hover:border-red-500' : 'border-zinc-800 hover:border-zinc-500'
                        }`}
                      >
                        {/* Card Header */}
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-2">
                            {room.type === 'TEXT' ? (
                              <div className="p-1.5 bg-blue-500/10 border border-blue-500/30 text-blue-400"><MessageSquare className="w-4 h-4" /></div>
                            ) : (
                              <div className="p-1.5 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400"><Mic className="w-4 h-4" /></div>
                            )}
                            {room.isPrivate && <div className="p-1.5 bg-zinc-800 border border-zinc-700 text-zinc-400"><Lock className="w-4 h-4" /></div>}
                          </div>
                          <span className={`px-2 py-1 text-[9px] font-black border uppercase ${room.warningLevel > 0 ? 'bg-red-500/10 text-red-500 border-red-500/30' : 'bg-green-500/10 text-green-400 border-green-500/30'}`}>
                            {room.status}
                          </span>
                        </div>

                        {/* Room Info */}
                        <div className="flex-1 mb-6">
                          <h3 className="text-sm font-black text-white uppercase tracking-widest mb-1 truncate group-hover:text-blue-400 transition-colors">{room.name}</h3>
                          <p className="text-[10px] text-zinc-500 font-bold font-mono">ID: {room.id} | UP: {room.uptime}</p>
                          
                          <div className="mt-4 flex flex-wrap gap-1.5">
                            {room.tags && room.tags.map(tag => (
                              <span key={tag} className="text-[8px] bg-black text-zinc-400 border border-zinc-800 px-1.5 py-0.5 font-black uppercase tracking-widest">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Footer Stats */}
                        <div className="mt-auto pt-4 border-t-2 border-zinc-800 flex justify-between items-end">
                          <div>
                            <span className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">Host / Creator</span>
                            <span className="block max-w-[clamp(8rem,16vw,12rem)] truncate text-xs font-bold uppercase text-white">{room.host}</span>
                          </div>
                          <div className="text-right">
                            <span className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1 flex items-center justify-end gap-1"><Users className="w-3 h-3" /> Capacity</span>
                            <span className={`text-xs font-black uppercase ${room.participants >= room.limit * 0.9 ? 'text-red-500' : 'text-white'}`}>
                              {room.participants} / {room.limit}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* =========================================
                TAB 2: GLOBAL KNOCKS (ACCESS QUEUE)
                ========================================= */}
            {activeTab === 'KNOCKS' && (
              <div className="w-full p-2 sm:p-3 lg:p-4 space-y-4">
                <div className="mb-6 bg-zinc-950 border-2 border-zinc-800 p-6 flex items-start gap-4">
                  <KeyRound className="w-8 h-8 text-blue-500 shrink-0" />
                  <div>
                    <h2 className="text-lg font-black text-white uppercase tracking-widest mb-2">Global Access Override Queue</h2>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest leading-relaxed">
                      While room hosts usually approve entries, system administrators can oversee all pending private room requests here. You can manually grant access to VIPs or bulk-reject suspicious accounts.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  {knocks.length === 0 ? (
                    <div className="p-12 border-2 border-dashed border-zinc-800 text-center bg-zinc-950/50">
                      <ShieldCheck className="w-8 h-8 text-green-500 mx-auto mb-3" />
                      <h3 className="text-sm font-black text-white uppercase tracking-widest">Queue Clear</h3>
                      <p className="text-[10px] text-zinc-500 uppercase font-bold">No pending access requests.</p>
                    </div>
                  ) : (
                    knocks.map(knock => (
                      <div key={knock.id} className="bg-black border-2 border-zinc-800 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 hover:border-zinc-600 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <span className={`px-2 py-0.5 text-[9px] font-black uppercase border ${knock.tier === 'VIP' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' : 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
                              {knock.tier}
                            </span>
                            <span className="text-xs font-black text-white truncate">{knock.user}</span>
                            <span className="text-[10px] text-zinc-500 font-mono">[{knock.time}]</span>
                          </div>
                          <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                            <Lock className="w-3 h-3 text-zinc-500" /> Target: <span className="text-blue-400 truncate">{knock.targetRoom}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 w-full sm:w-auto shrink-0 border-t-2 sm:border-t-0 border-zinc-800 pt-4 sm:pt-0">
                          <div className="text-center mr-4 hidden md:block">
                            <span className="block text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Risk Score</span>
                            <span className={`text-sm font-black ${knock.riskScore > 50 ? 'text-red-500' : 'text-green-400'}`}>{knock.riskScore}</span>
                          </div>
                          <div className="flex gap-2 w-full">
                            <button 
                              onClick={() => handleResolveKnock(knock.id, 'REJECT')}
                              className="flex-1 sm:flex-none px-4 py-2 border-2 border-red-900 text-red-500 hover:bg-red-500 hover:text-black font-black text-[10px] uppercase tracking-widest transition-colors"
                            >
                              Reject
                            </button>
                            <button 
                              onClick={() => handleResolveKnock(knock.id, 'APPROVE')}
                              className="flex-1 sm:flex-none px-4 py-2 bg-white text-black border-2 border-white hover:bg-zinc-200 font-black text-[10px] uppercase tracking-widest transition-colors"
                            >
                              Override Approve
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
                TAB 3: LOAD BALANCER (TELEMETRY)
                ========================================= */}
            {activeTab === 'BALANCER' && (
              <div className="p-2 sm:p-3 lg:p-4 space-y-4">
                <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b-2 border-zinc-800 pb-6">
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-2">
                      <Activity className="w-5 h-5 text-green-500" /> Matchmaking Telemetry
                    </h2>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                      Live visualization of incoming client traffic being routed to creator personas.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 bg-zinc-950 border-2 border-zinc-800">
                    <span className="text-[10px] font-black text-zinc-500 uppercase">Routing Engine:</span>
                    <span className="text-[10px] font-black text-green-400 uppercase flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> ONLINE (AUTO)</span>
                  </div>
                </div>

                <div className="grid h-[min(60dvh,42rem)] min-h-[35dvh] grid-cols-1 gap-6 lg:grid-cols-3">
                  
                  <div className="border-2 border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden relative">
                    <div className="p-4 bg-black border-b-2 border-zinc-800 flex justify-between items-center z-10 relative">
                      <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
                        <ArrowRightLeft className="w-4 h-4 text-blue-400" /> Ingress Traffic
                      </h3>
                      <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/30 px-2 py-0.5 font-bold">STREAM ACTIVE</span>
                    </div>
                    <div className="flex-1 p-6 flex flex-col justify-center text-center space-y-4">
                      <Server className="w-12 h-12 text-blue-500 mx-auto animate-pulse" />
                      <h4 className="text-sm font-black text-white uppercase">WebSocket Gateway</h4>
                      <p className="text-[10px] text-zinc-500">Routing standard room sockets & 1-on-1 signaling.</p>
                    </div>
                  </div>

                  <div className="hidden lg:flex flex-col items-center justify-center relative">
                    <div className="w-full h-0.5 bg-zinc-800 absolute top-1/2 -translate-y-1/2 -z-10"></div>
                    <div className="relative z-10 flex size-[clamp(6rem,12vw,8rem)] flex-col items-center justify-center rounded-full border-4 border-zinc-800 bg-black shadow-[0_0_50px_rgba(59,130,246,0.1)]">
                      <Server className="w-8 h-8 text-blue-500 mb-2 animate-pulse" />
                      <span className="text-[10px] font-black text-white uppercase tracking-widest">ROUTER_X1</span>
                    </div>
                    <div className="mt-8 text-center bg-zinc-950 border-2 border-zinc-800 p-3">
                      <span className="block text-[8px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Cluster Throughput</span>
                      <span className="text-sm font-black text-green-400 uppercase">1.4k Req/s</span>
                    </div>
                  </div>

                  <div className="border-2 border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden relative">
                    <div className="p-4 bg-black border-b-2 border-zinc-800 flex justify-between items-center z-10 relative">
                      <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
                        <Users className="w-4 h-4 text-green-400" /> Redis State Engine
                      </h3>
                    </div>
                    <div className="flex-1 p-6 flex flex-col justify-center text-center space-y-4">
                      <Zap className="w-12 h-12 text-yellow-400 mx-auto" />
                      <h4 className="text-sm font-black text-white uppercase">In-Memory Sync</h4>
                      <p className="text-[10px] text-zinc-500">Presence tracking and active session distribution operating at 99.9% uptime.</p>
                    </div>
                  </div>

                </div>
              </div>
            )}
          </>
        )}

      </div>

      {/* =====================================================================
          ROOM INSPECTION DRAWER (Slides out from right)
          ================================================================     */}
      {selectedRoom && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedRoom(null)} />
          
          <div className="relative w-full max-w-md h-full bg-black border-l-2 border-zinc-800 shadow-[[-10px_0_30px_rgba(0,0,0,0.8)]] flex flex-col animate-in slide-in-from-right-full duration-300">
            
            {/* Drawer Header */}
            <div className="p-6 bg-zinc-950 border-b-2 border-zinc-800 shrink-0">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 text-[9px] font-black uppercase border ${selectedRoom.type === 'TEXT' ? 'bg-blue-500/10 text-blue-400 border-blue-500' : 'bg-yellow-500/10 text-yellow-400 border-yellow-500'}`}>
                    {selectedRoom.type} ROOM
                  </span>
                  {selectedRoom.isPrivate && <Lock className="w-3 h-3 text-zinc-500" />}
                </div>
                <button onClick={() => setSelectedRoom(null)} className="p-1.5 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 bg-black transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <h2 className="text-xl font-black text-white uppercase tracking-widest break-words leading-tight">
                {selectedRoom.name}
              </h2>
              <div className="mt-3 text-[10px] text-zinc-400 font-mono font-bold flex flex-wrap items-center gap-x-4 gap-y-2">
                <span>ID: {selectedRoom.id}</span>
                <span>UP: {selectedRoom.uptime}</span>
              </div>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
              
              {/* Room Stats */}
              <div>
                <h4 className="text-[10px] font-black text-white uppercase tracking-widest mb-3 border-b-2 border-zinc-800 pb-2">Space Telemetry</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-zinc-950 border-2 border-zinc-800 p-3">
                    <span className="block text-[8px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Host/Creator</span>
                    <span className="text-xs font-black text-white uppercase truncate block">{selectedRoom.host}</span>
                  </div>
                  <div className="bg-zinc-950 border-2 border-zinc-800 p-3">
                    <span className="block text-[8px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Capacity</span>
                    <span className={`text-xs font-black uppercase block ${selectedRoom.participants >= selectedRoom.limit * 0.9 ? 'text-red-500' : 'text-green-400'}`}>
                      {selectedRoom.participants} / {selectedRoom.limit}
                    </span>
                  </div>
                  <div className="bg-zinc-950 border-2 border-zinc-800 p-3 col-span-2">
                    <span className="block text-[8px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Active Tags</span>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {selectedRoom.tags && selectedRoom.tags.map(t => <span key={t} className="px-1.5 py-0.5 bg-black border border-zinc-700 text-[9px] font-bold text-zinc-300">{t}</span>)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Participant List */}
              <div>
                <div className="flex justify-between items-center mb-3 border-b-2 border-zinc-800 pb-2">
                  <h4 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                    <Users className="w-3 h-3" /> Live Roster
                  </h4>
                  <span className="text-[9px] text-zinc-500 font-bold">{roomParticipants.length} LOADED</span>
                </div>
                
                {isLoadingParticipants ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="w-6 h-6 text-zinc-600 animate-spin" />
                  </div>
                ) : roomParticipants.length === 0 ? (
                  <p className="text-[10px] text-zinc-500 text-center py-4">No active participants in database.</p>
                ) : (
                  <div className="space-y-2">
                    {roomParticipants.map(p => (
                      <div key={p.id} className="flex items-center justify-between p-2 bg-black border border-zinc-800 group hover:border-zinc-600 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-zinc-900 border border-zinc-700 flex items-center justify-center">
                            <span className="text-[10px] font-black text-zinc-500">{p.name.charAt(0)}</span>
                          </div>
                          <div>
                            <span className="block text-[10px] font-black text-white uppercase">{p.name} {p.role === 'host' && '⭐'}</span>
                            <span className="block text-[8px] text-zinc-500 font-mono mt-0.5">{p.id} | IN: {p.joined}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {p.role !== 'host' && (
                            <button 
                              onClick={() => handleKickUser(p.id)}
                              className="p-1.5 bg-black border border-zinc-700 hover:border-red-500 text-zinc-400 hover:text-red-500 transition-colors" 
                              title="Kick User"
                            >
                              <UserX className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* Danger Zone Actions */}
            <div className="p-6 bg-zinc-950 border-t-2 border-zinc-800 shrink-0 space-y-3">
              <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                <AlertTriangle className="w-3 h-3" /> Super Admin Override
              </h4>
              <button 
                className="w-full py-3 bg-black border-2 border-zinc-700 hover:border-white text-zinc-400 hover:text-white font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                onClick={() => toast('Room set to invite-only.')}
              >
                <Lock className="w-3 h-3" /> Lock Room (Stop Ingress)
              </button>
              <button 
                onClick={() => handleForceCloseRoom(selectedRoom.id)}
                className="w-full py-4 bg-red-600 border-2 border-red-500 text-black hover:bg-black hover:text-red-500 font-black text-[11px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2 shadow-[4px_4px_0px_rgba(239,68,68,0.2)] hover:shadow-none translate-y-0 hover:translate-y-1 hover:translate-x-1"
              >
                <PowerOff className="w-4 h-4" /> Force Terminate Space
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}