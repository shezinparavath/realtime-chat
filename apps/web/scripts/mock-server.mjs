// DEV-ONLY mock of the LOCKED Phase 2 + 3 backend contract (context/interface-contracts.md), for
// building/testing the web client before the real server ships. In-memory; restart = empty.
// Never imported by src/, so it is not part of the Vite production bundle.
//
//   npm run mock                       # http://localhost:4100
//   MOCK_PORT=4100 MOCK_LATENCY_MS=5000 npm run mock   # simulate a slow / cold server
//   MOCK_SEED=1 npm run mock           # seed users alice, alicia, bob (password: password123)
//
// Test hooks (mock only, not part of the contract):
//   POST /__mock/revoke-tokens   rotates the signing secret -> every existing token now 401s
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
const newId = () => crypto.randomBytes(12).toString('hex'); // looks like a Mongo ObjectId
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex'); // mock stand-in for bcrypt
const publicUser = (u) => ({ id: u.id, username: u.username });
const selfUser = (u) => ({ id: u.id, email: u.email, username: u.username });
const chatView = (c) => ({
  id: c.id,
  participants: c.participantIds.map((id) => publicUser(users.get(id))),
  lastMessage: c.lastMessage,
  updatedAt: c.updatedAt,
});

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

  // GET /chats/:id/messages — P3; mock returns an empty page with participant checks.
  const mm = /^\/chats\/([^/]+)\/messages$/.exec(pathname);
  if (req.method === 'GET' && mm) {
    const me = requireAuth(req);
    const c = chats.get(mm[1]);
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'Chat not found');
    if (!c.participantIds.includes(me.id)) throw new HttpError(403, 'FORBIDDEN', 'Not a participant of this chat');
    return send(res, 200, { messages: [], hasMore: false });
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
  socket.data.userId = claims.sub;
  next();
});
io.on('connection', (socket) => {
  const userId = socket.data.userId;
  socket.join(`user:${userId}`);
  socket.emit('hello', { message: 'welcome', socketId: socket.id, userId });
  console.log(`[socket] connected ${socket.id} user ${userId}`);
  socket.on('message:send', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const c = chats.get(payload?.chatId);
    if (!c || !c.participantIds.includes(userId)) return reply({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a participant of this chat' } });
    const text = typeof payload?.text === 'string' ? payload.text : '';
    if (!text.trim()) return reply({ ok: false, error: { code: 'MESSAGE_EMPTY', message: 'Message cannot be empty' } });
    if (text.length > MAX_MESSAGE_LENGTH) return reply({ ok: false, error: { code: 'MESSAGE_TOO_LONG', message: `Max ${MAX_MESSAGE_LENGTH} characters` } });
    const message = { id: newId(), chatId: c.id, senderId: userId, text, createdAt: new Date().toISOString() };
    c.lastMessage = message;
    c.updatedAt = message.createdAt;
    reply({ ok: true, message });
    for (const pid of c.participantIds) io.to(`user:${pid}`).emit('message:new', { message, chat: chatView(c) });
  });
});

server.listen(PORT, () => console.log(`[mock] contract mock listening on http://localhost:${PORT}${LATENCY ? ` (latency ${LATENCY}ms)` : ''}`));
