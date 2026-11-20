import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Globe2, Loader2, Plus, RefreshCcw, Shield, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { adminService } from '../../api/admin.service';
import { authService } from '../../api/auth.service';
import { useAppDialogs } from '../../components/modals/useAppDialogs';
import { useI18n } from '../../i18n';

const getErrorMessage = (error, fallback) => error?.response?.data?.error
  || (typeof error?.response?.data === 'string' ? error.response.data.trim() : '')
  || (error instanceof Error ? error.message : fallback);

export default function AdminSettings() {
  const { confirm } = useAppDialogs();
  const { t } = useI18n();
  const [terms, setTerms] = useState([]);
  const [firewallRules, setFirewallRules] = useState([]);
  const [countries, setCountries] = useState([]);
  const [countryCode, setCountryCode] = useState('');
  const [word, setWord] = useState('');
  const [category, setCategory] = useState('social');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingRule, setPendingRule] = useState('');
  const [pendingTerm, setPendingTerm] = useState('');
  const [pendingCountry, setPendingCountry] = useState('');
  const [autoApprovePosts, setAutoApprovePosts] = useState(false);
  const [isSavingAutoApprove, setIsSavingAutoApprove] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [twoFactor, setTwoFactor] = useState(null);
  const [securityChannel, setSecurityChannel] = useState('email');
  const [securityChallenge, setSecurityChallenge] = useState(null);
  const [securityCode, setSecurityCode] = useState('');
  const [isSecurityBusy, setIsSecurityBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError('');
    const loadSettings = async () => {
      try {
        const security = await authService.getTwoFactorSettings();
        if (!active) return;
        setTwoFactor(security);
        if (!security.enabled) {
          setTerms([]);
          setFirewallRules([]);
          setCountries([]);
          setAutoApprovePosts(false);
          return;
        }

        const [termRows, ruleRows, countryRows, autoModeration] = await Promise.all([
          adminService.getModerationTerms(),
          adminService.getFirewallRules(),
          adminService.getRegionalCountries(),
          adminService.getAfterDarkAutoModeration(),
        ]);
        if (!Array.isArray(termRows) || !Array.isArray(ruleRows) || !Array.isArray(countryRows)
          || typeof autoModeration?.auto_approve_new_posts !== 'boolean') {
          throw new Error(t('adminUiInvalidSettingsResponse'));
        }
        if (!active) return;
        setTerms(termRows);
        setFirewallRules(ruleRows);
        setCountries(countryRows);
        setAutoApprovePosts(autoModeration.auto_approve_new_posts);
      } catch (error) {
        if (!active) return;
        setLoadError(getErrorMessage(error, t('adminUiLoadAdminSettingsError')));
        setTerms([]);
        setFirewallRules([]);
        setCountries([]);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    loadSettings();
    return () => { active = false; };
  }, [refreshKey, t]);

  const activeRuleCount = useMemo(
    () => firewallRules.filter((rule) => rule.active).length,
    [firewallRules],
  );

  const addTerm = async (event) => {
    event.preventDefault();
    const trimmedWord = word.trim();
    if (!trimmedWord || trimmedWord.length > 255) {
      toast.error(t('adminUiModerationTermLength'));
      return;
    }

    setIsSaving(true);
    try {
      await adminService.createModerationTerm({ word: trimmedWord, category });
      toast.success(t('adminUiModerationTermAdded'));
      setWord('');
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, t('adminUiAddModerationTermError')));
    } finally {
      setIsSaving(false);
    }
  };

  const removeTerm = async (term) => {
    if (!await confirm(t('adminUiRemoveModerationTermConfirm', { word: term.word, category: term.category }), {
      title: t('adminUiRemoveModerationTerm'),
      confirmLabel: t('adminUiRemove'),
      tone: 'danger',
    })) return;
    setPendingTerm(term.id);
    try {
      await adminService.deleteModerationTerm(term.id);
      toast.success(t('adminUiModerationTermRemoved'));
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, t('adminUiRemoveModerationTermError')));
    } finally {
      setPendingTerm('');
    }
  };

  const toggleRule = async (rule) => {
    setPendingRule(rule.id);
    try {
      await adminService.toggleFirewallRule(rule.id);
      toast.success(t(rule.active ? 'adminUiFirewallRuleDisabled' : 'adminUiFirewallRuleEnabled', { rule: rule.name }));
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, t('adminUiUpdateFirewallRuleError')));
    } finally {
      setPendingRule('');
    }
  };

  const blockCountry = async (event) => {
    event.preventDefault();
    const code = countryCode.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') {
      toast.error(t('adminUiCountryCodeInvalid'));
      return;
    }

    setPendingCountry(code);
    try {
      await adminService.blockRegionalCountry(code);
      toast.success(t('adminUiCountryBlocked', { code }));
      setCountryCode('');
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, t('adminUiBlockCountryError')));
    } finally {
      setPendingCountry('');
    }
  };

  const unblockCountry = async (code) => {
    setPendingCountry(code);
    try {
      await adminService.unblockRegionalCountry(code);
      toast.success(t('adminUiCountryAccessRestored', { code }));
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, t('adminUiUnblockCountryError')));
    } finally {
      setPendingCountry('');
    }
  };

  const toggleAutoApprovePosts = async () => {
    const nextEnabled = !autoApprovePosts;
    if (nextEnabled && !await confirm(
      t('adminUiEnableAutoApprovalConfirm'),
      {
        title: t('adminUiEnableInstantAutoApproval'),
        confirmLabel: t('adminUiEnable'),
        tone: 'danger',
      }
    )) return;

    setIsSavingAutoApprove(true);
    try {
      const result = await adminService.updateAfterDarkAutoModeration(nextEnabled);
      if (typeof result?.auto_approve_new_posts !== 'boolean') {
        throw new Error(t('adminUiInvalidModerationSetting'));
      }
      setAutoApprovePosts(result.auto_approve_new_posts);
      toast.success(result.auto_approve_new_posts
        ? t('adminUiNewPostsAutoApproved')
        : t('adminUiNewPostsRequireModeration'));
    } catch (error) {
      toast.error(getErrorMessage(error, t('adminUiUpdateAfterDarkAutoModerationError')));
    } finally {
      setIsSavingAutoApprove(false);
    }
  };

  const requestAdminTwoFactor = async (event) => {
    event.preventDefault();
    setIsSecurityBusy(true);
    try {
      const result = await authService.requestTwoFactorChange(true, securityChannel);
      setSecurityChallenge(result);
      toast.success(t('adminUiVerificationCodeSent', { destination: result.destination || securityChannel }));
    } catch (error) {
      toast.error(getErrorMessage(error, t('adminUiStartTwoFactorError')));
    } finally {
      setIsSecurityBusy(false);
    }
  };

  const verifyAdminTwoFactor = async (event) => {
    event.preventDefault();
    if (!securityChallenge?.challenge_id || !securityCode.trim()) return;
    setIsSecurityBusy(true);
    try {
      await authService.verifyTwoFactorChange(securityChallenge.challenge_id, securityCode.trim(), true);
      setSecurityChallenge(null);
      setSecurityCode('');
      setTwoFactor((current) => ({ ...current, enabled: true, channel: securityChannel }));
      toast.success(t('adminUiTwoFactorEnabled'));
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, t('adminUiVerifySecurityCodeError')));
    } finally {
      setIsSecurityBusy(false);
    }
  };

  const changeAdminPassword = async (event) => {
    event.preventDefault();
    if (newPassword.length < 8 || newPassword !== confirmPassword) {
      toast.error(newPassword.length < 8 ? t('adminUiNewPasswordTooShort') : t('adminUiPasswordsDoNotMatch'));
      return;
    }
    setIsPasswordSaving(true);
    try {
      await authService.updatePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success(t('adminUiPasswordUpdated'));
    } catch (error) {
      toast.error(getErrorMessage(error, t('adminUiUpdateAdminPasswordError')));
    } finally {
      setIsPasswordSaving(false);
    }
  };

  const countryName = (code) => {
    try {
      return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) || code;
    } catch {
      return code;
    }
  };

  return (
    <main className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-black p-2 font-mono text-zinc-300 sm:p-3 lg:p-4">
      <div className="w-full space-y-4">
        <header className="flex flex-col justify-between gap-4 border-b-2 border-zinc-800 pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-red-400">
              <Shield className="h-4 w-4" /> {t('adminUiAdminControls')}
            </p>
            <h1 className="text-2xl font-black uppercase tracking-widest text-white sm:text-3xl">{t('adminUiSafetySettings')}</h1>
            <p className="mt-2 max-w-2xl text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
              {t('adminUiSafetySettingsDescription')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((key) => key + 1)}
            disabled={isLoading}
            className="flex items-center justify-center gap-2 border-2 border-zinc-700 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-white hover:border-white disabled:opacity-50"
          >
            <RefreshCcw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> {t('adminUiRefresh')}
          </button>
        </header>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="border-2 border-zinc-800 bg-zinc-950 p-5">
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white">
              <Shield className="h-4 w-4 text-green-400" /> {t('adminUiAdminTwoFactor')}
            </h2>
            {twoFactor?.enabled ? (
              <p className="mt-3 text-xs text-green-300">
                {t('adminUiTwoFactorEnabledVia', { channel: twoFactor.channel || t('adminUiVerifiedSecurityMethod') })}
              </p>
            ) : (
              <>
                <p className="mt-3 text-xs leading-relaxed text-amber-300">
                  {t('adminUiEnableTwoFactorBeforeAdmin')}
                </p>
                {!securityChallenge ? (
                  <form onSubmit={requestAdminTwoFactor} className="mt-4 flex flex-wrap gap-2">
                    <label className="sr-only" htmlFor="admin-2fa-channel">{t('adminUiVerificationMethod')}</label>
                    <select id="admin-2fa-channel" value={securityChannel} onChange={(event) => setSecurityChannel(event.target.value)} className="border-2 border-zinc-700 bg-black px-3 py-2 text-xs text-white">
                      {twoFactor?.email_available && <option value="email">{t('adminUiEmail')}</option>}
                      {twoFactor?.sms_available && twoFactor?.sms_verified && <option value="sms">{t('adminUiSms')}</option>}
                    </select>
                    <button type="submit" disabled={isSecurityBusy || (!twoFactor?.email_available && !(twoFactor?.sms_available && twoFactor?.sms_verified))} className="border-2 border-green-800 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-green-200 hover:border-green-400 disabled:opacity-50">
                      {isSecurityBusy ? t('adminUiSending') : t('adminUiSendSetupCode')}
                    </button>
                    {!twoFactor?.email_available && !(twoFactor?.sms_available && twoFactor?.sms_verified) && (
                      <p className="w-full text-[10px] text-red-300">{t('adminUiVerifiedContactRequired')}</p>
                    )}
                  </form>
                ) : (
                  <form onSubmit={verifyAdminTwoFactor} className="mt-4 flex flex-wrap gap-2">
                    <label className="sr-only" htmlFor="admin-2fa-code">{t('adminUiTwoFactorSetupCode')}</label>
                    <input id="admin-2fa-code" inputMode="numeric" autoComplete="one-time-code" value={securityCode} onChange={(event) => setSecurityCode(event.target.value)} maxLength={12} placeholder={t('adminUiVerificationCode')} className="border-2 border-zinc-700 bg-black px-3 py-2 text-xs text-white" />
                    <button type="submit" disabled={isSecurityBusy || !securityCode.trim()} className="border-2 border-green-800 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-green-200 hover:border-green-400 disabled:opacity-50">
                      {isSecurityBusy ? t('adminUiVerifying') : t('adminUiVerifyAndEnable')}
                    </button>
                  </form>
                )}
              </>
            )}
          </article>

          <form onSubmit={changeAdminPassword} className="space-y-3 border-2 border-zinc-800 bg-zinc-950 p-5">
            <h2 className="text-xs font-black uppercase tracking-widest text-white">{t('adminUiAdministratorPassword')}</h2>
            <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
              {t('adminUiCurrentPassword')}
              <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                {t('adminUiNewPassword')}
                <input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white" />
              </label>
              <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                {t('adminUiConfirmNewPassword')}
                <input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white" />
              </label>
            </div>
            <button type="submit" disabled={isPasswordSaving || !currentPassword || !newPassword || !confirmPassword} className="border-2 border-zinc-700 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:border-white disabled:opacity-50">
              {isPasswordSaving ? t('adminUiUpdating') : t('adminUiUpdatePassword')}
            </button>
          </form>
        </section>

        {!twoFactor?.enabled && !isLoading && (
          <p role="status" className="border-2 border-amber-900 bg-amber-950/20 p-4 text-xs text-amber-200">
            {t('adminUiEnableTwoFactorToUnlockApis')}
          </p>
        )}

        {loadError && (
          <section role="alert" className="flex flex-wrap items-center justify-between gap-4 border-2 border-red-900 bg-red-950/30 p-4 text-xs text-red-300">
            <span>{loadError}</span>
            <button type="button" className="text-[10px] font-black uppercase underline" onClick={() => setRefreshKey((key) => key + 1)}>
              {t('adminUiRetry')}
            </button>
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <article className="border-2 border-zinc-800 bg-zinc-950 p-5">
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{t('adminUiDatabaseModerationTerms')}</p>
            <p className="mt-2 text-2xl font-black text-white">{terms.length}</p>
            <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-600">{t('adminUiCustomFilterEntries')}</p>
          </article>
          <article className="border-2 border-zinc-800 bg-zinc-950 p-5">
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{t('adminUiEnabledFirewallRules')}</p>
            <p className="mt-2 text-2xl font-black text-white">{activeRuleCount} / {firewallRules.length}</p>
            <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-600">{t('adminUiFirewallDatabaseState')}</p>
          </article>
        </section>

        <section className="border-2 border-amber-900 bg-zinc-950">
          <div className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center">
            <div className="max-w-3xl">
              <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white">
                <AlertTriangle className="h-4 w-4 text-amber-400" /> {t('adminUiAfterDarkAutoModeration')}
              </h2>
              <p className="mt-2 text-[9px] leading-relaxed text-zinc-400">
                {t('adminUiAfterDarkAutoModerationDescription')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoApprovePosts}
              onClick={toggleAutoApprovePosts}
              disabled={isLoading || isSavingAutoApprove}
              className={`flex shrink-0 items-center justify-center gap-2 border-2 px-4 py-3 text-[9px] font-black uppercase tracking-widest disabled:opacity-50 ${
                autoApprovePosts
                  ? 'border-amber-500 bg-amber-500 text-black hover:bg-amber-400'
                  : 'border-zinc-700 text-zinc-300 hover:border-white hover:text-white'
              }`}
            >
              {isSavingAutoApprove ? <Loader2 className="h-4 w-4 animate-spin" /> : autoApprovePosts ? <Check className="h-4 w-4" /> : null}
              {autoApprovePosts ? t('adminUiEnabled') : t('adminUiDisabled')}
            </button>
          </div>
        </section>

        <section className="border-2 border-zinc-800 bg-zinc-950">
          <header className="border-b-2 border-zinc-800 bg-black p-4">
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white">
              <Globe2 className="h-4 w-4 text-blue-300" /> {t('adminUiRegionalAccess')}
            </h2>
            <p className="mt-2 text-[9px] leading-relaxed text-zinc-500">
              {t('adminUiRegionalAccessDescription')}
            </p>
          </header>
          <form onSubmit={blockCountry} className="flex flex-col gap-3 border-b border-zinc-800 p-4 sm:flex-row sm:items-end">
            <label className="block flex-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">
              {t('adminUiCountryCode')}
              <input
                value={countryCode}
                onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
                maxLength={2}
                required
                placeholder={t('adminUiCountryCodeKenya')}
                className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white"
              />
            </label>
            <button
              type="submit"
              disabled={isLoading || Boolean(pendingCountry)}
              className="flex items-center justify-center gap-2 border-2 border-red-900 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-red-300 hover:bg-red-950 disabled:opacity-50"
            >
              {pendingCountry === countryCode.trim().toUpperCase() ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t('adminUiBlockCountry')}
            </button>
          </form>
          {isLoading ? (
            <p role="status" className="p-6 text-center text-xs text-zinc-500">{t('adminUiLoadingRegionalSettings')}</p>
          ) : countries.length === 0 ? (
            <p className="p-6 text-center text-[10px] uppercase tracking-widest text-zinc-600">
              {t('adminUiNoDetectedCountries')}
            </p>
          ) : (
            <div className="divide-y divide-zinc-800">
              {countries.map((country) => (
                <article key={country.country_code} className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-white">
                      {countryName(country.country_code)} ({country.country_code})
                    </h3>
                    <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-600">
                      {t('adminUiRegisteredUserCount', { count: country.user_count })} · {country.blocked ? t('adminUiBlocked') : t('adminUiAllowed')}
                    </p>
                  </div>
                  {country.blocked && (
                    <button
                      type="button"
                      onClick={() => unblockCountry(country.country_code)}
                      disabled={Boolean(pendingCountry)}
                      className="flex items-center justify-center gap-2 border-2 border-green-900 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-green-300 hover:bg-green-950 disabled:opacity-50"
                    >
                      {pendingCountry === country.country_code ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      {t('adminUiAllow')}
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
          <div className="space-y-6">
            <section className="border-2 border-zinc-800 bg-zinc-950">
              <header className="border-b-2 border-zinc-800 bg-black p-4">
                <h2 className="text-xs font-black uppercase tracking-widest text-white">{t('adminUiMessageFilterProtections')}</h2>
                <p className="mt-2 flex items-start gap-2 text-[9px] leading-relaxed text-zinc-500">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                  {t('adminUiBuiltInMessageFilterDescription')}
                </p>
              </header>
              <form onSubmit={addTerm} className="space-y-4 p-4">
                <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                  {t('adminUiTerm')}
                  <input
                    value={word}
                    onChange={(event) => setWord(event.target.value)}
                    maxLength={255}
                    required
                    placeholder={t('adminUiAddTermPlaceholder')}
                    className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white"
                  />
                </label>
                <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                  {t('adminUiFilterCategory')}
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white"
                  >
                    <option value="social">{t('adminUiSocialSharing')}</option>
                    <option value="profanity">{t('adminUiProfanity')}</option>
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={isSaving || isLoading}
                  className="flex items-center justify-center gap-2 border-2 border-white bg-white px-4 py-3 text-[9px] font-black uppercase tracking-widest text-black hover:bg-zinc-200 disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t('adminUiAddTerm')}
                </button>
              </form>
            </section>

            <section className="border-2 border-zinc-800 bg-zinc-950 p-4">
              <h2 className="text-xs font-black uppercase tracking-widest text-white">{t('adminUiAutomatedProfileAssignment')}</h2>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div className="border border-zinc-800 bg-black p-3">
                  <p className="text-lg font-black text-white">5h</p>
                  <p className="mt-1 text-[8px] uppercase tracking-widest text-zinc-600">{t('adminUiReplyIdleThreshold')}</p>
                </div>
                <div className="border border-zinc-800 bg-black p-3">
                  <p className="text-lg font-black text-white">24h</p>
                  <p className="mt-1 text-[8px] uppercase tracking-widest text-zinc-600">{t('adminUiCreatorActivityWindow')}</p>
                </div>
                <div className="border border-zinc-800 bg-black p-3">
                  <p className="text-lg font-black text-white">8</p>
                  <p className="mt-1 text-[8px] uppercase tracking-widest text-zinc-600">{t('adminUiProfilesPerCreator')}</p>
                </div>
              </div>
              <p className="mt-3 text-[9px] leading-relaxed text-zinc-600">{t('adminUiAssignmentWorkerSafeguards')}</p>
            </section>
          </div>

          <section className="border-2 border-zinc-800 bg-zinc-950">
            <header className="flex items-center justify-between border-b-2 border-zinc-800 bg-black p-4">
              <div>
                <h2 className="text-xs font-black uppercase tracking-widest text-white">{t('adminUiActiveModerationTerms')}</h2>
                <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-600">{t('adminUiChangesImmediate')}</p>
              </div>
              <span className="text-[9px] font-black uppercase text-zinc-500">{t('adminUiTotalCount', { count: terms.length })}</span>
            </header>
            {isLoading ? (
              <p role="status" className="p-8 text-center text-xs text-zinc-500">{t('adminUiLoadingModerationSettings')}</p>
            ) : terms.length === 0 ? (
              <p className="p-8 text-center text-[10px] uppercase tracking-widest text-zinc-600">{t('adminUiNoModerationTerms')}</p>
            ) : (
              <div className="max-h-[70dvh] divide-y divide-zinc-800 overflow-y-auto">
                {terms.map((term) => (
                  <div key={term.id} className="flex items-center justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <p className="break-all text-xs font-black text-white">{term.word}</p>
                      <p className={`mt-1 text-[8px] font-black uppercase tracking-widest ${term.category === 'social' ? 'text-blue-300' : 'text-amber-300'}`}>
                        {term.category === 'social' ? t('adminUiSocialSharing') : t('adminUiProfanity')} · {t('adminUiAdded')} {new Date(term.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeTerm(term)}
                      disabled={pendingTerm === term.id}
                      aria-label={t('adminUiRemoveModerationTermAria', { word: term.word })}
                      className="shrink-0 border border-red-900 p-2 text-red-300 hover:bg-red-950 disabled:opacity-50"
                    >
                      {pendingTerm === term.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>

        <section className="border-2 border-zinc-800 bg-zinc-950">
          <header className="border-b-2 border-zinc-800 bg-black p-4">
            <h2 className="text-xs font-black uppercase tracking-widest text-white">{t('adminUiFirewallRules')}</h2>
            <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-600">{t('adminUiFirewallRulesDescription')}</p>
          </header>
          {isLoading ? (
            <p role="status" className="p-6 text-center text-xs text-zinc-500">{t('adminUiLoadingFirewallRules')}</p>
          ) : firewallRules.length === 0 ? (
            <p className="p-6 text-center text-[10px] uppercase tracking-widest text-zinc-600">{t('adminUiNoFirewallRules')}</p>
          ) : (
            <div className="divide-y divide-zinc-800">
              {firewallRules.map((rule) => (
                <article key={rule.id} className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-white">{rule.name}</h3>
                    <p className="mt-1 text-[9px] leading-relaxed text-zinc-500">{rule.desc}</p>
                  </div>
                  <button
                    type="button"
                    aria-pressed={rule.active}
                    onClick={() => toggleRule(rule)}
                    disabled={pendingRule === rule.id}
                    className={`flex shrink-0 items-center justify-center gap-2 border-2 px-4 py-2 text-[9px] font-black uppercase tracking-widest disabled:opacity-50 ${rule.active ? 'border-green-900 text-green-300 hover:bg-green-950' : 'border-zinc-700 text-zinc-400 hover:border-white hover:text-white'}`}
                  >
                    {pendingRule === rule.id ? <Loader2 className="h-3 w-3 animate-spin" /> : rule.active ? <Check className="h-3 w-3" /> : null}
                    {rule.active ? t('adminUiEnabled') : t('adminUiDisabled')}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
