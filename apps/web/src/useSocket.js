import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, SLOW_THRESHOLD_MS, SOCKET_PATH } from './config.js';

/**
 * Socket.IO connection to the same origin as REST. https:// origin => wss:// upgrade.
 * status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'
 * hello: last { message: 'welcome', socketId } payload from the server.
 */
export function useSocket() {
  const [status, setStatus] = useState('connecting');
  const [slow, setSlow] = useState(false);
  const [hello, setHello] = useState(null);
  const [transport, setTransport] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  useEffect(() => {
    const socket = io(API_URL, {
      path: SOCKET_PATH,
      // Polling first then upgrade to websocket (Socket.IO default); survives proxies during cold start.
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 60000, // Render cold start can take ~50s
    });

    const slowTimer = setTimeout(() => setSlow(true), SLOW_THRESHOLD_MS);
    const markTransport = () => setTransport(socket.io.engine?.transport?.name ?? null);

    socket.on('connect', () => {
      clearTimeout(slowTimer);
      setSlow(false);
      setStatus('connected');
      setLastError(null);
      setReconnectAttempt(0);
      markTransport();
    });
    // Engine may upgrade polling -> websocket before or after 'connect'; track it from engine open.
    socket.io.on('open', () => socket.io.engine.on('upgrade', markTransport));
    socket.on('hello', (payload) => setHello(payload));
    socket.on('disconnect', (reason) => {
      setTransport(null);
      // 'io client disconnect' = we closed it; anything else Socket.IO will retry.
      setStatus(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting');
      setLastError(`disconnected: ${reason}`);
    });
    socket.on('connect_error', (err) => {
      setLastError(err.message || String(err));
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
  }, []);

  return { status, slow, hello, transport, lastError, reconnectAttempt };
}
