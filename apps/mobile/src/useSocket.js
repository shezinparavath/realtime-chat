import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, API_URL_MISSING, SLOW_THRESHOLD_MS, SOCKET_PATH, SOCKET_TIMEOUT_MS } from './config';

/**
 * Socket.IO connection to the same origin as REST. https:// origin => wss://.
 * status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'
 * hello: last { message: 'welcome', socketId } payload from the server.
 * Mirrors apps/web/src/useSocket.js, except transports = ['websocket'] (see handoff RTC-P1-03).
 */
export function useSocket() {
  const [status, setStatus] = useState('connecting');
  const [slow, setSlow] = useState(false);
  const [hello, setHello] = useState(null);
  const [transport, setTransport] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [session, setSession] = useState(0);

  useEffect(() => {
    if (API_URL_MISSING) return undefined;
    setStatus('connecting');
    setSlow(false);
    setLastError(null);
    setReconnectAttempt(0);

    const socket = io(API_URL, {
      path: SOCKET_PATH,
      // React Native has a native WebSocket; skip XHR long-polling (no sticky-session/upgrade
      // dance, no RN XHR quirks). CORS does not apply to native apps.
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: SOCKET_TIMEOUT_MS, // Render cold start can take ~50s
    });

    const slowTimer = setTimeout(() => setSlow(true), SLOW_THRESHOLD_MS);

    socket.on('connect', () => {
      clearTimeout(slowTimer);
      setSlow(false);
      setStatus('connected');
      setLastError(null);
      setReconnectAttempt(0);
      setTransport(socket.io.engine?.transport?.name ?? null);
    });
    socket.on('hello', (payload) => setHello(payload));
    socket.on('disconnect', (reason) => {
      setTransport(null);
      // 'io client disconnect' = we closed it; anything else Socket.IO will retry.
      setStatus(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting');
      setLastError(`disconnected: ${reason}`);
    });
    socket.on('connect_error', (err) => {
      setLastError(err?.message || String(err));
      setStatus(socket.active ? 'reconnecting' : 'error');
    });
    socket.io.on('reconnect_attempt', (n) => {
      setReconnectAttempt(n);
      setStatus('reconnecting');
    });
    socket.io.on('reconnect_failed', () => setStatus('error'));

    return () => {
      clearTimeout(slowTimer);
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
    };
  }, [session]);

  // Fresh socket (only offered in UI for 'error' / 'disconnected').
  const reconnect = useCallback(() => setSession((n) => n + 1), []);
  return { status, slow, hello, transport, lastError, reconnectAttempt, reconnect };
}
