'use strict';

/**
 * DEF-009: message:send is serialized per socket. A no-wait burst must be stored, acked,
 * broadcast and returned by history in emit order, even when earlier saves are slower.
 */
const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { startServer, signup, connectSocket, once } = require('./helpers');
const Message = require('../src/models/Message');
const C = require('../src/constants');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realCreate = Message.create;

/** Delay Message.create per text (earlier messages slower), or throw for 'boom'. */
function injectLatency(delays) {
  Message.create = async function (doc, ...rest) {
    const d = doc && delays[doc.text];
    if (doc && doc.text === 'boom') throw new Error('injected save failure');
    if (d) await sleep(d);
    return realCreate.call(this, doc, ...rest);
  };
}

describe('message:send order per socket (DEF-009)', () => {
  let srv;
  let alice;
  let bob;
  let chatId;
  let n = 0;
  const sockets = [];

  async function freshPair(server = srv) {
    n += 1;
    const a = await signup(request, server.app, { email: `oa${n}@example.com`, username: `oa${n}` });
    const b = await signup(request, server.app, { email: `ob${n}@example.com`, username: `ob${n}` });
    const r = await request(server.app).post('/chats').set('Authorization', `Bearer ${a.token}`).send({ userId: b.user.id });
    return { a, b, chatId: r.body.chat.id };
  }
  async function connect(u, server = srv) {
    const s = connectSocket(server.url, u.token);
    sockets.push(s);
    await once(s, 'hello');
    return s;
  }
  /** Emit all without awaiting; resolve with acks in ARRIVAL order plus by-index. */
  function burst(sock, items) {
    const arrival = [];
    const byIndex = [];
    const done = items.map(
      (item, i) =>
        new Promise((resolve) => {
          sock.emit('message:send', item, (ack) => {
            arrival.push(i);
            byIndex[i] = ack;
            resolve();
          });
        })
    );
    return Promise.all(done).then(() => ({ arrival, byIndex }));
  }
  const history = async (u, id) =>
    (await request(srv.app).get(`/chats/${id}/messages?limit=50`).set('Authorization', `Bearer ${u.token}`)).body.messages;

  before(async () => {
    srv = await startServer();
    ({ a: alice, b: bob, chatId } = await freshPair());
  });
  afterEach(() => {
    Message.create = realCreate;
  });
  after(async () => {
    Message.create = realCreate;
    sockets.forEach((s) => s.close());
    await srv.stop();
  });

  it('no-wait burst of 5 with slower earlier saves: stored, history, ack and message:new order = emit order', async () => {
    const texts = ['u1', 'u2', 'u3', 'u4', 'u5'];
    injectLatency({ u1: 150, u2: 100, u3: 60, u4: 20 });
    const aliceS = await connect(alice);
    const bobS = await connect(bob);
    const live = [];
    bobS.on('message:new', (e) => live.push(e.message.text));

    const { arrival, byIndex } = await burst(aliceS, texts.map((text) => ({ chatId, text })));
    assert.ok(byIndex.every((a) => a.ok), JSON.stringify(byIndex));
    assert.deepEqual(arrival, [0, 1, 2, 3, 4], 'acks arrive in emit order');

    const stored = await Message.find({ chatId }).sort({ _id: 1 }).lean();
    assert.deepEqual(stored.map((m) => m.text), texts, 'stored _id order');
    const times = stored.map((m) => +m.createdAt);
    assert.deepEqual([...times].sort((x, y) => x - y), times, 'createdAt non-decreasing in emit order');

    assert.deepEqual((await history(alice, chatId)).map((m) => m.text), texts, 'history order');
    await sleep(50);
    assert.deepEqual(live, texts, 'message:new order');
  });

  it('natural timing (no injected latency): 15 rounds of 3 back-to-back sends stay in order', async () => {
    const p = await freshPair();
    const s = await connect(p.a);
    for (let r = 0; r < 15; r += 1) {
      const texts = [`r${r} u1`, `r${r} u2`, `r${r} u3`];
      const { arrival } = await burst(s, texts.map((text, i) => ({ chatId: p.chatId, text, clientId: `00000000-0000-4000-8000-${String(r * 10 + i).padStart(12, '0')}` })));
      assert.deepEqual(arrival, [0, 1, 2]);
    }
    const all = (await request(srv.app).get(`/chats/${p.chatId}/messages?limit=50`).set('Authorization', `Bearer ${p.a.token}`)).body.messages.map((m) => m.text);
    const expected = [];
    for (let r = 0; r < 15; r += 1) expected.push(`r${r} u1`, `r${r} u2`, `r${r} u3`);
    assert.deepEqual(all, expected);
  });

  it('a failing send does not break the chain: error acks in order, later sends still saved in order', async () => {
    const p = await freshPair();
    injectLatency({ ok1: 80 });
    const s = await connect(p.a);
    const items = [
      { chatId: p.chatId, text: 'ok1' },
      { chatId: p.chatId, text: '   ' }, // MESSAGE_EMPTY
      { chatId: p.chatId, text: 'boom' }, // injected save error → SERVER_ERROR
      { chatId: '0123456789abcdef01234567', text: 'x' }, // unknown chat → FORBIDDEN
      { chatId: p.chatId, text: 'ok2' },
    ];
    const { arrival, byIndex } = await burst(s, items);
    assert.deepEqual(arrival, [0, 1, 2, 3, 4]);
    assert.deepEqual(byIndex.map((a) => (a.ok ? 'ok' : a.error.code)), ['ok', 'MESSAGE_EMPTY', 'SERVER_ERROR', 'FORBIDDEN', 'ok']);
    const stored = await Message.find({ chatId: p.chatId }).sort({ _id: 1 }).lean();
    assert.deepEqual(stored.map((m) => m.text), ['ok1', 'ok2']);
  });

  it('clientId dedupe inside a burst: duplicate acks the same message, one message:new, order kept', async () => {
    const p = await freshPair();
    injectLatency({ first: 80 });
    const s = await connect(p.a);
    const other = await connect(p.b);
    const live = [];
    other.on('message:new', (e) => live.push(e.message.text));
    const cid = '11111111-1111-4111-8111-111111111111';
    const { arrival, byIndex } = await burst(s, [
      { chatId: p.chatId, text: 'first', clientId: cid },
      { chatId: p.chatId, text: 'first', clientId: cid }, // retry of the same send
      { chatId: p.chatId, text: 'second' },
    ]);
    assert.deepEqual(arrival, [0, 1, 2]);
    assert.equal(byIndex[0].message.id, byIndex[1].message.id, 'duplicate gets the original message');
    await sleep(50);
    assert.deepEqual(live, ['first', 'second']);
    assert.deepEqual((await Message.find({ chatId: p.chatId }).sort({ _id: 1 }).lean()).map((m) => m.text), ['first', 'second']);
  });

  it('disconnect with sends queued: they still complete in order, no crash, the server keeps working', async () => {
    const p = await freshPair();
    injectLatency({ q1: 120, q2: 60 });
    const s = await connect(p.a);
    for (const text of ['q1', 'q2', 'q3', 'q4']) s.emit('message:send', { chatId: p.chatId, text }, () => {});
    await sleep(20);
    s.close(); // client goes away mid-queue
    await sleep(400);
    assert.deepEqual((await Message.find({ chatId: p.chatId }).sort({ _id: 1 }).lean()).map((m) => m.text), ['q1', 'q2', 'q3', 'q4']);
    const s2 = await connect(p.a);
    const { byIndex } = await burst(s2, [{ chatId: p.chatId, text: 'after' }]);
    assert.equal(byIndex[0].ok, true);
  });
});

describe('message:send order + LOCKED rate limit (DEF-009)', () => {
  let srv;
  const sockets = [];
  before(async () => {
    srv = await startServer({ rateLimits: { sendMax: C.SEND_RATE_MAX, sendWindowMs: C.SEND_RATE_WINDOW_MS } });
  });
  after(async () => {
    Message.create = realCreate;
    sockets.forEach((s) => s.close());
    await srv.stop();
  });

  it('limit checked at enqueue: 12-burst → 10 saved in order, 11th/12th RATE_LIMITED at once with retryAfterMs', async () => {
    const a = await signup(request, srv.app, { email: 'rl1@example.com', username: 'rl1' });
    const b = await signup(request, srv.app, { email: 'rl2@example.com', username: 'rl2' });
    const id = (await request(srv.app).post('/chats').set('Authorization', `Bearer ${a.token}`).send({ userId: b.user.id })).body.chat.id;
    injectLatency({ m0: 150 });
    const s = connectSocket(srv.url, a.token);
    sockets.push(s);
    await once(s, 'hello');
    const arrival = [];
    const acks = [];
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        new Promise((resolve) => {
          s.emit('message:send', { chatId: id, text: `m${i}` }, (ack) => {
            arrival.push(i);
            acks[i] = ack;
            resolve();
          });
        })
      )
    );
    assert.ok(acks.slice(0, 10).every((x) => x.ok));
    for (const i of [10, 11]) {
      assert.equal(acks[i].ok, false);
      assert.equal(acks[i].error.code, 'RATE_LIMITED');
      assert.equal(acks[i].error.message, C.RATE_LIMITED_MESSAGE);
      assert.ok(Number.isInteger(acks[i].error.retryAfterMs) && acks[i].error.retryAfterMs > 0);
    }
    // Rejections are immediate (not queued behind the slow saves); accepted acks stay in emit order.
    assert.deepEqual(arrival.slice(0, 2), [10, 11]);
    assert.deepEqual(arrival.slice(2), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const stored = await Message.find({ chatId: id }).sort({ _id: 1 }).lean();
    assert.deepEqual(stored.map((m) => m.text), Array.from({ length: 10 }, (_, i) => `m${i}`));
  });
});
