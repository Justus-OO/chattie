import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Sliders, Bell, Shield, LogOut, MapPin, Globe, 
  Mail, Smartphone, Crown, EyeOff, Lock, Camera,
  ChevronRight, Trash2, CheckCircle2, AlertTriangle, X,
  BadgeCheck, Music, Download, MonitorSmartphone,
  Laptop, RefreshCw, Sparkles, Check, Loader2
} from 'lucide-react';
import { toast } from 'sonner';

// Services
import { settingsService } from '../../api/settings.service';

// ============================================================================
// CUSTOM BRAND ICONS
// ============================================================================
const InstagramIcon = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
  </svg>
);

const SpotifyIcon = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.899 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.019zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141 C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.62.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
  </svg>
);

// ============================================================================
// TOGGLE COMPONENT
// ============================================================================
const ToggleSwitch = ({ enabled, onChange, disabled = false }) => (
  <button 
    type="button"
    onClick={onChange}
    disabled={disabled}
    className={`
      relative w-10 h-5 border-2 transition-colors duration-200 focus:outline-none shrink-0 rounded-none
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      ${enabled ? 'bg-white border-white' : 'bg-black border-zinc-600'}
    `}
  >
    <div 
      className={`
        absolute top-0.5 left-0.5 w-3 h-3 transition-transform duration-200 rounded-none
        ${enabled ? 'translate-x-5 bg-black' : 'translate-x-0 bg-zinc-600'}
      `}
    />
  </button>
);

// ============================================================================
// MOCK DATA (For Modals)
// ============================================================================
const MOCK_BLOCKED_USERS = [
  { id: 'b_1', name: 'ToxicUser99', date: 'Oct 12, 2025', avatar: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&w=150&q=80' },
  { id: 'b_2', name: 'CryptoSpammer', date: 'Nov 04, 2025', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80' }
];

const MOCK_SESSIONS = [
  { id: 's_1', device: 'MacBook Pro - Chrome', location: 'New York, NY', current: true, time: 'Active now' },
  { id: 's_2', device: 'iPhone 15 Pro Max', location: 'New York, NY', current: false, time: '2 hours ago' }
];

const VERIFICATION_POSES = [
  { id: 'pose_1', label: 'Hold two fingers up (Peace sign)' },
  { id: 'pose_2', label: 'Touch your chin with right hand' },
  { id: 'pose_3', label: 'Point your index finger to your left cheek' }
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function UserSettings() {
  const navigate = useNavigate();

  // Default settings shape used to normalize backend/mocked responses
  const DEFAULT_SETTINGS = {
    name: '',
    job: '',
    location: '',
    bio: '',
    intent: 'Dating',
    tags: [],
    avatar: '',
    cover: '',
    distance: 25,
    ageMin: 21,
    ageMax: 35,
    isGlobal: false,
    showMe: 'Everyone',
    notifs: { newMatches: true, messages: true, superLikes: true, promotions: false },
    privacy: { incognito: false, readReceipts: true },
    connected: { spotify: false, instagram: false }
  };

  // --- DATA STATE ---
  const [isLoading, setIsLoading] = useState(true);
  const [fullSettings, setFullSettings] = useState(DEFAULT_SETTINGS);

  // --- CORE STATE ---
  const [isVerified, setIsVerified] = useState(false);
  const [verifyStep, setVerifyStep] = useState(1); 
  const [selectedPose, setSelectedPose] = useState(VERIFICATION_POSES[0]);
  const [capturedPhoto, setCapturedPhoto] = useState(null);

  // --- DISCOVERY STATE ---
  const [distance, setDistance] = useState(25);
  const [ageMin, setAgeMin] = useState(21);
  const [ageMax, setAgeMax] = useState(35);
  const [isGlobal, setIsGlobal] = useState(false);
  const [showMe, setShowMe] = useState('Everyone');

  // --- NOTIFICATION STATE ---
  const [notifs, setNotifs] = useState({
    newMatches: true,
    messages: true,
    superLikes: true,
    promotions: false
  });

  // --- PRIVACY STATE ---
  const [privacy, setPrivacy] = useState({
    incognito: false, 
    readReceipts: true
  });

  // --- CONNECTED ACCOUNTS ---
  const [connected, setConnected] = useState({ spotify: false, instagram: false });

  // --- MODAL STATE ---
  const [blockedUsers, setBlockedUsers] = useState(MOCK_BLOCKED_USERS);
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  const [showDataModal, setShowDataModal] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');

  // ============================================================================
  // EFFECTS
  // ============================================================================
  useEffect(() => {
    const loadSettings = async () => {
      setIsLoading(true);
      try {
        const data = await settingsService.getSettings();
        // Normalize incoming data against defaults so empty/mocked objects are handled
        const normalized = { ...DEFAULT_SETTINGS, ...data };
        setFullSettings(normalized);

        // Map backend data to local state (ensure numeric types)
        setDistance(Number(normalized.distance ?? DEFAULT_SETTINGS.distance));
        setAgeMin(Number(normalized.ageMin ?? DEFAULT_SETTINGS.ageMin));
        setAgeMax(Number(normalized.ageMax ?? DEFAULT_SETTINGS.ageMax));
        setIsGlobal(Boolean(normalized.isGlobal));
        setShowMe(normalized.showMe || DEFAULT_SETTINGS.showMe);

        if (normalized.notifs) setNotifs(normalized.notifs);
        if (normalized.privacy) setPrivacy(normalized.privacy);
        if (normalized.connected) setConnected(normalized.connected);
        
      } catch (error) {
        console.error("Failed to load settings:", error);
        toast.error('Failed to load settings data.');
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  // ============================================================================
  // HANDLERS
  // ============================================================================
  const handleSettingChange = (setter, key, value, label) => {
    setter(prev => ({ ...prev, [key]: value }));
    // We update local state instantly, but only save to DB on "Done" to prevent spamming PUT requests
  };

  const handleAgeChange = (type, value) => {
    const num = parseInt(value);
    if (type === 'min') setAgeMin(Math.min(num, ageMax - 1));
    else setAgeMax(Math.max(num, ageMin + 1));
  };

  const handleSaveSettings = async () => {
    try {
      const updatedPayload = {
        ...fullSettings,
        distance,
        ageMin,
        ageMax,
        isGlobal,
        showMe,
        notifs,
        privacy,
        connected
      };
      await settingsService.updateSettings(updatedPayload);
      toast.success('Preferences saved successfully.');
    } catch (error) {
      toast.error('Failed to save preferences.');
    }
  };

  const handleUnblock = (id, name) => {
    setBlockedUsers(prev => prev.filter(u => u.id !== id));
    toast.success(`${name} unblocked.`);
  };

  const runBiometricCheck = () => {
    setVerifyStep(3); 
    setTimeout(() => {
      setVerifyStep(4); 
      setIsVerified(true);
      toast.success('Profile verification successful.');
    }, 3000);
  };

  const handleLogout = () => {
    toast('Logging out...');
    setTimeout(() => navigate('/login'), 1000);
  };

  const handleDeleteAccount = async () => {
    try {
      await settingsService.deleteAccount();
      toast.error('Account permanently deleted.');
      setTimeout(() => navigate('/login'), 1500);
    } catch (error) {
      toast.error('Failed to delete account.');
    }
  };

  // ============================================================================
  // LOADING STATE
  // ============================================================================
  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-black p-6 text-center text-zinc-300 w-full h-full" style={{ fontFamily: 'Roboto, sans-serif', fontWeight: 400 }}>
        <Loader2 className="w-10 h-10 text-white animate-spin mb-4" />
        <h2 className="text-sm text-white">Loading settings...</h2>
      </div>
    );
  }

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="flex-1 flex flex-col bg-black w-full h-full relative overflow-hidden text-zinc-300 rounded-none" style={{ fontFamily: 'Roboto, sans-serif', fontWeight: 400 }}>
      
      {/* =====================================================================
          HEADER
          ===================================================================== */}
      <header className="p-4 md:p-6 border-b-2 border-zinc-800 bg-zinc-950 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="p-1.5 border-2 border-zinc-600 bg-black">
            <Sliders className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl md:text-2xl text-white">Settings</h1>
        </div>
        <button 
          onClick={handleSaveSettings}
          className="px-4 py-2 bg-white text-black border-2 border-white text-sm hover:bg-zinc-200 transition-colors"
        >
          Done
        </button>
      </header>

      {/* =====================================================================
          MAIN SCROLLABLE CONTENT
          ===================================================================== */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-black">
        <div className="max-w-4xl mx-auto w-full p-4 md:p-8 space-y-8 pb-24">
          
          {/* VIP BANNER */}
          <section 
            onClick={() => navigate('/premium')}
            className="bg-black border-2 border-yellow-400 p-4 md:p-6 cursor-pointer hover:bg-zinc-950 transition-colors flex items-center justify-between group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-black border-2 border-yellow-400 flex items-center justify-center transition-transform group-hover:scale-105">
                <Crown className="w-6 h-6 text-yellow-400" />
              </div>
              <div>
                <h2 className="text-sm text-yellow-400 mb-1">Chattie Gold</h2>
                <p className="text-xs text-zinc-400">Unlock see who likes you & more.</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-yellow-400 group-hover:text-yellow-300 transition-colors" />
          </section>

          {/* ACCOUNT INFORMATION & VERIFICATION */}
          <section className="space-y-3">
            <h2 className="text-sm text-zinc-500">Account Information</h2>
            <div className="bg-black border-2 border-zinc-800 flex flex-col">
              
              <div className="flex items-center justify-between p-4 border-b-2 border-zinc-800 bg-zinc-950">
                <div className="flex items-center gap-3">
                  <BadgeCheck className={`w-4 h-4 ${isVerified ? 'text-blue-500' : 'text-zinc-500'}`} />
                  <span className="text-sm text-white">Profile Verification</span>
                </div>
                {isVerified ? (
                  <span className="text-xs text-blue-500 bg-black px-2 py-1 border-2 border-blue-500">Verified</span>
                ) : (
                  <button onClick={() => { setVerifyStep(1); setCapturedPhoto(null); setShowVerifyModal(true); }} className="px-3 py-1.5 bg-white text-black border-2 border-white text-xs hover:bg-zinc-200 transition-colors">
                    Get Verified
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between p-4 border-b-2 border-zinc-800 hover:bg-zinc-950 cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm text-white">Email Address</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">j***@example.com</span>
                  <ChevronRight className="w-4 h-4 text-zinc-600" />
                </div>
              </div>

              <div className="flex items-center justify-between p-4 hover:bg-zinc-950 cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <Smartphone className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm text-white">Phone Number</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">+1 (***) ***-8921</span>
                  <ChevronRight className="w-4 h-4 text-zinc-600" />
                </div>
              </div>

            </div>
          </section>

          {/* CONNECTED ACCOUNTS */}
          <section className="space-y-3">
            <h2 className="text-sm text-zinc-500">Connected Accounts</h2>
            <div className="bg-black border-2 border-zinc-800 flex flex-col">
              <div className="flex items-center justify-between p-4 border-b-2 border-zinc-800 hover:bg-zinc-950 transition-colors">
                <div className="flex items-center gap-3">
                  <SpotifyIcon className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-white">Spotify</span>
                </div>
                <button 
                  onClick={() => handleSettingChange(setConnected, 'spotify', !connected.spotify, 'Spotify')}
                  className={`px-3 py-1.5 border-2 text-xs transition-colors
                    ${connected.spotify ? 'bg-black border-zinc-600 text-zinc-400' : 'bg-white border-white text-black hover:bg-zinc-200'}
                  `}
                >
                  {connected.spotify ? 'Disconnect' : 'Connect'}
                </button>
              </div>
              <div className="flex items-center justify-between p-4 hover:bg-zinc-950 transition-colors">
                <div className="flex items-center gap-3">
                  <InstagramIcon className="w-4 h-4 text-pink-500" />
                  <span className="text-sm text-white">Instagram</span>
                </div>
                <button 
                  onClick={() => handleSettingChange(setConnected, 'instagram', !connected.instagram, 'Instagram')}
                  className={`px-3 py-1.5 border-2 text-xs transition-colors
                    ${connected.instagram ? 'bg-black border-zinc-600 text-zinc-400' : 'bg-white border-white text-black hover:bg-zinc-200'}
                  `}
                >
                  {connected.instagram ? 'Disconnect' : 'Connect'}
                </button>
              </div>
            </div>
          </section>

          {/* DISCOVERY PREFERENCES */}
          <section className="space-y-3">
            <h2 className="text-sm text-zinc-500">Discovery Preferences</h2>
            <div className="bg-black border-2 border-zinc-800 p-4 md:p-6 space-y-8">
              
              <div>
                <div className="flex items-center justify-between mb-4 pb-4 border-b-2 border-zinc-800">
                  <div className="flex items-center gap-3">
                    <MapPin className="w-4 h-4 text-white" />
                    <span className="text-sm text-white">Current Location</span>
                  </div>
                  <span className="text-xs text-zinc-400">New York, NY</span>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-sm text-white flex items-center gap-2">
                      <Globe className="w-4 h-4 text-zinc-400" /> Global Mode
                    </span>
                    <span className="text-xs text-zinc-500 mt-1">Show people from around the world.</span>
                  </div>
                  <ToggleSwitch 
                    enabled={isGlobal} 
                    onChange={() => {
                      setIsGlobal(!isGlobal);
                      toast(isGlobal ? 'Global mode disabled' : 'Global mode enabled');
                    }} 
                  />
                </div>
              </div>

              <div className={isGlobal ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
                <div className="flex justify-between items-end mb-4">
                  <label className="text-sm text-zinc-400">Maximum Distance</label>
                  <span className="text-sm text-white">{distance} mi</span>
                </div>
                <input 
                  type="range" min="1" max="100" 
                  value={distance} 
                  onChange={(e) => setDistance(Number(e.target.value))}
                  className="w-full accent-white h-2 bg-black rounded-none appearance-none cursor-pointer border-2 border-zinc-800"
                />
              </div>

              <div>
                <div className="flex justify-between items-end mb-4">
                  <label className="text-sm text-zinc-400">Age Range</label>
                  <span className="text-sm text-white">{ageMin} - {ageMax}</span>
                </div>
                <div className="space-y-5">
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-zinc-500 w-8">Min</span>
                    <input 
                      type="range" min="18" max="65" 
                      value={ageMin} 
                      onChange={(e) => handleAgeChange('min', e.target.value)}
                      className="w-full accent-white h-2 bg-black rounded-none appearance-none cursor-pointer border-2 border-zinc-800"
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-zinc-500 w-8">Max</span>
                    <input 
                      type="range" min="18" max="65" 
                      value={ageMax} 
                      onChange={(e) => handleAgeChange('max', e.target.value)}
                      className="w-full accent-white h-2 bg-black rounded-none appearance-none cursor-pointer border-2 border-zinc-800"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t-2 border-zinc-800">
                <label className="text-sm text-zinc-400 mb-3 block">Show Me</label>
                <div className="flex border-2 border-zinc-800 bg-black">
                  {['Men', 'Women', 'Everyone'].map(opt => (
                    <button
                      key={opt}
                      onClick={() => setShowMe(opt)}
                      className={`flex-1 py-3 text-sm transition-colors border-r-2 border-zinc-800 last:border-r-0
                        ${showMe === opt 
                          ? 'bg-white text-black' 
                          : 'text-zinc-500 hover:text-white hover:bg-zinc-950'
                        }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

            </div>
          </section>

          {/* NOTIFICATIONS */}
          <section className="space-y-3">
            <h2 className="text-sm text-zinc-500">Push Notifications</h2>
            <div className="bg-black border-2 border-zinc-800 flex flex-col">
              {[
                { key: 'newMatches', label: 'New Matches', desc: 'When you get a new match.' },
                { key: 'messages', label: 'Messages', desc: 'When someone sends you a text.' },
                { key: 'superLikes', label: 'Super Likes', desc: 'When someone super likes you.' },
                { key: 'promotions', label: 'Promotions', desc: 'Offers, discounts, and tips.' }
              ].map((item, idx, arr) => (
                <div key={item.key} className={`flex items-center justify-between p-4 hover:bg-zinc-950 transition-colors ${idx !== arr.length - 1 ? 'border-b-2 border-zinc-800' : ''}`}>
                  <div className="flex flex-col pr-4">
                    <span className="text-sm text-white">{item.label}</span>
                    <span className="text-xs text-zinc-500 mt-1">{item.desc}</span>
                  </div>
                  <ToggleSwitch 
                    enabled={notifs[item.key]} 
                    onChange={() => handleSettingChange(setNotifs, item.key, !notifs[item.key], item.label)} 
                  />
                </div>
              ))}
            </div>
          </section>

          {/* PRIVACY & SAFETY */}
          <section className="space-y-3">
            <h2 className="text-sm text-zinc-500">Privacy & Safety</h2>
            <div className="bg-black border-2 border-zinc-800 flex flex-col">
              
              <div className="flex items-center justify-between p-4 border-b-2 border-zinc-800 bg-zinc-950">
                <div className="flex flex-col pr-4">
                  <span className="text-sm text-yellow-400 flex items-center gap-2">
                    <EyeOff className="w-4 h-4" /> Incognito Mode
                  </span>
                  <span className="text-xs text-zinc-500 mt-1">Hide your profile. Only people you like can see you.</span>
                </div>
                <ToggleSwitch 
                  enabled={privacy.incognito} 
                  onChange={() => {
                    toast.error('Chattie Gold is required for Incognito Mode.');
                    navigate('/premium');
                  }} 
                />
              </div>

              <div className="flex items-center justify-between p-4 border-b-2 border-zinc-800 hover:bg-zinc-950 transition-colors">
                <div className="flex flex-col pr-4">
                  <span className="text-sm text-white">Read Receipts</span>
                  <span className="text-xs text-zinc-500 mt-1">Let others know when you've read their messages.</span>
                </div>
                <ToggleSwitch 
                  enabled={privacy.readReceipts} 
                  onChange={() => handleSettingChange(setPrivacy, 'readReceipts', !privacy.readReceipts, 'Read receipts')} 
                />
              </div>

              <div onClick={() => setShowSessionsModal(true)} className="flex items-center justify-between p-4 border-b-2 border-zinc-800 hover:bg-zinc-950 cursor-pointer transition-colors">
                <div className="flex items-center gap-3 text-white">
                  <MonitorSmartphone className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm">Active Sessions</span>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600" />
              </div>

              <div onClick={() => setShowDataModal(true)} className="flex items-center justify-between p-4 border-b-2 border-zinc-800 hover:bg-zinc-950 cursor-pointer transition-colors">
                <div className="flex items-center gap-3 text-white">
                  <Download className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm">Download My Data</span>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600" />
              </div>

              <div onClick={() => setShowBlockedModal(true)} className="flex items-center justify-between p-4 hover:bg-zinc-950 cursor-pointer transition-colors">
                <div className="flex items-center gap-3 text-white">
                  <Shield className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm">Manage Blocked Users</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white bg-black px-2 py-1 border-2 border-zinc-800">
                    {blockedUsers.length}
                  </span>
                  <ChevronRight className="w-4 h-4 text-zinc-600" />
                </div>
              </div>

            </div>
          </section>

          {/* DANGER ZONE */}
          <section className="pt-8 border-t-2 border-zinc-800 space-y-4">
            <button 
              onClick={() => setShowLogoutModal(true)}
              className="w-full py-4 bg-black border-2 border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 flex items-center justify-center gap-2 transition-colors text-sm"
            >
              <LogOut className="w-4 h-4" /> Log Out
            </button>

            <button 
              onClick={() => setShowDeleteModal(true)}
              className="w-full py-4 bg-black border-2 border-red-900 text-red-500 hover:bg-red-950 hover:border-red-500 flex items-center justify-center gap-2 transition-colors text-sm"
            >
              <Trash2 className="w-4 h-4" /> Delete Account
            </button>
            <p className="text-xs text-zinc-600 text-center mt-4">App Version 2.4.1 (Build 890)</p>
          </section>

        </div>
      </div>

      {/* =====================================================================
          REALISTIC MULTI-STEP MODAL: PROFILE VERIFICATION
          ===================================================================== */}
      {showVerifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={() => verifyStep !== 3 && setShowVerifyModal(false)} />
          
          <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] flex flex-col overflow-hidden rounded-none animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-zinc-950 shrink-0">
              <h2 className="text-sm text-white flex items-center gap-2">
                <BadgeCheck className="w-4 h-4 text-blue-500" /> Biometric Identity Verification
              </h2>
              {verifyStep !== 3 && (
                <button onClick={() => setShowVerifyModal(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Step 1: Select Pose & Guidelines */}
            {verifyStep === 1 && (
              <div className="p-6 flex flex-col space-y-6 bg-black">
                <div className="border-2 border-blue-500/50 p-4 bg-blue-950/20">
                  <h4 className="text-xs text-blue-400 mb-1">Anti-Spoofing Protocol</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    To prevent impersonation, our algorithm requires you to mimic a randomly generated gesture while live-scanning.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-zinc-500 block">Chosen pose requirement:</label>
                  <div className="p-4 border-2 border-white bg-zinc-950 text-center">
                    <span className="text-sm text-white">{selectedPose.label}</span>
                  </div>
                </div>

                <div className="space-y-2 text-xs text-zinc-500">
                  <p className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-green-500 shrink-0" /> Good lighting required</p>
                  <p className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-green-500 shrink-0" /> Remove sunglasses or hats</p>
                  <p className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-green-500 shrink-0" /> Center face inside the viewfinder reticle</p>
                </div>

                <button 
                  onClick={() => {
                    const randomPose = VERIFICATION_POSES[Math.floor(Math.random() * VERIFICATION_POSES.length)];
                    setSelectedPose(randomPose);
                    setVerifyStep(2);
                  }}
                  className="w-full py-4 bg-white text-black border-2 border-white text-sm hover:bg-zinc-200 transition-colors mt-2"
                >
                  Proceed to Camera Scan
                </button>
              </div>
            )}

            {/* Step 2: Camera Viewfinder Simulation */}
            {verifyStep === 2 && (
              <div className="p-6 flex flex-col items-center text-center bg-black">
                <div className="w-64 h-64 border-4 border-dashed border-zinc-600 bg-zinc-950 relative flex items-center justify-center overflow-hidden mb-6">
                  {/* Simulated Viewfinder overlay */}
                  <div className="absolute inset-4 border-2 border-white/20 flex flex-col items-center justify-between p-2">
                    <span className="text-xs text-zinc-500">Align face & gesture</span>
                    <div className="w-32 h-32 rounded-full border border-blue-500/50 flex items-center justify-center animate-pulse">
                      <Camera className="w-8 h-8 text-blue-400 opacity-60" />
                    </div>
                    <span className="text-xs text-blue-400">{selectedPose.label}</span>
                  </div>
                </div>

                <p className="text-xs text-zinc-400 mb-6">
                  Position your body and click capture when ready.
                </p>

                <div className="flex gap-3 w-full">
                  <button 
                    onClick={() => setVerifyStep(1)}
                    className="flex-1 py-3 bg-black border-2 border-zinc-700 text-zinc-400 hover:text-white text-sm transition-colors"
                  >
                    Back
                  </button>
                  <button 
                    onClick={runBiometricCheck}
                    className="flex-[2] py-3 bg-white text-black border-2 border-white hover:bg-zinc-200 text-sm transition-colors"
                  >
                    Capture & Analyze
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Biometric Analysis Processing */}
            {verifyStep === 3 && (
              <div className="p-10 flex flex-col items-center text-center bg-black space-y-6">
                <div className="relative">
                  <div className="w-20 h-20 border-4 border-zinc-800 border-t-white animate-spin flex items-center justify-center"></div>
                  <RefreshCw className="w-8 h-8 text-zinc-400 absolute inset-0 m-auto animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base text-white mb-2">Analyzing Biometrics</h3>
                  <p className="text-xs text-zinc-500 animate-pulse">
                    Comparing facial geometry & pose match...
                  </p>
                </div>
              </div>
            )}

            {/* Step 4: Verification Complete */}
            {verifyStep === 4 && (
              <div className="p-8 flex flex-col items-center text-center bg-black space-y-6">
                <div className="w-16 h-16 bg-black border-2 border-blue-500 flex items-center justify-center">
                  <BadgeCheck className="w-10 h-10 text-blue-500" />
                </div>
                <div>
                  <h3 className="text-base text-white mb-2">Verification Successful</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Your account has been authenticated. The official verification badge is now active on your profile.
                  </p>
                </div>
                <button 
                  onClick={() => setShowVerifyModal(false)}
                  className="w-full py-4 bg-white text-black border-2 border-white text-sm hover:bg-zinc-200 transition-colors"
                >
                  Done
                </button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: ACTIVE SESSIONS
          ===================================================================== */}
      {showSessionsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowSessionsModal(false)} />
          
          <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] flex flex-col overflow-hidden rounded-none animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-zinc-950 shrink-0">
              <h2 className="text-sm text-white flex items-center gap-2">
                <MonitorSmartphone className="w-4 h-4 text-white" /> Active Sessions
              </h2>
              <button onClick={() => setShowSessionsModal(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-black space-y-3">
              {MOCK_SESSIONS.map(session => (
                <div key={session.id} className="p-4 border-2 border-zinc-800 bg-zinc-950 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-black border-2 border-zinc-700">
                      <Laptop className="w-4 h-4 text-zinc-400" />
                    </div>
                    <div>
                      <h4 className="text-sm text-white">{session.device}</h4>
                      <p className="text-xs text-zinc-500 mt-0.5">{session.location} • {session.time}</p>
                    </div>
                  </div>
                  {session.current && (
                    <span className="text-xs text-green-500 border-2 border-green-500 px-2 py-0.5">This device</span>
                  )}
                </div>
              ))}
              <button 
                onClick={() => {
                  toast.success('All other sessions terminated.');
                  setShowSessionsModal(false);
                }}
                className="w-full py-4 mt-4 bg-black text-white border-2 border-zinc-600 hover:border-white text-sm transition-colors"
              >
                Log Out All Other Devices
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: DATA DOWNLOAD
          ===================================================================== */}
      {showDataModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowDataModal(false)} />
          
          <div className="relative w-full max-w-sm bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] flex flex-col overflow-hidden rounded-none animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-zinc-950 shrink-0">
              <h2 className="text-sm text-white flex items-center gap-2">
                <Download className="w-4 h-4 text-white" /> Download Data
              </h2>
              <button onClick={() => setShowDataModal(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 bg-black text-center">
              <Download className="w-8 h-8 text-zinc-600 mx-auto mb-4" />
              <h3 className="text-base text-white mb-2">Request Your Data</h3>
              <p className="text-xs text-zinc-500 mb-6 leading-relaxed">
                We'll email you a link to download a copy of your messages, matches, and profile data. This process can take up to 48 hours.
              </p>

              <button 
                onClick={() => {
                  toast.success('Data request received. Check your email shortly.');
                  setShowDataModal(false);
                }}
                className="w-full py-4 bg-white text-black border-2 border-white text-sm hover:bg-zinc-200 transition-colors"
              >
                Request Download
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: BLOCKED USERS
          ===================================================================== */}
      {showBlockedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowBlockedModal(false)} />
          
          <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 max-h-[80vh] rounded-none">
            
            <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-zinc-950 shrink-0">
              <h2 className="text-sm text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-white" /> Blocked Users
              </h2>
              <button onClick={() => setShowBlockedModal(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-black">
              {blockedUsers.length === 0 ? (
                <div className="text-center py-10 border-2 border-dashed border-zinc-800">
                  <Shield className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
                  <p className="text-xs text-zinc-500">You haven't blocked anyone.</p>
                </div>
              ) : (
                blockedUsers.map(user => (
                  <div key={user.id} className="flex items-center justify-between p-3 bg-black border-2 border-zinc-800 rounded-none">
                    <div className="flex items-center gap-3">
                      <img src={user.avatar} alt="Avatar" className="w-10 h-10 object-cover grayscale opacity-60 rounded-none border-2 border-zinc-700" />
                      <div>
                        <h4 className="text-sm text-white mb-1">{user.name}</h4>
                        <p className="text-xs text-zinc-500">Blocked: {user.date}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleUnblock(user.id, user.name)}
                      className="px-3 py-2 bg-white text-black border-2 border-white hover:bg-zinc-200 text-xs transition-colors"
                    >
                      Unblock
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: LOGOUT CONFIRMATION
          ===================================================================== */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowLogoutModal(false)} />
          
          <div className="relative w-full max-w-sm bg-black border-2 border-zinc-600 p-6 shadow-[8px_8px_0px_rgba(255,255,255,0.1)] animate-in zoom-in-95 duration-200 rounded-none">
            <h3 className="text-base text-white mb-2">Log out of Account?</h3>
            <p className="text-xs text-zinc-500 mb-6 leading-relaxed">
              You will continue to be seen by other users unless you enable Incognito Mode or delete your account.
            </p>

            <div className="flex gap-3">
              <button 
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 py-3 bg-black border-2 border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleLogout}
                className="flex-1 py-3 bg-white border-2 border-white hover:bg-zinc-200 text-black text-sm transition-colors"
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: DELETE ACCOUNT (DANGER)
          ===================================================================== */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={() => setShowDeleteModal(false)} />
          
          <div className="relative w-full max-w-sm bg-black border-2 border-red-900 p-6 shadow-[8px_8px_0px_rgba(239,68,68,0.1)] animate-in zoom-in-95 duration-200 rounded-none">
            <div className="w-12 h-12 bg-black border-2 border-red-500 flex items-center justify-center mb-4">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            
            <h3 className="text-base text-white mb-2">Delete Account?</h3>
            <p className="text-xs text-zinc-500 mb-6 leading-relaxed">
              This action is permanent and cannot be undone. All your matches, messages, and photos will be wiped.
            </p>

            <div className="mb-6">
              <label className="text-xs text-zinc-400 block mb-2">
                Type <span className="text-red-500">DELETE</span> to confirm
              </label>
              <input 
                type="text"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder="DELETE"
                className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500 transition-colors"
              />
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteInput('');
                }}
                className="flex-1 py-3 bg-black border-2 border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleDeleteAccount}
                disabled={deleteInput !== 'DELETE'}
                className="flex-[1.5] py-3 bg-red-600 border-2 border-red-600 hover:bg-red-700 text-white text-sm transition-colors disabled:opacity-50 disabled:grayscale disabled:border-zinc-800 disabled:bg-black disabled:text-zinc-600"
              >
                Permanently Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}