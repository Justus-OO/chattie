import { apiClient } from './client';

// Helper to check if a string is a valid UUIDv4 format
const isUUID = (str) => {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

const normalizeNotification = (notification = {}, fallback = {}) => {
  const source = notification ?? {};
  
  // Prefer real backend IDs. Only use fallback if absolutely necessary.
  const id = source.id ?? source.notification_id ?? source.notificationId ?? fallback.id ?? null;
  const hasRealId = isUUID(id);
  
  const finalId = hasRealId ? id : `local-${source.title ?? source.event_type ?? 'alert'}-${Date.now()}`;
  const title = source.title ?? source.event_title ?? fallback.title ?? 'New alert';
  const message = source.message ?? source.body ?? source.description ?? fallback.message ?? 'You have a new notification.';
  const createdAt = source.created_at ?? source.createdAt ?? source.timestamp ?? null;
  const read = source.read ?? source.is_read ?? source.isRead ?? false;
  const icon = source.icon ?? source.event_icon ?? source.type ?? fallback.icon ?? 'bell';

  return {
    ...source,
    id: finalId,
    isRealDatabaseId: hasRealId, // Flag so we know if we can sync with backend
    title,
    message,
    icon,
    read: Boolean(read),
    time: createdAt ? new Date(createdAt).toLocaleString() : source.time ?? fallback.time ?? 'Just now',
    created_at: createdAt ?? source.created_at ?? null,
  };
};

export const notificationsService = {
  normalize: normalizeNotification,
  
  normalizeList: (data) => Array.isArray(data) ? data.map((item) => normalizeNotification(item)) : [],
  
  fromSocket: (event) => {
    const incoming = event && typeof event === 'object' ? event : {};
    const payload = incoming.data || incoming;
    const action = String(incoming.type || payload.type || '').toUpperCase();
    
    const icon = action.includes('LIKE') || action.includes('INTERACTION') ? 'heart'
      : action.includes('MESSAGE') ? 'chat'
      : action.includes('ROOM') ? 'check'
      : 'check';
      
    const title = action === 'NEW_INTERACTION'
      ? 'New interaction'
      : action === 'MESSAGE' || action === 'NEW_MESSAGE'
        ? 'New message'
        : action.replaceAll('_', ' ') || 'New notification';
        
    const message = payload.message || incoming.message || (payload.type ? `${payload.type.replaceAll('_', ' ')} received` : 'You have a new notification');

    // Check if socket packet provided a real backend UUID
    const serverId = payload.notification_id || incoming.notification_id || payload.id || incoming.id;
    const hasRealId = isUUID(serverId);

    return {
      id: hasRealId ? serverId : `socket-${Date.now()}`,
      isRealDatabaseId: hasRealId,
      title,
      message,
      time: 'Just now',
      read: false,
      icon,
      created_at: new Date().toISOString(),
      payload: payload.payload || payload
    };
  },

  list: async () => {
    const { data } = await apiClient.get('/notifications');
    return notificationsService.normalizeList(data);
  },

  markRead: async (id) => {
    // GUARD: If it's a local/socket notification without a real database UUID, don't call the API!
    if (!isUUID(id)) {
      console.warn(`[NOTIF] Skipping backend markRead for local-only ID: ${id}`);
      return { status: 'skipped_local_only' };
    }
    return apiClient.patch(`/notifications/${id}/read`);
  },

  markAllRead: async () => {
    return apiClient.patch('/notifications/read');
  },

  remove: async (id) => {
    // GUARD: If it's local-only, just let frontend state delete it without throwing a 500
    if (!isUUID(id)) {
      console.warn(`[NOTIF] Skipping backend delete for local-only ID: ${id}`);
      return { status: 'skipped_local_only' };
    }
    return apiClient.delete(`/notifications/${id}`);
  }
};