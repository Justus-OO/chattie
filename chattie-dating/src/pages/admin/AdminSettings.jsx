import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Globe2, Loader2, Plus, RefreshCcw, Shield, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { adminService } from '../../api/admin.service';
import { authService } from '../../api/auth.service';
import { useAppDialogs } from '../../components/modals/useAppDialogs';

const getErrorMessage = (error, fallback) => error?.response?.data?.error
  || (typeof error?.response?.data === 'string' ? error.response.data.trim() : '')
  || (error instanceof Error ? error.message : fallback);

export default function AdminSettings() {
  const { confirm } = useAppDialogs();
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
          throw new Error('The settings service returned invalid data.');
        }
        if (!active) return;
        setTerms(termRows);
        setFirewallRules(ruleRows);
        setCountries(countryRows);
        setAutoApprovePosts(autoModeration.auto_approve_new_posts);
      } catch (error) {
        if (!active) return;
        setLoadError(getErrorMessage(error, 'Could not load admin settings.'));
        setTerms([]);
        setFirewallRules([]);
        setCountries([]);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    loadSettings();
    return () => { active = false; };
  }, [refreshKey]);

  const activeRuleCount = useMemo(
    () => firewallRules.filter((rule) => rule.active).length,
    [firewallRules],
  );

  const addTerm = async (event) => {
    event.preventDefault();
    const trimmedWord = word.trim();
    if (!trimmedWord || trimmedWord.length > 255) {
      toast.error('Enter a moderation term with 1 to 255 characters.');
      return;
    }

    setIsSaving(true);
    try {
      await adminService.createModerationTerm({ word: trimmedWord, category });
      toast.success('Moderation term added and filters reloaded.');
      setWord('');
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not add moderation term.'));
    } finally {
      setIsSaving(false);
    }
  };

  const removeTerm = async (term) => {
    if (!await confirm(`Remove "${term.word}" from the ${term.category} filter?`, {
      title: 'Remove moderation term',
      confirmLabel: 'Remove',
      tone: 'danger',
    })) return;
    setPendingTerm(term.id);
    try {
      await adminService.deleteModerationTerm(term.id);
      toast.success('Moderation term removed and filters reloaded.');
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not remove moderation term.'));
    } finally {
      setPendingTerm('');
    }
  };

  const toggleRule = async (rule) => {
    setPendingRule(rule.id);
    try {
      await adminService.toggleFirewallRule(rule.id);
      toast.success(`${rule.name} ${rule.active ? 'disabled' : 'enabled'}.`);
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update firewall rule.'));
    } finally {
      setPendingRule('');
    }
  };

  const blockCountry = async (event) => {
    event.preventDefault();
    const code = countryCode.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') {
      toast.error('Enter a valid two-letter country code.');
      return;
    }

    setPendingCountry(code);
    try {
      await adminService.blockRegionalCountry(code);
      toast.success(`${code} blocked from accessing the service.`);
      setCountryCode('');
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not block country.'));
    } finally {
      setPendingCountry('');
    }
  };

  const unblockCountry = async (code) => {
    setPendingCountry(code);
    try {
      await adminService.unblockRegionalCountry(code);
      toast.success(`${code} access restored.`);
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not unblock country.'));
    } finally {
      setPendingCountry('');
    }
  };

  const toggleAutoApprovePosts = async () => {
    const nextEnabled = !autoApprovePosts;
    if (nextEnabled && !await confirm(
      'Enable instant auto-approval for new After Dark posts? New posts will bypass human review and may become visible immediately.',
      {
        title: 'Enable instant auto-approval',
        confirmLabel: 'Enable',
        tone: 'danger',
      }
    )) return;

    setIsSavingAutoApprove(true);
    try {
      const result = await adminService.updateAfterDarkAutoModeration(nextEnabled);
      if (typeof result?.auto_approve_new_posts !== 'boolean') {
        throw new Error('The moderation setting response was invalid.');
      }
      setAutoApprovePosts(result.auto_approve_new_posts);
      toast.success(result.auto_approve_new_posts
        ? 'New After Dark posts will be auto-approved.'
        : 'New After Dark posts will require moderation.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update After Dark auto-moderation.'));
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
      toast.success(`Verification code sent to ${result.destination || securityChannel}.`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not start two-factor setup.'));
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
      toast.success('Two-factor authentication enabled. Admin access is now protected.');
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not verify the security code.'));
    } finally {
      setIsSecurityBusy(false);
    }
  };

  const changeAdminPassword = async (event) => {
    event.preventDefault();
    if (newPassword.length < 8 || newPassword !== confirmPassword) {
      toast.error(newPassword.length < 8 ? 'New password must contain at least 8 characters.' : 'The new passwords do not match.');
      return;
    }
    setIsPasswordSaving(true);
    try {
      await authService.updatePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password updated.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update the administrator password.'));
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
              <Shield className="h-4 w-4" /> Admin controls
            </p>
            <h1 className="text-2xl font-black uppercase tracking-widest text-white sm:text-3xl">Safety settings</h1>
            <p className="mt-2 max-w-2xl text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
              Configure message protections, regional access, and After Dark post moderation. Changes are audited.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((key) => key + 1)}
            disabled={isLoading}
            className="flex items-center justify-center gap-2 border-2 border-zinc-700 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-white hover:border-white disabled:opacity-50"
          >
            <RefreshCcw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </header>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="border-2 border-zinc-800 bg-zinc-950 p-5">
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white">
              <Shield className="h-4 w-4 text-green-400" /> Administrator two-factor authentication
            </h2>
            {twoFactor?.enabled ? (
              <p className="mt-3 text-xs text-green-300">
                Required admin protection is enabled via {twoFactor.channel || 'your verified security method'}. Administrators cannot disable it.
              </p>
            ) : (
              <>
                <p className="mt-3 text-xs leading-relaxed text-amber-300">
                  Enable two-factor authentication before using admin controls. Until then, admin APIs remain locked; setup and password controls stay available here.
                </p>
                {!securityChallenge ? (
                  <form onSubmit={requestAdminTwoFactor} className="mt-4 flex flex-wrap gap-2">
                    <label className="sr-only" htmlFor="admin-2fa-channel">Verification method</label>
                    <select id="admin-2fa-channel" value={securityChannel} onChange={(event) => setSecurityChannel(event.target.value)} className="border-2 border-zinc-700 bg-black px-3 py-2 text-xs text-white">
                      {twoFactor?.email_available && <option value="email">Email</option>}
                      {twoFactor?.sms_available && twoFactor?.sms_verified && <option value="sms">SMS</option>}
                    </select>
                    <button type="submit" disabled={isSecurityBusy || (!twoFactor?.email_available && !(twoFactor?.sms_available && twoFactor?.sms_verified))} className="border-2 border-green-800 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-green-200 hover:border-green-400 disabled:opacity-50">
                      {isSecurityBusy ? 'Sending…' : 'Send setup code'}
                    </button>
                    {!twoFactor?.email_available && !(twoFactor?.sms_available && twoFactor?.sms_verified) && (
                      <p className="w-full text-[10px] text-red-300">Add a verified email or phone number before enabling admin two-factor authentication.</p>
                    )}
                  </form>
                ) : (
                  <form onSubmit={verifyAdminTwoFactor} className="mt-4 flex flex-wrap gap-2">
                    <label className="sr-only" htmlFor="admin-2fa-code">Two-factor setup code</label>
                    <input id="admin-2fa-code" inputMode="numeric" autoComplete="one-time-code" value={securityCode} onChange={(event) => setSecurityCode(event.target.value)} maxLength={12} placeholder="Verification code" className="border-2 border-zinc-700 bg-black px-3 py-2 text-xs text-white" />
                    <button type="submit" disabled={isSecurityBusy || !securityCode.trim()} className="border-2 border-green-800 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-green-200 hover:border-green-400 disabled:opacity-50">
                      {isSecurityBusy ? 'Verifying…' : 'Verify and enable'}
                    </button>
                  </form>
                )}
              </>
            )}
          </article>

          <form onSubmit={changeAdminPassword} className="space-y-3 border-2 border-zinc-800 bg-zinc-950 p-5">
            <h2 className="text-xs font-black uppercase tracking-widest text-white">Administrator password</h2>
            <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
              Current password
              <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                New password
                <input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white" />
              </label>
              <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                Confirm new password
                <input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white" />
              </label>
            </div>
            <button type="submit" disabled={isPasswordSaving || !currentPassword || !newPassword || !confirmPassword} className="border-2 border-zinc-700 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:border-white disabled:opacity-50">
              {isPasswordSaving ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </section>

        {!twoFactor?.enabled && !isLoading && (
          <p role="status" className="border-2 border-amber-900 bg-amber-950/20 p-4 text-xs text-amber-200">
            Enable two-factor authentication to unlock moderation, finance, and other admin APIs.
          </p>
        )}

        {loadError && (
          <section role="alert" className="flex flex-wrap items-center justify-between gap-4 border-2 border-red-900 bg-red-950/30 p-4 text-xs text-red-300">
            <span>{loadError}</span>
            <button type="button" className="text-[10px] font-black uppercase underline" onClick={() => setRefreshKey((key) => key + 1)}>
              Retry
            </button>
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <article className="border-2 border-zinc-800 bg-zinc-950 p-5">
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Database moderation terms</p>
            <p className="mt-2 text-2xl font-black text-white">{terms.length}</p>
            <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-600">Custom social and profanity entries</p>
          </article>
          <article className="border-2 border-zinc-800 bg-zinc-950 p-5">
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Enabled firewall rules</p>
            <p className="mt-2 text-2xl font-black text-white">{activeRuleCount} / {firewallRules.length}</p>
            <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-600">Rule state is read from the database</p>
          </article>
        </section>

        <section className="border-2 border-amber-900 bg-zinc-950">
          <div className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center">
            <div className="max-w-3xl">
              <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white">
                <AlertTriangle className="h-4 w-4 text-amber-400" /> After Dark auto-moderation
              </h2>
              <p className="mt-2 text-[9px] leading-relaxed text-zinc-400">
                When enabled, new posts with ready media are approved immediately and skip human review. Existing pending posts are not changed. Keep this off if posts need manual review.
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
              {autoApprovePosts ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </section>

        <section className="border-2 border-zinc-800 bg-zinc-950">
          <header className="border-b-2 border-zinc-800 bg-black p-4">
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white">
              <Globe2 className="h-4 w-4 text-blue-300" /> Regional access
            </h2>
            <p className="mt-2 text-[9px] leading-relaxed text-zinc-500">
              Countries are allowed by default. Blocks apply to new API requests and WebSocket connections, and country detection only trusts configured proxy CIDRs.
            </p>
          </header>
          <form onSubmit={blockCountry} className="flex flex-col gap-3 border-b border-zinc-800 p-4 sm:flex-row sm:items-end">
            <label className="block flex-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">
              Country code
              <input
                value={countryCode}
                onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
                maxLength={2}
                required
                placeholder="KE"
                className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white"
              />
            </label>
            <button
              type="submit"
              disabled={isLoading || Boolean(pendingCountry)}
              className="flex items-center justify-center gap-2 border-2 border-red-900 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-red-300 hover:bg-red-950 disabled:opacity-50"
            >
              {pendingCountry === countryCode.trim().toUpperCase() ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Block country
            </button>
          </form>
          {isLoading ? (
            <p role="status" className="p-6 text-center text-xs text-zinc-500">Loading regional settings…</p>
          ) : countries.length === 0 ? (
            <p className="p-6 text-center text-[10px] uppercase tracking-widest text-zinc-600">
              No detected countries yet. Configure TRUSTED_PROXY_CIDRS to enable trusted country detection.
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
                      {country.user_count} registered {country.user_count === 1 ? 'user' : 'users'} · {country.blocked ? 'blocked' : 'allowed'}
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
                      Allow
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
                <h2 className="text-xs font-black uppercase tracking-widest text-white">Message filter protections</h2>
                <p className="mt-2 flex items-start gap-2 text-[9px] leading-relaxed text-zinc-500">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                  Phone numbers, known social links, platform names, and contextual handles are blocked in creator messages by built-in rules.
                </p>
              </header>
              <form onSubmit={addTerm} className="space-y-4 p-4">
                <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                  Term
                  <input
                    value={word}
                    onChange={(event) => setWord(event.target.value)}
                    maxLength={255}
                    required
                    placeholder="Add a word or platform name"
                    className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white"
                  />
                </label>
                <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                  Filter category
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    className="mt-2 w-full border-2 border-zinc-800 bg-black p-3 text-xs text-white outline-none focus:border-white"
                  >
                    <option value="social">Social sharing</option>
                    <option value="profanity">Profanity</option>
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={isSaving || isLoading}
                  className="flex items-center justify-center gap-2 border-2 border-white bg-white px-4 py-3 text-[9px] font-black uppercase tracking-widest text-black hover:bg-zinc-200 disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add term
                </button>
              </form>
            </section>

            <section className="border-2 border-zinc-800 bg-zinc-950 p-4">
              <h2 className="text-xs font-black uppercase tracking-widest text-white">Automated profile assignment</h2>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div className="border border-zinc-800 bg-black p-3">
                  <p className="text-lg font-black text-white">5h</p>
                  <p className="mt-1 text-[8px] uppercase tracking-widest text-zinc-600">Reply idle threshold</p>
                </div>
                <div className="border border-zinc-800 bg-black p-3">
                  <p className="text-lg font-black text-white">24h</p>
                  <p className="mt-1 text-[8px] uppercase tracking-widest text-zinc-600">Creator activity window</p>
                </div>
                <div className="border border-zinc-800 bg-black p-3">
                  <p className="text-lg font-black text-white">8</p>
                  <p className="mt-1 text-[8px] uppercase tracking-widest text-zinc-600">Profiles per creator</p>
                </div>
              </div>
              <p className="mt-3 text-[9px] leading-relaxed text-zinc-600">These safeguards are enforced by the assignment worker and are not adjustable from this page.</p>
            </section>
          </div>

          <section className="border-2 border-zinc-800 bg-zinc-950">
            <header className="flex items-center justify-between border-b-2 border-zinc-800 bg-black p-4">
              <div>
                <h2 className="text-xs font-black uppercase tracking-widest text-white">Active moderation terms</h2>
                <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-600">Changes take effect immediately</p>
              </div>
              <span className="text-[9px] font-black uppercase text-zinc-500">{terms.length} total</span>
            </header>
            {isLoading ? (
              <p role="status" className="p-8 text-center text-xs text-zinc-500">Loading moderation settings…</p>
            ) : terms.length === 0 ? (
              <p className="p-8 text-center text-[10px] uppercase tracking-widest text-zinc-600">No database terms configured.</p>
            ) : (
              <div className="max-h-[70dvh] divide-y divide-zinc-800 overflow-y-auto">
                {terms.map((term) => (
                  <div key={term.id} className="flex items-center justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <p className="break-all text-xs font-black text-white">{term.word}</p>
                      <p className={`mt-1 text-[8px] font-black uppercase tracking-widest ${term.category === 'social' ? 'text-blue-300' : 'text-amber-300'}`}>
                        {term.category} · added {new Date(term.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeTerm(term)}
                      disabled={pendingTerm === term.id}
                      aria-label={`Remove ${term.word}`}
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
            <h2 className="text-xs font-black uppercase tracking-widest text-white">Firewall rules</h2>
            <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-600">Toggle persisted rules; updates are audited by the moderation service.</p>
          </header>
          {isLoading ? (
            <p role="status" className="p-6 text-center text-xs text-zinc-500">Loading firewall rules…</p>
          ) : firewallRules.length === 0 ? (
            <p className="p-6 text-center text-[10px] uppercase tracking-widest text-zinc-600">No firewall rules configured.</p>
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
                    {rule.active ? 'Enabled' : 'Disabled'}
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
