// Node smoke check against a backend: GET /health + Socket.IO `hello`.
// Usage: VITE_API_URL=https://realtime-chat-qi6q.onrender.com npm run check:live
// (Node does not enforce CORS; browser check from the Vercel origin is separate.)
import { io } from 'socket.io-client';

const base = (process.env.VITE_API_URL || '').replace(/\/+$/, '');
if (!base) {
  console.error('Set VITE_API_URL');
  process.exit(2);
}

const t0 = Date.now();
const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(90000) });
const body = await res.json();
console.log(`[health] HTTP ${res.status} in ${Date.now() - t0}ms`, body);
const healthOk = res.status === 200 && body.status === 'ok' && typeof body.uptime === 'number' &&
  ['connected', 'disconnected', 'not_configured'].includes(body.db);

const helloOk = await new Promise((resolve) => {
  const socket = io(base, { path: '/socket.io', transports: ['polling', 'websocket'], timeout: 60000, reconnection: false });
  const timer = setTimeout(() => { console.error('[socket] timed out waiting for hello'); socket.close(); resolve(false); }, 60000);
  socket.on('connect_error', (err) => { console.error('[socket] connect_error', err.message); clearTimeout(timer); socket.close(); resolve(false); });
  socket.on('hello', (payload) => {
    console.log('[socket] hello', payload, 'transport:', socket.io.engine.transport.name);
    const ok = payload?.message === 'welcome' && payload?.socketId === socket.id;
    socket.io.engine.once('upgrade', (t) => console.log('[socket] upgraded to', t.name));
    setTimeout(() => {
      console.log('[socket] transport after 1.5s:', socket.io.engine.transport.name);
      clearTimeout(timer); socket.close(); resolve(ok);
    }, 1500);
  });
});

console.log(`health contract: ${healthOk ? 'PASS' : 'FAIL'}; hello contract: ${helloOk ? 'PASS' : 'FAIL'}`);
process.exit(healthOk && helloOk ? 0 : 1);
