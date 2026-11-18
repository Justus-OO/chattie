import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DialogContext } from './DialogContext';

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const resolverRef = useRef(null);
  const nextDialogId = useRef(0);
  const cancelButtonRef = useRef(null);
  const primaryButtonRef = useRef(null);
  const inputRef = useRef(null);

  const openDialog = useCallback(config => new Promise(resolve => {
    resolverRef.current?.(null);
    resolverRef.current = resolve;
    setInputValue(config.defaultValue || '');
    setDialog({ ...config, id: ++nextDialogId.current });
  }), []);

  const confirm = useCallback((message, options = {}) => openDialog({
    type: 'confirm',
    message,
    title: options.title || 'Please confirm',
    confirmLabel: options.confirmLabel || 'Continue',
    cancelLabel: options.cancelLabel || 'Cancel',
    tone: options.tone || 'default',
  }), [openDialog]);

  const prompt = useCallback((message, options = {}) => openDialog({
    type: 'prompt',
    message,
    title: options.title || 'Your response',
    inputLabel: options.inputLabel || 'Response',
    placeholder: options.placeholder || '',
    defaultValue: options.defaultValue || '',
    confirmLabel: options.confirmLabel || 'Submit',
    cancelLabel: options.cancelLabel || 'Cancel',
    tone: options.tone || 'default',
  }), [openDialog]);

  const resolveDialog = useCallback(result => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    resolve?.(result);
  }, []);

  useEffect(() => {
    if (!dialog) return undefined;

    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTarget = dialog.type === 'prompt' ? inputRef.current : cancelButtonRef.current;
    focusTarget?.focus();

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        resolveDialog(dialog.type === 'prompt' ? null : false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = [
        dialog.type === 'prompt' ? inputRef.current : null,
        cancelButtonRef.current,
        primaryButtonRef.current,
      ].filter(Boolean);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [dialog, resolveDialog]);

  const value = { confirm, prompt };

  return (
    <DialogContext.Provider value={value}>
      {children}
      {dialog && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              resolveDialog(dialog.type === 'prompt' ? null : false);
            }
          }}
        >
          <section
            role={dialog.type === 'confirm' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby={`app-dialog-title-${dialog.id}`}
            aria-describedby={`app-dialog-message-${dialog.id}`}
            className="w-full max-w-md border-2 border-zinc-700 bg-zinc-950 p-5 text-zinc-100 shadow-2xl sm:p-6"
          >
            <h2 id={`app-dialog-title-${dialog.id}`} className="text-sm font-black uppercase tracking-widest">
              {dialog.title}
            </h2>
            <p id={`app-dialog-message-${dialog.id}`} className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
              {dialog.message}
            </p>

            {dialog.type === 'prompt' && (
              <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-zinc-400">
                {dialog.inputLabel}
                <input
                  ref={inputRef}
                  autoComplete="off"
                  placeholder={dialog.placeholder}
                  value={inputValue}
                  onChange={event => setInputValue(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      resolveDialog(inputValue);
                    }
                  }}
                  className="mt-2 w-full border-2 border-zinc-700 bg-black px-3 py-2 text-sm text-white outline-none focus:border-white"
                />
              </label>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={() => resolveDialog(dialog.type === 'prompt' ? null : false)}
                className="border-2 border-zinc-700 px-4 py-2 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:border-zinc-400 hover:text-white"
              >
                {dialog.cancelLabel}
              </button>
              <button
                ref={primaryButtonRef}
                type="button"
                onClick={() => resolveDialog(dialog.type === 'prompt' ? inputValue : true)}
                className={`border-2 px-4 py-2 text-xs font-black uppercase tracking-wider ${
                  dialog.tone === 'danger'
                    ? 'border-red-600 bg-red-700 text-white hover:bg-red-600'
                    : 'border-white bg-white text-black hover:bg-zinc-200'
                }`}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      )}
    </DialogContext.Provider>
  );
}
