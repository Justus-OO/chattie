import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, UserPlus, Search, Filter, ShieldCheck, 
  Activity, DollarSign, Clock, MessageSquare, 
  MoreVertical, CheckCircle2, AlertTriangle, X, 
  Lock, Unlock, ChevronRight, Link2, Unlink, 
  Percent, Terminal, BarChart3, Edit3, Trash2,
  Radio, Eye, Zap, ShieldAlert, UserX, Image as ImageIcon, 
  Bot, User, Loader2, Plus, Calendar, Camera, UploadCloud, 
  FileImage, Star, Upload, Database
} from 'lucide-react';
import { toast } from 'sonner';
import { adminService } from '../../api/admin.service';

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function AdminCreators() {
  const [activeTab, setActiveTab] = useState('ROSTER');
  const [creators, setCreators] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');

  // Drawers & Modals
  const [selectedCreator, setSelectedCreator] = useState(null);
  const [drawerTab, setDrawerTab] = useState('PERSONAS');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showCreatePersonaModal, setShowCreatePersonaModal] = useState(false);

  // Forms
  const [newOperatorForm, setNewOperatorForm] = useState({
    username: '',
    email: '',
    password: '',
    displayName: '',
    intent: 'companion',
  });

  const [newPersonaForm, setNewPersonaForm] = useState({
    name: '',
    archetype: 'Companion',
    avatarUrl: '',
    bio: '',
    gender: 'Female',
    dateOfBirth: '2000-01-01',
    height: 165
  });

  // Derived State
  const [activeOperators, setActiveOperators] = useState(0);
  const [activeChats, setActiveChats] = useState(0);

  // ============================================================================
  // VAULT STATE & LOGIC
  // ============================================================================
  const [selectedVaultPersona, setSelectedVaultPersona] = useState(null);
  const [vaultMedia, setVaultMedia] = useState([]);
  const [isLoadingGallery, setIsLoadingGallery] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [uploadFiles, setUploadFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  // ============================================================================
  // DATA FETCHING
  // ============================================================================
  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);
      const [rosterData, personasData] = await Promise.all([
        adminService.getOperatorRoster(),
        adminService.getPersonaMetrics()
      ]);
      
      setCreators(rosterData || []);
      setPersonas(personasData || []);
    } catch (error) {
      console.error("Failed to fetch admin data", error);
      toast.error("Failed to sync with operator engine");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  useEffect(() => {
    setActiveOperators(creators.filter(c => c.status === 'ONLINE' || c.status === 'active').length);
    setActiveChats(creators.reduce((acc, curr) => acc + (curr.performance?.activeSessions || 0), 0));
  }, [creators]);

  // ============================================================================
  // OPERATOR / PERSONA ACTIONS
  // ============================================================================
  
  const handleCreatePersona = async () => {
    try {
      if (!newPersonaForm.name) {
        toast.error("Persona Name is required");
        return;
      }
      
      await adminService.createPersona(newPersonaForm);
      toast.success('New Virtual Persona (User Account) provisioned successfully');
      
      setShowCreatePersonaModal(false);
      setNewPersonaForm({ 
        name: '', 
        archetype: 'Companion', 
        avatarUrl: '',
        bio: '',
        gender: 'Female',
        dateOfBirth: '2000-01-01',
        height: 165
      });
      fetchDashboardData(); 
    } catch (error) {
      toast.error("Failed to create new persona");
    }
  };

  const handleUpdateCommission = async (id, newRate) => {
    try {
      await adminService.updateCommission(id, newRate);
      setCreators(prev => prev.map(c => c.id === id ? { ...c, commissionRate: newRate } : c));
      
      if (selectedCreator?.id === id) {
        setSelectedCreator(prev => ({ ...prev, commissionRate: newRate }));
      }
      toast.success(`Commission split updated to ${newRate}%`);
    } catch (error) {
      toast.error("Failed to update commission rate");
    }
  };

  const handleProvisionOperator = async () => {
    try {
      if (!newOperatorForm.email || !newOperatorForm.username || !newOperatorForm.password) {
        toast.error("Email, Username, and Password are required");
        return;
      }
      
      await adminService.provisionCreator(newOperatorForm);
      toast.success('Operator provisioned successfully');
      setShowAddModal(false);
      setNewOperatorForm({ username: '', email: '', password: '', displayName: '', intent: 'companion' });
      fetchDashboardData(); 
    } catch (error) {
      toast.error("Failed to provision new operator");
    }
  };

  const handleToggleLock = async (id) => {
    const creator = creators.find(c => c.id === id);
    if (!creator) return;
    
    const isLocked = !creator.security?.locked;
    const newStatus = isLocked ? 'SUSPENDED' : 'OFFLINE';

    try {
      await adminService.updateOperatorStatus(id, newStatus);
      setCreators(prev => prev.map(c => {
        if (c.id === id) {
          return { 
            ...c, 
            status: newStatus,
            security: { ...c.security, locked: isLocked } 
          };
        }
        return c;
      }));
      
      if (selectedCreator?.id === id) {
        setSelectedCreator(prev => ({ 
          ...prev, 
          status: newStatus,
          security: { ...prev.security, locked: isLocked }
        }));
      }
      toast.success(isLocked ? 'Account Suspended & Terminated' : 'Account Unrestored & Accessible');
    } catch (error) {
      toast.error("Failed to lock/unlock account");
    }
  };

  const handleForceStatusOverride = async (id, newStatus) => {
    try {
      await adminService.updateOperatorStatus(id, newStatus);
      setCreators(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c));
      
      if (selectedCreator?.id === id) {
        setSelectedCreator(prev => ({ ...prev, status: newStatus }));
      }
      toast.success(`Operator status forcefully set to ${newStatus}`);
    } catch (error) {
      toast.error("Failed to override status");
    }
  };

  const handleToggleAutoPilot = async (id) => {
    const creator = creators.find(c => c.id === id);
    if (!creator) return;

    const nextState = !creator.autoPilotActive;

    try {
      await adminService.toggleAutoPilot(id, nextState);
      setCreators(prev => prev.map(c => {
        if (c.id === id) return { ...c, autoPilotActive: nextState };
        return c;
      }));
      
      if (selectedCreator?.id === id) {
        setSelectedCreator(prev => ({ ...prev, autoPilotActive: nextState }));
      }
      toast.success(nextState ? 'AI Auto-Pilot engaged for operator personas.' : 'AI Auto-Pilot disengaged. Manual control restored.');
    } catch (error) {
      toast.error("Failed to toggle AI Auto-Pilot");
    }
  };

  const handleBindPersona = async (creatorId, persona) => {
    try {
      await adminService.bindPersona(creatorId, persona.id);
      setCreators(prev => prev.map(c => 
        c.id === creatorId ? { ...c, personas: [...(c.personas || []), persona] } : c
      ));
      
      if (selectedCreator?.id === creatorId) {
        setSelectedCreator(prev => ({ ...prev, personas: [...(prev.personas || []), persona] }));
      }
      toast.success(`${persona.name || persona.display_name} assigned successfully.`);
      setShowAssignModal(false);
      fetchDashboardData();
    } catch (error) {
      toast.error("Failed to bind persona to operator");
    }
  };

  const handleUnbindPersona = async (creatorId, personaId) => {
    try {
      await adminService.unbindPersona(creatorId, personaId);
      setCreators(prev => prev.map(c => {
        if (c.id === creatorId) {
          return { ...c, personas: (c.personas || []).filter(p => p.id !== personaId) };
        }
        return c;
      }));
      
      if (selectedCreator?.id === creatorId) {
        setSelectedCreator(prev => ({ ...prev, personas: (prev.personas || []).filter(p => p.id !== personaId) }));
      }
      toast.success('Persona unbound from operator.');
      fetchDashboardData();
    } catch (error) {
      toast.error("Failed to unbind persona");
    }
  };

  // ============================================================================
  // VAULT FUNCTIONS
  // ============================================================================
  
  const openVaultGallery = async (persona) => {
    setSelectedVaultPersona(persona);
    setPreviewImage(null);
    setUploadFiles([]);
    try {
      setIsLoadingGallery(true);
      const galleryData = await adminService.getMediaVault(persona.id);
      setVaultMedia(galleryData || []);
    } catch (error) {
      toast.error("Failed to load vault assets");
    } finally {
      setIsLoadingGallery(false);
    }
  };

  const handleSetPrimary = async (imageId) => {
    if (!selectedVaultPersona) return;
    try {
      await adminService.setPrimary(selectedVaultPersona.id, imageId);
      
      setVaultMedia(prev => prev.map(img => ({
        ...img,
        isPrimary: img.id === imageId
      })));

      // Update personas and selected Creator UI
      const targetImg = vaultMedia.find(img => img.id === imageId);
      if (targetImg) {
        setPersonas(prev => prev.map(p => p.id === selectedVaultPersona.id ? { ...p, avatar_url: targetImg.url, image: targetImg.url } : p));
        if (selectedCreator) {
          setSelectedCreator(prev => ({
            ...prev,
            personas: prev.personas.map(p => p.id === selectedVaultPersona.id ? { ...p, avatar_url: targetImg.url, image: targetImg.url } : p)
          }));
        }
      }

      toast.success('Primary avatar updated successfully.');
      fetchDashboardData();
    } catch (error) {
      toast.error("Failed to set primary asset");
    }
  };

  const handleDeleteMedia = async (imageId) => {
    try {
      await adminService.deleteAsset(imageId);
      setVaultMedia(prev => prev.filter(img => img.id !== imageId));
      toast('Asset permanently deleted from vault.');
      if (previewImage?.id === imageId) setPreviewImage(null);
    } catch (error) {
      toast.error("Failed to delete asset");
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFiles = (files) => {
    const newFiles = files.map(file => ({
      file,
      id: Math.random().toString(),
      preview: URL.createObjectURL(file),
      size: (file.size / (1024 * 1024)).toFixed(2) + ' MB'
    }));
    setUploadFiles(prev => [...prev, ...newFiles]);
  };

  const executeBulkUpload = async () => {
    if (!selectedVaultPersona) return;
    if (uploadFiles.length === 0) {
      toast.error('No files queued for injection.');
      return;
    }

    try {
      setIsUploading(true);
      const formData = new FormData();
      uploadFiles.forEach(f => {
        formData.append('files', f.file);
      });

      await adminService.injectAssets(selectedVaultPersona.id, formData);

      toast.success(`${uploadFiles.length} assets successfully injected into vault.`);
      setUploadFiles([]);
      
      // Refresh the gallery
      const galleryData = await adminService.getVaultGallery(selectedVaultPersona.id);
      setVaultMedia(galleryData || []);
    } catch (error) {
      toast.error("Bulk injection failed");
    } finally {
      setIsUploading(false);
    }
  };

  // ============================================================================
  // FILTERING
  // ============================================================================
  const filteredCreators = creators.filter(c => {
    const matchStatus = filterStatus === 'ALL' || c.status === filterStatus || (c.status === 'active' && filterStatus === 'ONLINE');
    const nameMatch = c.realName || c.username || c.displayName || '';
    const matchSearch = nameMatch.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        (c.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                        c.id.toLowerCase().includes(searchQuery.toLowerCase());
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
            <Activity className="w-4 h-4 animate-pulse" /> OPERATOR ENGINE: ONLINE
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500">
            STAFF ACTIVE: <span className="text-white">{activeOperators} / {creators.length}</span>
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden md:inline-block">
            LIVE SESSIONS MANAGED: <span className="text-blue-400">{activeChats}</span>
          </span>
        </div>
      </div>

      {/* =========================================
          MAIN HEADER & TABS
          ========================================= */}
      <div className="p-6 md:p-8 border-b-2 border-zinc-800 bg-black shrink-0 flex flex-col gap-6 z-10 relative">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-3">
              <Users className="w-8 h-8 text-blue-500" /> Creator & Operator Engine
            </h1>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
              MANAGE HUMAN OPERATORS, OVERRIDE STATUS, CONFIGURE PAYOUT SPLITS & AUDIT CHAT QUEUES
            </p>
          </div>
          
          <button 
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-white text-black border-2 border-white px-6 py-3 font-black text-xs uppercase tracking-widest hover:bg-zinc-200 transition-colors shadow-[4px_4px_0px_rgba(255,255,255,0.2)] hover:shadow-none translate-y-0 hover:translate-y-1 hover:translate-x-1"
          >
            <UserPlus className="w-4 h-4" /> Onboard New Operator
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-2 border-b-2 border-zinc-800">
          {[
            { id: 'ROSTER', label: `STAFF ROSTER (${creators.length})`, icon: ShieldCheck },
            { id: 'PERFORMANCE', label: 'OPERATOR TELEMETRY', icon: BarChart3 },
            { id: 'QUEUE_ROUTING', label: `PERSONA QUEUES (${personas.length})`, icon: Radio },
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
        
        {isLoading ? (
          <div className="flex items-center justify-center h-full w-full p-20">
            <Loader2 className="w-10 h-10 text-zinc-600 animate-spin" />
          </div>
        ) : (
          <>
            {/* =========================================
                TAB: ROSTER (THE MAIN TABLE)
                ========================================= */}
            {activeTab === 'ROSTER' && (
              <div className="p-6 md:p-8 space-y-6">
                
                {/* Filters & Search */}
                <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-zinc-950 p-4 border-2 border-zinc-800">
                  <div className="flex items-center gap-2 w-full md:w-auto">
                    <Search className="w-4 h-4 text-zinc-500" />
                    <input 
                      type="text" 
                      placeholder="SEARCH NAME, EMAIL, OR ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-transparent border-none outline-none text-xs font-bold text-white uppercase tracking-widest w-full md:w-80 placeholder:text-zinc-600"
                    />
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto custom-scrollbar pb-1 md:pb-0">
                    <Filter className="w-4 h-4 text-zinc-500 shrink-0" />
                    {['ALL', 'ONLINE', 'OFFLINE', 'SUSPENDED'].map(status => (
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

                {/* Operator Roster Table */}
                <div className="bg-zinc-950 border-2 border-zinc-800 overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono whitespace-nowrap">
                    <thead className="bg-black border-b-2 border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-widest">
                      <tr>
                        <th className="p-4">Operator Details</th>
                        <th className="p-4">Assigned Personas</th>
                        <th className="p-4">Status & Presence</th>
                        <th className="p-4">Control State</th>
                        <th className="p-4">Earnings / Split</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-zinc-900 text-zinc-300 font-bold uppercase tracking-wide">
                      {filteredCreators.length === 0 ? (
                        <tr>
                          <td colSpan="6" className="p-12 text-center text-zinc-500">
                            <UserX className="w-8 h-8 mx-auto mb-3 opacity-50" />
                            NO OPERATORS MATCHING CRITERIA
                          </td>
                        </tr>
                      ) : (
                        filteredCreators.map(creator => (
                          <tr key={creator.id} className="hover:bg-zinc-900 transition-colors group cursor-pointer" onClick={() => setSelectedCreator(creator)}>
                            <td className="p-4">
                              <div className="flex flex-col">
                                <span className="text-white font-black text-sm">{creator.displayName || creator.username || creator.realName || 'Unknown'}</span>
                                <span className="text-[10px] text-zinc-500 flex items-center gap-2">
                                  {creator.id} | {creator.email}
                                  {creator.security?.mfaEnabled && <Lock className="w-3 h-3 text-green-500 inline" />}
                                </span>
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-1.5">
                                {!creator.personas || creator.personas.length === 0 ? (
                                  <span className="text-[9px] text-zinc-600 bg-zinc-950 px-2 py-1 border border-zinc-800">UNASSIGNED</span>
                                ) : (
                                  creator.personas.map(p => (
                                    <div key={p.id} className="flex items-center gap-2 bg-black border border-zinc-700 px-2 py-1 pr-3 rounded-full">
                                      <img src={p.image || p.avatar_url || 'https://via.placeholder.com/50'} alt="p" className="w-5 h-5 rounded-full object-cover grayscale" />
                                      <span className="text-[9px] text-zinc-300">{p.name || p.display_name}</span>
                                    </div>
                                  ))
                                )}
                                {creator.personas?.length > 0 && (
                                  <span className="text-[9px] text-zinc-500 ml-2">({creator.personas.length})</span>
                                )}
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-1 text-[9px] font-black border flex items-center gap-1.5 w-max ${
                                  (creator.status === 'ONLINE' || creator.status === 'active') ? 'bg-green-500/10 text-green-400 border-green-500/30' :
                                  creator.status === 'SUSPENDED' ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                                  'bg-zinc-800 text-zinc-400 border-zinc-600'
                                }`}>
                                  {(creator.status === 'ONLINE' || creator.status === 'active') && <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />}
                                  {creator.status === 'active' ? 'ONLINE' : (creator.status || 'OFFLINE')}
                                </span>
                              </div>
                            </td>
                            <td className="p-4">
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleToggleAutoPilot(creator.id); }}
                                className={`px-2.5 py-1 text-[9px] font-black uppercase border-2 transition-colors flex items-center gap-1 ${
                                  creator.autoPilotActive ? 'bg-blue-500/20 text-blue-400 border-blue-500' : 'bg-black text-zinc-600 border-zinc-800 hover:text-zinc-400'
                                }`}
                              >
                                {creator.autoPilotActive ? <><Bot className="w-3 h-3" /> AI ACTIVE</> : <><User className="w-3 h-3" /> MANUAL</>}
                              </button>
                            </td>
                            <td className="p-4">
                              <div className="flex flex-col">
                                <span className="text-green-400 font-black">${(creator.totalEarnings || 0).toLocaleString()}</span>
                                <span className="text-[9px] text-zinc-500">{creator.commissionRate || 50}% CREATOR CUT</span>
                              </div>
                            </td>
                            <td className="p-4 text-right">
                              <button 
                                className="p-2 border-2 border-zinc-700 hover:border-white hover:text-white transition-colors bg-black group-hover:bg-zinc-800"
                                onClick={(e) => { e.stopPropagation(); setSelectedCreator(creator); }}
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
                TAB: PERFORMANCE & SPEEDS (OPERATOR FOCUSED)
                ========================================= */}
            {activeTab === 'PERFORMANCE' && (
              <div className="p-6 md:p-8 space-y-6">
                <div className="mb-6">
                  <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-blue-400" /> Operator Telemetry (Human Layer)
                  </h2>
                  <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
                    MONITOR STAFF LATENCY, OUTPUT VOLUME, AND SESSION EFFICIENCY
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {creators.filter(c => c.status !== 'SUSPENDED').map(creator => (
                    <div key={creator.id} className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col hover:border-zinc-600 transition-colors cursor-pointer" onClick={() => setSelectedCreator(creator)}>
                      <div className="flex justify-between items-start mb-4 border-b-2 border-zinc-800 pb-4">
                        <div>
                          <h3 className="text-sm font-black text-white uppercase">{creator.displayName || creator.username || creator.realName}</h3>
                          <span className="text-[10px] text-zinc-500">ID: {creator.id}</span>
                        </div>
                        <span className={`px-2 py-1 text-[9px] font-black border ${(creator.status === 'ONLINE' || creator.status === 'active') ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-zinc-800 text-zinc-400 border-zinc-600'}`}>
                          {creator.status === 'active' ? 'ONLINE' : (creator.status || 'OFFLINE')}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4 flex-1">
                        <div>
                          <span className="block text-[9px] text-zinc-500 uppercase tracking-widest mb-1">Avg Reply Time</span>
                          <span className={`text-xl font-black ${parseInt(creator.performance?.avgReplyTime || '0') > 20 ? 'text-yellow-400' : 'text-green-400'}`}>
                            {creator.performance?.avgReplyTime || 'N/A'}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[9px] text-zinc-500 uppercase tracking-widest mb-1">Total Msgs</span>
                          <span className="text-xl font-black text-white">{(creator.performance?.msgsSent || 0).toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="block text-[9px] text-zinc-500 uppercase tracking-widest mb-1">Live Sessions</span>
                          <span className="text-xl font-black text-blue-400">{creator.performance?.activeSessions || 0}</span>
                        </div>
                        <div>
                          <span className="block text-[9px] text-zinc-500 uppercase tracking-widest mb-1">Quality Rating</span>
                          <span className="text-xl font-black text-purple-400">{creator.performance?.rating || '0.0'} / 5</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* =========================================
                TAB: QUEUE ROUTING & LOAD BALANCING (PERSONA FOCUSED)
                ========================================= */}
            {activeTab === 'QUEUE_ROUTING' && (
              <div className="p-6 md:p-8 space-y-6">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-2">
                      <Radio className="w-5 h-5 text-green-400" /> Persona Queues & Vaults
                    </h2>
                    <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
                      MONITOR VIRTUAL PERSONA REVENUE, MEDIA INTEGRITY, AND INDEPENDENT QUEUE LOAD
                    </p>
                  </div>
                  <button 
                    onClick={() => setShowCreatePersonaModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white text-black font-black text-[10px] uppercase tracking-widest border-2 border-white hover:bg-transparent hover:text-white transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Create Persona Profile
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {personas.map(p => (
                    <div key={p.id} className="bg-zinc-950 border-2 border-zinc-800 p-6 flex flex-col gap-4 relative overflow-hidden">
                      
                      {/* Persona Header */}
                      <div className="flex items-center justify-between border-b-2 border-zinc-800 pb-4 relative z-10">
                        <div className="flex items-center gap-3">
                          <img src={p.image || p.avatar_url || 'https://via.placeholder.com/50'} alt={p.name} className="w-12 h-12 object-cover border-2 border-zinc-700" />
                          <div>
                            <h4 className="text-sm font-black text-white uppercase">{p.name || p.display_name}</h4>
                            <span className="text-[10px] text-zinc-500 font-mono">{p.archetype || p.intent || 'General'}</span>
                          </div>
                        </div>
                        <span className="px-2 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/30 text-[9px] font-black uppercase">
                          {p.activeChats || 0} Active Chats
                        </span>
                      </div>

                      {/* Persona Dual-Tracking Metrics */}
                      <div className="space-y-3 relative z-10">
                        <div className="flex items-center justify-between text-xs font-mono border-b border-zinc-900 pb-2">
                          <span className="text-zinc-500 uppercase flex items-center gap-2"><DollarSign className="w-3 h-3"/> Persona Revenue:</span>
                          <span className="text-green-400 font-black">${(p.earnings || 0).toLocaleString()}</span>
                        </div>
                        
                        <div className="flex items-center justify-between text-xs font-mono border-b border-zinc-900 pb-2">
                          <span className="text-zinc-500 uppercase flex items-center gap-2"><ImageIcon className="w-3 h-3"/> Media Vault Assets:</span>
                          <span className="text-zinc-300 font-black">{p.mediaVault || 0} ITEMS</span>
                        </div>

                        <div className="flex items-center justify-between text-xs font-mono border-b border-zinc-900 pb-2">
                          <span className="text-zinc-500 uppercase flex items-center gap-2"><Clock className="w-3 h-3"/> Pending Queue (Unread):</span>
                          <span className={`font-black ${(p.unread || 0) > 0 ? 'text-yellow-400' : 'text-zinc-400'}`}>{p.unread || 0} REQUESTS</span>
                        </div>

                        <div className="flex items-center justify-between text-xs font-mono pt-1">
                          <span className="text-zinc-500 uppercase flex items-center gap-2"><Activity className="w-3 h-3"/> Control State:</span>
                          <span className={`font-black px-2 py-0.5 border ${p.autoPilotActive ? 'text-blue-400 border-blue-500 bg-blue-500/10' : 'text-purple-400 border-purple-500 bg-purple-500/10'}`}>
                            {p.autoPilotActive ? '🤖 AI AUTO-PILOT' : '👤 HUMAN OPERATOR'}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="pt-2 flex gap-2 relative z-10">
                        <button 
                          onClick={() => toast.success(`Re-routing task dispatch for ${p.name || p.display_name}...`)}
                          className="flex-1 py-2 bg-black border-2 border-zinc-700 text-xs font-black uppercase text-white hover:border-white transition-colors"
                        >
                          Re-Route
                        </button>
                        <button 
                          onClick={() => openVaultGallery(p)}
                          className="px-4 py-2 bg-zinc-900 border-2 border-zinc-700 text-xs font-black uppercase text-blue-400 hover:text-blue-300 hover:border-blue-500 transition-colors flex items-center gap-1"
                          title="Manage Persona Vault"
                        >
                          <ImageIcon className="w-3 h-3" /> Vault
                        </button>
                        <button 
                          onClick={() => toast.info(`Opening shadow inspection for ${p.name || p.display_name}...`)}
                          className="px-4 py-2 bg-zinc-900 border-2 border-zinc-700 text-xs font-black uppercase text-zinc-300 hover:text-white hover:border-white transition-colors flex items-center gap-1"
                          title="Shadow Persona Chats"
                        >
                          <Eye className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* =====================================================================
          CREATOR INVESTIGATION / MANAGEMENT DRAWER
          ==================================================================== */}
      {selectedCreator && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedCreator(null)} />
          
          <div className="relative w-full max-w-2xl h-full bg-black border-l-2 border-zinc-800 shadow-[[-10px_0_30px_rgba(0,0,0,0.8)]] flex flex-col animate-in slide-in-from-right-full duration-300">
            
            {/* Drawer Header */}
            <div className="p-6 bg-zinc-950 border-b-2 border-zinc-800 shrink-0 flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 text-[9px] font-black uppercase border ${(selectedCreator.status === 'ONLINE' || selectedCreator.status === 'active') ? 'bg-green-500/10 text-green-400 border-green-500' : selectedCreator.status === 'SUSPENDED' ? 'bg-red-500/10 text-red-500 border-red-500' : 'bg-zinc-800 text-zinc-400 border-zinc-600'}`}>
                    {selectedCreator.status === 'active' ? 'ONLINE' : (selectedCreator.status || 'OFFLINE')}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-bold font-mono">ID: {selectedCreator.id}</span>
                </div>
                <h2 className="text-2xl font-black text-white uppercase tracking-widest">
                  {selectedCreator.displayName || selectedCreator.username || selectedCreator.realName}
                </h2>
                <span className="text-xs text-zinc-400 font-mono mt-1">{selectedCreator.email}</span>
              </div>
              <button onClick={() => setSelectedCreator(null)} className="p-2 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 bg-black transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Tabs */}
            <div className="flex bg-black border-b-2 border-zinc-800 shrink-0 px-6 pt-4 gap-4 overflow-x-auto custom-scrollbar">
              {['PERSONAS', 'FINANCE', 'SECURITY', 'TELEMETRY'].map(tab => (
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
              
              {/* TAB: PERSONA MANAGEMENT */}
              {drawerTab === 'PERSONAS' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  <div className="flex justify-between items-center bg-zinc-950 p-4 border-2 border-zinc-800">
                    <div>
                      <h4 className="text-[10px] font-black text-white uppercase tracking-widest">Bound Profiles</h4>
                      <p className="text-[9px] text-zinc-500 font-bold mt-1">Personas this operator controls.</p>
                    </div>
                    <button 
                      onClick={() => setShowAssignModal(true)}
                      className="px-4 py-2 bg-white text-black font-black text-[9px] uppercase tracking-widest border-2 border-white hover:bg-black hover:text-white transition-colors flex items-center gap-2"
                    >
                      <Link2 className="w-3 h-3" /> Assign Persona
                    </button>
                  </div>

                  {!selectedCreator.personas || selectedCreator.personas.length === 0 ? (
                    <div className="p-12 border-2 border-dashed border-zinc-800 text-center">
                      <Users className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
                      <h5 className="text-xs font-black text-zinc-400 uppercase tracking-widest">No Personas Assigned</h5>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {selectedCreator.personas.map(p => (
                        <div key={p.id} className="bg-black border-2 border-zinc-800 p-4 flex items-center justify-between group hover:border-zinc-600 transition-colors">
                          <div className="flex items-center gap-4">
                            <img src={p.image || p.avatar_url || 'https://via.placeholder.com/50'} alt={p.name} className="w-12 h-12 object-cover border-2 border-zinc-700 grayscale group-hover:grayscale-0 transition-all" />
                            <div>
                              <h5 className="text-sm font-black text-white uppercase">{p.name || p.display_name}</h5>
                              <div className="flex gap-3 text-[9px] text-zinc-500 font-bold uppercase font-mono mt-1">
                                <span>{p.archetype || p.intent || 'General'}</span>
                                <span>|</span>
                                <span className="text-green-400">${(p.earnings || 0).toLocaleString()}</span>
                                <span>|</span>
                                <span className="text-blue-400">{p.mediaVault || 0} Media</span>
                              </div>
                            </div>
                          </div>
                          
                          {/* Vault & Unbind Actions */}
                          <div className="flex gap-2">
                            <button 
                              onClick={() => openVaultGallery(p)}
                              className="p-2 border-2 border-zinc-800 text-blue-400 hover:bg-blue-500 hover:text-black transition-colors"
                              title="Manage Media Vault"
                            >
                              <ImageIcon className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleUnbindPersona(selectedCreator.id, p.id)}
                              className="p-2 border-2 border-zinc-800 text-red-500 hover:bg-red-500 hover:text-black transition-colors"
                              title="Unbind Persona"
                            >
                              <Unlink className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB: FINANCE & COMMISSION */}
              {drawerTab === 'FINANCE' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-zinc-950 border-2 border-zinc-800 p-6">
                      <span className="block text-[10px] text-zinc-500 font-black uppercase tracking-widest mb-2 flex items-center gap-2">
                        <DollarSign className="w-3 h-3 text-green-500" /> Operator Lifetime Earned
                      </span>
                      <span className="text-3xl font-black text-white">${(selectedCreator.totalEarnings || 0).toLocaleString()}</span>
                    </div>
                    <div className="bg-zinc-950 border-2 border-zinc-800 p-6">
                      <span className="block text-[10px] text-zinc-500 font-black uppercase tracking-widest mb-2 flex items-center gap-2">
                        <Percent className="w-3 h-3 text-blue-500" /> Current Split
                      </span>
                      <span className="text-3xl font-black text-blue-400">{selectedCreator.commissionRate || 50}% <span className="text-xs text-zinc-600">CUT</span></span>
                    </div>
                  </div>

                  <div className="bg-black border-2 border-zinc-800 p-6 space-y-6">
                    <h4 className="text-[10px] font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-3">Adjust Revenue Split</h4>
                    <div className="space-y-4">
                      <div className="flex justify-between text-xs font-bold text-zinc-400 uppercase font-mono">
                        <span>Platform: {100 - (selectedCreator.commissionRate || 50)}%</span>
                        <span>Operator: {selectedCreator.commissionRate || 50}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="10" max="90" step="5"
                        value={selectedCreator.commissionRate || 50}
                        onChange={(e) => handleUpdateCommission(selectedCreator.id, parseInt(e.target.value))}
                        className="w-full accent-blue-500 h-2 bg-zinc-800 appearance-none outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: SECURITY & OVERRIDES (Operator Layer) */}
              {drawerTab === 'SECURITY' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  <div className="bg-black border-2 border-zinc-800 p-6 space-y-4 font-mono">
                    <h4 className="text-[10px] font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-3 flex items-center gap-2">
                      <Terminal className="w-3 h-3 text-red-500" /> Operator Access & Hardware
                    </h4>
                    
                    <div className="flex justify-between items-center text-xs uppercase font-bold border-b border-zinc-900 pb-2">
                      <span className="text-zinc-500">Force Status Override</span>
                      <div className="flex gap-1">
                        {['ONLINE', 'OFFLINE'].map(st => (
                          <button
                            key={st}
                            onClick={() => handleForceStatusOverride(selectedCreator.id, st)}
                            className={`px-2 py-1 text-[9px] font-black border ${selectedCreator.status === st || (st === 'ONLINE' && selectedCreator.status === 'active') ? 'bg-white text-black border-white' : 'bg-zinc-900 text-zinc-400 border-zinc-700'}`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-xs uppercase font-bold border-b border-zinc-900 pb-2">
                      <span className="text-zinc-500">Last Known IP</span>
                      <span className="text-white bg-zinc-900 px-2 py-1">{selectedCreator.security?.lastIp || 'Unknown'}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs uppercase font-bold border-b border-zinc-900 pb-2">
                      <span className="text-zinc-500">2FA / MFA Configured</span>
                      <span className={`px-2 py-1 ${selectedCreator.security?.mfaEnabled ? 'text-green-400 bg-green-500/15' : 'text-red-500 bg-red-500/15'}`}>
                        {selectedCreator.security?.mfaEnabled ? 'ENABLED' : 'DISABLED'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-zinc-950 border-2 border-red-900/50 p-6 space-y-4">
                    <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest">Danger Zone</h4>
                    <button 
                      onClick={() => handleToggleLock(selectedCreator.id)}
                      className={`w-full py-4 border-2 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-colors ${
                        selectedCreator.security?.locked 
                          ? 'border-green-500 text-green-500 hover:bg-green-500 hover:text-black'
                          : 'border-red-500 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-black'
                      }`}
                    >
                      {selectedCreator.security?.locked ? (
                        <><Unlock className="w-4 h-4" /> Restore Access (Unsuspend)</>
                      ) : (
                        <><Lock className="w-4 h-4" /> Suspend & Terminate Sessions</>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* TAB: LIVE TELEMETRY (Operator Performance) */}
              {drawerTab === 'TELEMETRY' && (
                <div className="space-y-6 animate-in fade-in duration-200 font-mono">
                  <div className="bg-zinc-950 border-2 border-zinc-800 p-6 space-y-4">
                    <h4 className="text-[10px] font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-3">Operator Output Metrics</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-black border border-zinc-800">
                        <span className="block text-[9px] text-zinc-500">Average Reply Latency</span>
                        <span className="text-lg font-black text-green-400">{selectedCreator.performance?.avgReplyTime || 'N/A'}</span>
                      </div>
                      <div className="p-3 bg-black border border-zinc-800">
                        <span className="block text-[9px] text-zinc-500">Total Messages Delivered</span>
                        <span className="text-lg font-black text-white">{(selectedCreator.performance?.msgsSent || 0).toLocaleString()}</span>
                      </div>
                      <div className="p-3 bg-black border border-zinc-800">
                        <span className="block text-[9px] text-zinc-500">Active Concurrent Sessions</span>
                        <span className="text-lg font-black text-blue-400">{selectedCreator.performance?.activeSessions || 0}</span>
                      </div>
                      <div className="p-3 bg-black border border-zinc-800">
                        <span className="block text-[9px] text-zinc-500">QA Rating Score</span>
                        <span className="text-lg font-black text-purple-400">{selectedCreator.performance?.rating || '0.0'} / 5</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          ONBOARDING MODAL (Add New Creator Operator)
          ==================================================================== */}
      {showAddModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
          <div className="relative w-full max-w-lg bg-black border-2 border-white shadow-[8px_8px_0px_rgba(255,255,255,1)] flex flex-col z-10">
            <div className="p-6 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center">
              <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                <UserPlus className="w-4 h-4" /> Onboard Operator
              </h2>
              <button onClick={() => setShowAddModal(false)} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4 font-mono max-h-[70vh] overflow-y-auto custom-scrollbar">
              
              <div>
                <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Display Name</label>
                <input 
                  type="text" 
                  placeholder="Elena NYC"
                  value={newOperatorForm.displayName}
                  onChange={(e) => setNewOperatorForm({...newOperatorForm, displayName: e.target.value})}
                  className="w-full bg-black border-2 border-zinc-800 p-3 text-xs text-white uppercase outline-none focus:border-white transition-colors" 
                />
              </div>

              <div>
                <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Login Username *</label>
                <input 
                  type="text" 
                  placeholder="operator_johndoe"
                  value={newOperatorForm.username}
                  onChange={(e) => setNewOperatorForm({...newOperatorForm, username: e.target.value})}
                  className="w-full bg-black border-2 border-zinc-800 p-3 text-xs text-white uppercase outline-none focus:border-white transition-colors" 
                />
              </div>

              <div>
                <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Work Email *</label>
                <input 
                  type="email" 
                  placeholder="john@agency.com"
                  value={newOperatorForm.email}
                  onChange={(e) => setNewOperatorForm({...newOperatorForm, email: e.target.value})}
                  className="w-full bg-black border-2 border-zinc-800 p-3 text-xs text-white uppercase outline-none focus:border-white transition-colors" 
                />
              </div>

              <div>
                <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Temporary Password *</label>
                <input 
                  type="password" 
                  placeholder="********"
                  value={newOperatorForm.password}
                  onChange={(e) => setNewOperatorForm({...newOperatorForm, password: e.target.value})}
                  className="w-full bg-black border-2 border-zinc-800 p-3 text-xs text-white uppercase outline-none focus:border-white transition-colors" 
                />
              </div>

              <div className="pt-4">
                <button 
                  onClick={handleProvisionOperator}
                  className="w-full py-4 bg-white text-black font-black uppercase text-xs tracking-widest border-2 border-white hover:bg-zinc-200 transition-colors shadow-[4px_4px_0px_rgba(255,255,255,0.2)]"
                >
                  Create Creator Account
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          ASSIGN PERSONA MODAL
          ==================================================================== */}
      {showAssignModal && selectedCreator && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowAssignModal(false)} />
          <div className="relative w-full max-w-md bg-black border-2 border-blue-500 shadow-[8px_8px_0px_rgba(59,130,246,0.3)] flex flex-col z-10">
            <div className="p-4 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center">
              <h2 className="text-xs font-black text-white uppercase tracking-widest">Assign to {selectedCreator.displayName || selectedCreator.username}</h2>
              <button onClick={() => setShowAssignModal(false)} className="text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            
            <div className="p-4 border-b-2 border-zinc-800 bg-black">
              <button 
                onClick={() => setShowCreatePersonaModal(true)}
                className="w-full py-2 bg-blue-500/10 text-blue-400 border border-blue-500/30 text-[10px] font-black uppercase flex items-center justify-center gap-2 hover:bg-blue-500 hover:text-black transition-colors"
              >
                <Plus className="w-3 h-3" /> Create New Persona Profile
              </button>
            </div>

            <div className="p-4 max-h-[50vh] overflow-y-auto space-y-2 custom-scrollbar">
              {personas.filter(p => !p.manager_id || p.manager_id === selectedCreator.id).length === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-4 font-mono">No unassigned personas available in system.</p>
              ) : personas
                  .filter(p => !p.manager_id || p.manager_id === selectedCreator.id)
                  .map(p => {
                const isAlreadyAssigned = p.manager_id === selectedCreator.id;
                
                return (
                  <div key={p.id} className={`flex items-center justify-between p-3 border-2 ${isAlreadyAssigned ? 'border-zinc-800 opacity-50 bg-zinc-950' : 'border-zinc-700 bg-black hover:border-blue-500 cursor-pointer transition-colors'}`}>
                    <div className="flex items-center gap-3">
                      <img src={p.image || p.avatar_url || 'https://via.placeholder.com/50'} alt={p.name} className="w-8 h-8 object-cover border border-zinc-700 grayscale" />
                      <div>
                        <h5 className="text-[10px] font-black text-white uppercase">{p.name || p.display_name}</h5>
                        <p className="text-[8px] text-zinc-500 uppercase tracking-widest font-mono">{p.archetype || p.intent}</p>
                      </div>
                    </div>
                    {isAlreadyAssigned ? (
                      <span className="text-[9px] text-zinc-600 font-bold uppercase font-mono">Assigned</span>
                    ) : (
                      <button 
                        onClick={() => handleBindPersona(selectedCreator.id, p)}
                        className="px-3 py-1 bg-blue-500 text-black text-[9px] font-black uppercase border-2 border-blue-500 hover:bg-black hover:text-blue-500 transition-colors"
                      >
                        Bind
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          CREATE FULL PERSONA MODAL (User Profile Equivalent)
          ==================================================================== */}
      {showCreatePersonaModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowCreatePersonaModal(false)} />
          <div className="relative w-full max-w-lg bg-black border-2 border-white shadow-[8px_8px_0px_rgba(255,255,255,1)] flex flex-col z-10 max-h-[90vh]">
            <div className="p-4 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center shrink-0">
              <h2 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
                <Plus className="w-4 h-4" /> Provision Virtual Persona
              </h2>
              <button onClick={() => setShowCreatePersonaModal(false)} className="text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            
            <div className="p-6 space-y-5 font-mono overflow-y-auto custom-scrollbar">
              
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Display Name *</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Luna / Sarah"
                    value={newPersonaForm.name}
                    onChange={(e) => setNewPersonaForm({...newPersonaForm, name: e.target.value})}
                    className="w-full bg-black border-2 border-zinc-800 p-3 text-xs text-white uppercase outline-none focus:border-white transition-colors" 
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Archetype / Category</label>
                  <select 
                    value={newPersonaForm.archetype}
                    onChange={(e) => setNewPersonaForm({...newPersonaForm, archetype: e.target.value})}
                    className="w-full bg-black border-2 border-zinc-800 p-3 text-xs text-white uppercase outline-none focus:border-white transition-colors appearance-none"
                  >
                    <option value="General">General</option>
                    <option value="Companion">Companion</option>
                    <option value="Gamer">Gamer</option>
                    <option value="Creator">Creator / Influencer</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Gender identity</label>
                  <select 
                    value={newPersonaForm.gender}
                    onChange={(e) => setNewPersonaForm({...newPersonaForm, gender: e.target.value})}
                    className="w-full bg-black border-2 border-zinc-800 p-3 text-xs text-white uppercase outline-none focus:border-white transition-colors appearance-none"
                  >
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Non-Binary">Non-Binary</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1"><Calendar className="w-3 h-3"/> Date of Birth</label>
                  <input 
                    type="date" 
                    value={newPersonaForm.dateOfBirth}
                    onChange={(e) => setNewPersonaForm({...newPersonaForm, dateOfBirth: e.target.value})}
                    className="w-full bg-black border-2 border-zinc-800 p-3 text-xs text-white uppercase outline-none focus:border-white transition-colors custom-calendar-icon" 
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Height (CM)</label>
                  <input 
                    type="number" 
                    placeholder="165"
                    value={newPersonaForm.height}
                    onChange={(e) => setNewPersonaForm({...newPersonaForm, height: parseInt(e.target.value) || ''})}
                    className="w-full bg-black border-2 border-zinc-800 p-3 text-xs text-white uppercase outline-none focus:border-white transition-colors" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Initial Avatar URL</label>
                <input 
                  type="text" 
                  placeholder="https://..."
                  value={newPersonaForm.avatarUrl}
                  onChange={(e) => setNewPersonaForm({...newPersonaForm, avatarUrl: e.target.value})}
                  className="w-full bg-black border-2 border-zinc-800 p-3 text-xs text-zinc-300 outline-none focus:border-white transition-colors" 
                />
              </div>

              <div>
                <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Biography / Description</label>
                <textarea 
                  placeholder="Write the persona's grid bio..."
                  value={newPersonaForm.bio}
                  onChange={(e) => setNewPersonaForm({...newPersonaForm, bio: e.target.value})}
                  className="w-full bg-black border-2 border-zinc-800 p-3 text-xs text-white uppercase outline-none focus:border-white transition-colors min-h-[80px] resize-none" 
                />
              </div>

              <div className="pt-4 border-t-2 border-zinc-800 mt-6">
                <button 
                  onClick={handleCreatePersona}
                  className="w-full py-3 bg-white text-black font-black uppercase text-xs tracking-widest border-2 border-white hover:bg-zinc-200 transition-colors"
                >
                  Provision Persona Account
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MEGA MODAL: PERSONA VAULT DRAWER & INJECTOR (z-[90])
          ==================================================================== */}
      {selectedVaultPersona && (
        <div className="fixed inset-0 z-[90] flex justify-end">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={() => setSelectedVaultPersona(null)} />
          
          <div className="relative w-full max-w-5xl h-full bg-black border-l-2 border-zinc-800 shadow-[[-20px_0_40px_rgba(0,0,0,1)]] flex flex-col animate-in slide-in-from-right-full duration-300">
            
            {/* Vault Header */}
            <div className="p-6 bg-zinc-950 border-b-2 border-zinc-800 shrink-0 flex justify-between items-start">
              <div className="flex gap-6 items-center">
                <div className="w-16 h-16 border-2 border-zinc-700 bg-black overflow-hidden relative group">
                  {selectedVaultPersona.image || selectedVaultPersona.avatar_url ? (
                    <img src={selectedVaultPersona.image || selectedVaultPersona.avatar_url} alt="primary" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600"><Camera className="w-6 h-6" /></div>
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Star className="w-4 h-4 text-white" />
                  </div>
                </div>
                <div>
                  <h2 className="text-2xl font-black text-white uppercase tracking-widest flex items-center gap-3">
                    <ImageIcon className="w-6 h-6 text-purple-500" /> {selectedVaultPersona.name || selectedVaultPersona.display_name}'s Vault
                  </h2>
                  <div className="mt-2 text-[10px] text-zinc-400 font-mono font-bold flex gap-4">
                    <span>ID: {selectedVaultPersona.id}</span>
                    <span>OP: <span className="text-green-400">{selectedVaultPersona.assignedOp || 'UNASSIGNED'}</span></span>
                    <span>ASSETS: <span className="text-blue-400">{vaultMedia.length}</span></span>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedVaultPersona(null)} className="p-2 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 bg-black transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Vault Main Layout */}
            <div className="flex-1 overflow-hidden relative flex">
              
              {/* Left Content Area (Uploader + Grid) */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
                
                {/* Drag & Drop Injection Zone */}
                <div className="space-y-2">
                  <div className="flex justify-between items-end">
                    <h4 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                      <UploadCloud className="w-4 h-4 text-blue-400" /> Bulk Asset Injection
                    </h4>
                    {uploadFiles.length > 0 && (
                      <button 
                        onClick={executeBulkUpload}
                        disabled={isUploading}
                        className="px-4 py-1.5 bg-blue-600 text-black font-black uppercase text-[10px] flex items-center gap-2 hover:bg-blue-500 disabled:opacity-50 transition-colors"
                      >
                        {isUploading ? <><Loader2 className="w-3 h-3 animate-spin" /> INJECTING...</> : <><Upload className="w-3 h-3" /> PUSH {uploadFiles.length} ASSETS</>}
                      </button>
                    )}
                  </div>
                  
                  <div 
                    className={`border-2 border-dashed p-8 flex flex-col items-center justify-center text-center transition-all cursor-pointer ${
                      dragActive ? 'border-blue-500 bg-blue-500/5' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                    }`}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input 
                      ref={fileInputRef}
                      type="file" 
                      multiple 
                      accept="image/*,video/*"
                      className="hidden"
                      onChange={(e) => handleFiles(Array.from(e.target.files || []))}
                    />
                    <UploadCloud className={`w-8 h-8 mb-2 ${dragActive ? 'text-blue-500 animate-bounce' : 'text-zinc-600'}`} />
                    <h3 className="text-xs font-black text-white uppercase tracking-widest mb-1">Drag & Drop Media Here</h3>
                    <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Supports JPG, PNG, MP4. (Max 50MB/File)</p>
                  </div>

                  {/* Upload Preview Queue */}
                  {uploadFiles.length > 0 && (
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mt-2 border-2 border-zinc-800 p-2 bg-black">
                      {uploadFiles.map(file => (
                        <div key={file.id} className="relative group border border-zinc-800 aspect-square overflow-hidden">
                          <img src={file.preview} alt="preview" className="w-full h-full object-cover opacity-60" />
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={(e) => { e.stopPropagation(); setUploadFiles(prev => prev.filter(f => f.id !== file.id)); }}
                              className="p-1.5 bg-red-500 text-black hover:scale-110 transition-transform"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Vault Grid */}
                <div>
                  <h4 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2 mb-4 pt-6 border-t-2 border-zinc-800">
                    <FileImage className="w-4 h-4 text-purple-400" /> Vault Inventory ({vaultMedia.length})
                  </h4>
                  
                  {isLoadingGallery ? (
                    <div className="flex justify-center p-12">
                      <Loader2 className="w-8 h-8 text-zinc-600 animate-spin" />
                    </div>
                  ) : vaultMedia.length === 0 ? (
                    <div className="p-12 border-2 border-zinc-800 bg-zinc-950 text-center text-zinc-500 font-mono text-xs uppercase font-black">
                      VAULT IS EMPTY
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                      {vaultMedia.map(img => (
                        <div 
                          key={img.id} 
                          onClick={() => setPreviewImage(img)}
                          className={`relative aspect-[3/4] border-2 cursor-pointer transition-all ${
                            previewImage?.id === img.id ? 'border-white ring-4 ring-white/20' : 'border-zinc-800 hover:border-zinc-500'
                          }`}
                        >
                          <img src={img.url} alt="vault asset" className="w-full h-full object-cover" />
                          
                          {img.isPrimary && (
                            <div className="absolute top-2 left-2 bg-green-500 text-black px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest flex items-center gap-1 shadow-md">
                              <Star className="w-2 h-2" /> Primary
                            </div>
                          )}
                          
                          <div className="absolute inset-0 bg-black/60 opacity-0 hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-4 text-center">
                            <Eye className="w-6 h-6 text-white mb-2" />
                            <span className="text-[8px] text-zinc-300 font-mono uppercase">{img.size}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>

              {/* Right Sidebar: Image Inspector */}
              {previewImage && (
                <div className="w-80 bg-zinc-950 border-l-2 border-zinc-800 flex flex-col shrink-0 animate-in slide-in-from-right-8 duration-200">
                  <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center">
                    <span className="text-[10px] font-black text-white uppercase tracking-widest">Asset Inspector</span>
                    <button onClick={() => setPreviewImage(null)} className="text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
                    <div className="aspect-[3/4] border-2 border-zinc-800 bg-black">
                      <img src={previewImage.url} alt="inspect" className="w-full h-full object-contain" />
                    </div>

                    <div className="space-y-3 font-mono text-[10px] uppercase font-bold bg-black p-4 border-2 border-zinc-800 text-zinc-400">
                      <div className="flex justify-between border-b border-zinc-900 pb-1">
                        <span>ID</span><span className="text-white truncate ml-4">{previewImage.id}</span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-900 pb-1">
                        <span>Type</span><span className="text-white">{previewImage.type || 'IMAGE'}</span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-900 pb-1">
                        <span>Size</span><span className="text-white">{previewImage.size || 'Unknown'}</span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-900 pb-1">
                        <span>Uploaded</span><span className="text-white">{previewImage.uploadedAt || 'Recently'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Status</span>
                        {previewImage.isPrimary ? <span className="text-green-400">PRIMARY AVATAR</span> : <span>GALLERY ASSET</span>}
                      </div>
                    </div>

                    <div className="space-y-3 pt-4 border-t-2 border-zinc-800">
                      {!previewImage.isPrimary && (
                        <button 
                          onClick={() => handleSetPrimary(previewImage.id)}
                          className="w-full py-3 bg-black border-2 border-green-500 text-green-500 hover:bg-green-500 hover:text-black font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                        >
                          <Star className="w-3 h-3" /> Set as Primary Avatar
                        </button>
                      )}
                      <button 
                        onClick={() => handleDeleteMedia(previewImage.id)}
                        className="w-full py-3 bg-red-600 border-2 border-red-500 text-black hover:bg-black hover:text-red-500 font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                      >
                        <Trash2 className="w-3 h-3" /> Permanently Delete
                      </button>
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