'use strict';

/**
 * RTC-N2-01: /me/push-token + Expo push to every recipient (DEF-012: online or not, never the sender). fetch is ALWAYS a stub here;
 * no test touches the network.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { startServer, signup, connectSocket, once, emitAck } = require('./helpers');
const User = require('../src/models/User');
const { truncateBody, isExpoPushToken, EXPO_PUSH_URL } = require('../src/services/push');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = (s) => `ExponentPushToken[${s}]`;

async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timeout');
    await sleep(20);
  }
}

/** Controllable fetch stub: records calls; behaviour set per test via `mode`. */
function makeFetch() {
  const stub = {
    calls: [],
    mode: 'ok', // 'ok' | 'hang' | 'reject' | 'dnr' | 'http500'
    async fetch(url, init) {
      const messages = JSON.parse(init.body);
      stub.calls.push({ url, init, messages });
      if (stub.mode === 'hang') return new Promise(() => {});
      if (stub.mode === 'reject') throw new Error('network down');
      if (stub.mode === 'http500') return { ok: false, status: 500, json: async () => ({ errors: [{ code: 'X' }] }) };
      const data = messages.map((m) =>
        stub.mode === 'dnr' && m.to.includes('dead')
          ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok', id: 'ticket' }
      );
      return { ok: true, status: 200, json: async () => ({ data }) };
    },
  };
  return stub;
}

describe('push tokens + push notifications (RTC-N2-01)', () => {
  let srv;
  const stub = makeFetch();
  const sockets = [];
  let n = 0;

  async function pair() {
    n += 1;
    const a = await signup(request, srv.app, { email: `pa${n}@example.com`, username: `pa${n}` });
    const b = await signup(request, srv.app, { email: `pb${n}@example.com`, username: `pb${n}` });
    const r = await request(srv.app).post('/chats').set('Authorization', `Bearer ${a.token}`).send({ userId: b.user.id });
    return { a, b, chatId: r.body.chat.id };
  }
  async function connect(u) {
    const s = connectSocket(srv.url, u.token);
    sockets.push(s);
    await once(s, 'hello');
    return s;
  }
  const post = (u, body) => request(srv.app).post('/me/push-token').set('Authorization', `Bearer ${u.token}`).send(body);
  const del = (u, body) => request(srv.app).delete('/me/push-token').set('Authorization', `Bearer ${u.token}`).send(body);
  const tokensOf = async (u) => ((await User.findById(u.user.id).lean()).pushTokens || []);

  before(async () => {
    srv = await startServer({ push: { fetch: (...a) => stub.fetch(...a) } });
  });
  beforeEach(() => {
    stub.calls.length = 0;
    stub.mode = 'ok';
  });
  after(async () => {
    sockets.forEach((s) => s.close());
    await srv.stop();
  });

  describe('POST/DELETE /me/push-token', () => {
    it('requires auth (401 UNAUTHORIZED) for both', async () => {
      const p = await request(srv.app).post('/me/push-token').send({ token: tok('x') });
      assert.equal(p.status, 401);
      assert.equal(p.body.error.code, 'UNAUTHORIZED');
      const d = await request(srv.app).delete('/me/push-token').send({ token: tok('x') });
      assert.equal(d.status, 401);
      assert.equal(d.body.error.code, 'UNAUTHORIZED');
    });

    it('validates token shape: 400 VALIDATION_ERROR field token', async () => {
      const { a } = await pair();
      for (const body of [{}, { token: '' }, { token: 123 }, { token: 'abc' }, { token: 'ExponentPushToken[]' }, { token: 'ExponentPushToken[a b]' }, { token: `ExponentPushToken[${'x'.repeat(300)}]` }]) {
        const r = await post(a, body);
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.equal(r.body.error.code, 'VALIDATION_ERROR');
        assert.equal(r.body.error.field, 'token');
      }
      const d = await del(a, { token: 'nope' });
      assert.equal(d.status, 400);
      assert.equal(d.body.error.field, 'token');
      assert.ok(isExpoPushToken('ExpoPushToken[abc-123_X]'));
    });

    it('stores, dedupes (re-POST moves to newest) and DELETE removes; both idempotent', async () => {
      const { a } = await pair();
      assert.deepEqual((await post(a, { token: tok('1') })).body, { ok: true });
      await post(a, { token: tok('2') });
      await post(a, { token: tok('1') });
      assert.deepEqual(await tokensOf(a), [tok('2'), tok('1')]);
      assert.equal((await del(a, { token: tok('2') })).status, 200);
      assert.equal((await del(a, { token: tok('2') })).status, 200);
      assert.deepEqual(await tokensOf(a), [tok('1')]);
    });

    it('caps at 5 tokens, evicting the oldest', async () => {
      const { a } = await pair();
      for (const i of [1, 2, 3, 4, 5, 6]) assert.equal((await post(a, { token: tok(`c${i}`) })).status, 200);
      assert.deepEqual(await tokensOf(a), [2, 3, 4, 5, 6].map((i) => tok(`c${i}`)));
    });

    it('POST moves a token away from any other user; DELETE only affects the caller', async () => {
      const { a, b } = await pair();
      await post(a, { token: tok('shared') });
      await post(b, { token: tok('shared') });
      assert.deepEqual(await tokensOf(a), []);
      assert.deepEqual(await tokensOf(b), [tok('shared')]);
      await del(a, { token: tok('shared') });
      assert.deepEqual(await tokensOf(b), [tok('shared')]);
    });

    it('token never leaks via /auth/me', async () => {
      const { a } = await pair();
      await post(a, { token: tok('priv') });
      const r = await request(srv.app).get('/auth/me').set('Authorization', `Bearer ${a.token}`);
      assert.equal(JSON.stringify(r.body).includes('priv'), false);
    });
  });

  describe('push on message:send', () => {
    it('recipient offline (no socket) → one Expo request with title/body/data; sender not notified', async () => {
      const { a, b, chatId } = await pair();
      await post(b, { token: tok('b1') });
      await post(b, { token: tok('b2') });
      await post(a, { token: tok('a1') });
      const sa = await connect(a);
      const ack = await emitAck(sa, 'message:send', { chatId, text: 'hello bob' });
      assert.equal(ack.ok, true);
      await waitFor(() => stub.calls.length === 1);
      const call = stub.calls[0];
      assert.equal(call.url, EXPO_PUSH_URL);
      assert.equal(call.init.method, 'POST');
      assert.equal(call.init.headers['Content-Type'], 'application/json');
      assert.equal(call.init.headers.Authorization, undefined);
      assert.deepEqual(call.messages.map((m) => m.to), [tok('b1'), tok('b2')]);
      for (const m of call.messages) {
        assert.equal(m.title, a.user.username);
        assert.equal(m.body, 'hello bob');
        assert.deepEqual(m.data, { chatId });
        assert.equal(m.channelId, 'messages');
      }
    });

    it('DEF-012: recipient online (live socket, e.g. backgrounded app) → push IS sent; sender never', async () => {
      const { a, b, chatId } = await pair();
      await post(b, { token: tok('on') });
      await post(a, { token: tok('sender') });
      const sa = await connect(a);
      const sb = await connect(b);
      const got = once(sb, 'message:new');
      assert.equal((await emitAck(sa, 'message:send', { chatId, text: 'hi online' })).ok, true);
      await got; // recipient's live socket really received it
      await waitFor(() => stub.calls.length === 1);
      await sleep(150);
      assert.equal(stub.calls.length, 1);
      assert.deepEqual(stub.calls[0].messages.map((m) => m.to), [tok('on')]);
      const m = stub.calls[0].messages[0];
      assert.equal(m.title, a.user.username);
      assert.equal(m.body, 'hi online');
      assert.deepEqual(m.data, { chatId });
      assert.equal(m.channelId, 'messages');
      assert.equal(m.sound, 'default');
    });

    it('DEF-012: reply from the other side pushes only the original sender (both online)', async () => {
      const { a, b, chatId } = await pair();
      await post(a, { token: tok('a-only') });
      await post(b, { token: tok('b-only') });
      await connect(a);
      const sb = await connect(b);
      assert.equal((await emitAck(sb, 'message:send', { chatId, text: 'reply' })).ok, true);
      await waitFor(() => stub.calls.length === 1);
      await sleep(150);
      assert.equal(stub.calls.length, 1);
      assert.deepEqual(stub.calls[0].messages.map((m) => m.to), [tok('a-only')]);
      assert.equal(stub.calls[0].messages[0].title, b.user.username);
    });

    it('recipient with no tokens → no request', async () => {
      const { a, chatId } = await pair();
      const sa = await connect(a);
      assert.equal((await emitAck(sa, 'message:send', { chatId, text: 'hi' })).ok, true);
      await sleep(200);
      assert.equal(stub.calls.length, 0);
    });

    it('duplicate clientId resend → no second push', async () => {
      const { a, b, chatId } = await pair();
      await post(b, { token: tok('dup') });
      const sa = await connect(a);
      const clientId = '6f1c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f';
      await emitAck(sa, 'message:send', { chatId, text: 'once', clientId });
      await emitAck(sa, 'message:send', { chatId, text: 'once', clientId });
      await sleep(200);
      assert.equal(stub.calls.length, 1);
    });

    it('body truncated to 100 chars (99 + …); emoji not split; ≤100 unchanged', async () => {
      assert.equal(truncateBody('x'.repeat(100)), 'x'.repeat(100));
      const long = truncateBody('y'.repeat(150));
      assert.equal(long, `${'y'.repeat(99)}…`);
      assert.equal(Array.from(long).length, 100);
      const emo = truncateBody('😀'.repeat(120));
      assert.equal(Array.from(emo).length, 100);
      assert.ok(!emo.includes('\uFFFD'));

      const { a, b, chatId } = await pair();
      await post(b, { token: tok('trunc') });
      const sa = await connect(a);
      await emitAck(sa, 'message:send', { chatId, text: 'z'.repeat(500) });
      await waitFor(() => stub.calls.length === 1);
      assert.equal(stub.calls[0].messages[0].body, `${'z'.repeat(99)}…`);
    });

    it('a hanging fetch does not delay the ack or the next queued send', async () => {
      stub.mode = 'hang';
      const { a, b, chatId } = await pair();
      await post(b, { token: tok('hang') });
      const sa = await connect(a);
      const t0 = Date.now();
      const acks = await Promise.all([1, 2, 3].map((i) => emitAck(sa, 'message:send', { chatId, text: `m${i}` }, 2000)));
      assert.ok(acks.every((x) => x.ok));
      assert.ok(Date.now() - t0 < 1500, `acks took ${Date.now() - t0} ms`);
      await waitFor(() => stub.calls.length === 3);
    });

    it('fetch rejection / HTTP 500 is logged, send still succeeds, next send works', async () => {
      const { a, b, chatId } = await pair();
      await post(b, { token: tok('rej') });
      const sa = await connect(a);
      stub.mode = 'reject';
      assert.equal((await emitAck(sa, 'message:send', { chatId, text: 'r1' })).ok, true);
      await waitFor(() => stub.calls.length === 1);
      stub.mode = 'http500';
      assert.equal((await emitAck(sa, 'message:send', { chatId, text: 'r2' })).ok, true);
      await waitFor(() => stub.calls.length === 2);
      stub.mode = 'ok';
      assert.equal((await emitAck(sa, 'message:send', { chatId, text: 'r3' })).ok, true);
      await waitFor(() => stub.calls.length === 3);
      assert.deepEqual(await tokensOf(b), [tok('rej')]);
    });

    it('DeviceNotRegistered ticket drops only that token', async () => {
      stub.mode = 'dnr';
      const { a, b, chatId } = await pair();
      await post(b, { token: tok('alive') });
      await post(b, { token: tok('dead') });
      const sa = await connect(a);
      await emitAck(sa, 'message:send', { chatId, text: 'ping' });
      await waitFor(async () => (await tokensOf(b)).length === 1);
      assert.deepEqual(await tokensOf(b), [tok('alive')]);
    });
  });
});

describe('push disabled', () => {
  it('startServer default (push off) never calls fetch', async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      calls.push(args);
      throw new Error('no network in tests');
    };
    const srv = await startServer();
    try {
      const a = await signup(request, srv.app, { email: 'off1@example.com', username: 'off1' });
      const b = await signup(request, srv.app, { email: 'off2@example.com', username: 'off2' });
      await request(srv.app).post('/me/push-token').set('Authorization', `Bearer ${b.token}`).send({ token: tok('off') });
      const chat = await request(srv.app).post('/chats').set('Authorization', `Bearer ${a.token}`).send({ userId: b.user.id });
      const s = connectSocket(srv.url, a.token);
      await once(s, 'hello');
      assert.equal((await emitAck(s, 'message:send', { chatId: chat.body.chat.id, text: 'x' })).ok, true);
      await sleep(200);
      s.close();
      assert.equal(calls.length, 0);
    } finally {
      globalThis.fetch = realFetch;
      await srv.stop();
    }
  });
});
