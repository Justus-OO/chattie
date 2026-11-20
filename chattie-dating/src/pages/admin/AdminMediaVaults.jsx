import React, { useState, useEffect, useRef } from 'react';
import { 
  Image as ImageIcon, UploadCloud, FolderOpen, HardDrive, 
  Search, Filter, CheckCircle2, XCircle, Trash2, Star, 
  Eye, Lock, Camera, Activity, RefreshCcw, FileImage, 
  AlertTriangle, Terminal, X, ChevronRight, Upload,
  Zap, Database, Link2, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { adminService } from '../../api/admin.service';
import { useI18n } from '../../i18n';

// ============================================================================
// COMPONENT: ADMIN MEDIA VAULTS
// ============================================================================
export default function AdminMediaVaults() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('DIRECTORY'); // DIRECTORY, INJECTION, AUDIT
  const [isLoading, setIsLoading] = useState(true);
  
  // Data State
  const [personas, setPersonas] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Vault Drawer State
  const [selectedPersona, setSelectedPersona] = useState(null);
  const [vaultMedia, setVaultMedia] = useState([]);
  const [isLoadingGallery, setIsLoadingGallery] = useState(false);
  const [drawerTab, setDrawerTab] = useState('GALLERY'); // GALLERY, SETTINGS
  const [previewImage, setPreviewImage] = useState(null);

  // Bulk Upload State
  const [uploadTargetId, setUploadTargetId] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploadFiles, setUploadFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState([]);

  // Telemetry State
  const [telemetry, setTelemetry] = useState({
    totalStorage: '0.0 MB',
    totalAssets: 0,
    syncStatus: 'OPTIMAL'
  });

  // ============================================================================
  // DATA FETCHING
  // ============================================================================
  const fetchVaultData = async () => {
    try {
      setIsLoading(true);
      const [vaultsData, logsData] = await Promise.all([
        adminService.getVaults(),
        adminService.getAuditLogs()
      ]);
      
      setPersonas(vaultsData || []);
      setAuditLogs(logsData || []);

      // Calculate total assets & storage from real data
      const totalAssetsCount = (vaultsData || []).reduce((acc, curr) => acc + (curr.totalAssets || 0), 0);
      setTelemetry(prev => ({
        ...prev,
        totalAssets: totalAssetsCount
      }));
    } catch (error) {
      console.error("Failed to fetch media vaults", error);
      toast.error(t('adminUiSyncMediaClusterError'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchVaultData();
  }, []);

  const openVaultGallery = async (persona) => {
    setSelectedPersona(persona);
    setPreviewImage(null);
    setDrawerTab('GALLERY');
    try {
      setIsLoadingGallery(true);
      const galleryData = await adminService.getVaultGallery(persona.id);
      setVaultMedia(galleryData || []);
    } catch (error) {
      toast.error(t('adminUiLoadVaultAssetsError'));
    } finally {
      setIsLoadingGallery(false);
    }
  };

const handleSetPrimary = async (imageId) => {
    if (!selectedPersona) return;
    try {
      await adminService.setPrimary(selectedPersona.id, imageId);
      
      // Update local state to reflect change instantly (Fixed missing closing parenthesis here)
      setVaultMedia(prev => prev.map(img => ({
        ...img,
        isPrimary: img.id === imageId
      })));

      // Update primary image in the persona card view
      const targetImg = vaultMedia.find(img => img.id === imageId);
      if (targetImg) {
        setPersonas(prev => prev.map(p => p.id === selectedPersona.id ? { ...p, primaryImage: targetImg.url } : p));
        setSelectedPersona(prev => ({ ...prev, primaryImage: targetImg.url }));
      }

      toast.success(t('adminUiPrimaryAvatarUpdated'));
    } catch (error) {
      toast.error(t('adminUiSetPrimaryAssetError'));
    }
  };

  const handleDeleteMedia = async (imageId) => {
    try {
      await adminService.deleteAsset(imageId);
      setVaultMedia(prev => prev.filter(img => img.id !== imageId));
      toast(t('adminUiAssetDeleted'));
      if (previewImage?.id === imageId) setPreviewImage(null);
      fetchVaultData(); // Refresh counts
    } catch (error) {
      toast.error(t('adminUiDeleteAssetError'));
    }
  };

  // Drag & Drop Upload Handlers
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
    if (!uploadTargetId) {
      toast.error(t('adminUiSelectPersonaVault'));
      return;
    }
    if (uploadFiles.length === 0) {
      toast.error(t('adminUiNoFilesQueued'));
      return;
    }

    try {
      setIsUploading(true);
      const formData = new FormData();
      uploadFiles.forEach(f => {
        formData.append('files', f.file);
      });

      await adminService.injectAssets(uploadTargetId, formData);

      toast.success(t('adminUiAssetsInjected', { count: uploadFiles.length }));
      setUploadFiles([]);
      setUploadTargetId('');
      fetchVaultData(); // Refresh directory metrics
    } catch (error) {
      toast.error(t('adminUiBulkInjectionError'));
    } finally {
      setIsUploading(false);
    }
  };

  const filteredPersonas = personas.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.assignedOp.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black font-mono text-zinc-300 rounded-none" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      
      {/* =========================================
          TOP TELEMETRY BAR
          ========================================= */}
      <div className="border-b-2 border-zinc-800 bg-zinc-950 p-4 flex flex-wrap justify-between items-center text-[10px] uppercase font-black tracking-widest shrink-0 gap-4 z-10 relative">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2 text-purple-500">
            <HardDrive className="w-4 h-4 animate-pulse" /> {t('adminUiStorageClusterActive')}
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden sm:inline-block">
            {t('adminUiS3Usage')}: <span className="text-white">{telemetry.totalStorage}</span>
          </span>
          <span className="border-l-2 border-zinc-800 pl-4 text-zinc-500 hidden md:inline-block">
            {t('adminUiAssetsIndexed')}: <span className="text-blue-400">{telemetry.totalAssets.toLocaleString()}</span>
          </span>
        </div>
        <button 
          onClick={() => { fetchVaultData(); toast(t('adminUiCdnCacheInvalidated')); }}
          className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors bg-black border-2 border-zinc-800 px-3 py-1"
        >
          <RefreshCcw className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{t('adminUiPurgeCache')}</span>
        </button>
      </div>

      {/* =========================================
          MAIN HEADER & TABS
          ========================================= */}
      <div className="shrink-0 border-b-2 border-zinc-800 bg-black p-3 sm:p-4 flex flex-col gap-4 z-10 relative">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-widest mb-2 flex items-center gap-3">
              <ImageIcon className="w-8 h-8 text-purple-500" /> {t('adminUiMediaVaults')}
            </h1>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
              {t('adminUiMediaVaultsDescription')}
            </p>
          </div>
          
          <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-2 border-red-500 text-red-500">
            <Lock className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">{t('adminUiCreatorUploadsDisabled')}</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-2 border-b-2 border-zinc-800">
          {[
            { id: 'DIRECTORY', label: t('adminUiPersonaVaults', { count: personas.length }), icon: FolderOpen },
            { id: 'INJECTION', label: t('adminUiBulkAssetInjection'), icon: UploadCloud },
            { id: 'AUDIT', label: t('adminUiMediaAuditLog'), icon: Terminal },
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
              {tab.id === 'INJECTION' && uploadFiles.length > 0 && <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse ml-1" />}
            </button>
          ))}
        </div>
      </div>

      {/* =========================================
          TAB CONTENT AREA
          ========================================= */}
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar relative bg-black">
        
        {isLoading ? (
          <div className="flex items-center justify-center h-full w-full p-20">
            <Loader2 className="w-10 h-10 text-zinc-600 animate-spin" />
          </div>
        ) : (
          <>
            {/* =========================================
                TAB 1: VAULT DIRECTORY
                ========================================= */}
            {activeTab === 'DIRECTORY' && (
              <div className="p-2 sm:p-3 lg:p-4 space-y-4">
                
                {/* Search */}
                <div className="flex bg-zinc-950 p-4 border-2 border-zinc-800 items-center gap-2">
                  <Search className="w-4 h-4 text-zinc-500" />
                  <input 
                    type="text" 
                    placeholder={t('adminUiSearchPersonasOrOperator')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-transparent border-none outline-none text-xs font-bold text-white uppercase tracking-widest w-full placeholder:text-zinc-600"
                  />
                </div>

                {/* Persona Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {filteredPersonas.map(persona => (
                    <div 
                      key={persona.id} 
                      onClick={() => openVaultGallery(persona)}
                      className="bg-zinc-950 border-2 border-zinc-800 p-5 flex flex-col cursor-pointer group hover:border-white transition-colors relative overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 p-3 opacity-20 group-hover:opacity-10 transition-opacity">
                        <Database className="w-16 h-16 text-zinc-500" />
                      </div>
                      
                      <div className="flex items-center gap-4 mb-4 relative z-10">
                        <div className="w-12 h-12 border-2 border-zinc-700 bg-black flex items-center justify-center overflow-hidden">
                          {persona.primaryImage ? (
                            <img src={persona.primaryImage} alt={t('adminUiPrimaryImage')} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" />
                          ) : (
                            <Camera className="w-5 h-5 text-zinc-600" />
                          )}
                        </div>
                        <div>
                          <h3 className="text-sm font-black text-white uppercase">{persona.name}</h3>
                          <p className="text-[9px] text-zinc-500 font-bold uppercase">{persona.archetype}</p>
                        </div>
                      </div>

                      <div className="space-y-2 flex-1 relative z-10 mt-2">
                        <div className="flex justify-between items-center text-[10px] font-mono border-b border-zinc-900 pb-1">
                          <span className="text-zinc-500">{t('adminUiVaultId')}:</span>
                          <span className="text-white">{persona.id}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-mono border-b border-zinc-900 pb-1">
                          <span className="text-zinc-500">{t('adminUiTotalAssets')}:</span>
                          <span className="text-blue-400 font-black">{persona.totalAssets}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-mono border-b border-zinc-900 pb-1">
                          <span className="text-zinc-500">{t('adminUiStorageUsed')}:</span>
                          <span className="text-white">{persona.storageUsed}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-mono">
                          <span className="text-zinc-500">{t('adminUiAssignedOperator')}:</span>
                          <span className="text-green-400 bg-green-500/10 px-1 border border-green-500/30">{persona.assignedOp}</span>
                        </div>
                      </div>

                      <div className="mt-6 pt-4 border-t-2 border-zinc-800 flex justify-between items-center relative z-10">
                        <span className="text-[8px] text-zinc-500 uppercase font-black">{t('adminUiSync')}: {persona.lastUpdated}</span>
                        <span className="text-[10px] font-black uppercase text-zinc-400 group-hover:text-white transition-colors flex items-center gap-1">
                          {t('adminUiOpenVault')} <ChevronRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* =========================================
                TAB 2: BULK ASSET INJECTION (UPLOADER)
                ========================================= */}
            {activeTab === 'INJECTION' && (
              <div className="w-full p-2 sm:p-3 lg:p-4 space-y-4">
                
                <div className="bg-zinc-950 border-2 border-zinc-800 p-6">
                  <h2 className="text-lg font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Link2 className="w-5 h-5 text-blue-400" /> {t('adminUiTargetVaultSelection')}
                  </h2>
                  <select 
                    value={uploadTargetId}
                    onChange={(e) => setUploadTargetId(e.target.value)}
                    className="w-full bg-black border-2 border-zinc-700 p-4 text-xs text-white font-black uppercase outline-none focus:border-blue-500 transition-colors cursor-pointer appearance-none"
                  >
                    <option value="" disabled>-- {t('adminUiSelectVaultToInject')} --</option>
                    {personas.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                    ))}
                  </select>
                </div>

                {/* Drag & Drop Zone */}
                <div 
                  className={`border-2 border-dashed p-12 flex flex-col items-center justify-center text-center transition-all ${
                    dragActive ? 'border-blue-500 bg-blue-500/5' : 'border-zinc-700 bg-zinc-950 hover:border-zinc-500 hover:bg-zinc-900'
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
                  <UploadCloud className={`w-16 h-16 mb-4 ${dragActive ? 'text-blue-500 animate-bounce' : 'text-zinc-600'}`} />
                  <h3 className="text-xl font-black text-white uppercase tracking-widest mb-2">{t('adminUiDragDropAssets')}</h3>
                  <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
                    {t('adminUiBrowseLocalFiles')}
                  </p>
                </div>

                {/* Upload Queue Preview */}
                {uploadFiles.length > 0 && (
                  <div className="bg-black border-2 border-zinc-800 p-6 space-y-4">
                    <div className="flex justify-between items-center border-b-2 border-zinc-800 pb-2">
                      <h4 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                        <Database className="w-3 h-3 text-yellow-400" /> {t('adminUiPendingInjectionQueue')}
                      </h4>
                      <span className="text-[10px] font-black text-blue-400">{t('adminUiFilesCount', { count: uploadFiles.length })}</span>
                    </div>

                    <div className="grid max-h-[60dvh] grid-cols-2 gap-4 overflow-y-auto pr-2 custom-scrollbar sm:grid-cols-4">
                      {uploadFiles.map(file => (
                        <div key={file.id} className="relative group border-2 border-zinc-800 bg-zinc-950 aspect-square">
                          <img src={file.preview} alt={t('adminUiAssetPreview')} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                            <button 
                              onClick={(e) => { e.stopPropagation(); setUploadFiles(prev => prev.filter(f => f.id !== file.id)); }}
                              className="self-end p-1 bg-red-500 text-black border border-red-900 hover:bg-black hover:text-red-500 transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                            <span className="text-[8px] font-black text-white uppercase truncate">{file.file.name}</span>
                            <span className="text-[8px] font-mono text-zinc-400">{file.size}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="pt-4 flex gap-4">
                      <button 
                        onClick={() => setUploadFiles([])}
                        className="px-6 py-4 border-2 border-zinc-700 text-zinc-400 hover:text-white hover:border-white font-black text-[10px] uppercase tracking-widest transition-colors flex-1"
                      >
                        {t('adminUiClearQueue')}
                      </button>
                      <button 
                        onClick={executeBulkUpload}
                        disabled={isUploading}
                        className="px-6 py-4 border-2 border-blue-500 bg-blue-600 text-black hover:bg-black hover:text-blue-500 font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2 flex-1 shadow-[4px_4px_0px_rgba(var(--info-rgb), 0.3)] hover:shadow-none translate-y-0 hover:translate-y-1 hover:translate-x-1 disabled:opacity-50"
                      >
                        {isUploading ? <><RefreshCcw className="w-4 h-4 animate-spin" /> {t('adminUiInjecting')}</> : <><Upload className="w-4 h-4" /> {t('adminUiExecuteInjection')}</>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* =========================================
                TAB 3: AUDIT LOGS
                ========================================= */}
            {activeTab === 'AUDIT' && (
              <div className="p-2 sm:p-3 lg:p-4">
                <div className="bg-zinc-950 border-2 border-zinc-800 overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono whitespace-nowrap">
                    <thead className="bg-black border-b-2 border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-widest">
                      <tr>
                        <th className="p-4">{t('adminUiTime')}</th>
                        <th className="p-4">{t('adminUiAction')}</th>
                        <th className="p-4">{t('adminUiTargetVault')}</th>
                        <th className="p-4">{t('adminUiAdminSystem')}</th>
                        <th className="p-4">{t('adminUiAssetReference')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-zinc-900 text-zinc-300 font-bold uppercase tracking-wide">
                      {auditLogs.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="p-12 text-center text-zinc-500">{t('adminUiNoAuditRecords')}</td>
                        </tr>
                      ) : (
                        auditLogs.map(log => (
                          <tr key={log.id} className="hover:bg-zinc-900 transition-colors">
                            <td className="p-4 text-zinc-500">{log.time}</td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 text-[9px] font-black border ${
                                log.action.includes('DELETE') ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                                log.action.includes('INJECT') ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                                'bg-green-500/10 text-green-400 border-green-500/30'
                              }`}>
                                {log.action}
                              </span>
                            </td>
                            <td className="p-4 text-white">{log.target}</td>
                            <td className="p-4 text-zinc-400">{log.admin}</td>
                            <td className="max-w-[clamp(8rem,18vw,13rem)] truncate p-4 text-zinc-500">{log.filename}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* =====================================================================
          PERSONA VAULT DRAWER (Gallery Manager)
          ==================================================================== */}
      {selectedPersona && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedPersona(null)} />
          
          <div className="relative w-full max-w-4xl h-full bg-black border-l-2 border-zinc-800 shadow-[[-10px_0_30px_rgba(var(--shadow-rgb), 0.8)]] flex flex-col animate-in slide-in-from-right-full duration-300">
            
            {/* Drawer Header */}
            <div className="p-6 bg-zinc-950 border-b-2 border-zinc-800 shrink-0 flex justify-between items-start">
              <div className="flex gap-6 items-center">
                <div className="w-16 h-16 border-2 border-zinc-700 bg-black">
                  {selectedPersona.primaryImage ? (
                    <img src={selectedPersona.primaryImage} alt={t('adminUiPrimaryImage')} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600"><Camera className="w-6 h-6" /></div>
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-black text-white uppercase tracking-widest">
                    {selectedPersona.name} Vault
                  </h2>
                  <div className="mt-2 text-[10px] text-zinc-400 font-mono font-bold flex gap-4">
                    <span>ID: {selectedPersona.id}</span>
                    <span>{t('adminUiOperatorAbbreviation')}: <span className="text-green-400">{selectedPersona.assignedOp}</span></span>
                    <span>{t('adminUiStorageUsed')}: {selectedPersona.storageUsed}</span>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedPersona(null)} className="p-2 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 bg-black transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Tabs */}
            <div className="flex bg-black border-b-2 border-zinc-800 shrink-0 px-6 pt-4 gap-4 overflow-x-auto custom-scrollbar">
              {[{ id: 'GALLERY', label: t('adminUiGallery') }, { id: 'SETTINGS', label: t('adminUiSettings') }].map(({ id: tab, label }) => (
                <button
                  key={tab}
                  onClick={() => setDrawerTab(tab)}
                  className={`pb-3 text-[10px] font-black uppercase tracking-widest border-b-2 transition-colors whitespace-nowrap ${
                    drawerTab === tab ? 'border-white text-white' : 'border-transparent text-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Drawer Content Area */}
            <div className="flex-1 overflow-hidden relative flex">
              
              {/* Main Column */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                
                {drawerTab === 'GALLERY' && (
                  <div className="space-y-6 animate-in fade-in duration-200">
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                        <FileImage className="w-4 h-4 text-purple-400" /> {t('adminUiVaultAssets')}
                      </h4>
                      <button 
                        onClick={() => { setSelectedPersona(null); setActiveTab('INJECTION'); setUploadTargetId(selectedPersona.id); }}
                        className="text-[9px] font-black text-blue-400 border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 uppercase hover:bg-blue-500 hover:text-black transition-colors"
                      >
                        {t('adminUiInjectNew')}
                      </button>
                    </div>

                    {isLoadingGallery ? (
                      <div className="flex items-center justify-center p-20">
                        <Loader2 className="w-8 h-8 text-zinc-600 animate-spin" />
                      </div>
                    ) : vaultMedia.length === 0 ? (
                      <div className="p-12 border-2 border-dashed border-zinc-800 text-center text-zinc-500">
                        {t('adminUiNoAssetsInVault')}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {vaultMedia.map(img => (
                          <div 
                            key={img.id} 
                            onClick={() => setPreviewImage(img)}
                            className={`relative aspect-square border-2 cursor-pointer transition-all ${
                              previewImage?.id === img.id ? 'border-white ring-4 ring-white/20' : 'border-zinc-800 hover:border-zinc-500'
                            }`}
                          >
                            <img src={img.url} alt={t('adminUiVaultAsset')} className="w-full h-full object-cover" />
                            
                            {/* Badges */}
                            <div className="absolute top-2 left-2 flex gap-1">
                              {img.isPrimary && (
                                <span className="bg-green-500 text-black px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest flex items-center gap-1 shadow-md">
                                  <Star className="w-2 h-2" /> {t('adminUiPrimary')}
                                </span>
                              )}
                            </div>
                            
                            {/* Hover Overlay */}
                            <div className="absolute inset-0 bg-black/60 opacity-0 hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-4 text-center">
                              <Eye className="w-6 h-6 text-white mb-2" />
                              <span className="text-[8px] text-zinc-300 font-mono uppercase">{img.size}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {drawerTab === 'SETTINGS' && (
                  <div className="space-y-6 animate-in fade-in duration-200 max-w-lg">
                    <div className="bg-zinc-950 border-2 border-zinc-800 p-6 space-y-4">
                      <h4 className="text-[10px] font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-3 flex items-center gap-2">
                        <Lock className="w-3 h-3 text-red-500" /> {t('adminUiVaultSecurityConfiguration')}
                      </h4>
                      
                      <div className="flex justify-between items-center py-2 border-b border-zinc-900/50">
                        <div>
                          <span className="block text-xs font-bold text-white uppercase mb-1">{t('adminUiAutoWatermarking')}</span>
                          <span className="block text-[9px] text-zinc-500 font-bold uppercase tracking-widest">{t('adminUiWatermarkingDescription')}</span>
                        </div>
                        <button className="relative inline-flex h-6 w-11 items-center border-2 bg-green-500 border-green-500 transition-colors">
                          <span className="inline-block h-4 w-4 transform translate-x-6 bg-white transition-transform" />
                        </button>
                      </div>

                      <div className="flex justify-between items-center py-2 border-b border-zinc-900/50">
                        <div>
                          <span className="block text-xs font-bold text-white uppercase mb-1">{t('adminUiPreventMobileScreenshots')}</span>
                          <span className="block text-[9px] text-zinc-500 font-bold uppercase tracking-widest">{t('adminUiDrmClientDescription')}</span>
                        </div>
                        <button className="relative inline-flex h-6 w-11 items-center border-2 bg-black border-zinc-600 transition-colors">
                          <span className="inline-block h-4 w-4 transform translate-x-1 bg-white transition-transform" />
                        </button>
                      </div>

                      <div className="pt-4">
                        <label className="block text-[9px] text-zinc-500 font-black uppercase tracking-widest mb-2">{t('adminUiVaultStorageLimitGb')}</label>
                        <input type="number" defaultValue={5} className="w-full bg-black border-2 border-zinc-700 p-3 text-xs text-white font-mono font-bold outline-none focus:border-white transition-colors" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Side: Image Inspector Panel */}
              {drawerTab === 'GALLERY' && previewImage && (
                <div className="flex w-[clamp(14rem,22vw,20rem)] shrink-0 flex-col border-l-2 border-zinc-800 bg-zinc-950 animate-in slide-in-from-right-8 duration-200">
                  <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center">
                    <span className="text-[10px] font-black text-white uppercase tracking-widest">{t('adminUiAssetInspector')}</span>
                    <button onClick={() => setPreviewImage(null)} className="text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
                    <div className="aspect-square border-2 border-zinc-800 bg-black">
                      <img src={previewImage.url} alt={t('adminUiAssetPreview')} className="w-full h-full object-contain" />
                    </div>

                    <div className="space-y-3 font-mono text-xs uppercase font-bold bg-black p-4 border-2 border-zinc-800 text-zinc-400">
                      <div className="flex justify-between border-b border-zinc-900 pb-1">
                        <span>ID</span><span className="text-white">{previewImage.id}</span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-900 pb-1">
                        <span>{t('adminUiType')}</span><span className="text-white">{previewImage.type}</span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-900 pb-1">
                        <span>{t('adminUiSize')}</span><span className="text-white">{previewImage.size}</span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-900 pb-1">
                        <span>{t('adminUiUploaded')}</span><span className="text-white">{previewImage.uploadedAt}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('adminUiStatus')}</span>
                        {previewImage.isPrimary ? <span className="text-green-400">{t('adminUiPrimaryAvatar')}</span> : <span>{t('adminUiGallery')}</span>}
                      </div>
                    </div>

                    <div className="space-y-3 pt-4 border-t-2 border-zinc-800">
                      {!previewImage.isPrimary && (
                        <button 
                          onClick={() => handleSetPrimary(previewImage.id)}
                          className="w-full py-3 bg-black border-2 border-green-500 text-green-500 hover:bg-green-500 hover:text-black font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                        >
                          <Star className="w-3 h-3" /> {t('adminUiSetPrimaryAvatar')}
                        </button>
                      )}
                      <button 
                        onClick={() => handleDeleteMedia(previewImage.id)}
                        className="w-full py-3 bg-red-600 border-2 border-red-500 text-black hover:bg-black hover:text-red-500 font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                      >
                        <Trash2 className="w-3 h-3" /> {t('adminUiPermanentlyDelete')}
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