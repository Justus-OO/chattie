import React, { useRef } from 'react';
import { toast } from 'sonner';
import { X, Upload, BellOff, PhoneOff } from 'lucide-react';
import { useI18n } from '../../i18n';

export function MediaVaultModal({ isOpen, images, onClose, onSelect, isLoading, onUpload }) {
  const { t } = useI18n();
  const fileInputRef = useRef(null);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200" style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
        <div className="p-6 flex justify-between items-center shrink-0" style={{ backgroundColor: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Upload className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} /> {t('mediaVault')}
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{t('selectPhoto')}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full transition-colors" style={{ color: 'var(--text-secondary)' }}>
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6" style={{ backgroundColor: 'var(--surface)' }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button 
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="aspect-square border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-3 transition-colors"
              style={{ backgroundColor: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--surface-strong)' }}>
                <Upload className="w-5 h-5" />
              </div>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('uploadPhoto')}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  if (onUpload) onUpload(file);
                  else toast(t('uploadCallbackMissing'));
                  event.target.value = '';
                }
              }}
            />

            {isLoading ? (
              <div className="col-span-full flex items-center justify-center py-20">
                <div className="w-8 h-8 rounded-full border-4 border-white/20 border-t-white animate-spin"></div>
              </div>
            ) : images.length === 0 ? (
              <div className="col-span-full flex flex-col items-center justify-center py-20 text-center" style={{ color: 'var(--text-secondary)' }}>
                <Upload className="w-12 h-12 mb-4" />
                <p className="text-sm font-medium">{t('noVaultPhotos')}</p>
              </div>
            ) : (
              images.map((mediaObj) => (
                <button 
                  key={mediaObj.id || mediaObj.url}
                  onClick={() => onSelect(mediaObj.url || mediaObj.media_url, mediaObj)}
                  className="aspect-square rounded-2xl overflow-hidden group relative shadow-sm"
                  style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}
                >
                  <img src={mediaObj.url || mediaObj.media_url} alt={t('vaultItem')} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm" style={{ backgroundColor: 'rgba(24, 19, 16, 0.28)' }}>
                    <span className="text-sm font-bold px-5 py-2.5 rounded-full shadow-xl transform translate-y-4 group-hover:translate-y-0 transition-transform" style={{ backgroundColor: 'var(--surface-strong)', color: 'var(--text-primary)' }}>{t('send')}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DeleteConfirmModal({ isOpen, targetName, onClose, onConfirm }) {
  const { t } = useI18n();
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm p-6 rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 text-center" style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5 mx-auto" style={{ backgroundColor: 'rgba(210, 79, 116, 0.1)', border: '1px solid rgba(210, 79, 116, 0.2)' }}>
          <PhoneOff className="w-8 h-8" style={{ color: 'var(--accent)' }} />
        </div>
        <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>{t('deleteConversation')}</h3>
        <p className="text-sm mb-8 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {t('deleteConversation')} with <strong style={{ color: 'var(--text-primary)' }}>{targetName}</strong>?
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3.5 text-sm font-semibold rounded-xl transition-colors" style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-primary)' }}>{t('cancel')}</button>
          <button onClick={onConfirm} className="flex-1 py-3.5 text-sm font-semibold rounded-xl transition-colors shadow-lg" style={{ backgroundColor: 'var(--accent)', color: 'var(--surface-strong)' }}>{t('delete')}</button>
        </div>
      </div>
    </div>
  );
}

export function BlockUserModal({ isOpen, targetName, onClose, onBlock }) {
  const { t } = useI18n();
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm p-6 rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 text-center" style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5 mx-auto" style={{ backgroundColor: 'rgba(210, 79, 116, 0.1)', border: '1px solid rgba(210, 79, 116, 0.2)' }}>
          <BellOff className="w-8 h-8" style={{ color: 'var(--accent)' }} />
        </div>
        <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>{t('blockUser')}</h3>
        <p className="text-sm mb-8 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {t('blockDescription', { name: targetName })}
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3.5 text-sm font-semibold rounded-xl transition-colors" style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-primary)' }}>{t('cancel')}</button>
          <button onClick={onBlock} className="flex-1 py-3.5 text-sm font-semibold rounded-xl transition-colors shadow-lg" style={{ backgroundColor: 'var(--accent)', color: 'var(--surface-strong)' }}>{t('blockUser')}</button>
        </div>
      </div>
    </div>
  );
}
