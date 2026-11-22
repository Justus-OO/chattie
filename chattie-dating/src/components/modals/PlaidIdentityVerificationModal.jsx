import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle, LockKeyhole, ShieldCheck, X } from 'lucide-react';
import { settingsService } from '../../api/settings.service';
import { useI18n } from '../../i18n';

const PLAID_LINK_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
let plaidScriptPromise;

function loadPlaidLink() {
  if (window.Plaid?.create) return Promise.resolve();
  if (plaidScriptPromise) return plaidScriptPromise;

  plaidScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PLAID_LINK_SCRIPT;
    script.async = true;
    script.onload = () => (window.Plaid?.create
      ? resolve()
      : reject(new Error('Plaid Link loaded without its initialization API.')));
    script.onerror = () => reject(new Error('Could not load Plaid Link.'));
    document.head.appendChild(script);
  }).catch((error) => {
    plaidScriptPromise = undefined;
    throw error;
  });

  return plaidScriptPromise;
}

export default function PlaidIdentityVerificationModal({ isOpen, onClose, onVerified, zIndex = 50 }) {
  const { t } = useI18n();
  const [hasConsent, setHasConsent] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [attempt, setAttempt] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const plaidHandler = useRef(null);
  const isOpenRef = useRef(isOpen);
  const translate = useRef(t);
  const onVerifiedRef = useRef(onVerified);
  const didNotifyVerified = useRef(false);

  isOpenRef.current = isOpen;
  translate.current = t;
  onVerifiedRef.current = onVerified;

  useEffect(() => {
    if (isOpen) {
      didNotifyVerified.current = false;
      setHasConsent(false);
      setIsStarting(false);
      setAttempt(null);
      setStatus('idle');
      setError('');
      return undefined;
    }

    return undefined;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !attempt?.attemptId || !['active', 'checking', 'pending_review'].includes(status)) {
      return undefined;
    }

    let active = true;
    const pollStatus = async () => {
      try {
        const result = await settingsService.getPlaidIdentityVerificationStatus(attempt.attemptId);
        if (!active) return;

        setStatus(result.status);
        setError('');
        if (result.status === 'success' && !didNotifyVerified.current) {
          didNotifyVerified.current = true;
          onVerifiedRef.current?.();
        }
      } catch {
        if (active) setError(translate.current('plaidVerificationStatusUnavailable'));
      }
    };

    pollStatus();
    const interval = window.setInterval(pollStatus, status === 'pending_review' ? 15000 : 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [attempt?.attemptId, isOpen, status]);

  useEffect(() => {
    if (isOpen) return undefined;
    const handler = plaidHandler.current;
    plaidHandler.current = null;
    handler?.destroy?.();
    return undefined;
  }, [isOpen]);

  if (!isOpen) return null;

  const close = () => {
    const handler = plaidHandler.current;
    plaidHandler.current = null;
    handler?.destroy?.();
    onClose?.();
  };

  const startVerification = async () => {
    if (!hasConsent || isStarting) return;
    setIsStarting(true);
    setError('');

    try {
      const session = await settingsService.createPlaidIdentityVerificationLinkToken(true);
      if (!isOpenRef.current) return;
      if (!session?.attempt_id || !session?.link_token) {
        throw new Error('The server returned an incomplete verification session.');
      }
      setAttempt({ attemptId: session.attempt_id });
      setStatus('active');

      await loadPlaidLink();
      if (!isOpenRef.current) return;
      let completed = false;
      const handler = window.Plaid.create({
        token: session.link_token,
        onSuccess: async (_publicToken, metadata) => {
          completed = true;
          const identityVerificationId = metadata?.link_session_id;
          if (!identityVerificationId) {
            setStatus('failed');
            setError(t('plaidVerificationIncomplete'));
            setIsStarting(false);
            return;
          }

          setStatus('checking');
          try {
            const result = await settingsService.completePlaidIdentityVerification(
              session.attempt_id,
              identityVerificationId,
            );
            setStatus(result.status);
            if (result.status === 'success' && !didNotifyVerified.current) {
              didNotifyVerified.current = true;
              onVerifiedRef.current?.();
            }
          } catch (requestError) {
            setError(requestError.response?.data?.error || t('plaidVerificationStatusUnavailable'));
          } finally {
            setIsStarting(false);
          }
        },
        onExit: (linkError) => {
          if (completed) return;
          setStatus('canceled');
          setIsStarting(false);
          if (linkError?.display_message) setError(linkError.display_message);
        },
      });

      plaidHandler.current = handler;
      handler.open();
    } catch (requestError) {
      if (!isOpenRef.current) return;
      setAttempt(null);
      setStatus('idle');
      setError(requestError.response?.data?.error || requestError.message || t('plaidVerificationIncomplete'));
      setIsStarting(false);
    }
  };

  const statusMessages = {
    active: t('plaidVerificationWaiting'),
    checking: t('plaidVerificationChecking'),
    pending_review: t('plaidVerificationReview'),
    success: t('plaidVerificationSuccess'),
    failed: t('plaidVerificationFailed'),
    expired: t('plaidVerificationFailed'),
    canceled: t('plaidVerificationCanceled'),
  };
  const statusMessage = statusMessages[status];
  const isSuccessful = status === 'success';
  const isPending = ['active', 'checking', 'pending_review'].includes(status);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      style={{ zIndex }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="plaid-verification-title"
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto border-2 shadow-2xl"
        style={{
          backgroundColor: 'var(--surface-strong)',
          borderColor: 'var(--border-strong)',
          color: 'var(--text-primary)',
        }}
      >
        <div className="h-1" style={{ backgroundColor: 'var(--accent)' }} />
        <button
          type="button"
          onClick={close}
          aria-label={t('verificationClose')}
          className="absolute right-3 top-3 border p-2 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:right-4 sm:top-4"
          style={{
            borderColor: 'var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          <X size={18} />
        </button>

        <div className="p-4 sm:p-8">
          <div
            className="mb-5 flex h-12 w-12 items-center justify-center border-2 sm:mb-6 sm:h-14 sm:w-14"
            style={{ backgroundColor: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            {isSuccessful ? <CheckCircle2 size={28} /> : <ShieldCheck size={28} />}
          </div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--accent)' }}>
            {t('plaidVerificationSecure')}
          </p>
          <h2 id="plaid-verification-title" className="text-xl font-bold tracking-tight sm:text-2xl">
            {t('verificationTitle')}
          </h2>
          <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
            {t('plaidVerificationIntro')}
          </p>

          <div
            className="mt-5 flex gap-3 border p-3 sm:mt-6 sm:p-4"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-alt)' }}
          >
            <LockKeyhole className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} size={18} />
            <p className="text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
              {t('plaidVerificationPrivacy')}
            </p>
          </div>

          {statusMessage && (
            <div
              role="status"
              className="mt-5 flex items-start gap-3 border p-3 text-sm sm:p-4"
              style={{
                borderColor: isSuccessful ? 'var(--success)' : 'var(--accent)',
                backgroundColor: isSuccessful
                  ? 'color-mix(in srgb, var(--surface-strong) 90%, var(--success) 10%)'
                  : 'var(--accent-soft)',
                color: isSuccessful ? 'var(--success-strong)' : 'var(--accent-strong)',
              }}
            >
              {isPending ? <LoaderCircle className="mt-0.5 shrink-0 animate-spin" size={17} /> : (
                isSuccessful ? <CheckCircle2 className="mt-0.5 shrink-0" size={17} /> : <AlertCircle className="mt-0.5 shrink-0" size={17} />
              )}
              <span>{statusMessage}</span>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}

          {status === 'idle' || status === 'failed' || status === 'expired' || status === 'canceled' ? (
            <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm leading-5 text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={hasConsent}
                onChange={(event) => setHasConsent(event.target.checked)}
                className="mt-1 h-4 w-4 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                style={{ accentColor: 'var(--accent)', borderColor: 'var(--border-strong)' }}
              />
              <span>{t('plaidVerificationConsent')}</span>
            </label>
          ) : null}

          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={close}
              className="border px-5 py-3 text-sm font-semibold transition hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              style={{
                borderColor: 'var(--border-strong)',
                color: 'var(--text-primary)',
              }}
            >
              {t('verificationClose')}
            </button>
            {(status === 'idle' || status === 'failed' || status === 'expired' || status === 'canceled') && (
              <button
                type="button"
                onClick={startVerification}
                disabled={!hasConsent || isStarting}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-bold transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--text-on-accent)' }}
              >
                {isStarting && <LoaderCircle size={16} className="animate-spin" />}
                {isStarting ? t('verificationLoading') : t('startVerification')}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
