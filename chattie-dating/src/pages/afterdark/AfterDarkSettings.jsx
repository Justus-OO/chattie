import React, { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Sliders, User, Shield, Bell, Wallet, Eye,
  Globe, AlertTriangle, X, Camera, UploadCloud, 
  Smartphone, Mail, MapPin, EyeOff, Key, ShieldCheck, 
  DownloadCloud, Trash2, Link as LinkIcon,
  RefreshCcw, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '../../store/useAppStore';
import { afterDarkService } from '../../api/afterdark.service';
import { settingsService } from '../../api/settings.service';
import { useI18n } from '../../i18n';
import { PagePrivacyShield, usePageFocus } from '../../hooks/usePageFocus';

// ============================================================================
// INLINE COMPONENT: CUSTOM TOGGLE SWITCH
// ============================================================================
const CustomToggle = ({ label, description, checked, onChange, disabled = false }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    className={`flex w-full items-start justify-between p-4 text-left border-2 transition-colors ${checked ? 'border-white bg-zinc-950' : 'border-zinc-800 bg-black'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-zinc-500'}`}
    onClick={() => onChange(!checked)}
  >
    <span className="flex-1 pr-4">
      <span className={`mb-1 block text-[10px] font-black uppercase tracking-widest ${checked ? 'text-white' : 'text-zinc-400'}`}>{label}</span>
      {description && <span className="block text-[9px] font-bold uppercase leading-relaxed text-zinc-500">{description}</span>}
    </span>
    <span className={`flex h-6 w-12 shrink-0 items-center border-2 p-0.5 transition-all ${checked ? 'justify-end border-white bg-white' : 'justify-start border-zinc-600 bg-black'}`}>
      <span className={`h-4 w-4 border border-black shadow-sm ${checked ? 'bg-black' : 'bg-zinc-600'}`}></span>
    </span>
  </button>
);

// ============================================================================
// MAIN COMPONENT: SETTINGS ENGINE
// ============================================================================
export default function AfterDarkSettings() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useI18n();
  const currentUser = useAppStore(state => state.user) || { name: 'Creator', email: 'creator@example.com' };
  const storedCreatorStatus = useAppStore(state => state.isCreator);
  const setCreatorStatus = useAppStore(state => state.setCreatorStatus);
  const isCreator = typeof currentUser.isCreator === 'boolean' ? currentUser.isCreator : storedCreatorStatus;
  const updateUser = useAppStore(state => state.updateUser);
  const updateSession = useAppStore(state => state.login);
  const [creatorProfileStatus, setCreatorProfileStatus] = useState(null);
  const hasCreatorProfile = creatorProfileStatus ?? isCreator;
  const isPageFocused = usePageFocus();
  const storedSettings = {};
  const creatorTabs = [
    { id: 'profile', label: t('adPublicProfile'), icon: User },
    { id: 'monetization', label: t('adMonetization'), icon: Wallet },
    { id: 'payouts', label: t('adPayouts'), icon: Wallet },
    { id: 'privacy', label: t('adPrivacyGeo'), icon: Globe },
    { id: 'security', label: t('adSecurity'), icon: Shield },
    { id: 'notifications', label: t('adNotifications'), icon: Bell },
    { id: 'danger', label: t('adDangerZone'), icon: AlertTriangle, danger: true },
  ];
  const memberTabs = [
    { id: 'account', label: t('adAccount'), icon: User },
    { id: 'privacy', label: t('adPrivacyContent'), icon: EyeOff },
    { id: 'security', label: t('adSecurity'), icon: Shield },
    { id: 'notifications', label: t('adNotifications'), icon: Bell },
    { id: 'danger', label: t('adDataAccount'), icon: Trash2, danger: true },
  ];
  const settingsTabs = hasCreatorProfile ? creatorTabs : memberTabs;
  const requestedTab = searchParams.get('tab') || (hasCreatorProfile ? 'profile' : 'account');
  const [activeTab, setActiveTab] = useState(requestedTab);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [avatarFile, setAvatarFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(storedSettings.avatar || '');
  const [coverPreview, setCoverPreview] = useState(storedSettings.cover || '');
  const avatarInputRef = useRef(null);
  const coverInputRef = useRef(null);
  const [paused, setPaused] = useState(Boolean(storedSettings.paused));
  const [showExplicitContent, setShowExplicitContent] = useState(Boolean(storedSettings.showExplicitContent));
  const [discoverable, setDiscoverable] = useState(storedSettings.discoverable ?? true);

  React.useEffect(() => {
    const requested = searchParams.get('tab') || (hasCreatorProfile ? 'profile' : 'account');
    const validForRole = hasCreatorProfile
      ? ['profile', 'monetization', 'payouts', 'privacy', 'security', 'notifications', 'danger'].includes(requested)
      : ['account', 'privacy', 'security', 'notifications', 'danger'].includes(requested);
    setActiveTab(validForRole ? requested : (hasCreatorProfile ? 'profile' : 'account'));
  }, [searchParams, hasCreatorProfile]);

  const changeSettingsTab = tabId => {
    setActiveTab(tabId);
    setSearchParams(tabId === (hasCreatorProfile ? 'profile' : 'account') ? {} : { tab: tabId }, { replace: true });
  };

  React.useEffect(() => {
    let active = true;
    afterDarkService.getMyPerformerProfile()
      .then(response => {
        const profile = response?.profile || response;
        const exists = Boolean(profile && (profile.id || profile.user_id || profile.username));
        if (!active) return;
        setCreatorProfileStatus(exists);
        if (exists !== storedCreatorStatus) setCreatorStatus(exists);
      })
      .catch(error => {
        if (!active) return;
        if (error?.response?.status === 404) {
          setCreatorProfileStatus(false);
          if (storedCreatorStatus) setCreatorStatus(false);
          return;
        }
        toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load creator profile status.'));
      });
    return () => { active = false; };
  }, [setCreatorStatus, storedCreatorStatus]);

  // --- Profile State ---
  const [displayName, setDisplayName] = useState(storedSettings.displayName ?? currentUser.name);
  const [username, setUsername] = useState(storedSettings.username ?? currentUser.username ?? '');
  const [bio, setBio] = useState(storedSettings.bio ?? '');
  const [location, setLocation] = useState(storedSettings.location ?? '');
  const [website, setWebsite] = useState(storedSettings.website ?? '');

  // --- Monetization State ---
  const [defaultPpv, setDefaultPpv] = useState(storedSettings.defaultPpv ?? '');
  const [autoWithdraw, setAutoWithdraw] = useState(storedSettings.autoWithdraw ?? false);
  const [withdrawThreshold, setWithdrawThreshold] = useState(storedSettings.withdrawThreshold ?? '');
  const [payoutMethods, setPayoutMethods] = useState([]);
  const [revealedPayoutMethods, setRevealedPayoutMethods] = useState({});
  const [payoutProvider, setPayoutProvider] = useState('mpesa');
  const [payoutAccountNumber, setPayoutAccountNumber] = useState('');
  const [payoutAccountName, setPayoutAccountName] = useState('');
  const [payoutBankCode, setPayoutBankCode] = useState('');
  const [payoutBanks, setPayoutBanks] = useState([]);
  const [isLoadingPayoutBanks, setIsLoadingPayoutBanks] = useState(false);
  const [isAddingPayoutMethod, setIsAddingPayoutMethod] = useState(false);

  React.useEffect(() => {
    if (!isPageFocused) setRevealedPayoutMethods({});
  }, [isPageFocused]);

  // --- Privacy & Geo State ---
  const [watermarkEnabled, setWatermarkEnabled] = useState(storedSettings.watermarkEnabled ?? true);
  const [watermarkText, setWatermarkText] = useState(storedSettings.watermarkText ?? '@creator_official');
  const [geoBlockEnabled, setGeoBlockEnabled] = useState(storedSettings.geoBlockEnabled ?? false);
  const [blockedRegions, setBlockedRegions] = useState(storedSettings.blockedRegions ?? []);
  const [dmControl, setDmControl] = useState(storedSettings.dmControl ?? 'subscribers'); // 'all', 'subscribers', 'none'

  // --- Security State ---
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(storedSettings.twoFactorEnabled ?? false);
  const [twoFactorChannel, setTwoFactorChannel] = useState('email');
  const [twoFactorAvailability, setTwoFactorAvailability] = useState({ sms_available: false });
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [isChangingTwoFactor, setIsChangingTwoFactor] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [isRevokingSessions, setIsRevokingSessions] = useState(false);

  // --- Notifications State ---
  const [notifEmail, setNotifEmail] = useState(storedSettings.notifEmail ?? { subs: true, tips: true, sales: true, likes: false, messages: false, marketing: false });
  const [notifPush, setNotifPush] = useState(storedSettings.notifPush ?? { subs: true, tips: true, messages: true, mentions: true });

  React.useEffect(() => {
    let active = true;
    const loadSettings = async () => {
      setIsLoadingSettings(true);
      try {
        const [settingsResponse, profileResponse, securityResponse] = await Promise.all([
          afterDarkService.getMySettings(),
          hasCreatorProfile ? afterDarkService.getMyPerformerProfile() : Promise.resolve(null),
          settingsService.getTwoFactorSettings(),
        ]);
        if (!active) return;
        const settings = settingsResponse?.settings || settingsResponse || {};
        const profile = profileResponse?.profile || profileResponse || {};
        setAvatarPreview(settings.avatar_url || settings.avatar || currentUser.avatar || '');
        setShowExplicitContent(Boolean(settings.show_explicit_content ?? settings.showExplicitContent));
        setDiscoverable(settings.discoverable ?? true);
        setTwoFactorEnabled(Boolean(securityResponse.enabled));
        setTwoFactorChannel(securityResponse.channel || 'email');
        setTwoFactorAvailability(securityResponse);
        setNotifEmail(settings.notification_email || settings.notifEmail || { subs: true, tips: true, sales: true, likes: false, messages: false, marketing: false });
        setNotifPush(settings.notification_push || settings.notifPush || { subs: true, tips: true, messages: true, mentions: true });
        if (hasCreatorProfile) {
          setDisplayName(profile.display_name || profile.displayName || currentUser.name || '');
          setUsername(profile.username || profile.alias || '');
          setBio(profile.bio || '');
          setLocation(profile.location || '');
          setWebsite(profile.website || '');
          setAvatarPreview(profile.avatar_url || profile.avatar || settings.avatar_url || currentUser.avatar || '');
          setCoverPreview(profile.cover_url || profile.cover || '');
          setDefaultPpv(String(settings.default_ppv ?? settings.defaultPpv ?? ''));
          setAutoWithdraw(Boolean(settings.auto_withdraw ?? settings.autoWithdraw));
          setWithdrawThreshold(String(settings.withdraw_threshold ?? settings.withdrawThreshold ?? ''));
          setWatermarkEnabled(Boolean(settings.watermark_enabled ?? settings.watermarkEnabled));
          setWatermarkText(settings.watermark_text || settings.watermarkText || '');
          setGeoBlockEnabled(Boolean(settings.geo_block_enabled ?? settings.geoBlockEnabled));
          setBlockedRegions(settings.blocked_regions || settings.blockedRegions || []);
          const savedDmControl = profile.dm_control || profile.dmControl || settings.dm_control || settings.dmControl;
          setDmControl(savedDmControl === 'everyone' ? 'all' : savedDmControl || 'subscribers');
          setPaused(Boolean(profile.paused || settings.paused));
        }
      } catch (error) {
        if (active) toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load After Dark settings.'));
      } finally {
        if (active) setIsLoadingSettings(false);
      }
    };
    loadSettings();
    return () => { active = false; };
  }, [hasCreatorProfile, currentUser.avatar, currentUser.name]);

  React.useEffect(() => {
    let active = true;
    settingsService.getBlockedUsers()
      .then(result => {
        if (!active) return;
        const users = Array.isArray(result) ? result : result?.blocked_users || result?.items || [];
        if (!Array.isArray(users)) throw new Error('The blocked-users service returned an invalid response.');
        setBlockedUsers(users);
      })
      .catch(error => {
        if (active) toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load blocked users.'));
      });
    return () => { active = false; };
  }, []);

  React.useEffect(() => {
    if (!hasCreatorProfile) return undefined;
    let active = true;
    afterDarkService.getPayoutMethods()
      .then(response => {
        const methods = Array.isArray(response) ? response : response?.methods || response?.items || [];
        if (!Array.isArray(methods)) throw new Error('The payout service returned invalid payout methods.');
        if (active) setPayoutMethods(methods);
      })
      .catch(error => {
        if (active) toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not load payout methods.'));
      });
    return () => { active = false; };
  }, [hasCreatorProfile]);

  React.useEffect(() => {
    if (!payoutProvider.startsWith('paystack_')) {
      setPayoutBanks([]);
      setPayoutBankCode('');
      return undefined;
    }
    let active = true;
    const type = payoutProvider === 'paystack_bank' ? 'bank' : 'mobile_money';
    setIsLoadingPayoutBanks(true);
    afterDarkService.getPaystackPayoutBanks(type)
      .then(response => {
        const banks = Array.isArray(response) ? response : response?.banks || response?.items || [];
        if (!Array.isArray(banks)) throw new Error('The Paystack destination service returned an invalid response.');
        if (active) {
          setPayoutBanks(banks);
          setPayoutBankCode(current => banks.some(bank => bank.code === current) ? current : '');
        }
      })
      .catch(error => {
        if (active) {
          setPayoutBanks([]);
          toast.error(error?.response?.data?.error || (typeof error?.response?.data === 'string' ? error.response.data.trim() : '') || (error instanceof Error ? error.message : 'Could not load Paystack payout destinations.'));
        }
      })
      .finally(() => {
        if (active) setIsLoadingPayoutBanks(false);
      });
    return () => { active = false; };
  }, [payoutProvider]);

  const addPayoutMethod = async event => {
    event.preventDefault();
    const accountNumber = payoutAccountNumber.trim();
    const accountName = payoutAccountName.trim();
    if (!accountNumber || !accountName) {
      toast.error('Enter both the payout account number and account name.');
      return;
    }

    setIsAddingPayoutMethod(true);
    try {
      await afterDarkService.addPayoutMethod({
        provider: payoutProvider,
        account_number: accountNumber,
        account_name: accountName,
        bank_code: payoutBankCode,
      });
      setPayoutAccountNumber('');
      setPayoutAccountName('');
      setPayoutBankCode('');
      toast.success('Payout method added.');
      try {
        const response = await afterDarkService.getPayoutMethods();
        const methods = Array.isArray(response) ? response : response?.methods || response?.items || [];
        if (!Array.isArray(methods)) throw new Error('The payout service returned invalid payout methods.');
        setPayoutMethods(methods);
      } catch (error) {
        toast.error(error?.response?.data?.error || (error instanceof Error ? `Payout method added, but could not refresh the list: ${error.message}` : 'Payout method added, but could not refresh the list.'));
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || (typeof error?.response?.data === 'string' ? error.response.data.trim() : '') || (error instanceof Error ? error.message : 'Could not add payout method.'));
    } finally {
      setIsAddingPayoutMethod(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      let avatarUrl = avatarPreview;
      let coverUrl = coverPreview;
      if (avatarFile) {
        const uploaded = hasCreatorProfile
          ? await afterDarkService.uploadCreatorImage('avatar', avatarFile)
          : await settingsService.uploadMedia(avatarFile);
        avatarUrl = uploaded?.url || uploaded?.avatar_url || uploaded?.asset_url || avatarUrl;
      }
      if (coverFile && hasCreatorProfile) {
        const uploaded = await afterDarkService.uploadCreatorImage('cover', coverFile);
        coverUrl = uploaded?.url || uploaded?.cover_url || uploaded?.asset_url || coverUrl;
      }
      await afterDarkService.updateSettings({
        avatar_url: avatarUrl,
        show_explicit_content: showExplicitContent,
        discoverable,
        notification_email: notifEmail,
        notification_push: notifPush,
        default_ppv: Number(defaultPpv) || 0,
        auto_withdraw: autoWithdraw,
        withdraw_threshold: Number(withdrawThreshold) || 0,
        watermark_enabled: watermarkEnabled,
        watermark_text: watermarkText,
        geo_block_enabled: geoBlockEnabled,
        blocked_regions: blockedRegions,
        dm_control: dmControl,
        ...(hasCreatorProfile ? { paused } : {}),
      });
      if (hasCreatorProfile) {
        await afterDarkService.updateMyPerformerProfile({
          display_name: displayName,
          username,
          bio,
          location,
          website,
          dm_control: dmControl,
          avatar_url: avatarUrl,
          cover_url: coverUrl,
        });
        setCoverPreview(coverUrl);
      }
      setAvatarPreview(avatarUrl);
      setAvatarFile(null);
      setCoverFile(null);
      if (avatarUrl) updateUser({ avatar: avatarUrl });
      if (hasCreatorProfile) updateUser({ name: displayName });
      toast.success(t('adSettingsSaved'));
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('adSettingsSaveFailed')));
    } finally {
      setIsSaving(false);
    }
  };

  const selectImage = (event, setPreview, setFile) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) {
      toast.error('Choose an image file smaller than 5MB.');
      event.target.value = '';
      return;
    }
    setFile(file);
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.onerror = () => toast.error('This image could not be previewed.');
    reader.readAsDataURL(file);
  };

  const exportArchive = async () => {
    try {
      const result = await afterDarkService.requestDataExport();
      const downloadUrl = result?.download_url || result?.url;
      if (downloadUrl) window.location.assign(downloadUrl);
      else toast.success('Your data archive request was submitted.');
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not request your data archive.'));
    }
  };

  const revokeSessions = async () => {
    if (!window.confirm('Sign out all other devices?')) return;
    setIsRevokingSessions(true);
    try {
      const result = await settingsService.terminateOtherSessions();
      if (result.token && currentUser) updateSession(currentUser, result.token);
      toast.success('Other sessions have been signed out.');
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not terminate other sessions.'));
    } finally {
      setIsRevokingSessions(false);
    }
  };

  const requestTwoFactorChange = async enabled => {
    setIsChangingTwoFactor(true);
    try {
      const challenge = await settingsService.requestTwoFactorChange(enabled, twoFactorChannel);
      setTwoFactorChallenge(challenge);
      setTwoFactorCode('');
      toast.success(`Verification code sent by ${challenge.channel}.`);
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not send a security code.'));
    } finally {
      setIsChangingTwoFactor(false);
    }
  };

  const verifyTwoFactorChange = async event => {
    event.preventDefault();
    if (!twoFactorChallenge) return;
    setIsChangingTwoFactor(true);
    try {
      const result = await settingsService.verifyTwoFactorChange(
        twoFactorChallenge.challenge_id,
        twoFactorCode,
        twoFactorChallenge.enabled,
      );
      setTwoFactorEnabled(result.enabled);
      setTwoFactorChannel(result.channel);
      setTwoFactorChallenge(null);
      setTwoFactorCode('');
      toast.success(result.enabled ? 'Two-factor sign-in is enabled.' : 'Two-factor sign-in is disabled.');
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'The code is invalid or expired.'));
    } finally {
      setIsChangingTwoFactor(false);
    }
  };

  const unblockUser = async (id) => {
    try {
      await settingsService.unblockUser(id);
      setBlockedUsers(prev => prev.filter(user => user.id !== id));
      toast.success('User unblocked.');
    } catch (error) {
      toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not unblock this user.'));
    }
  };

  // ==========================================
  // TAB RENDERING BLOCKS
  // ==========================================
  const renderProfileSettings = () => (
    <div className="space-y-8 max-w-4xl animate-in fade-in duration-300">
      
      {/* Media Uploads */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">{t('adAvatar')}</label>
          <button type="button" aria-label={t('adChange')} onClick={() => avatarInputRef.current?.click()} className="relative flex aspect-square w-full flex-col items-center justify-center overflow-hidden border-2 border-dashed border-zinc-700 bg-black transition-colors hover:border-white hover:bg-zinc-900 group">
            <img src={avatarPreview || currentUser.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=400&q=80'} alt="avatar preview" className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-20 transition-opacity grayscale" />
            <div className="relative z-10 flex flex-col items-center">
              <Camera className="w-8 h-8 text-zinc-400 group-hover:text-white mb-2" />
              <span className="text-[9px] font-black uppercase text-zinc-400 group-hover:text-white">{t('adChange')}</span>
            </div>
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={event => selectImage(event, setAvatarPreview, setAvatarFile)} />
        </div>

        <div className="flex min-w-0 flex-col space-y-4 lg:col-span-2">
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">{t('adCover')}</label>
          <button type="button" aria-label={t('adUploadNewCover')} onClick={() => coverInputRef.current?.click()} className="relative flex min-h-40 w-full flex-1 flex-col items-center justify-center overflow-hidden border-2 border-dashed border-zinc-700 bg-black transition-colors hover:border-white hover:bg-zinc-900 group sm:min-h-52">
            <img src={coverPreview || 'https://images.unsplash.com/photo-1616423640778-28d1b53229bd?w=800&q=80'} alt="cover preview" className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-20 transition-opacity grayscale" />
            <div className="relative z-10 flex flex-col items-center">
              <UploadCloud className="w-8 h-8 text-zinc-400 group-hover:text-white mb-2" />
              <span className="text-[9px] font-black uppercase text-zinc-400 group-hover:text-white">{t('adUploadNewCover')}</span>
            </div>
          </button>
          <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={event => selectImage(event, setCoverPreview, setCoverFile)} />
        </div>
      </div>

      {/* Text Info */}
      <div className="space-y-6 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">{t('adDisplayName')}</label>
            <input 
              type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
              className="w-full bg-black border-2 border-zinc-800 text-white p-4 text-xs font-bold outline-none focus:border-white uppercase transition-colors"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">{t('adUsername')}</label>
            <input 
              type="text" value={username} onChange={e => setUsername(e.target.value)}
              className="w-full bg-black border-2 border-zinc-800 text-zinc-400 p-4 text-xs font-bold outline-none focus:border-white lowercase transition-colors"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">{t('adBiography')}</label>
          <textarea 
            value={bio} onChange={e => setBio(e.target.value)}
            className="w-full bg-black border-2 border-zinc-800 text-white p-4 text-xs font-bold outline-none focus:border-white uppercase transition-colors resize-none h-32 custom-scrollbar"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2 flex items-center gap-2"><MapPin className="w-3 h-3"/> {t('adLocation')}</label>
            <input 
              type="text" value={location} onChange={e => setLocation(e.target.value)}
              className="w-full bg-black border-2 border-zinc-800 text-white p-4 text-xs font-bold outline-none focus:border-white uppercase transition-colors"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2 flex items-center gap-2"><LinkIcon className="w-3 h-3"/> {t('adExternalLink')}</label>
            <input 
              type="url" value={website} onChange={e => setWebsite(e.target.value)}
              className="w-full bg-black border-2 border-zinc-800 text-white p-4 text-xs font-bold outline-none focus:border-white transition-colors"
            />
          </div>
        </div>
        {showPasswordDialog && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <button type="button" aria-label="Close password dialog" className="absolute inset-0 bg-black/90" onClick={() => setShowPasswordDialog(false)} />
            <form onSubmit={async event => {
              event.preventDefault();
              if (!currentPassword || newPassword.length < 8) {
                toast.error(t('adPasswordPrompt'));
                return;
              }
              try {
                const result = await afterDarkService.updatePassword({ current_password: currentPassword, new_password: newPassword });
                if (result.token) updateSession(currentUser, result.token);
                setPasswordChanged(true);
                setCurrentPassword('');
                setNewPassword('');
                setShowPasswordDialog(false);
                toast.success(t('adPasswordUpdated'));
              } catch (error) {
                toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : t('adPasswordFailed')));
              }
            }} className="relative w-full max-w-md space-y-4 border-2 border-zinc-700 bg-black p-4 sm:p-6">
              <h2 className="text-sm font-black text-white uppercase">{t('adChangePassword')}</h2>
              <input autoComplete="current-password" type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required placeholder={t('adCurrentPassword')} className="w-full bg-black border-2 border-zinc-800 text-white p-3 text-xs" />
              <input autoComplete="new-password" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={8} required placeholder={t('adNewPasswordHint')} className="w-full bg-black border-2 border-zinc-800 text-white p-3 text-xs" />
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowPasswordDialog(false)} className="flex-1 border-2 border-zinc-800 py-3 text-sm font-bold uppercase text-zinc-400 hover:border-white">{t('adCancel')}</button>
                <button type="submit" className="flex-1 border-2 border-white bg-white py-3 text-sm font-bold uppercase text-black hover:bg-zinc-200">{t('adUpdatePassword')}</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );

  const renderMemberSettings = () => (
    <div className="max-w-4xl space-y-8 animate-in fade-in duration-300">
      <section className="space-y-5 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <div>
          <h2 className="text-xs font-black uppercase tracking-widest text-white">{t('adAccountTitle')}</h2>
          <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500">{t('adAccountDescription')}</p>
        </div>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <button type="button" aria-label={t('adChange')} onClick={() => avatarInputRef.current?.click()} className="relative h-24 w-24 shrink-0 overflow-hidden border-2 border-dashed border-zinc-800 hover:border-white">
            <img src={avatarPreview || currentUser.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=200&q=80'} alt="Profile preview" className="h-full w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[9px] font-black uppercase text-white"><Camera className="mr-1 h-4 w-4" /> {t('adChange')}</span>
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={event => selectImage(event, setAvatarPreview, setAvatarFile)} />
          <div className="grid flex-1 gap-4 sm:grid-cols-2">
            <div className="border border-zinc-800 bg-black p-3">
              <span className="block text-[9px] font-black uppercase text-zinc-500">{t('displayName')}</span>
              <span className="mt-1 block text-sm font-bold text-white">{currentUser.name || currentUser.username || 'Chattie member'}</span>
            </div>
            <div className="border border-zinc-800 bg-black p-3">
              <span className="block text-[9px] font-black uppercase text-zinc-500">{t('emailAddress')}</span>
              <span className="mt-1 block truncate text-sm font-bold text-white">{currentUser.email || 'Managed in Chattie account settings'}</span>
            </div>
          </div>
        </div>
        <p className="text-[9px] leading-relaxed text-zinc-600">{t('adAccountPhotoDescription')}</p>
      </section>
      <section className="space-y-4 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <h2 className="text-xs font-black uppercase tracking-widest text-white">{t('adViewingPreferences')}</h2>
        <CustomToggle
          label={t('adExplicitPreference')}
          description={t('adExplicitDescription')}
          checked={showExplicitContent}
          onChange={setShowExplicitContent}
        />
        <div className="border-2 border-zinc-800 bg-black p-4 text-[9px] font-bold leading-relaxed text-zinc-400">
          {t('adAdultWarning')}
        </div>
      </section>
    </div>
  );

  const renderMonetizationSettings = () => (
    <div className="space-y-8 max-w-4xl animate-in fade-in duration-300">
      
      <div className="space-y-6 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <h3 className="text-xs font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-4 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-white" /> {t('adDefaultPricing')}
        </h3>
        
        <div>
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">{t('adDefaultPpv')}</label>
          <div className="relative max-w-xs">
            <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-zinc-500 font-bold">KES</span>
            <input 
              type="number" value={defaultPpv} onChange={e => setDefaultPpv(e.target.value)}
              className="w-full bg-black border-2 border-zinc-800 text-white p-4 pl-14 text-sm font-black outline-none focus:border-white transition-colors"
            />
          </div>
          <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-2">{t('adPpvDescription')}</p>
        </div>
      </div>

    </div>
  );

  const renderPayoutSettings = () => (
    <div className="space-y-8 max-w-4xl animate-in fade-in duration-300">
      <div className="space-y-6 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <h3 className="flex items-center gap-2 border-b-2 border-zinc-800 pb-4 text-xs font-black uppercase tracking-widest text-white">
          <RefreshCcw className="h-4 w-4" /> {t('adMpesaAutomation')}
        </h3>
        <CustomToggle
          label={t('adAutoWithdraw')}
          description={t('adAutoWithdrawDescription')}
          checked={autoWithdraw}
          onChange={setAutoWithdraw}
        />
        <div className={`transition-all duration-300 ${autoWithdraw ? 'opacity-100 h-auto' : 'opacity-50 pointer-events-none'}`}>
          <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('adMinimumThreshold')}</label>
          <div className="relative max-w-xs">
            <span className="absolute inset-y-0 left-0 flex items-center pl-4 font-bold text-zinc-500">KES</span>
            <input
              type="number"
              value={withdrawThreshold}
              onChange={event => setWithdrawThreshold(event.target.value)}
              disabled={!autoWithdraw}
              className="w-full border-2 border-zinc-800 bg-black p-4 pl-14 text-sm font-black text-white outline-none transition-colors focus:border-white disabled:bg-zinc-900"
            />
          </div>
        </div>
      </div>

      <section className="space-y-6 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <div>
          <h3 className="text-xs font-black uppercase tracking-widest text-white">Payout methods</h3>
          <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500">Manage the destinations used for creator withdrawals.</p>
        </div>
        {payoutMethods.length > 0 ? (
          <div className="space-y-2">
            {payoutMethods.map((method, index) => {
              const methodId = String(method.id || method.payout_method_id || `${method.provider || 'payout'}-${index}`);
              const accountNumber = String(method.account_number || method.phone_number || '');
              const isRevealed = isPageFocused && Boolean(revealedPayoutMethods[methodId]);
              const maskedNumber = accountNumber ? `**** ${accountNumber.slice(-4)}` : 'Number unavailable';
              return (
                <div key={methodId} className="flex min-w-0 flex-col gap-2 border-2 border-zinc-800 bg-zinc-950 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white">{method.provider || method.type || 'Payout'}</span>
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 break-all text-[10px] font-bold text-zinc-400" aria-live="polite">
                      {isRevealed ? `${method.account_name || 'Account'} · ${accountNumber || 'Number unavailable'}` : `Account holder · ${maskedNumber}`}
                    </span>
                    <button
                      type="button"
                      disabled={!isPageFocused}
                      onClick={() => setRevealedPayoutMethods(current => ({ ...current, [methodId]: !current[methodId] }))}
                      aria-label={isRevealed ? 'Hide payout details' : 'Reveal payout details'}
                      className="flex h-8 w-8 shrink-0 items-center justify-center border border-zinc-700 text-zinc-400 hover:border-white hover:text-white disabled:opacity-40"
                    >
                      {isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="border-2 border-dashed border-zinc-800 p-4 text-[9px] font-bold uppercase tracking-widest text-zinc-500">No payout methods added yet.</p>
        )}
        <form onSubmit={addPayoutMethod} className="grid grid-cols-1 gap-4 border-t-2 border-zinc-800 pt-5 sm:grid-cols-2">
          <div>
            <label htmlFor="payout-provider" className="mb-2 block text-[10px] font-black uppercase tracking-widest text-zinc-500">Provider</label>
            <select
              id="payout-provider"
              value={payoutProvider}
              onChange={event => setPayoutProvider(event.target.value)}
              className="w-full border-2 border-zinc-800 bg-black p-3 text-xs font-bold uppercase text-white outline-none focus:border-white"
            >
              <option value="mpesa">M-Pesa</option>
              <option value="paystack_bank">Paystack bank</option>
              <option value="paystack_mobile_money">Paystack mobile money</option>
            </select>
          </div>
          <div>
            <label htmlFor="payout-account-name" className="mb-2 block text-[10px] font-black uppercase tracking-widest text-zinc-500">Account name</label>
            <input
              id="payout-account-name"
              value={payoutAccountName}
              onChange={event => setPayoutAccountName(event.target.value)}
              autoComplete="name"
              required
              className="w-full border-2 border-zinc-800 bg-black p-3 text-xs font-bold text-white outline-none focus:border-white"
            />
          </div>
          {payoutProvider.startsWith('paystack_') && (
            <div className="sm:col-span-2">
              <label htmlFor="payout-bank" className="mb-2 block text-[10px] font-black uppercase tracking-widest text-zinc-500">
                {payoutProvider === 'paystack_bank' ? 'Bank' : 'Mobile money provider'}
              </label>
              <select
                id="payout-bank"
                value={payoutBankCode}
                onChange={event => setPayoutBankCode(event.target.value)}
                required
                disabled={isLoadingPayoutBanks}
                className="w-full border-2 border-zinc-800 bg-black p-3 text-xs font-bold uppercase text-white outline-none focus:border-white disabled:opacity-50"
              >
                <option value="">{isLoadingPayoutBanks ? 'Loading destinations…' : 'Select destination'}</option>
                {payoutBanks.map(bank => <option key={bank.code} value={bank.code}>{bank.name}</option>)}
              </select>
            </div>
          )}
          <div className="sm:col-span-2">
            <label htmlFor="payout-account-number" className="mb-2 block text-[10px] font-black uppercase tracking-widest text-zinc-500">Account number</label>
            <input
              id="payout-account-number"
              type="text"
              inputMode={payoutProvider === 'paystack_bank' ? 'numeric' : 'tel'}
              value={payoutAccountNumber}
              onChange={event => setPayoutAccountNumber(event.target.value)}
              autoComplete="off"
              required
              className="w-full border-2 border-zinc-800 bg-black p-3 text-xs font-bold text-white outline-none focus:border-white"
            />
            <p className="mt-2 text-[9px] font-bold uppercase tracking-widest text-zinc-600">
              {payoutProvider === 'paystack_bank' ? 'Enter the account number for the selected bank.' : 'Enter the Kenyan mobile number that receives the payout.'}
            </p>
          </div>
          <button
            type="submit"
            disabled={isAddingPayoutMethod}
            className="flex w-full items-center justify-center gap-2 border-2 border-white bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2 sm:w-auto"
          >
            {isAddingPayoutMethod && <RefreshCcw className="h-4 w-4 animate-spin" />}
            {isAddingPayoutMethod ? 'Adding payout method…' : 'Add payout method'}
          </button>
        </form>
      </section>
    </div>
  );

  const renderPrivacySettings = () => (
    hasCreatorProfile ? (
    <div className="space-y-8 max-w-4xl animate-in fade-in duration-300">
      
      <div className="space-y-6 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <h3 className="text-xs font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-white" /> {t('adContentProtection')}
        </h3>
        
        <CustomToggle 
          label={t('adAntiPiracy')}
          description={t('adWatermarkDescription')}
          checked={watermarkEnabled} 
          onChange={setWatermarkEnabled} 
        />

        <div className={`transition-all duration-300 ${watermarkEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">{t('adCustomWatermark')}</label>
          <input 
            type="text" value={watermarkText} onChange={e => setWatermarkText(e.target.value)}
            disabled={!watermarkEnabled}
            className="w-full max-w-sm bg-black border-2 border-zinc-800 text-white p-4 text-xs font-bold outline-none focus:border-white uppercase transition-colors disabled:bg-zinc-900"
          />
        </div>
      </div>

      <div className="space-y-6 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <h3 className="text-xs font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-4 flex items-center gap-2">
          <Globe className="w-4 h-4 text-white" /> {t('adGeoBlocking')}
        </h3>
        
        <CustomToggle 
          label={t('adEnableGeo')}
          description={t('adGeoDescription')}
          checked={geoBlockEnabled} 
          onChange={setGeoBlockEnabled} 
        />

        {geoBlockEnabled && (
          <div className="p-4 bg-black border-2 border-dashed border-zinc-700 flex flex-col items-center justify-center text-center">
            <EyeOff className="w-8 h-8 text-zinc-600 mb-2" />
            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-4">{t('adRestrictedRegions')}</span>
            <button onClick={() => {
              const region = window.prompt(t('adRegionPrompt'));
              if (region?.trim()) setBlockedRegions(current => [...new Set([...current, region.trim()])]);
            }} className="px-6 py-2 bg-zinc-900 text-white font-black uppercase text-[9px] tracking-widest border-2 border-zinc-700 hover:border-white transition-colors">
                + {t('adAddCountryCity')}
              </button>
              {blockedRegions.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {blockedRegions.map(region => (
                    <button key={region} onClick={() => setBlockedRegions(current => current.filter(item => item !== region))} className="px-3 py-1 bg-zinc-900 border border-zinc-700 text-[9px] font-bold text-white uppercase">
                      {region} <X className="ml-1 inline h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}
          </div>
        )}
      </div>

      <div className="space-y-6 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <h3 className="text-xs font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-4 flex items-center gap-2">
          <Mail className="w-4 h-4 text-white" /> {t('adDirectMessages')}
        </h3>
        
        <div>
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-4">{t('adWhoCanMessage')}</label>
          <div className="flex flex-col gap-3">
            {[
              { id: 'all', label: t('adEveryone') },
              { id: 'subscribers', label: t('adSubscribersOnly') },
              { id: 'none', label: t('adNoOne') },
            ].map(opt => (
              <label key={opt.id} className={`flex items-center gap-4 p-4 border-2 cursor-pointer transition-colors ${dmControl === opt.id ? 'border-white bg-zinc-950' : 'border-zinc-800 bg-black hover:border-zinc-600'}`}>
                <div className={`flex h-4 w-4 items-center justify-center border-2 ${dmControl === opt.id ? 'border-white' : 'border-zinc-600'}`}>
                  {dmControl === opt.id && <div className="h-2 w-2 bg-white" />}
                </div>
                <span className={`text-[10px] font-black uppercase tracking-widest ${dmControl === opt.id ? 'text-white' : 'text-zinc-400'}`}>{opt.label}</span>
                <input type="radio" name="dmControl" className="hidden" checked={dmControl === opt.id} onChange={() => setDmControl(opt.id)} />
              </label>
            ))}
          </div>
        </div>
      </div>
      <PagePrivacyShield active={!isPageFocused} message="Payout details are hidden while this window is inactive." />
    </div>
    ) : (
      <div className="max-w-4xl space-y-8 animate-in fade-in duration-300">
        <section className="space-y-4 border-2 border-zinc-800 bg-black p-4 sm:p-6">
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest text-white">{t('adViewerPrivacy')}</h2>
            <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500">{t('adViewerPrivacyDescription')}</p>
          </div>
          <CustomToggle
            label={t('adShowMemberLists')}
            description={t('adShowMemberListsDescription')}
            checked={discoverable}
            onChange={setDiscoverable}
          />
          <div className="border-2 border-zinc-800 bg-black p-4">
            <h3 className="mb-1 text-[10px] font-black uppercase tracking-widest text-white">{t('adPaidPrivateChats')}</h3>
            <p className="text-[9px] leading-relaxed text-zinc-500">{t('adPaidPrivateDescription')}</p>
          </div>
        </section>
        <section className="border-2 border-zinc-800 bg-black p-4 sm:p-6">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white"><EyeOff className="h-4 w-4 text-zinc-400" /> {t('adExplicitMedia')}</h2>
          <p className="text-[9px] leading-relaxed text-zinc-500">{t('adExplicitMediaDescription')}</p>
        </section>
      </div>
    )
  );

  const renderSecuritySettings = () => (
    <div className="space-y-8 max-w-4xl animate-in fade-in duration-300">
      
      <div className="space-y-6 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <h3 className="text-xs font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-4 flex items-center gap-2">
          <Key className="w-4 h-4 text-white" /> {t('adAccountSecurity')}
        </h3>
        
        <CustomToggle
          label={t('adTwoFactor')}
          description={t('adTwoFactorDescription')}
          checked={twoFactorEnabled}
          disabled={isChangingTwoFactor || Boolean(twoFactorChallenge)}
          onChange={requestTwoFactorChange}
        />
        {!twoFactorEnabled && !twoFactorChallenge && (
          <div className="flex flex-wrap gap-2">
            {['email', ...(twoFactorAvailability.sms_available ? ['sms'] : [])].map(channel => (
              <button
                key={channel}
                type="button"
                onClick={() => setTwoFactorChannel(channel)}
                className={`border px-3 py-2 text-[9px] font-bold uppercase tracking-widest ${twoFactorChannel === channel ? 'border-white text-white' : 'border-zinc-800 text-zinc-500'}`}
              >
                {channel}
              </button>
            ))}
            {twoFactorChannel === 'sms' && !twoFactorAvailability.sms_available && (
              <span className="text-[9px] font-bold uppercase text-amber-500">Add a phone number first.</span>
            )}
          </div>
        )}
        {twoFactorChallenge && (
          <form onSubmit={verifyTwoFactorChange} className="space-y-3 border-2 border-zinc-800 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              Code sent by {twoFactorChallenge.channel}{twoFactorChallenge.destination ? ` to ${twoFactorChallenge.destination}` : ''}.
            </p>
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              value={twoFactorCode}
              onChange={event => setTwoFactorCode(event.target.value)}
              maxLength={8}
              required
              aria-label="Two-factor verification code"
              className="w-full border-2 border-zinc-800 bg-black px-3 py-2 text-sm font-bold tracking-[0.4em] text-white outline-none focus:border-white"
            />
            <div className="flex gap-2">
              <button type="submit" disabled={isChangingTwoFactor || twoFactorCode.length < 6} className="border-2 border-white bg-white px-4 py-2 text-[9px] font-bold uppercase tracking-widest text-black disabled:opacity-50">
                {isChangingTwoFactor ? 'Verifying...' : 'Confirm'}
              </button>
              <button type="button" onClick={() => setTwoFactorChallenge(null)} className="border-2 border-zinc-800 px-4 py-2 text-[9px] font-bold uppercase tracking-widest text-zinc-400">
                Cancel
              </button>
            </div>
          </form>
        )}
        
        <button onClick={() => setShowPasswordDialog(true)} className="w-full border-2 border-zinc-800 bg-black px-4 py-3 text-sm font-bold uppercase tracking-widest text-white transition-colors hover:border-white sm:w-auto">
          {t('adChangePassword')}
        </button>
        {passwordChanged && <p className="text-[9px] font-bold text-zinc-400 uppercase">{t('adPasswordUpdated')}</p>}
      </div>

      <div className="space-y-6 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <h3 className="text-xs font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-4 flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-white" /> {t('adActiveSessions')}
        </h3>
        
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('adActiveSessionsDescription')}</p>
        <button type="button" onClick={revokeSessions} disabled={isRevokingSessions} className="border-2 border-red-900 bg-black px-5 py-3 text-[9px] font-black uppercase tracking-widest text-red-500 transition-colors hover:border-red-500 hover:bg-red-950 disabled:opacity-50">
          {isRevokingSessions ? t('adSigningOut') : t('adSignOutOther')}
        </button>
      </div>

      <div className="space-y-6 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <h3 className="text-xs font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-4 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-white" /> {t('adBlockedUsers')}
        </h3>
        
        {blockedUsers.length === 0 ? (
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('adNoBlockedUsers')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {blockedUsers.map(user => (
              <div key={user.id || user.blocked_id} className="flex items-center justify-between p-4 bg-black border-2 border-zinc-800">
                <div>
                  <span className="text-[10px] font-black text-white uppercase tracking-widest">@{user.name || user.username || user.blocked_user?.username}</span>
                  <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest block mt-1">{t('adBlockedOn', { date: user.date || user.created_at || t('adDateUnavailable') })}</span>
                </div>
                <button 
                  onClick={() => unblockUser(user.id || user.blocked_id)}
                  className="text-[9px] font-black text-zinc-500 uppercase tracking-widest hover:text-white transition-colors"
                >
                  {t('adUnblock')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderNotificationSettings = () => (
    <div className="space-y-8 max-w-4xl animate-in fade-in duration-300">
      
      <div className="space-y-6 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <h3 className="text-xs font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-4 flex items-center gap-2">
          <Mail className="w-4 h-4 text-white" /> {t('adEmailNotifications')}
        </h3>
        
        <div className="space-y-3">
          {hasCreatorProfile && <CustomToggle label={t('adNewSubscribers')} description={t('adNewSubscribersDescription')} checked={notifEmail.subs} onChange={(v) => setNotifEmail({...notifEmail, subs: v})} />}
          {hasCreatorProfile && <CustomToggle label="New purchases" description="Get an email when a member purchases a post or live pass." checked={notifEmail.sales !== false} onChange={(v) => setNotifEmail({...notifEmail, sales: v})} />}
          {hasCreatorProfile && <CustomToggle label="Post likes" description="Get an email when a member likes your published post." checked={notifEmail.likes === true} onChange={(v) => setNotifEmail({...notifEmail, likes: v})} />}
          {hasCreatorProfile && <CustomToggle label={t('adTipsUnlocks')} description={t('adTipsUnlocksDescription')} checked={notifEmail.tips} onChange={(v) => setNotifEmail({...notifEmail, tips: v})} />}
          <CustomToggle label={t('adDirectMessages')} description={hasCreatorProfile ? t('adCustomerMessagesDescription') : t('adCreatorRepliesDescription')} checked={notifEmail.messages} onChange={(v) => setNotifEmail({...notifEmail, messages: v})} />
          <CustomToggle label={t('adPlatformUpdates')} description={t('adPlatformUpdatesDescription')} checked={notifEmail.marketing} onChange={(v) => setNotifEmail({...notifEmail, marketing: v})} />
        </div>
      </div>

      <div className="space-y-6 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <h3 className="text-xs font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-4 flex items-center gap-2">
          <Bell className="w-4 h-4 text-white" /> {t('adPushNotifications')}
        </h3>
        
        <div className="space-y-3">
          {hasCreatorProfile && <CustomToggle label={t('adNewSubscribers')} checked={notifPush.subs} onChange={(v) => setNotifPush({...notifPush, subs: v})} />}
          {hasCreatorProfile && <CustomToggle label={t('adTipsUnlocks')} checked={notifPush.tips} onChange={(v) => setNotifPush({...notifPush, tips: v})} />}
          <CustomToggle label={t('adDirectMessages')} checked={notifPush.messages} onChange={(v) => setNotifPush({...notifPush, messages: v})} />
          {hasCreatorProfile && <CustomToggle label={t('adFeedMentions')} checked={notifPush.mentions} onChange={(v) => setNotifPush({...notifPush, mentions: v})} />}
        </div>
      </div>
    </div>
  );

  const renderDangerZone = () => (
    <div className="space-y-8 max-w-4xl animate-in fade-in duration-300">
      
      <div className="space-y-6 border-2 border-zinc-800 bg-black p-4 sm:p-6">
        <h3 className="text-xs font-black text-white uppercase tracking-widest border-b-2 border-zinc-800 pb-4 flex items-center gap-2">
          <DownloadCloud className="w-4 h-4 text-white" /> {t('adDataExport')}
        </h3>
        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed">
          {hasCreatorProfile
            ? t('adExportCreatorDescription')
            : t('adExportMemberDescription')}
        </p>
        <button onClick={exportArchive} className="w-full border-2 border-zinc-800 bg-black px-4 py-3 text-sm font-bold uppercase tracking-widest text-white transition-colors hover:border-white sm:w-auto flex items-center justify-center gap-2">
          <DownloadCloud className="w-4 h-4" /> {t('adRequestArchive')}
        </button>
      </div>

      {hasCreatorProfile ? (
        <div className="relative space-y-6 overflow-hidden border-2 border-red-900 bg-black p-4 sm:p-6 group">
          <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
            <AlertTriangle className="w-48 h-48 text-red-500" />
          </div>
          <h3 className="text-xs font-black text-red-500 uppercase tracking-widest border-b-2 border-red-900/30 pb-4 flex items-center gap-2 relative z-10">
            <AlertCircle className="w-4 h-4" /> {t('adDangerZone')}
          </h3>
          <div className="relative z-10 space-y-6">
            <div className="flex flex-col justify-between gap-4 border-2 border-red-900/50 bg-black p-4 sm:flex-row sm:items-center">
              <div>
                <h4 className="text-[10px] font-black text-white uppercase tracking-widest mb-1">{t('adPauseCreator')}</h4>
                <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">{t('adPauseDescription')}</p>
              </div>
              <button onClick={() => {
                const next = !paused;
                if (!window.confirm(t(next ? 'adConfirmPause' : 'adConfirmResume'))) return;
                const request = next ? afterDarkService.pauseCreator() : afterDarkService.resumeCreator();
                request.then(() => {
                  setPaused(next);
                  toast.success(`Creator account ${next ? 'paused' : 'resumed'}.`);
                }).catch(error => toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not update creator status.')));
              }} className="px-4 py-3 bg-black border-2 border-zinc-800 text-white font-black uppercase text-[9px] tracking-widest hover:border-white transition-colors shrink-0">
                {paused ? t('adResume') : t('adPause')}
              </button>
            </div>
            <div className="flex min-w-0 flex-col justify-between gap-4 border-2 border-red-900/50 bg-black p-4 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1">{t('adDeactivateCreator')}</h4>
                <p className="max-w-sm text-[9px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
                  {t('adDeactivateDescription')}
                </p>
              </div>
              <button onClick={() => {
                if (!window.confirm(t('adConfirmDeactivate'))) return;
                afterDarkService.deactivateCreator()
                  .then(() => {
                    setCreatorStatus(false);
                    updateUser({ isCreator: false });
                    toast.success('Creator account deactivated.');
                    navigate('/afterdark/feed');
                  })
                  .catch(error => toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not deactivate creator status.')));
              }} className="flex w-full shrink-0 items-center justify-center gap-2 border-2 border-red-900 bg-black px-4 py-3 text-[9px] font-black uppercase tracking-widest text-red-500 transition-colors hover:border-red-500 hover:bg-red-950 sm:w-auto">
                <Trash2 className="w-3 h-3" /> {t('adDeactivate')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="border-2 border-zinc-800 bg-black p-4 sm:p-6">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white"><ShieldCheck className="h-4 w-4 text-white" /> {t('adLeaveAfterDark')}</h3>
          <p className="mb-5 text-[10px] leading-relaxed text-zinc-500">{t('adLeaveDescription')}</p>
          <button onClick={() => navigate('/rooms')} className="border-2 border-zinc-800 bg-black px-4 py-3 text-sm font-bold uppercase tracking-widest text-white hover:border-white">{t('adBackToChattie')}</button>
        </div>
      )}
    </div>
  );

  // ==========================================
  // MAIN RENDER
  // ==========================================
  return (
    <div className="flex min-h-0 flex-1 flex-col w-full overflow-hidden rounded-none bg-black font-mono text-zinc-300">
      
      {/* HEADER */}
      <header className="z-20 shrink-0 border-b-2 border-zinc-800 bg-zinc-950">
        <div className="flex w-full flex-col items-stretch justify-between gap-4 p-4 sm:flex-row sm:items-center md:p-6">
        <div className="flex min-w-0 items-center gap-3">
            <div className="border-2 border-zinc-600 bg-black p-1.5">
              <Sliders className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold uppercase tracking-widest text-white md:text-2xl">{hasCreatorProfile ? t('adCreatorSettings') : t('adSettings')}</h1>
            </div>
          </div>
          <button 
            onClick={handleSave}
            disabled={isSaving || isLoadingSettings}
            className="flex w-full shrink-0 items-center justify-center gap-2 border-2 border-white bg-white px-4 py-2 text-sm font-bold uppercase tracking-widest text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {isSaving || isLoadingSettings ? <RefreshCcw className="h-4 w-4 animate-spin" /> : null}
            {isLoadingSettings ? t('adLoadingSettings') : t('adSaveChanges')}
          </button>
        </div>
      </header>

      {/* LAYOUT BODY */}
      <div className="custom-scrollbar flex-1 overflow-y-auto bg-black">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 pb-24 sm:p-6 md:gap-8 md:p-8 md:pb-24 lg:flex-row">
          <aside className="w-full shrink-0 lg:w-64">
            <nav aria-label={t('adSettingsSections')} className="grid grid-cols-2 overflow-hidden border-2 border-zinc-800 bg-black sm:grid-cols-3 lg:flex lg:flex-col lg:border-0 lg:bg-transparent">
              {settingsTabs.map(tab => {
                const isActive = activeTab === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => changeSettingsTab(tab.id)}
                    className={`flex min-h-12 w-full min-w-0 items-center gap-2 border-b-2 border-r-2 border-zinc-800 px-3 py-3 text-left text-xs font-bold uppercase tracking-widest transition-colors hover:bg-zinc-950 hover:text-white sm:gap-3 sm:text-sm lg:border-2 lg:px-3
                      ${isActive ? 'bg-white text-black' : 'bg-black text-zinc-500'}
                      ${tab.danger && isActive ? '!border-red-500 !bg-black !text-red-500' : ''}
                      ${tab.danger && !isActive ? 'hover:!text-red-500' : ''}
                    `}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center border-2 ${isActive && !tab.danger ? 'border-black bg-white' : 'border-zinc-800 bg-black'}`}>
                      <Icon className={`h-4 w-4 ${isActive && tab.danger ? 'text-red-500' : isActive ? 'text-black' : 'text-zinc-500'}`} />
                    </span>
                    <span className="min-w-0 truncate">{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-4xl pb-12">
              {hasCreatorProfile && activeTab === 'profile' && renderProfileSettings()}
              {!hasCreatorProfile && activeTab === 'account' && renderMemberSettings()}
              {hasCreatorProfile && activeTab === 'monetization' && renderMonetizationSettings()}
              {hasCreatorProfile && activeTab === 'payouts' && renderPayoutSettings()}
              {activeTab === 'privacy' && renderPrivacySettings()}
              {activeTab === 'security' && renderSecuritySettings()}
              {activeTab === 'notifications' && renderNotificationSettings()}
              {activeTab === 'danger' && renderDangerZone()}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}