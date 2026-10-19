// DEV-ONLY mock of the LOCKED Phase 2 + 3 backend contract (context/interface-contracts.md), for
// building/testing the web client before the real server ships. In-memory; restart = empty.
// Never imported by src/, so it is not part of the Vite production bundle.
//
//   npm run mock                       # http://localhost:4100
//   MOCK_PORT=4100 MOCK_LATENCY_MS=5000 npm run mock   # simulate a slow / cold server
//   MOCK_SEED=1 npm run mock           # seed users alice, alicia, bob (password: password123)
//
// Test hooks (mock only, NOT part of the contract; all under /__mock):
//   POST /__mock/reset              wipe all users/chats/messages (back to a clean state)
//   POST /__mock/revoke-tokens      rotate the signing secret -> every existing token now 401s
//   POST /__mock/config             { dropAcks, ackDelayMs, emitDelayMs, suppressEmit } fault injection
//                                   for message:send (all default off)
//   POST /__mock/block-user         { username, blocked } drop that user's sockets and close new
//                                   transports before CONNECT (simulated outage) -> client keeps retrying
//   POST /__mock/bulk-messages      { chatId, username, count } insert count messages from username
import http from 'node:http';
import crypto from 'node:crypto';
import { Server } from 'socket.io';

const PORT = Number(process.env.MOCK_PORT || 4100);
const LATENCY = Number(process.env.MOCK_LATENCY_MS || 0);
const MAX_MESSAGE_LENGTH = 2000;
let secret = crypto.randomBytes(32);
const startedAt = Date.now();

// ---------- JWT HS256 (claims { sub, username }, exp 7d) ----------
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function signJwt(user) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(JSON.stringify({ sub: user.id, username: user.username, iat: now, exp: now + 7 * 24 * 3600 }));
  const sig = b64u(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}
function verifyJwt(token) {
  if (typeof token !== 'string') return null;
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  const expected = b64u(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest());
  if (s.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
  try {
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (claims.exp * 1000 < Date.now()) return null;
    return users.get(claims.sub) ? claims : null;
  } catch {
    return null;
  }
}

// ---------- store ----------
const users = new Map(); // id -> { id, email, username, passwordHash, salt }
const chats = new Map(); // id -> { id, participantIds:[a,b], lastMessage, createdAt, updatedAt }
const messages = new Map(); // chatId -> [Message] in insert (_id) order
const blockedUsers = new Set();
let faults = { dropAcks: false, ackDelayMs: 0, emitDelayMs: 0, suppressEmit: false };
// ObjectId-like: 4-byte seconds + 5 random bytes + 3-byte counter -> monotonic per insert (ruling P3-11).
const idRandom = crypto.randomBytes(5).toString('hex');
let idCounter = crypto.randomInt(0xffffff);
const newId = () => {
  idCounter = (idCounter + 1) % 0x1000000;
  return Math.floor(Date.now() / 1000).toString(16).padStart(8, '0') + idRandom + idCounter.toString(16).padStart(6, '0');
};
const isId = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/.test(v);
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex'); // mock stand-in for bcrypt
const publicUser = (u) => ({ id: u.id, username: u.username });
const selfUser = (u) => ({ id: u.id, email: u.email, username: u.username });
const chatView = (c) => ({
  id: c.id,
  participants: c.participantIds.map((id) => publicUser(users.get(id))),
  lastMessage: c.lastMessage,
  updatedAt: c.updatedAt,
});

function saveMessage(c, senderId, text, clientId) {
  const message = { id: newId(), chatId: c.id, senderId, text, clientId: clientId ?? null, createdAt: new Date().toISOString() };
  if (!messages.has(c.id)) messages.set(c.id, []);
  messages.get(c.id).push(message);
  c.lastMessage = message;
  c.updatedAt = message.createdAt;
  return message;
}

function createUser({ email, username, password }) {
  const salt = crypto.randomBytes(8).toString('hex');
  const u = { id: newId(), email, username, salt, passwordHash: hash(password, salt) };
  users.set(u.id, u);
  return u;
}
if (process.env.MOCK_SEED) {
  for (const n of ['alice', 'alicia', 'bob']) createUser({ email: `${n}@example.com`, username: n, password: 'password123' });
}

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, code, message, field) {
    super(message);
    Object.assign(this, { status, code, field });
  }
}
const vErr = (field, message) => new HttpError(400, 'VALIDATION_ERROR', message, field);
const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}
async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw vErr(undefined, 'Body must be valid JSON');
  }
}
function requireAuth(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const claims = m && verifyJwt(m[1]);
  if (!claims) throw new HttpError(401, 'UNAUTHORIZED', 'Missing, invalid or expired token');
  return users.get(claims.sub);
}

// ---------- routes ----------
async function route(req, res, url) {
  const { pathname } = url;
  const key = `${req.method} ${pathname}`;

  if (key === 'GET /health') return send(res, 200, { status: 'ok', uptime: Math.floor((Date.now() - startedAt) / 1000), db: 'connected' });

  if (key === 'POST /__mock/reset') {
    users.clear();
    chats.clear();
    messages.clear();
    blockedUsers.clear();
    faults = { dropAcks: false, ackDelayMs: 0, emitDelayMs: 0, suppressEmit: false };
    for (const s of io.of('/').sockets.values()) s.disconnect(true);
    return send(res, 200, { ok: true });
  }
  if (key === 'POST /__mock/config') {
    const b = await readJson(req);
    faults = { ...faults, ...b };
    return send(res, 200, { faults });
  }
  if (key === 'POST /__mock/block-user') {
    const { username, blocked = true } = await readJson(req);
    const u = [...users.values()].find((x) => x.username === username);
    if (!u) throw new HttpError(404, 'NOT_FOUND', 'No such user');
    if (blocked) {
      blockedUsers.add(u.id);
      // Close the transport (not a server-side "disconnect") so the client auto-reconnects.
      for (const s of io.of('/').sockets.values()) if (s.data.userId === u.id) s.conn.close();
    } else blockedUsers.delete(u.id);
    return send(res, 200, { ok: true, blocked });
  }
  if (key === 'POST /__mock/bulk-messages') {
    const { chatId, username, count = 1 } = await readJson(req);
    const u = [...users.values()].find((x) => x.username === username);
    const c = chats.get(chatId);
    if (!u || !c) throw new HttpError(404, 'NOT_FOUND', 'No such user/chat');
    for (let i = 1; i <= count; i++) saveMessage(c, u.id, `bulk ${i}`, null);
    return send(res, 200, { ok: true, count: messages.get(chatId).length });
  }

  if (key === 'POST /__mock/revoke-tokens') {
    secret = crypto.randomBytes(32);
    for (const s of io.of('/').sockets.values()) s.disconnect(true);
    return send(res, 200, { ok: true });
  }

  if (key === 'POST /auth/signup') {
    const b = await readJson(req);
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw vErr('email', 'A valid email is required');
    if (!USERNAME_RE.test(username)) throw vErr('username', 'Username must be 3–20 characters: a–z, 0–9, _ or .');
    if (password.length < 8 || password.length > 128) throw vErr('password', 'Password must be 8–128 characters');
    for (const u of users.values()) {
      if (u.email === email) throw new HttpError(409, 'EMAIL_TAKEN', 'That email is already registered', 'email');
      if (u.username === username) throw new HttpError(409, 'USERNAME_TAKEN', 'That username is taken', 'username');
    }
    const u = createUser({ email, username, password });
    return send(res, 201, { token: signJwt(u), user: selfUser(u) });
  }

  if (key === 'POST /auth/login') {
    const b = await readJson(req);
    const identifier = typeof b.identifier === 'string' ? b.identifier.trim().toLowerCase() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    if (!identifier) throw vErr('identifier', 'Email or username is required');
    if (!password) throw vErr('password', 'Password is required');
    const byEmail = identifier.includes('@');
    const u = [...users.values()].find((x) => (byEmail ? x.email : x.username) === identifier);
    if (!u || hash(password, u.salt) !== u.passwordHash) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email/username or password');
    return send(res, 200, { token: signJwt(u), user: selfUser(u) });
  }

  if (key === 'GET /auth/me') return send(res, 200, { user: selfUser(requireAuth(req)) });

  if (key === 'GET /users/search') {
    const me = requireAuth(req);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    if (!q) return send(res, 200, { users: [] });
    const found = [...users.values()].filter((u) => u.id !== me.id && u.username.startsWith(q)).sort((a, b) => a.username.localeCompare(b.username)).slice(0, 20);
    return send(res, 200, { users: found.map(publicUser) });
  }

  if (key === 'POST /chats') {
    const me = requireAuth(req);
    const { userId } = await readJson(req);
    if (typeof userId !== 'string' || !/^[a-f0-9]{24}$/i.test(userId)) throw vErr('userId', 'userId must be a valid id');
    if (userId === me.id) throw vErr('userId', 'You cannot start a chat with yourself');
    if (!users.has(userId)) throw new HttpError(404, 'NOT_FOUND', 'User not found');
    const existing = [...chats.values()].find((c) => c.participantIds.includes(me.id) && c.participantIds.includes(userId));
    if (existing) return send(res, 200, { chat: chatView(existing) });
    const now = new Date().toISOString();
    const c = { id: newId(), participantIds: [me.id, userId], lastMessage: null, createdAt: now, updatedAt: now };
    chats.set(c.id, c);
    return send(res, 201, { chat: chatView(c) });
  }

  if (key === 'GET /chats') {
    const me = requireAuth(req);
    const mine = [...chats.values()].filter((c) => c.participantIds.includes(me.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return send(res, 200, { chats: mine.map(chatView) });
  }

  // GET /chats/:id/messages?before=&limit= (contract + rulings P3-2, P3-9..P3-11, round 2 #3)
  const mm = /^\/chats\/([^/]+)\/messages$/.exec(pathname);
  if (req.method === 'GET' && mm) {
    const me = requireAuth(req);
    const chatId = decodeURIComponent(mm[1]);
    if (!isId(chatId)) throw vErr('id', 'Invalid chat id');
    const c = chats.get(chatId);
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'Chat not found');
    if (!c.participantIds.includes(me.id)) throw new HttpError(403, 'FORBIDDEN', 'Not a participant of this chat');
    const n = parseInt(url.searchParams.get('limit'), 10);
    const limit = Number.isNaN(n) ? 30 : Math.min(50, Math.max(1, n));
    const all = messages.get(chatId) || [];
    let end = all.length;
    const before = url.searchParams.get('before');
    if (before !== null) {
      if (!isId(before)) throw vErr('before', 'Invalid before cursor');
      end = all.findIndex((m) => m.id === before);
      if (end === -1) throw vErr('before', 'before is not a message in this chat');
    }
    const start = Math.max(0, end - limit);
    return send(res, 200, { messages: all.slice(start, end), hasMore: start > 0 });
  }

  throw new HttpError(404, 'NOT_FOUND', `No route ${req.method} ${pathname}`);
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/socket.io')) return; // handled by socket.io
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  if (LATENCY) await new Promise((r) => setTimeout(r, LATENCY));
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    await route(req, res, url);
  } catch (err) {
    if (err instanceof HttpError) {
      const error = { code: err.code, message: err.message };
      if (err.field) error.field = err.field;
      return send(res, err.status, { error });
    }
    console.error(err);
    send(res, 500, { error: { code: 'SERVER_ERROR', message: 'Internal error' } });
  }
  console.log(`${req.method} ${req.url} -> ${res.statusCode}`);
});

const io = new Server(server, { path: '/socket.io', cors: { origin: true, credentials: true } });
io.use((socket, next) => {
  const claims = verifyJwt(socket.handshake.auth?.token);
  if (!claims) return next(new Error('unauthorized'));
  // Blocked (test hook): kill the transport before CONNECT so the client's Manager keeps retrying,
  // like a network outage. (A middleware error would stop client reconnection.)
  if (blockedUsers.has(claims.sub)) return socket.conn.close();
  socket.data.userId = claims.sub;
  next();
});
io.on('connection', (socket) => {
  const userId = socket.data.userId;
  socket.join(`user:${userId}`);
  socket.emit('hello', { message: 'welcome', socketId: socket.id, userId });
  console.log(`[socket] connected ${socket.id} user ${userId}`);
  // message:send { chatId, text, clientId } (contract + rulings P3-1..P3-5, round 2 #1)
  socket.on('message:send', async (payload, ack) => {
    let reply = typeof ack === 'function' ? ack : () => {};
    if (faults.dropAcks) reply = () => {};
    else if (faults.ackDelayMs) {
      const r = reply;
      reply = (body) => setTimeout(() => r(body), faults.ackDelayMs);
    }
    const fail = (code, message) => reply({ ok: false, error: { code, message } });
    if (!payload || typeof payload !== 'object' || !isId(payload.chatId)) return fail('VALIDATION_ERROR', 'Invalid chatId');
    const c = chats.get(payload.chatId);
    if (!c || !c.participantIds.includes(userId)) return fail('FORBIDDEN', 'Not a participant of this chat');
    const { text, clientId } = payload;
    if (typeof text !== 'string') return fail('VALIDATION_ERROR', 'text must be a string');
    if (!text.trim()) return fail('MESSAGE_EMPTY', 'Message cannot be empty');
    if (text.length > MAX_MESSAGE_LENGTH) return fail('MESSAGE_TOO_LONG', `Max ${MAX_MESSAGE_LENGTH} characters`);
    if (clientId !== undefined && clientId !== null && (typeof clientId !== 'string' || clientId.length > 64))
      return fail('VALIDATION_ERROR', 'clientId must be a string of at most 64 chars');
    if (clientId) {
      // Idempotent: same (senderId, clientId) -> ack the existing message, no save, no re-emit.
      const existing = (messages.get(c.id) || []).find((m) => m.senderId === userId && m.clientId === clientId);
      if (existing) return reply({ ok: true, message: existing });
    }
    const message = saveMessage(c, userId, text, clientId);
    reply({ ok: true, message });
    if (faults.suppressEmit) return;
    const emit = () => { for (const pid of c.participantIds) io.to(`user:${pid}`).emit('message:new', { message, chat: chatView(c) }); };
    if (faults.emitDelayMs) setTimeout(emit, faults.emitDelayMs);
    else emit();
  });
});

server.listen(PORT, () => console.log(`[mock] contract mock listening on http://localhost:${PORT}${LATENCY ? ` (latency ${LATENCY}ms)` : ''}`));
