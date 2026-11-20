const DEFAULT_PRODUCTION_API_URL = 'https://chattie-server-pp6p.onrender.com/api';
const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

export const API_BASE_URL = (
  configuredApiUrl || DEFAULT_PRODUCTION_API_URL
).replace(/\/+$/, '');

const apiOrigin = new URL(API_BASE_URL).origin;
const configuredWebSocketUrl = import.meta.env.VITE_WS_URL?.trim();
const inferredWebSocketUrl = `${apiOrigin.replace(/^http/, 'ws')}/ws`;

export const WEBSOCKET_URL = (
  configuredWebSocketUrl || inferredWebSocketUrl
).replace(/^https:/, 'wss:').replace(/^http:/, 'ws:').replace(/\/+$/, '');

export const SOCKJS_URL = WEBSOCKET_URL
  .replace(/^wss:/, 'https:')
  .replace(/^ws:/, 'http:');

export const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL?.trim() || '';
