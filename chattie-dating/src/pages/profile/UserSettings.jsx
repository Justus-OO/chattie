import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Sliders, Globe, Mail, Smartphone, Crown, EyeOff, Camera,
  ChevronRight, Trash2, X, BadgeCheck, Download, MonitorSmartphone,
  Loader2, Shield, AlertTriangle, MapPin,
  LogOut
} from 'lucide-react';
import { toast } from 'sonner';
import { MediaVaultModal } from '../../components/chat/ChatModals';
import PlaidIdentityVerificationModal from '../../components/modals/PlaidIdentityVerificationModal';

// Services
import { settingsService } from '../../api/settings.service';
import { useAppStore } from '../../store/useAppStore';
import { useI18n } from '../../i18n';

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

const decodeVapidKey = (key) => {
  const padding = '='.repeat((4 - key.length % 4) % 4);
  const base64 = `${key}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
};

export default function UserSettings() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const DEFAULT_SETTINGS = {
    name: '', job: '', location: '', bio: '', email: '', phone_number: '',
    intent: 'Dating', tags: [], avatar: '', cover: '', distance: 25, ageMin: 21, ageMax: 35,
    isGlobal: false, showMe: 'Everyone',
    notifs: { newMatches: true, messages: true, superLikes: true, promotions: false },
    privacy: { incognito: false, readReceipts: true },
    connected: { spotify: false, instagram: false }
  };

  // --- DATA STATE ---
  const [isLoading, setIsLoading] = useState(true);
  const [fullSettings, setFullSettings] = useState(DEFAULT_SETTINGS);

  // --- CORE STATE ---
  const isVerified = useAppStore(state => state.isIdentityVerified);
  const setIdentityVerificationStatus = useAppStore(state => state.setIdentityVerificationStatus);
  const currentUser = useAppStore(state => state.user);
  const updateSession = useAppStore(state => state.login);
  const membershipPlan = String(fullSettings.plan || 'NONE').toUpperCase();
  const membershipStatus = String(fullSettings.sub_status || '').toUpperCase();
  const membershipExpiry = fullSettings.expires_at ? new Date(fullSettings.expires_at) : null;
  const hasPremium = ['PREMIUM', 'GOLD', 'VIP'].includes(membershipPlan)
    && ['ACTIVE', 'TRIALING'].includes(membershipStatus)
    && (!membershipExpiry || membershipExpiry.getTime() > Date.now());
  const membershipExpiryLabel = membershipExpiry && !Number.isNaN(membershipExpiry.getTime())
    ? membershipExpiry.toLocaleDateString()
    : '';
  const [twoFactor, setTwoFactor] = useState({ enabled: false, channel: 'email', email_available: true, sms_available: false });
  const [twoFactorChannel, setTwoFactorChannel] = useState('email');
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [isUpdatingTwoFactor, setIsUpdatingTwoFactor] = useState(false);

  // --- DISCOVERY STATE ---
  const [distance, setDistance] = useState(25);
  const [ageMin, setAgeMin] = useState(21);
  const [ageMax, setAgeMax] = useState(35);
  const [isGlobal, setIsGlobal] = useState(false);
  const [showMe, setShowMe] = useState('Everyone');

  // --- NOTIFICATION & PRIVACY STATE ---
  const [privacy, setPrivacy] = useState(DEFAULT_SETTINGS.privacy);

  // --- MODAL STATE ---
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  const [activeSessions, setActiveSessions] = useState([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState('');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [isUpdatingPush, setIsUpdatingPush] = useState(false);
  const [showDataModal, setShowDataModal] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  
  // Vault State
  const [showMediaVault, setShowMediaVault] = useState(false);
  const [vaultImages, setVaultImages] = useState([]);
  const [isLoadingVault, setIsLoadingVault] = useState(false);

  // ============================================================================
  // EFFECTS
  // ============================================================================
  useEffect(() => {
    const loadSettings = async () => {
      setIsLoading(true);
      try {
        const data = await settingsService.getSettings();
        const security = await settingsService.getTwoFactorSettings();
        const normalized = { ...DEFAULT_SETTINGS, ...data };
        setFullSettings(normalized);
        setTwoFactor(security);
        setTwoFactorChannel(security.channel || 'email');

        setDistance(Number(normalized.distance ?? DEFAULT_SETTINGS.distance));
        setAgeMin(Number(normalized.ageMin ?? DEFAULT_SETTINGS.ageMin));
        setAgeMax(Number(normalized.ageMax ?? DEFAULT_SETTINGS.ageMax));
        setIsGlobal(Boolean(normalized.isGlobal));
        setShowMe(normalized.showMe || DEFAULT_SETTINGS.showMe);
        if (typeof normalized.verified === 'boolean') {
          setIdentityVerificationStatus(normalized.verified);
        }

        if (normalized.privacy) setPrivacy(normalized.privacy);
      } catch (error) {
        toast.error(t('coreUiSettingsLoadFailed'));
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, [setIdentityVerificationStatus, t]);

  useEffect(() => {
    if (showBlockedModal) {
      settingsService.getBlockedUsers()
        .then(res => setBlockedUsers(res || []))
        .catch(() => toast.error(t('coreUiBlockedUsersLoadFailed')));
    }
  }, [showBlockedModal, t]);

  useEffect(() => {
    let active = true;
    if (!('serviceWorker' in navigator)) return undefined;
    navigator.serviceWorker.getRegistration('/').then((registration) => (
      registration ? registration.pushManager.getSubscription() : null
    )).then((subscription) => {
      if (active) setPushEnabled(Boolean(subscription));
    }).catch((error) => {
      console.error('Failed to check browser push subscription:', error);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!showSessionsModal) return undefined;
    let active = true;
    setIsLoadingSessions(true);
    settingsService.getActiveSessions().then((sessions) => {
      if (!Array.isArray(sessions)) throw new Error(t('coreUiActiveSessionsInvalid'));
      if (active) setActiveSessions(sessions);
    }).catch((error) => {
      toast.error(error.response?.data?.error || t('coreUiActiveSessionsLoadFailed'));
    }).finally(() => {
      if (active) setIsLoadingSessions(false);
    });
    return () => { active = false; };
  }, [showSessionsModal, t]);

  // ============================================================================
  // SETTINGS HANDLERS
  // ============================================================================
  const handleSettingChange = (setter, key, value) => {
    setter(prev => ({ ...prev, [key]: value }));
  };

  const handleAgeChange = (type, value) => {
    const num = parseInt(value);
    if (type === 'min') setAgeMin(Math.min(num, ageMax - 1));
    else setAgeMax(Math.max(num, ageMin + 1));
  };

  const handleSaveSettings = async () => {
    try {
      const updatedPayload = {
        ...fullSettings, distance, ageMin, ageMax, isGlobal, showMe, privacy
      };
      await settingsService.updateSettings(updatedPayload);
      setFullSettings(updatedPayload);
      toast.success(t('coreUiPreferencesSaved'));
    } catch (error) {
      toast.error(t('coreUiPreferencesSaveFailed'));
    }
  };

  const handleTerminateSessions = async () => {
    try {
      const res = await settingsService.terminateOtherSessions();
      if (res.token && currentUser) updateSession(currentUser, res.token);
      setActiveSessions((sessions) => sessions.filter((session) => session.is_current));
      toast.success(res.message || t('coreUiOtherDevicesSignedOut'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('coreUiTerminateSessionsFailed'));
    }
  };

  const handleRevokeSession = async (session) => {
    setRevokingSessionId(session.id);
    try {
      await settingsService.revokeSession(session.id);
      setActiveSessions((sessions) => sessions.filter((item) => item.id !== session.id));
      toast.success(t('coreUiSessionSignedOut'));
    } catch (error) {
      toast.error(error.response?.data?.error || t('coreUiSessionSignOutFailed'));
    } finally {
      setRevokingSessionId('');
    }
  };

  const handlePushToggle = async () => {
    if (isUpdatingPush) return;
    setIsUpdatingPush(true);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        throw new Error(t('coreUiPushNotSupported'));
      }

      const registration = await navigator.serviceWorker.register('/service-worker.js');
      const existingSubscription = await registration.pushManager.getSubscription();
      if (existingSubscription) {
        await settingsService.deletePushSubscription(existingSubscription.endpoint);
        await existingSubscription.unsubscribe();
        setPushEnabled(false);
        toast.success(t('coreUiPushDisabled'));
        return;
      }

      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') throw new Error(t('coreUiPushPermissionRequired'));

      const publicKey = await settingsService.getPushVapidPublicKey();
      if (!publicKey) throw new Error(t('coreUiPushNotConfigured'));
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(publicKey),
      });
      await settingsService.savePushSubscription(subscription.toJSON());
      setPushEnabled(true);
      toast.success(t('coreUiPushEnabled'));
    } catch (error) {
      toast.error(error.response?.data?.error || error.message || t('coreUiPushUpdateFailed'));
    } finally {
      setIsUpdatingPush(false);
    }
  };

  const handleRequestTwoFactorChange = async (enabled) => {
    setIsUpdatingTwoFactor(true);
    try {
      const challenge = await settingsService.requestTwoFactorChange(enabled, enabled ? twoFactorChannel : twoFactor.channel);
      setTwoFactorChallenge(challenge);
      setTwoFactorCode('');
      toast.success(t('coreUiVerificationSentBy', { channel: challenge.channel }));
    } catch (error) {
      toast.error(error.response?.data?.error || t('coreUiSecurityCodeSendFailed'));
    } finally {
      setIsUpdatingTwoFactor(false);
    }
  };

  const handleVerifyTwoFactorChange = async (event) => {
    event.preventDefault();
    if (!twoFactorChallenge) return;
    setIsUpdatingTwoFactor(true);
    try {
      const updated = await settingsService.verifyTwoFactorChange(
        twoFactorChallenge.challenge_id,
        twoFactorCode,
        twoFactorChallenge.enabled,
      );
      setTwoFactor((previous) => ({ ...previous, enabled: updated.enabled, channel: updated.channel }));
      setTwoFactorChallenge(null);
      setTwoFactorCode('');
      toast.success(t(updated.enabled ? 'coreUiTwoFactorEnabled' : 'coreUiTwoFactorDisabled'));
    } catch (error) {
      toast.error(error.response?.data?.error || t('coreUiVerificationCodeInvalid'));
    } finally {
      setIsUpdatingTwoFactor(false);
    }
  };

  const handleRequestData = async () => {
    try {
      const res = await settingsService.requestDataDownload();
      toast.success(res.message || t('coreUiDataRequestInitiated'));
      setShowDataModal(false);
    } catch (err) {
      toast.error(t('coreUiDataRequestFailed'));
    }
  };

  const handleUnblock = async (id, name) => {
    try {
      await settingsService.unblockUser(id);
      setBlockedUsers(prev => prev.filter(u => u.id !== id));
      toast.success(t('coreUiUserUnblocked', { name }));
    } catch (err) {
      toast.error(t('coreUiUnblockUserFailed', { name }));
    }
  };

  const handleLogout = () => {
    toast(t('coreUiLoggingOut'));
    localStorage.removeItem('jwt_token');
    setTimeout(() => navigate('/login'), 1000);
  };

  const handleDeleteAccount = async () => {
    try {
      await settingsService.deleteAccount();
      localStorage.removeItem('jwt_token');
      toast.error(t('coreUiAccountDeleted'));
      setTimeout(() => navigate('/login'), 1500);
    } catch (error) {
      toast.error(t('coreUiAccountDeleteFailed'));
    }
  };

  // ============================================================================
  // MEDIA VAULT
  // ============================================================================
  const openMediaVault = async () => {
    setShowMediaVault(true);
    setIsLoadingVault(true);
    try {
      const media = await settingsService.getMediaVault();
      setVaultImages(Array.isArray(media) ? media : []);
    } catch (e) {
      toast.error(t('coreUiMediaVaultLoadFailed'));
    } finally {
      setIsLoadingVault(false);
    }
  };

  const handleUploadToVault = async (file) => {
    try {
      setIsLoadingVault(true);
      const uploaded = await settingsService.uploadMedia(file);
      setVaultImages(prev => [uploaded, ...prev]);
      toast.success(t('coreUiMediaVaultUploadSucceeded'));
    } catch (e) {
      toast.error(t('coreUiUploadFailed'));
    } finally {
      setIsLoadingVault(false);
    }
  };

  const handleSelectVaultImage = async (_url, media) => {
    try {
      if (!media?.id) throw new Error(t('coreUiSelectedMediaMissingId'));
      await settingsService.setPrimaryMedia(media.id);
      const updated = await settingsService.getSettings();
      setFullSettings(prev => ({ ...prev, ...updated }));
      toast.success(t('coreUiProfileAvatarUpdated'));
      setShowMediaVault(false);
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('coreUiAvatarUpdateFailed')));
    }
  };

  // ============================================================================
  // RENDER - LOADING STATE
  // ============================================================================
  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col items-center justify-center bg-black p-6 text-center text-zinc-300 font-mono">
        <Loader2 className="w-10 h-10 text-white animate-spin mb-4" />
        <h2 className="text-sm text-white uppercase tracking-widest">{t('loading')}</h2>
      </div>
    );
  }

  // ============================================================================
  // RENDER - MAIN UI
  // ============================================================================
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-black w-full relative overflow-hidden text-zinc-300 rounded-none font-mono">
      
      <header className="p-4 md:p-6 border-b-2 border-zinc-800 bg-zinc-950 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="p-1.5 border-2 border-zinc-600 bg-black">
            <Sliders className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl md:text-2xl font-bold uppercase tracking-widest text-white">{t('settings')}</h1>
        </div>
        <button 
          onClick={handleSaveSettings}
          className="px-4 py-2 bg-white text-black border-2 border-white text-sm font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors"
        >
          {t('done')}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar bg-black">
        <div className="flex min-h-full w-full flex-col space-y-4 p-2 pb-4 sm:p-3 lg:p-4">
          
          {/* VIP BANNER */}
          <section 
            onClick={() => navigate('/upgrade')}
            className="bg-black border-2 border-yellow-400 p-4 md:p-6 cursor-pointer hover:bg-zinc-950 transition-colors flex items-center justify-between group shadow-[4px_4px_0px_rgba(var(--warning-rgb), 0.1)] hover:shadow-[6px_6px_0px_rgba(var(--warning-rgb), 0.2)]"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-black border-2 border-yellow-400 flex items-center justify-center transition-transform group-hover:scale-105">
                <Crown className="w-6 h-6 text-yellow-400" />
              </div>
              <div>
                <h2 className="text-base font-bold uppercase tracking-widest text-yellow-400 mb-1">
                  {hasPremium ? `${membershipPlan} MEMBERSHIP ACTIVE` : 'MEMBERSHIP & PLANS'}
                </h2>
                <p className="text-[10px] uppercase font-bold text-zinc-400">
                  {hasPremium
                    ? `Your ${membershipPlan} plan is active${membershipExpiryLabel ? ` until ${membershipExpiryLabel}` : ''}.`
                    : `Current plan: ${membershipPlan}${membershipStatus ? ` · ${membershipStatus.toLowerCase()}` : ' · no active subscription'}.`}
                </p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-yellow-400 group-hover:text-yellow-300 transition-colors" />
          </section>

          {/* ACCOUNT INFORMATION & VERIFICATION */}
          <section className="space-y-3">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('accountInformation')}</h2>
            <div className="bg-black border-2 border-zinc-800 flex flex-col">
              
              <div className="flex items-center justify-between p-4 border-b-2 border-zinc-800 bg-zinc-950">
                <div className="flex items-center gap-3">
                  <BadgeCheck className={`w-4 h-4 ${isVerified ? 'text-blue-500' : 'text-zinc-500'}`} />
                  <span className="text-sm font-bold uppercase tracking-widest text-white">{t('coreUiProfileVerification')}</span>
                </div>
                {isVerified ? (
                  <span className="text-[10px] font-bold text-blue-500 bg-black px-2 py-1 border-2 border-blue-500 uppercase tracking-widest">{t('coreUiVerified')}</span>
                ) : (
                  <button onClick={() => setShowVerifyModal(true)} className="px-3 py-1.5 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors">
                    Get Verified
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between p-4 border-b-2 border-zinc-800 transition-colors">
                <div className="flex items-center gap-3 shrink-0">
                  <Mail className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm font-bold uppercase tracking-widest text-white">{t('coreUiEmail')}</span>
                </div>
                <div className="ml-4 max-w-[clamp(10rem,24vw,20rem)] flex-1">
                  <input
                    type="email"
                    value={fullSettings.email}
                    onChange={(e) => setFullSettings(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full bg-black border-2 border-zinc-800 rounded-none px-3 py-2 text-xs font-bold text-white text-right focus:outline-none focus:border-white transition-colors"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between p-4 transition-colors">
                <div className="flex items-center gap-3 shrink-0">
                  <Smartphone className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm font-bold uppercase tracking-widest text-white">{t('coreUiPhone')}</span>
                </div>
                <div className="ml-4 max-w-[clamp(10rem,24vw,20rem)] flex-1">
                  <input
                    type="text"
                    value={fullSettings.phone_number}
                    onChange={(e) => setFullSettings(prev => ({ ...prev, phone_number: e.target.value }))}
                    className="w-full bg-black border-2 border-zinc-800 rounded-none px-3 py-2 text-xs font-bold text-white text-right focus:outline-none focus:border-white transition-colors"
                  />
                </div>
              </div>

            </div>
          </section>

          {/* AVATAR QUICK ACTIONS */}
          <section className="space-y-3">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('profile')}</h2>
            <div className="bg-black border-2 border-zinc-800 p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-none overflow-hidden border-2 border-zinc-700">
                  {fullSettings.avatar ? (
                    <img src={fullSettings.avatar} alt={t('profile')} className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-zinc-950 text-zinc-600" aria-label={t('coreUiNoProfilePhoto')}>
                      <Camera className="h-6 w-6" />
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-sm font-bold uppercase tracking-widest text-white">{t('coreUiPrimaryPhoto')}</div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mt-1">{t('coreUiUsedForVerification')}</div>
                </div>
              </div>
              <div className="flex flex-col md:flex-row items-end md:items-center gap-2">
                {(!fullSettings.avatar) && (
                  <span className="text-[9px] font-bold text-yellow-300 border-2 border-yellow-400 px-2 py-1 uppercase tracking-widest">{t('coreUiNoImageUploaded')}</span>
                )}
                <button onClick={openMediaVault} className="px-3 py-2 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors">
                  Change
                </button>
              </div>
            </div>
          </section>

          {/* PROFILE DETAILS */}
          <section className="space-y-3">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('profileDetails')}</h2>
            <div className="bg-black border-2 border-zinc-800 p-4 space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2 block">{t('coreUiDisplayName')}</label>
                <input
                  type="text"
                  value={fullSettings.name}
                  onChange={(e) => setFullSettings(prev => ({ ...prev, name: e.target.value }))}
                  placeholder={t('coreUiDisplayNamePlaceholder')}
                  className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white transition-colors"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2 block">{t('coreUiProfessionRole')}</label>
                <input
                  type="text"
                  value={fullSettings.job}
                  onChange={(e) => setFullSettings(prev => ({ ...prev, job: e.target.value }))}
                  placeholder={t('coreUiProfessionPlaceholder')}
                  className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white transition-colors"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2 block">{t('coreUiLocation')}</label>
                <input
                  type="text"
                  value={fullSettings.location}
                  onChange={(e) => setFullSettings(prev => ({ ...prev, location: e.target.value }))}
                  placeholder={t('coreUiLocationPlaceholder')}
                  className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white transition-colors"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2 block">{t('coreUiBio')}</label>
                <textarea
                  value={fullSettings.bio}
                  onChange={(e) => setFullSettings(prev => ({ ...prev, bio: e.target.value }))}
                  placeholder={t('coreUiBioPlaceholder')}
                  className="min-h-[clamp(6rem,15vh,9rem)] w-full border-2 border-zinc-800 bg-black px-4 py-3 text-sm text-white transition-colors focus:outline-none focus:border-white rounded-none"
                />
              </div>
            </div>
          </section>

          {/* DISCOVERY PREFERENCES */}
          <section className="space-y-3">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('discoveryPreferences')}</h2>
            <div className="bg-black border-2 border-zinc-800 p-4 md:p-6 space-y-8">
              
              <div>
                <div className="flex items-center justify-between mb-4 pb-4 border-b-2 border-zinc-800">
                  <div className="flex items-center gap-3">
                    <MapPin className="w-4 h-4 text-white" />
                    <span className="text-sm font-bold uppercase tracking-widest text-white">{t('coreUiCurrentLocation')}</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{fullSettings.location || 'Unknown'}</span>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold uppercase tracking-widest text-white flex items-center gap-2">
                      <Globe className="w-4 h-4 text-zinc-400" /> Global Mode
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mt-1">{t('coreUiGlobalModeDescription')}</span>
                  </div>
                  <ToggleSwitch 
                    enabled={isGlobal} 
                    onChange={() => {
                      setIsGlobal(!isGlobal);
                      toast(t(isGlobal ? 'coreUiGlobalModeDisabled' : 'coreUiGlobalModeEnabled'));
                    }} 
                  />
                </div>
              </div>

              <div className={isGlobal ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
                <div className="flex justify-between items-end mb-4">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{t('coreUiMaximumDistance')}</label>
                  <span className="text-sm font-bold text-white">{distance} km</span>
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
                  <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{t('coreUiAgeRange')}</label>
                  <span className="text-sm font-bold text-white">{ageMin} - {ageMax}</span>
                </div>
                <div className="space-y-5">
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 w-8">{t('coreUiMin')}</span>
                    <input 
                      type="range" min="18" max="65" 
                      value={ageMin} 
                      onChange={(e) => handleAgeChange('min', e.target.value)}
                      className="w-full accent-white h-2 bg-black rounded-none appearance-none cursor-pointer border-2 border-zinc-800"
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 w-8">{t('coreUiMax')}</span>
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
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-3 block">{t('coreUiShowMe')}</label>
                <div className="flex border-2 border-zinc-800 bg-black">
                  {['Men', 'Women', 'Other', 'Everyone'].map(opt => (
                    <button
                      key={opt}
                      onClick={() => setShowMe(opt)}
                      className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-colors border-r-2 border-zinc-800 last:border-r-0
                        ${showMe === opt 
                          ? 'bg-white text-black' 
                          : 'text-zinc-500 hover:text-white hover:bg-zinc-950'
                        }`}
                    >
                      {t(`coreUiShowMe${opt}`)}
                    </button>
                  ))}
                </div>
              </div>

            </div>
          </section>

          {/* NOTIFICATION DELIVERY */}
          <section className="space-y-3">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('coreUiNotificationsDelivery')}</h2>
            <div className="bg-black border-2 border-zinc-800">
              <div className="flex items-center justify-between gap-4 border-b-2 border-zinc-800 p-4">
                <div className="pr-4">
                  <span className="text-sm font-bold uppercase tracking-widest text-white">{t('coreUiBackgroundPush')}</span>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    {t('coreUiBackgroundPushDescription')}
                  </p>
                </div>
                <ToggleSwitch enabled={pushEnabled} disabled={isUpdatingPush} onChange={handlePushToggle} />
              </div>
              {[
                ['newMatches', t('coreUiNewMatches')],
                ['messages', t('coreUiMessages')],
                ['superLikes', t('coreUiSuperLikes')],
                ['promotions', t('coreUiProductUpdates')],
              ].map(([key, label], index, items) => (
                <div key={key} className={`flex items-center justify-between gap-4 p-4 ${index < items.length - 1 ? 'border-b-2 border-zinc-800' : ''}`}>
                  <span className="text-xs font-bold uppercase tracking-widest text-zinc-300">{label}</span>
                  <ToggleSwitch
                    enabled={Boolean(fullSettings.notifs?.[key])}
                    onChange={() => setFullSettings((settings) => ({
                      ...settings,
                      notifs: { ...settings.notifs, [key]: !settings.notifs?.[key] },
                    }))}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* PRIVACY & SAFETY */}
          <section className="space-y-3">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('privacySafety')}</h2>
            <div className="bg-black border-2 border-zinc-800 flex flex-col">
              
              <div className="flex items-center justify-between p-4 border-b-2 border-zinc-800 bg-zinc-950">
                <div className="flex flex-col pr-4">
                  <span className="text-sm font-bold uppercase tracking-widest text-yellow-400 flex items-center gap-2">
                    <EyeOff className="w-4 h-4" /> {t('coreUiIncognitoMode')}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mt-1">{t('coreUiIncognitoDescription')}</span>
                </div>
                <ToggleSwitch 
                  enabled={privacy.incognito} 
                  onChange={() => {
                    if (!hasPremium) {
                      toast.error(t('coreUiIncognitoPremiumRequired'));
                      navigate('/upgrade');
                      return;
                    }
                    handleSettingChange(setPrivacy, 'incognito', !privacy.incognito);
                  }}
                />
              </div>

              <div className="flex items-center justify-between p-4 border-b-2 border-zinc-800 hover:bg-zinc-950 transition-colors">
                <div className="flex flex-col pr-4">
                  <span className="text-sm font-bold uppercase tracking-widest text-white">{t('coreUiReadReceipts')}</span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mt-1">{t('coreUiReadReceiptsDescription')}</span>
                </div>
                <ToggleSwitch 
                  enabled={privacy.readReceipts} 
                  onChange={() => handleSettingChange(setPrivacy, 'readReceipts', !privacy.readReceipts)} 
                />
              </div>

              <div className="border-b-2 border-zinc-800 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col pr-4">
                    <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white">
                      <Shield className="h-4 w-4 text-zinc-400" /> Two-factor sign-in
                    </span>
                    <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      {twoFactor.enabled ? t('coreUiTwoFactorEnabledBy', { channel: twoFactor.channel }) : t('coreUiTwoFactorDescription')}
                    </span>
                  </div>
                  <ToggleSwitch
                    enabled={twoFactor.enabled}
                    disabled={isUpdatingTwoFactor || Boolean(twoFactorChallenge)}
                    onChange={() => handleRequestTwoFactorChange(!twoFactor.enabled)}
                  />
                </div>
                {!twoFactor.enabled && !twoFactorChallenge && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {['email', ...(twoFactor.sms_available ? ['sms'] : [])].map((channel) => (
                      <button
                        key={channel}
                        type="button"
                        onClick={() => setTwoFactorChannel(channel)}
                        className={`border px-3 py-2 text-[9px] font-bold uppercase tracking-widest ${twoFactorChannel === channel ? 'border-white text-white' : 'border-zinc-800 text-zinc-500'}`}
                      >
                        {channel}
                      </button>
                    ))}
                    {twoFactorChannel === 'sms' && !twoFactor.sms_available && (
                      <span className="text-[9px] font-bold uppercase text-amber-500">{t('coreUiAddPhoneFirst')}</span>
                    )}
                  </div>
                )}
                {twoFactorChallenge && (
                  <form onSubmit={handleVerifyTwoFactorChange} className="mt-4 space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                      {t('coreUiCodeSentTo', { channel: twoFactorChallenge.channel, destination: twoFactorChallenge.destination ? ` ${t('coreUiTo')} ${twoFactorChallenge.destination}` : '' })}
                    </p>
                    <input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      value={twoFactorCode}
                      onChange={(event) => setTwoFactorCode(event.target.value)}
                      maxLength={8}
                      required
                      aria-label={t('coreUiTwoFactorCodeLabel')}
                      className="w-full border-2 border-zinc-800 bg-black px-3 py-2 text-sm font-bold tracking-[0.4em] text-white outline-none focus:border-white"
                    />
                    <div className="flex gap-2">
                      <button type="submit" disabled={isUpdatingTwoFactor || twoFactorCode.length < 6} className="border-2 border-white bg-white px-4 py-2 text-[9px] font-bold uppercase tracking-widest text-black disabled:opacity-50">
                        {isUpdatingTwoFactor ? t('coreUiVerifying') : t('coreUiConfirm')}
                      </button>
                      <button type="button" onClick={() => setTwoFactorChallenge(null)} className="border-2 border-zinc-800 px-4 py-2 text-[9px] font-bold uppercase tracking-widest text-zinc-400">
                        {t('cancel')}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              <div onClick={() => setShowSessionsModal(true)} className="flex items-center justify-between p-4 border-b-2 border-zinc-800 hover:bg-zinc-950 cursor-pointer transition-colors">
                <div className="flex items-center gap-3 text-white">
                  <MonitorSmartphone className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm font-bold uppercase tracking-widest">{t('coreUiActiveSessions')}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600" />
              </div>

              <div onClick={() => setShowDataModal(true)} className="flex items-center justify-between p-4 border-b-2 border-zinc-800 hover:bg-zinc-950 cursor-pointer transition-colors">
                <div className="flex items-center gap-3 text-white">
                  <Download className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm font-bold uppercase tracking-widest">{t('coreUiDownloadMyData')}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600" />
              </div>

              <div onClick={() => setShowBlockedModal(true)} className="flex items-center justify-between p-4 hover:bg-zinc-950 cursor-pointer transition-colors">
                <div className="flex items-center gap-3 text-white">
                  <Shield className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm font-bold uppercase tracking-widest">{t('coreUiManageBlockedUsers')}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600" />
              </div>

            </div>
          </section>

          {/* DANGER ZONE */}
          <section className="pt-8 border-t-2 border-zinc-800 space-y-4">
            <button 
              onClick={() => setShowLogoutModal(true)}
              className="w-full py-4 bg-black border-2 border-zinc-700 text-zinc-300 font-bold uppercase tracking-widest hover:text-white hover:border-zinc-500 flex items-center justify-center gap-2 transition-colors text-sm"
            >
              <LogOut className="w-4 h-4" /> Log Out
            </button>

            <button 
              onClick={() => setShowDeleteModal(true)}
              className="w-full py-4 bg-black border-2 border-red-900 text-red-500 font-bold uppercase tracking-widest hover:bg-red-950 hover:border-red-500 flex items-center justify-center gap-2 transition-colors text-sm shadow-[4px_4px_0px_rgba(var(--danger-rgb), 0.1)]"
            >
              <Trash2 className="w-4 h-4" /> Delete Account
            </button>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 text-center mt-4">{t('coreUiAppVersion', { version: '2.4.1', build: '890' })}</p>
          </section>

        </div>
      </div>

      {/* =====================================================================
          MULTI-STEP MODAL: HIGH SECURITY KYC VERIFICATION (ID + LIVENESS)
          ===================================================================== */}
      <PlaidIdentityVerificationModal
        isOpen={showVerifyModal}
        onClose={() => setShowVerifyModal(false)}
        onVerified={() => setIdentityVerificationStatus(true)}
      />

      {/* Media Vault Modal */}
      <MediaVaultModal
        isOpen={showMediaVault}
        images={vaultImages}
        isLoading={isLoadingVault}
        onClose={() => setShowMediaVault(false)}
        onSelect={(url) => handleSelectVaultImage(url)}
        onUpload={(file) => handleUploadToVault(file)}
      />

      {/* =====================================================================
          MODAL: ACTIVE SESSIONS
          ===================================================================== */}
      {showSessionsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowSessionsModal(false)} />
          <div className="relative w-full max-w-md bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] flex flex-col overflow-hidden rounded-none animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-zinc-950 shrink-0">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-white flex items-center gap-2">
                <MonitorSmartphone className="w-4 h-4 text-white" /> Active Sessions
              </h2>
              <button onClick={() => setShowSessionsModal(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[65dvh] overflow-y-auto p-4 bg-black space-y-3">
              {isLoadingSessions ? (
                <div className="py-8 text-center text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('coreUiLoadingActiveSessions')}</div>
              ) : activeSessions.length === 0 ? (
                <div className="py-8 text-center text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('coreUiNoActiveSessions')}</div>
              ) : activeSessions.map((session) => (
                <article key={session.id} className="border-2 border-zinc-800 bg-zinc-950 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-[10px] font-bold uppercase tracking-widest text-white">
                        {session.is_current ? 'This device' : (session.user_agent || 'Unknown browser')}
                      </p>
                      <p className="mt-2 text-[9px] uppercase tracking-widest text-zinc-500">
                        IP: {session.ip_address || 'Unavailable'}
                      </p>
                      <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-500">
                        Last active: {new Date(session.last_seen_at).toLocaleString()}
                      </p>
                    </div>
                    {session.is_current ? (
                      <span className="shrink-0 border border-green-800 px-2 py-1 text-[8px] font-bold uppercase text-green-400">{t('coreUiCurrent')}</span>
                    ) : (
                      <button
                        type="button"
                        disabled={revokingSessionId === session.id}
                        onClick={() => handleRevokeSession(session)}
                        className="shrink-0 border-2 border-red-900 px-2 py-1 text-[8px] font-bold uppercase text-red-400 hover:border-red-500 disabled:opacity-50"
                      >
                        {revokingSessionId === session.id ? 'Signing out…' : 'Sign out'}
                      </button>
                    )}
                  </div>
                </article>
              ))}
              <p className="text-[9px] font-bold uppercase tracking-widest leading-relaxed text-zinc-600">
                Device details and IP addresses are reported by the connecting browser and network; approximate location is not inferred.
              </p>
              <button
                type="button"
                onClick={handleTerminateSessions}
                disabled={activeSessions.filter((session) => !session.is_current).length === 0}
                className="w-full border-2 border-zinc-600 bg-black py-3 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:border-white disabled:cursor-not-allowed disabled:opacity-40"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowDataModal(false)} />
          <div className="relative w-full max-w-sm bg-black border-2 border-zinc-600 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] flex flex-col overflow-hidden rounded-none animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-zinc-950 shrink-0">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-white flex items-center gap-2">
                <Download className="w-4 h-4 text-white" /> Data Dossier
              </h2>
              <button onClick={() => setShowDataModal(false)} className="p-1 text-zinc-500 hover:text-white border-2 border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 bg-black text-center">
              <Download className="w-8 h-8 text-zinc-600 mx-auto mb-4" />
              <h3 className="text-base font-bold uppercase tracking-widest text-white mb-2">{t('coreUiRequestYourData')}</h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-6 leading-relaxed">
                Our backend will instantly compile your messages, matches, and logs into a secure PDF and email it directly to you.
              </p>
              <button 
                onClick={handleRequestData}
                className="w-full py-4 bg-white text-black border-2 border-white text-xs font-bold uppercase tracking-widest hover:bg-zinc-200 transition-colors"
              >
                Compile & Email Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: BLOCKED USERS
          ===================================================================== */}
      {showBlockedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowBlockedModal(false)} />
          <div className="relative flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden border-2 border-zinc-600 bg-black shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] animate-in zoom-in-95 duration-200 rounded-none">
            <div className="p-4 border-b-2 border-zinc-800 flex justify-between items-center bg-zinc-950 shrink-0">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-white flex items-center gap-2">
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
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('coreUiNoBlockedUsers')}</p>
                </div>
              ) : (
                blockedUsers.map(user => (
                  <div key={user.id} className="flex items-center justify-between p-3 bg-black border-2 border-zinc-800 rounded-none">
                    <div className="flex items-center gap-3">
                      <img src={user.avatar || 'https://via.placeholder.com/150'} alt={t('coreUiAvatar')} className="w-10 h-10 object-cover grayscale opacity-60 rounded-none border-2 border-zinc-700" />
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-widest text-white mb-1">{user.username || 'Unknown'}</h4>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">ID: {user.id.substring(0,8)}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleUnblock(user.id, user.username)}
                      className="px-3 py-2 bg-white text-black border-2 border-white hover:bg-zinc-200 text-[10px] font-bold uppercase tracking-widest transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowLogoutModal(false)} />
          <div className="relative w-full max-w-sm bg-black border-2 border-zinc-600 p-6 shadow-[8px_8px_0px_rgba(var(--highlight-rgb), 0.1)] animate-in zoom-in-95 duration-200 rounded-none">
            <h3 className="text-sm font-bold uppercase tracking-widest text-white mb-2">{t('coreUiLogoutAccountConfirm')}</h3>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-6 leading-relaxed">
              You will continue to be seen by other users unless you enable Incognito Mode or delete your account.
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 py-3 bg-black border-2 border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleLogout}
                className="flex-1 py-3 bg-white border-2 border-white hover:bg-zinc-200 text-black text-xs font-bold uppercase tracking-widest transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-mono">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={() => setShowDeleteModal(false)} />
          <div className="relative w-full max-w-sm bg-black border-2 border-red-900 p-6 shadow-[8px_8px_0px_rgba(var(--danger-rgb), 0.1)] animate-in zoom-in-95 duration-200 rounded-none">
            <div className="w-12 h-12 bg-black border-2 border-red-500 flex items-center justify-center mb-4">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-white mb-2">{t('coreUiDeleteAccountConfirm')}</h3>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-6 leading-relaxed">
              This action is permanent and cannot be undone. All your matches, messages, and photos will be wiped.
            </p>
            <div className="mb-6">
              <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 block mb-2">
                {t('coreUiTypeToConfirm')} <span className="text-red-500">DELETE</span>
              </label>
              <input 
                type="text"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder="DELETE"
                className="w-full bg-black border-2 border-zinc-800 rounded-none px-4 py-3 text-sm font-bold text-white focus:outline-none focus:border-red-500 transition-colors"
              />
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteInput('');
                }}
                className="flex-1 py-3 bg-black border-2 border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleDeleteAccount}
                disabled={deleteInput !== 'DELETE'}
                className="flex-[1.5] py-3 bg-red-600 border-2 border-red-600 hover:bg-red-700 text-white text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-50 disabled:grayscale disabled:border-zinc-800 disabled:bg-black disabled:text-zinc-600"
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