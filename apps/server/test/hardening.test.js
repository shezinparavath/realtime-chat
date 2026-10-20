'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const request = require('supertest');
const { startServer, signup, connectSocket, once, emitAck } = require('./helpers');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const Message = require('../src/models/Message');
const C = require('../src/constants');

const RATE_BODY = { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again shortly' } };

describe('constants match the locked contract', () => {
  it('production defaults', () => {
    assert.equal(C.RATE_LIMITED, 'RATE_LIMITED');
    assert.equal(C.AUTH_RATE_MAX, 20);
    assert.equal(C.AUTH_RATE_WINDOW_MS, 15 * 60 * 1000);
    assert.equal(C.SEND_RATE_MAX, 10);
    assert.equal(C.SEND_RATE_WINDOW_MS, 10 * 1000);
    const cfg = loadConfig({});
    assert.deepEqual(cfg.rateLimits, { authWindowMs: 900000, authMax: 20, sendWindowMs: 10000, sendMax: 10 });
  });
});

describe('auth rate limits (429 RATE_LIMITED)', () => {
  let srv;
  before(async () => {
    srv = await startServer({ rateLimits: { authWindowMs: 60_000, authMax: 3 } });
  });
  after(async () => {
    await srv.stop();
  });

  it('signup: 4th request in window → 429 with locked body + standard headers', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await request(srv.app).post('/auth/signup').send({ email: 'bad' }); // 400s still count
      assert.equal(res.status, 400);
    }
    const res = await request(srv.app)
      .post('/auth/signup')
      .send({ email: 'ok@example.com', username: 'okuser', password: 'password123' });
    assert.equal(res.status, 429);
    assert.deepEqual(res.body, RATE_BODY);
    assert.ok(res.headers.ratelimit || res.headers['ratelimit-policy'], 'standard RateLimit headers');
    // Retry-After: whole seconds until the 60 s window resets (ceil), requests were just made
    assert.match(res.headers['retry-after'], /^\d+$/);
    const ra = Number(res.headers['retry-after']);
    assert.ok(ra >= 55 && ra <= 60, `Retry-After=${ra}`);
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  it('login has its own limiter (not exhausted by signup), then 429 after 3', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await request(srv.app).post('/auth/login').send({ identifier: 'nobody', password: 'password123' });
      assert.equal(res.status, 401);
    }
    const res = await request(srv.app).post('/auth/login').send({ identifier: 'nobody', password: 'password123' });
    assert.equal(res.status, 429);
    assert.deepEqual(res.body, RATE_BODY);
    const ra = Number(res.headers['retry-after']);
    assert.ok(Number.isInteger(ra) && ra >= 1 && ra <= 60, `Retry-After=${res.headers['retry-after']}`);
  });

  // Dev/test default is trust proxy 1 with no client-IP header; production
  // defaults (3 + CF-Connecting-IP) are covered in ratelimit-ip.test.js (DEF-001).
  it('dev default trust proxy 1: limit is per client IP from X-Forwarded-For', async () => {
    const res = await request(srv.app)
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.7')
      .send({ identifier: 'nobody', password: 'password123' });
    assert.equal(res.status, 401, 'a different client IP has its own budget');
    assert.equal(srv.app.get('trust proxy'), 1, 'dev/test default (NODE_ENV unset)');
    assert.equal(srv.config.clientIpHeader, '', 'no client-IP header outside production');
  });

  it('other routes are not limited', async () => {
    await request(srv.app).get('/health').expect(200);
  });
});

describe('message:send rate limit (10 per 10 s per socket)', () => {
  let srv;
  let alice;
  let bob;
  let chatId;
  const sockets = [];

  before(async () => {
    srv = await startServer({ rateLimits: { sendMax: C.SEND_RATE_MAX, sendWindowMs: C.SEND_RATE_WINDOW_MS } });
    alice = await signup(request, srv.app, { email: 'alice@example.com', username: 'alice' });
    bob = await signup(request, srv.app, { email: 'bob@example.com', username: 'bob' });
    const res = await request(srv.app)
      .post('/chats')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ userId: bob.user.id });
    chatId = res.body.chat.id;
  });
  after(async () => {
    sockets.forEach((s) => s.close());
    await srv.stop();
  });

  it('11th send acks RATE_LIMITED; nothing stored or emitted; no-ack sends do not crash; per socket', async () => {
    const a = connectSocket(srv.url, alice.token);
    const b = connectSocket(srv.url, bob.token);
    sockets.push(a, b);
    await Promise.all([once(a, 'hello'), once(b, 'hello')]);
    const bobEvents = [];
    b.on('message:new', (e) => bobEvents.push(e));

    for (let i = 0; i < 10; i += 1) {
      const ack = await emitAck(a, 'message:send', { chatId, text: `m${i}` });
      assert.equal(ack.ok, true, `send ${i}: ${JSON.stringify(ack)}`);
    }
    const limited = await emitAck(a, 'message:send', { chatId, text: 'over' });
    assert.equal(limited.ok, false);
    assert.deepEqual(Object.keys(limited.error).sort(), ['code', 'message', 'retryAfterMs']);
    assert.equal(limited.error.code, 'RATE_LIMITED');
    assert.equal(limited.error.message, 'Too many attempts, try again shortly');
    assert.ok(Number.isInteger(limited.error.retryAfterMs), 'integer ms');
    assert.ok(limited.error.retryAfterMs > 0 && limited.error.retryAfterMs <= 10_000, `retryAfterMs=${limited.error.retryAfterMs}`);
    a.emit('message:send', { chatId, text: 'over, no ack' }); // must not crash
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await Message.countDocuments({ chatId }), 10);
    assert.equal(bobEvents.length, 10);
    assert.ok(!bobEvents.some((e) => e.message.text.startsWith('over')));

    // a fresh socket of the same user has its own budget
    const a2 = connectSocket(srv.url, alice.token);
    sockets.push(a2);
    await once(a2, 'hello');
    const ok = await emitAck(a2, 'message:send', { chatId, text: 'other socket' });
    assert.equal(ok.ok, true);
    assert.equal(a.connected, true);
  });
});

describe('limiter math (exact semantics)', () => {
  const { createWindowLimiter, retryAfterSeconds } = require('../src/middleware/rateLimit');

  it('socket window: retryAfterMs = oldest hit + window - now; rejected attempts not recorded', () => {
    const l = createWindowLimiter({ max: 2, windowMs: 1000 });
    assert.deepEqual(l.check(0), { allowed: true });
    assert.deepEqual(l.check(100), { allowed: true });
    assert.deepEqual(l.check(250), { allowed: false, retryAfterMs: 750 });
    assert.deepEqual(l.check(999.2), { allowed: false, retryAfterMs: 1 });
    assert.deepEqual(l.check(1000), { allowed: true }); // hit@0 expired
    assert.deepEqual(l.check(1050), { allowed: false, retryAfterMs: 50 }); // oldest is now hit@100
  });

  it('Retry-After seconds = ceil((resetTime - now) / 1000), min 1', () => {
    const now = 1_000_000;
    assert.equal(retryAfterSeconds(new Date(now + 60_000), now), 60);
    assert.equal(retryAfterSeconds(new Date(now + 1500), now), 2);
    assert.equal(retryAfterSeconds(new Date(now + 1000), now), 1);
    assert.equal(retryAfterSeconds(new Date(now + 1), now), 1);
    assert.equal(retryAfterSeconds(new Date(now - 5), now), 1);
    assert.equal(retryAfterSeconds(undefined, now), 1);
  });
});

describe('X-Powered-By disabled', () => {
  let srv;
  before(async () => {
    srv = await startServer({ db: false });
  });
  after(async () => {
    await srv.stop();
  });

  it('header absent on 200, 404 and error responses', async () => {
    for (const res of [
      await request(srv.app).get('/health'),
      await request(srv.app).get('/nope'),
      await request(srv.app).post('/auth/login').send({ identifier: 'x', password: 'y' }),
    ]) {
      assert.equal(res.headers['x-powered-by'], undefined, `status ${res.status}`);
    }
  });
});

describe('socket keepalive + disconnect logging', () => {
  let srv;
  before(async () => {
    srv = await startServer({ db: false });
  });
  after(async () => {
    await srv.stop();
  });

  it('pingInterval 20000 / pingTimeout 25000 are applied', () => {
    assert.equal(srv.io.engine.opts.pingInterval, 20000);
    assert.equal(srv.io.engine.opts.pingTimeout, 25000);
  });

  it('logs disconnect with socket id, user id and reason, never the token', async () => {
    const { signToken } = require('../src/lib/jwt');
    const { TEST_SECRET } = require('./helpers');
    const token = signToken({ id: '0123456789abcdef01234567', username: 'a' }, TEST_SECRET);
    const lines = [];
    const orig = console.log;
    console.log = (...args) => {
      lines.push(args.join(' '));
    };
    try {
      const s = connectSocket(srv.url, token);
      const hello = await once(s, 'hello');
      s.close();
      await new Promise((r) => setTimeout(r, 200));
      const line = lines.find((l) => l.includes('[socket] disconnect'));
      assert.ok(line, 'disconnect logged');
      assert.match(line, new RegExp(`socketId=${hello.socketId}`));
      assert.match(line, /userId=0123456789abcdef01234567/);
      assert.match(line, /reason=client namespace disconnect/);
      assert.ok(!lines.join('\n').includes(token), 'token never logged');
    } finally {
      console.log = orig;
    }
  });
});

describe('production CORS guard', () => {
  it('createApp throws with NODE_ENV=production and no CLIENT_ORIGINS/CORS_ORIGIN', () => {
    for (const env of [
      { NODE_ENV: 'production', JWT_SECRET: 'x' },
      { NODE_ENV: 'production', JWT_SECRET: 'x', CLIENT_ORIGINS: ' , ' },
      { NODE_ENV: 'production', JWT_SECRET: 'x', CORS_ORIGIN: '' },
    ]) {
      assert.throws(() => createApp(loadConfig(env)), /NODE_ENV=production but CLIENT_ORIGINS \(or CORS_ORIGIN\) is empty/);
    }
  });

  it('starts in production when CLIENT_ORIGINS or CORS_ORIGIN is set; dev unchanged', () => {
    for (const env of [
      { NODE_ENV: 'production', CLIENT_ORIGINS: 'https://realtime-chat-web-orcin.vercel.app' },
      { NODE_ENV: 'production', CORS_ORIGIN: 'https://realtime-chat-web-orcin.vercel.app' },
      { NODE_ENV: 'development' },
      {},
    ]) {
      const { httpServer, io } = createApp(loadConfig(env));
      io.close();
      httpServer.close();
    }
  });

  function runIndex(env) {
    const script = path.join(__dirname, '..', 'src', 'index.js');
    const child = spawn(process.execPath, [script], {
      cwd: os.tmpdir(), // no stray .env
      env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    return { child, output: () => out };
  }

  it('npm start process exits 1 with a clear message when unset in production', async () => {
    const { child, output } = runIndex({ NODE_ENV: 'production' });
    const code = await new Promise((r) => child.on('exit', r));
    assert.equal(code, 1);
    assert.match(output(), /refusing to start/);
  });

  it('npm start process listens in production when CLIENT_ORIGINS is set', async () => {
    const { child, output } = runIndex({ NODE_ENV: 'production', CLIENT_ORIGINS: 'https://example.test', JWT_SECRET: 'x' });
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`no listen: ${output()}`)), 5000);
        child.stdout.on('data', () => {
          if (/listening on port/.test(output())) {
            clearTimeout(t);
            resolve();
          }
        });
        child.on('exit', (c) => reject(new Error(`exited ${c}: ${output()}`)));
      });
    } finally {
      child.kill('SIGTERM'); // by this child's PID only
      await new Promise((r) => child.on('exit', r));
    }
  });
});
