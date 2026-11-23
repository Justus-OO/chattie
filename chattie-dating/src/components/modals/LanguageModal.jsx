import React, { useEffect, useState } from 'react';
import { Check, Globe, X } from 'lucide-react';
import { useI18n } from '../../i18n';

export default function LanguageModal({ isOpen, onClose, languages, language, setLanguage, title }) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const [savingCode, setSavingCode] = useState('');
  useEffect(() => {
    if (!isOpen) {
      setError('');
      setSavingCode('');
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const selectLanguage = async (code) => {
    setError('');
    setSavingCode(code);
    try {
      await setLanguage(code);
      onClose();
    } catch {
      setError(t('coreUiPreferencesSaveFailed'));
    } finally {
      setSavingCode('');
    }
  };

  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="language-modal-title">
      <button type="button" className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} aria-label={t('closeLanguageSelection')} />
      <section className="relative w-full max-w-sm overflow-hidden border shadow-2xl" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-strong)', borderRadius: 'var(--radius-lg)' }}>
        <header className="flex items-center justify-between border-b px-5 py-4" style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)' }}>
          <h2 id="language-modal-title" className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            <Globe className="h-4 w-4" style={{ color: 'var(--accent)' }} /> {title}
          </h2>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }} aria-label={t('close')}>
            <X className="h-4 w-4" />
          </button>
        </header>
        {error && <p className="px-5 pt-3 text-sm text-red-500" role="alert">{error}</p>}
        <div className="space-y-2 p-3">
          {languages.map((item) => {
            const isSelected = item.code === language;
            return (
              <button
                key={item.code}
                type="button"
                onClick={() => void selectLanguage(item.code)}
                disabled={Boolean(savingCode)}
                aria-busy={savingCode === item.code}
                aria-pressed={isSelected}
                className="flex w-full items-center justify-between border px-4 py-3 text-left text-sm font-semibold transition-colors"
                style={{
                  color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  backgroundColor: isSelected ? 'var(--surface-alt)' : 'var(--surface)',
                  borderColor: isSelected ? 'var(--accent)' : 'var(--border)'
                }}
              >
                <span>{item.label}</span>
                {isSelected && <Check className="h-4 w-4" style={{ color: 'var(--accent)' }} />}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
