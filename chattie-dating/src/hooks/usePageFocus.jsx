import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { EyeOff } from 'lucide-react';
import { useI18n } from '../i18n';

const isPageVisible = () => document.visibilityState === 'visible' && document.hasFocus();

export function usePageFocus() {
  const [isFocused, setIsFocused] = useState(() =>
    typeof document === 'undefined' || isPageVisible()
  );

  useEffect(() => {
    const handleBlur = () => setIsFocused(false);
    const handleFocus = () => setIsFocused(document.visibilityState === 'visible');
    const handleVisibilityChange = () => setIsFocused(isPageVisible());

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isFocused;
}

export function PagePrivacyShield({ active, message }) {
  const { t } = useI18n();
  if (!active) return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6 text-center backdrop-blur-xl"
      style={{ zIndex: 10000 }}
    >
      <div className="flex max-w-sm flex-col items-center gap-3 border border-zinc-700 bg-zinc-950 px-8 py-7">
        <EyeOff className="h-7 w-7 text-yellow-300" aria-hidden="true" />
        <p className="text-xs font-bold uppercase tracking-widest text-white">{t('commonUiPrivateView')}</p>
        <p className="text-[10px] leading-relaxed text-zinc-400">{message || t('commonUiPrivateDetailsHidden')}</p>
      </div>
    </div>,
    document.body
  );
}