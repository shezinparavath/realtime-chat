// Node smoke check against the backend the APK uses: GET /health + Socket.IO `hello`.
// Same approach as apps/web/scripts/check-connection.mjs, but websocket-only like the app.
// Usage: npm run check:live   (defaults to EXPO_PUBLIC_API_URL, else the Render URL)
// Sockets need a JWT since Phase 2. Without credentials the check expects the handshake to be
// refused with 'unauthorized'. With CHECK_IDENTIFIER + CHECK_PASSWORD set (an existing account; never
// commit them) it logs in and expects `hello` with that user's id.
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

const identifier = process.env.CHECK_IDENTIFIER;
const password = process.env.CHECK_PASSWORD;
let token = null;
let userId = null;
if (identifier && password) {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }), signal: AbortSignal.timeout(90000) });
  const body = await res.json().catch(() => ({}));
  console.log(`[login] HTTP ${res.status}`, body.user ? `as @${body.user.username}` : body.error);
  token = body.token || null;
  userId = body.user?.id || null;
}

const helloOk = await new Promise((resolve) => {
  const socket = io(base, { path: '/socket.io', transports: ['websocket'], timeout: 60000, reconnection: false, auth: token ? { token } : {} });
  const timer = setTimeout(() => { console.error('[socket] timed out waiting for hello'); socket.close(); resolve(false); }, 60000);
  socket.on('connect_error', (err) => {
    clearTimeout(timer);
    socket.close();
    if (!token && err.message === 'unauthorized') {
      console.log('[socket] refused without a token (unauthorized), as the contract requires');
      resolve(true);
      return;
    }
    console.error('[socket] connect_error', err.message);
    resolve(false);
  });
  socket.on('hello', (payload) => {
    console.log('[socket] hello', payload, 'transport:', socket.io.engine.transport.name);
    const ok = payload?.message === 'welcome' && payload?.socketId === socket.id && (!userId || payload?.userId === userId);
    clearTimeout(timer); socket.close(); resolve(ok);
  });
});

console.log(`health contract: ${healthOk ? 'PASS' : 'FAIL'}; socket ${token ? 'hello (authenticated)' : 'auth enforced'}: ${helloOk ? 'PASS' : 'FAIL'}`);
process.exit(healthOk && helloOk ? 0 : 1);
