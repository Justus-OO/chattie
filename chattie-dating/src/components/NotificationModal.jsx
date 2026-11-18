import React, { useEffect, useState } from 'react';
import {
  Bell, Check, CheckCheck, ChevronRight, Heart, MessageCircle,
  RefreshCw, ShieldAlert, Trash2, X
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { notificationsService } from '../api/notifications.service';
import { useI18n } from '../i18n';

const iconMap = {
  heart: Heart,
  chat: MessageCircle,
  warning: ShieldAlert,
  bell: Bell,
  check: Check
};

export default function NotificationModal() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const loadNotifications = async () => {
      setIsLoading(true);
      setLoadError(false);
      try {
        const items = await notificationsService.list();
        setNotifications(items);
        setSelectedId((currentId) => currentId || items[0]?.id || null);
      } catch {
        setLoadError(true);
      } finally {
        setIsLoading(false);
      }
    };

    loadNotifications();
  }, []);

  const selectedNotification = notifications.find((item) => item.id === selectedId) || notifications[0];
  const unreadCount = notifications.filter((item) => !item.read).length;
  const markRead = async (notification) => {
    if (notification.read) return;
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item));
    try {
      await notificationsService.markRead(notification.id);
    } catch (error) {
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read: false } : item));
      toast.error(error.response?.data?.error || 'Could not mark this notification as read.');
    }
  };

  const selectNotification = (notification) => {
    setSelectedId(notification.id);
    markRead(notification);
  };

  const markAllRead = async () => {
    const previousNotifications = notifications;
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    try {
      await notificationsService.markAllRead();
    } catch (error) {
      setNotifications(previousNotifications);
      toast.error(error.response?.data?.error || 'Could not mark notifications as read.');
    }
  };

  const removeNotification = async (notification) => {
    const previousNotifications = notifications;
    setNotifications((current) => current.filter((item) => item.id !== notification.id));
    const nextNotification = notifications.find((item) => item.id !== notification.id);
    setSelectedId(nextNotification?.id || null);
    try {
      await notificationsService.remove(notification.id);
    } catch (error) {
      setNotifications(previousNotifications);
      setSelectedId(notification.id);
      toast.error(error.response?.data?.error || 'Could not delete this notification.');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col p-3 sm:p-6" aria-labelledby="notification-modal-title">
      <section className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-strong)' }}>
        <header className="flex shrink-0 items-center justify-between border-b px-5 py-4 sm:px-7" style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)' }}>
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center border" style={{ color: 'var(--accent)', backgroundColor: 'var(--accent-soft)', borderColor: 'rgba(210, 79, 116, 0.25)' }}>
                <Bell className="h-4 w-4" />
              </div>
              <div>
                <h2 id="notification-modal-title" className="text-base font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{t('notifications')}</h2>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>{unreadCount ? t('unreadUpdates', { count: unreadCount, suffix: unreadCount === 1 ? '' : 's' }) : t('allCaughtUp')}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} className="hidden items-center gap-2 border px-3 py-2 text-xs font-semibold transition-colors sm:flex" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
                <CheckCheck className="h-3.5 w-3.5" /> {t('markAllRead')}
              </button>
            )}
            <button type="button" onClick={() => navigate('/rooms')} className="flex h-9 w-9 items-center justify-center border transition-colors" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }} aria-label={`${t('close')} ${t('notifications').toLowerCase()}`}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex min-h-0 w-full flex-col border-b md:w-[38%] md:border-b-0 md:border-r" style={{ backgroundColor: 'var(--surface-alt)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
              <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>{t('activity')}</span>
              <button type="button" onClick={async () => {
                setIsLoading(true);
                setLoadError(false);
                try {
                  const items = await notificationsService.list();
                  setNotifications(items);
                  setSelectedId((currentId) => currentId || items[0]?.id || null);
                } catch (error) {
                  setLoadError(true);
                  toast.error(error.response?.data?.error || 'Could not refresh notifications.');
                } finally {
                  setIsLoading(false);
                }
              }} className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }} title={t('refresh')}>
                <RefreshCw className="h-3 w-3" /> {t('refresh')}
              </button>
            </div>
            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex h-[min(35dvh,20rem)] items-center justify-center" style={{ color: 'var(--text-muted)' }}><RefreshCw className="h-5 w-5 animate-spin" /></div>
              ) : loadError ? (
                <div className="px-5 py-12 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>{t('unableLoadNotifications')}</div>
              ) : notifications.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>{t('noNotifications')}</div>
              ) : notifications.map((notification) => {
                const Icon = iconMap[notification.icon] || Bell;
                const isSelected = notification.id === selectedNotification?.id;
                return (
                  <button key={notification.id} type="button" onClick={() => selectNotification(notification)} className="flex w-full gap-3 border-b p-4 text-left transition-colors" style={{ backgroundColor: isSelected ? 'var(--surface-strong)' : 'transparent', borderColor: 'var(--border)' }}>
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border" style={{ color: notification.read ? 'var(--text-muted)' : 'var(--accent)', backgroundColor: notification.read ? 'var(--surface)' : 'var(--accent-soft)', borderColor: notification.read ? 'var(--border)' : 'rgba(210, 79, 116, 0.25)' }}><Icon className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2"><strong className="truncate text-xs" style={{ color: 'var(--text-primary)' }}>{notification.title}</strong>{!notification.read && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />}</span>
                      <span className="mt-1 block truncate text-xs" style={{ color: 'var(--text-secondary)' }}>{notification.message}</span>
                      <span className="mt-2 block text-[10px]" style={{ color: 'var(--text-muted)' }}>{notification.time}</span>
                    </span>
                    {isSelected && <ChevronRight className="mt-2 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent)' }} />}
                  </button>
                );
              })}
            </div>
          </div>

          <article className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8" style={{ backgroundColor: 'var(--surface)' }}>
            {selectedNotification ? (
              <div className="mx-auto max-w-2xl">
                <div className="mb-8 flex items-start justify-between gap-4">
                  <div>
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--accent)' }}>{t('notificationDetail')}</p>
                    <h3 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{selectedNotification.title}</h3>
                    <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>{selectedNotification.time}</p>
                  </div>
                  <button type="button" onClick={() => removeNotification(selectedNotification)} className="flex h-9 w-9 shrink-0 items-center justify-center border transition-colors" style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }} title={t('deleteNotification')} aria-label={t('deleteNotification')}><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="border-l-2 py-1 pl-5" style={{ borderColor: 'var(--accent)' }}>
                  <p className="text-base leading-8" style={{ color: 'var(--text-secondary)' }}>{selectedNotification.message}</p>
                </div>
                <div className="mt-12 flex items-center gap-2 border-t pt-5 text-xs" style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
                  <Check className="h-3.5 w-3.5" /> {selectedNotification.read ? t('read') : t('markedRead')}
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center" style={{ color: 'var(--text-muted)' }}>
                <Bell className="mb-4 h-8 w-8" />
                <p className="text-sm">{t('selectNotification')}</p>
              </div>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}
