// Node smoke check against the backend the APK uses: GET /health + Socket.IO `hello`.
// Same approach as apps/web/scripts/check-connection.mjs, but websocket-only like the app.
// Usage: npm run check:live   (defaults to EXPO_PUBLIC_API_URL, else the Render URL)
import { io } from 'socket.io-client';

const base = (process.env.EXPO_PUBLIC_API_URL || 'https://realtime-chat-qi6q.onrender.com').trim().replace(/\/+$/, '');
console.log(`[check] backend ${base}`);

const t0 = Date.now();
let healthOk = false;
try {
  const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(90000) });
  const body = await res.json();
  console.log(`[health] HTTP ${res.status} in ${Date.now() - t0}ms`, body);
  healthOk = res.status === 200 && body.status === 'ok' && typeof body.uptime === 'number' &&
    ['connected', 'disconnected', 'not_configured'].includes(body.db);
} catch (err) {
  console.error('[health] failed', err.message);
}

const helloOk = await new Promise((resolve) => {
  const socket = io(base, { path: '/socket.io', transports: ['websocket'], timeout: 60000, reconnection: false });
  const timer = setTimeout(() => { console.error('[socket] timed out waiting for hello'); socket.close(); resolve(false); }, 60000);
  socket.on('connect_error', (err) => { console.error('[socket] connect_error', err.message); clearTimeout(timer); socket.close(); resolve(false); });
  socket.on('hello', (payload) => {
    console.log('[socket] hello', payload, 'transport:', socket.io.engine.transport.name);
    const ok = payload?.message === 'welcome' && payload?.socketId === socket.id;
    clearTimeout(timer); socket.close(); resolve(ok);
  });
});

console.log(`health contract: ${healthOk ? 'PASS' : 'FAIL'}; hello contract: ${helloOk ? 'PASS' : 'FAIL'}`);
process.exit(healthOk && helloOk ? 0 : 1);
