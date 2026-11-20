import React, { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  Bell,
  ExternalLink,
  Loader2,
  Power,
  Save,
  Settings,
  Sparkles,
  UserRound,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import AIDraftAssistant from '../../components/AIDraftAssistant';
import { creatorService } from '../../api/creator.service';
import { settingsService } from '../../api/settings.service';
import { useI18n } from '../../i18n';

const DEFAULT_USER_SETTINGS = {
  name: '',
  email: '',
  phone_number: '',
  job: '',
  location: '',
  bio: '',
  intent: 'Dating',
  tags: [],
  avatar: '',
  cover: '',
  avatar_storage_url: '',
  cover_storage_url: '',
  photos: [],
  verified: false,
  two_factor_enabled: false,
  two_factor_channel: 'email',
  distance: 25,
  ageMin: 21,
  ageMax: 35,
  isGlobal: false,
  showMe: 'Everyone',
  notifs: { newMatches: true, messages: true, superLikes: true, promotions: false },
  privacy: { incognito: false, readReceipts: true },
  connected: { spotify: false, instagram: false },
  sub_status: '',
  expires_at: '',
  plan: 'NONE',
};

const PAYOUT_NETWORKS = [
  { id: 'USDT-TRC20', label: 'USDT - TRON (TRC20)' },
  { id: 'USDT-ERC20', label: 'USDT - Ethereum (ERC20)' },
];
const NO_PROFILE_INTERESTS = [];

function SettingsToggle({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'border-amber-300 bg-amber-300' : 'border-zinc-600 bg-black'
      }`}
    >
      <span className={`absolute top-1 h-3.5 w-3.5 transition-transform ${checked ? 'translate-x-5 bg-black' : 'translate-x-1 bg-zinc-500'}`} />
    </button>
  );
}

function SettingsSection({ icon: Icon, title, description, children }) {
  return (
    <section className="border border-zinc-800 bg-zinc-950">
      <header className="flex items-start gap-3 border-b border-zinc-800 p-4 sm:p-5">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest text-white">{title}</h2>
          {description && <p className="mt-1 text-xs leading-relaxed text-zinc-500">{description}</p>}
        </div>
      </header>
      <div className="space-y-4 p-4 sm:p-5">{children}</div>
    </section>
  );
}

function ProfileSettingsCard({ profile, onSave, onStatusChange, isSavingStatus }) {
  const { t } = useI18n();
  const [details, setDetails] = useState({
    name: profile.name || '',
    avatar_url: profile.avatar_url || '',
    bio: profile.bio || '',
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDetails({
      name: profile.name || '',
      avatar_url: profile.avatar_url || '',
      bio: profile.bio || '',
    });
  }, [profile.id, profile.name, profile.avatar_url, profile.bio]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      await onSave(profile.id, details);
      toast.success(t('coreUiProfileSaved', { name: profile.name }));
    } catch (error) {
      toast.error(error.response?.data?.error || t('coreUiProfileSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border border-zinc-800 bg-black p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-3">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="h-12 w-12 border border-zinc-700 object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center border border-zinc-700 bg-zinc-900 text-sm font-black text-zinc-300">
              {(profile.name || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-white">{profile.name}</h3>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-zinc-500">{t('coreUiAssignedProfile')}</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          {t('coreUiAvailability')}
          <select
            value={profile.status || 'offline'}
            disabled={isSavingStatus}
            onChange={(event) => onStatusChange(profile.id, event.target.value)}
            className="border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-white outline-none focus:border-amber-300 disabled:opacity-50"
          >
            <option value="online">{t('online')}</option>
            <option value="busy">{t('coreUiBusy')}</option>
            <option value="offline">{t('offline')}</option>
          </select>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('coreUiDisplayName')}</span>
        <input
          value={details.name}
          onChange={(event) => setDetails((current) => ({ ...current, name: event.target.value }))}
          required
          minLength={2}
          maxLength={50}
          className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('coreUiAvatarImageUrl')}</span>
        <input
          type="url"
          value={details.avatar_url}
          onChange={(event) => setDetails((current) => ({ ...current, avatar_url: event.target.value }))}
          required
          maxLength={500}
          placeholder="https://..."
          className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('coreUiProfileBio')}</span>
        <textarea
          value={details.bio}
          onChange={(event) => setDetails((current) => ({ ...current, bio: event.target.value }))}
          maxLength={500}
          rows={4}
          className="w-full resize-y border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm leading-relaxed text-white outline-none focus:border-amber-300"
        />
        <span className="block text-right text-[9px] text-zinc-600">{details.bio.length}/500</span>
      </label>

      <AIDraftAssistant
        type="profile-bio"
        draft={details.bio}
        interests={NO_PROFILE_INTERESTS}
        disabled={isSaving}
        onSelect={(bio) => setDetails((current) => ({ ...current, bio }))}
      />

      <button
        type="submit"
        disabled={isSaving}
        className="inline-flex items-center gap-2 border border-amber-300 bg-amber-300 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t('coreUiSaveProfile')}
      </button>
    </form>
  );
}

export default function ModelSettings() {
  const { t } = useI18n();
  const {
    profiles = [],
    setProfiles,
    profilesLoading = false,
    profilesLoadError = '',
    isGlobalOnline = false,
    setIsGlobalOnline,
    modelSettings = { ai_drafts_enabled: false },
    setModelSettings,
    modelSettingsLoadError = '',
  } = useOutletContext();
  const [userSettings, setUserSettings] = useState(DEFAULT_USER_SETTINGS);
  const [payoutMethods, setPayoutMethods] = useState([]);
  const [areNotificationsLoaded, setAreNotificationsLoaded] = useState(false);
  const [arePayoutMethodsLoaded, setArePayoutMethodsLoaded] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState(PAYOUT_NETWORKS[0].id);
  const [walletAddress, setWalletAddress] = useState('');
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isSavingNotifications, setIsSavingNotifications] = useState(false);
  const [isSavingPayout, setIsSavingPayout] = useState(false);
  const [isSavingAI, setIsSavingAI] = useState(false);
  const [isSavingAvailability, setIsSavingAvailability] = useState(false);
  const [savingProfileStatus, setSavingProfileStatus] = useState('');

  useEffect(() => {
    let active = true;
    const loadSettings = async () => {
      const [settingsResult, payoutResult] = await Promise.allSettled([
        settingsService.getSettings(),
        creatorService.getPayoutMethods(),
      ]);
      if (!active) return;

      if (settingsResult.status === 'fulfilled') {
        const loaded = settingsResult.value || {};
        setUserSettings({
          ...loaded,
          notifs: { ...DEFAULT_USER_SETTINGS.notifs, ...(loaded.notifs || {}) },
          privacy: { ...DEFAULT_USER_SETTINGS.privacy, ...(loaded.privacy || {}) },
          connected: { ...DEFAULT_USER_SETTINGS.connected, ...(loaded.connected || {}) },
          tags: Array.isArray(loaded.tags) ? loaded.tags : [],
        });
        setAreNotificationsLoaded(true);
      } else {
        console.error('Failed to load model notification preferences:', settingsResult.reason);
        toast.error(t('coreUiNotificationPreferencesLoadFailed'));
      }

      if (payoutResult.status === 'fulfilled') {
        setPayoutMethods(Array.isArray(payoutResult.value) ? payoutResult.value : []);
        setArePayoutMethodsLoaded(true);
      } else {
        console.error('Failed to load model payout methods:', payoutResult.reason);
        toast.error(t('coreUiPayoutMethodsLoadFailed'));
      }
      setIsLoadingSettings(false);
    };
    void loadSettings();
    return () => { active = false; };
  }, [t]);

  useEffect(() => {
    const savedMethod = payoutMethods.find((method) => method.asset_network === selectedNetwork);
    setWalletAddress(savedMethod?.wallet_address || '');
  }, [payoutMethods, selectedNetwork]);

  const saveProfile = async (profileId, details) => {
    const updated = await creatorService.updateProfileDetails(profileId, {
      name: details.name.trim(),
      avatar_url: details.avatar_url.trim(),
      bio: details.bio.trim(),
    });
    setProfiles((current) => current.map((profile) => profile.id === profileId
      ? { ...profile, ...updated }
      : profile));
  };

  const changeProfileStatus = async (profileId, status) => {
    setSavingProfileStatus(profileId);
    try {
      await creatorService.updateProfileStatus(profileId, status);
      setProfiles((current) => current.map((profile) => profile.id === profileId
        ? { ...profile, status }
        : profile));
      toast.success(t('coreUiProfileAvailabilityUpdated'));
    } catch (error) {
      console.error('Failed to update assigned profile status:', error);
      toast.error(error.response?.data?.error || t('coreUiProfileAvailabilityUpdateFailed'));
    } finally {
      setSavingProfileStatus('');
    }
  };

  const changeGlobalAvailability = async () => {
    setIsSavingAvailability(true);
    try {
      const updated = await creatorService.toggleOnlineStatus(!isGlobalOnline);
      setIsGlobalOnline(updated.is_online === true);
      setModelSettings((current) => ({ ...current, is_online: updated.is_online === true }));
      toast.success(t('coreUiGlobalAvailabilityUpdated'));
    } catch (error) {
      console.error('Failed to update global availability:', error);
      toast.error(error.response?.data?.error || t('coreUiAvailabilityUpdateFailed'));
    } finally {
      setIsSavingAvailability(false);
    }
  };

  const saveNotifications = async () => {
    setIsSavingNotifications(true);
    try {
      await settingsService.updateSettings(userSettings);
      toast.success(t('coreUiNotificationPreferencesSaved'));
    } catch (error) {
      console.error('Failed to save model notification preferences:', error);
      toast.error(error.response?.data?.error || t('coreUiNotificationPreferencesSaveFailed'));
    } finally {
      setIsSavingNotifications(false);
    }
  };

  const changeAIDrafts = async () => {
    const enabled = !modelSettings.ai_drafts_enabled;
    setIsSavingAI(true);
    try {
      const updated = await creatorService.updateModelSettings({ ai_drafts_enabled: enabled });
      setModelSettings(updated);
      toast.success(t(enabled ? 'coreUiAiDraftsEnabled' : 'coreUiAiDraftsDisabled'));
    } catch (error) {
      console.error('Failed to update model AI draft preference:', error);
      toast.error(error.response?.data?.error || t('coreUiAiDraftSettingFailed'));
    } finally {
      setIsSavingAI(false);
    }
  };

  const savePayoutMethod = async (event) => {
    event.preventDefault();
    setIsSavingPayout(true);
    try {
      const saved = await creatorService.savePayoutMethod(selectedNetwork, walletAddress.trim());
      setPayoutMethods((current) => [
        ...current.filter((method) => method.asset_network !== saved.asset_network),
        saved,
      ]);
      toast.success(t('coreUiPayoutWalletSaved'));
    } catch (error) {
      console.error('Failed to save model payout wallet:', error);
      toast.error(error.response?.data?.error || t('coreUiPayoutWalletSaveFailed'));
    } finally {
      setIsSavingPayout(false);
    }
  };

  return (
    <div className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-black p-3 text-zinc-300 custom-scrollbar sm:p-5 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-zinc-800 pb-5">
          <div>
            <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-amber-300">
              <Settings className="h-4 w-4" /> {t('coreUiModelWorkspace')}
            </p>
            <h1 className="text-2xl font-black uppercase tracking-widest text-white sm:text-3xl">{t('settings')}</h1>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-zinc-500">
              {t('coreUiModelSettingsDescription')}
            </p>
          </div>
          <Link to="/model/earnings" className="inline-flex items-center gap-2 border border-zinc-700 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300 hover:border-amber-300 hover:text-amber-200">
            {t('coreUiEarningsPayoutHistory')} <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </header>
        {modelSettingsLoadError && (
          <p role="alert" className="border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-200">
            {modelSettingsLoadError}
          </p>
        )}

        <SettingsSection
          icon={Power}
          title={t('coreUiAvailability')}
          description={t('coreUiGlobalAvailabilityDescription')}
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border border-zinc-800 bg-black p-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-white">{t('coreUiGlobalChatAvailability')}</p>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-zinc-500">
                {t('coreUiCurrentlyStatus', { status: t(isGlobalOnline ? 'online' : 'offline') })}
              </p>
            </div>
            <button
              type="button"
              onClick={changeGlobalAvailability}
              disabled={isSavingAvailability || profilesLoading}
              className={`inline-flex items-center gap-2 border px-4 py-2.5 text-[10px] font-black uppercase tracking-widest disabled:opacity-50 ${
                isGlobalOnline ? 'border-red-400 text-red-300 hover:bg-red-400/10' : 'border-green-400 text-green-300 hover:bg-green-400/10'
              }`}
            >
              {isSavingAvailability ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              {t(isGlobalOnline ? 'coreUiGoOffline' : 'coreUiGoOnline')}
            </button>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={UserRound}
          title={t('coreUiAssignedProfiles')}
          description={t('coreUiAssignedProfilesDescription')}
        >
          {profilesLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-amber-300" /></div>
          ) : profilesLoadError ? (
            <p role="alert" className="border border-red-500/40 bg-red-500/5 p-4 text-xs text-red-200">{profilesLoadError}</p>
          ) : profiles.length === 0 ? (
            <p className="border border-dashed border-zinc-800 p-5 text-xs text-zinc-500">{t('coreUiNoAssignedProfiles')}</p>
          ) : (
            <div className="space-y-4">
              {profiles.map((profile) => (
                <ProfileSettingsCard
                  key={profile.id}
                  profile={profile}
                  onSave={saveProfile}
                  onStatusChange={changeProfileStatus}
                  isSavingStatus={savingProfileStatus === profile.id}
                />
              ))}
            </div>
          )}
        </SettingsSection>

        <SettingsSection
          icon={Bell}
          title={t('notifications')}
          description={t('coreUiNotificationPreferencesDescription')}
        >
          {isLoadingSettings ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-amber-300" /></div>
          ) : !areNotificationsLoaded ? (
            <p role="alert" className="border border-red-500/40 bg-red-500/5 p-4 text-xs text-red-200">{t('coreUiNotificationPreferencesLoadNotice')}</p>
          ) : (
            <>
              {[
                ['messages', t('coreUiNewMessages')],
                ['newMatches', t('coreUiNewMatches')],
                ['superLikes', t('coreUiSuperLikes')],
                ['promotions', t('coreUiProductAnnouncements')],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4 border-b border-zinc-800 pb-3 last:border-0 last:pb-0">
                  <span className="text-xs font-bold text-zinc-200">{label}</span>
                  <SettingsToggle
                    checked={Boolean(userSettings.notifs?.[key])}
                    label={label}
                    onChange={() => setUserSettings((current) => ({
                      ...current,
                      notifs: { ...current.notifs, [key]: !current.notifs?.[key] },
                    }))}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={saveNotifications}
                disabled={isSavingNotifications || isLoadingSettings || !areNotificationsLoaded}
                className="inline-flex items-center gap-2 border border-amber-300 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-amber-200 hover:bg-amber-300/10 disabled:opacity-50"
              >
                {isSavingNotifications ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t('coreUiSaveNotificationPreferences')}
              </button>
            </>
          )}
        </SettingsSection>

        <SettingsSection
          icon={Sparkles}
          title={t('coreUiAiChatDrafts')}
          description={t('coreUiAiDraftsDescription')}
        >
          <div className="flex items-center justify-between gap-4 border border-zinc-800 bg-black p-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-white">{t('coreUiEnableAiReplyDrafts')}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                {t('coreUiAiDraftsReviewNotice')}
              </p>
            </div>
            <SettingsToggle
              checked={modelSettings.ai_drafts_enabled === true}
              label={t('coreUiEnableAiReplyDrafts')}
              disabled={isSavingAI || profilesLoading}
              onChange={changeAIDrafts}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          icon={Wallet}
          title={t('coreUiPayoutWallet')}
          description={t('coreUiPayoutWalletDescription')}
        >
          {isLoadingSettings ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-amber-300" /></div>
          ) : !arePayoutMethodsLoaded ? (
            <p role="alert" className="border border-red-500/40 bg-red-500/5 p-4 text-xs text-red-200">{t('coreUiPayoutMethodsLoadNotice')}</p>
          ) : (
            <form onSubmit={savePayoutMethod} className="grid gap-3 sm:grid-cols-[minmax(12rem,0.8fr)_minmax(15rem,1.2fr)_auto] sm:items-end">
              <label className="block space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('coreUiNetwork')}</span>
                <select
                  value={selectedNetwork}
                  onChange={(event) => setSelectedNetwork(event.target.value)}
                  disabled={isSavingPayout}
                  className="w-full border border-zinc-700 bg-black px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-amber-300"
                >
                  {PAYOUT_NETWORKS.map((network) => <option key={network.id} value={network.id}>{network.label}</option>)}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t('coreUiWalletAddress')}</span>
                <input
                  value={walletAddress}
                  onChange={(event) => setWalletAddress(event.target.value)}
                  required
                  maxLength={255}
                  autoComplete="off"
                  spellCheck="false"
                  placeholder={t(selectedNetwork === 'USDT-TRC20' ? 'coreUiTronAddressPlaceholder' : 'coreUiEthereumAddressPlaceholder')}
                  disabled={isSavingPayout}
                  className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2.5 font-mono text-xs text-white outline-none focus:border-amber-300 disabled:opacity-50"
                />
              </label>
              <button
                type="submit"
                disabled={isSavingPayout}
                className="inline-flex items-center justify-center gap-2 border border-amber-300 bg-amber-300 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-black hover:bg-amber-200 disabled:opacity-50"
              >
                {isSavingPayout ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t('coreUiSaveWallet')}
              </button>
            </form>
          )}
          <p className="text-[10px] text-zinc-600">
            {t('coreUiPayoutHistoryAvailable')} <Link to="/model/earnings" className="text-amber-300 underline">{t('earnings')}</Link>.
          </p>
        </SettingsSection>
      </div>
    </div>
  );
}
