import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, SLOW_THRESHOLD_MS, SOCKET_PATH } from './config.js';

/**
 * Authenticated Socket.IO connection (LOCKED contract): io(API_URL, { auth: { token } }).
 * A bad/missing token makes the server refuse the handshake with connect_error
 * err.message === 'unauthorized'; we then stop and call onUnauthorized (treated as logged out).
 *
 * token = null -> no socket (status 'idle'). A new token tears down the old socket and opens a new one.
 * status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'unauthorized' | 'error'
 * hello: last { message: 'welcome', socketId, userId } from the server.
 * socket: the live Socket instance (or null), used by the chat store.
 * everConnected: connected at least once with this token (drives the Reconnecting… bar).
 */
export function useSocket(token, { onUnauthorized } = {}) {
  const [status, setStatus] = useState(token ? 'connecting' : 'idle');
  const [slow, setSlow] = useState(false);
  const [hello, setHello] = useState(null);
  const [transport, setTransport] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [socket, setSocket] = useState(null);
  // True once this token's socket has connected at least once (drives the "Reconnecting…" bar).
  const [everConnected, setEverConnected] = useState(false);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    setHello(null);
    setTransport(null);
    setLastError(null);
    setReconnectAttempt(0);
    setSlow(false);
    setEverConnected(false);
    if (!token) {
      setStatus('idle');
      setSocket(null);
      return undefined;
    }
    setStatus('connecting');

    const s = io(API_URL, {
      path: SOCKET_PATH,
      auth: { token },
      // Polling first then upgrade to websocket (Socket.IO default); survives proxies during cold start.
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 60000, // Render cold start can take ~50s
    });
    setSocket(s);

    const slowTimer = setTimeout(() => setSlow(true), SLOW_THRESHOLD_MS);
    const markTransport = () => setTransport(s.io.engine?.transport?.name ?? null);

    s.on('connect', () => {
      clearTimeout(slowTimer);
      setSlow(false);
      setStatus('connected');
      setEverConnected(true);
      setLastError(null);
      setReconnectAttempt(0);
      markTransport();
    });
    s.io.on('open', () => s.io.engine.on('upgrade', markTransport));
    s.on('hello', (payload) => setHello(payload));
    s.on('disconnect', (reason) => {
      setTransport(null);
      // Server-initiated disconnects are not auto-retried by Socket.IO. Reconnect once so the
      // handshake re-checks the token: a revoked/expired one then fails with 'unauthorized'.
      if (reason === 'io server disconnect') {
        setStatus('reconnecting');
        setLastError(`disconnected: ${reason}`);
        s.connect();
        return;
      }
      setStatus(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting');
      setLastError(`disconnected: ${reason}`);
    });
    s.on('connect_error', (err) => {
      const message = err?.message || String(err);
      setLastError(message);
      if (message === 'unauthorized') {
        // Server middleware refused the token; Socket.IO will not auto-retry this. Log out.
        clearTimeout(slowTimer);
        setStatus('unauthorized');
        s.disconnect();
        onUnauthorizedRef.current?.();
        return;
      }
      setStatus(s.active ? 'reconnecting' : 'error');
    });
    s.io.on('reconnect_attempt', (n) => {
      setReconnectAttempt(n);
      setStatus('reconnecting');
    });
    s.io.on('reconnect_failed', () => setStatus('error'));

    return () => {
      clearTimeout(slowTimer);
      s.removeAllListeners();
      s.io.removeAllListeners();
      s.disconnect();
      setSocket(null);
    };
  }, [token]);

  return { socket, status, slow, hello, transport, lastError, reconnectAttempt, everConnected };
}
