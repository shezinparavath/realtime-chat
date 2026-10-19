'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { startServer, signup, connectSocket, once } = require('./helpers');
const { TYPING_MAX_EVENTS } = require('../src/constants');

const WRITE_OPS = /^(insert|update|delete|replace|findOneAndUpdate|findOneAndDelete|findOneAndReplace|bulkWrite|create)/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('typing indicator relay (RTC-N1-01)', () => {
  let srv;
  let alice;
  let bob;
  let carol;
  let chatId;
  const sockets = [];

  async function connect(u) {
    const s = connectSocket(srv.url, u.token);
    sockets.push(s);
    await once(s, 'hello');
    return s;
  }

  /** Collect `typing` events on a socket. */
  function collect(s) {
    const events = [];
    s.on('typing', (e) => events.push(e));
    return events;
  }

  before(async () => {
    srv = await startServer();
    alice = await signup(request, srv.app, { email: 'alice@example.com', username: 'alice' });
    bob = await signup(request, srv.app, { email: 'bob@example.com', username: 'bob' });
    carol = await signup(request, srv.app, { email: 'carol@example.com', username: 'carol' });
    const res = await request(srv.app)
      .post('/chats')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ userId: bob.user.id })
      .expect(201);
    chatId = res.body.chat.id;
  });

  after(async () => {
    sockets.forEach((s) => s.close());
    mongoose.set('debug', false);
    await srv.stop();
  });

  it('relays to the other participant only (not the sender or the sender\'s other tabs); no DB writes', async () => {
    const ops = [];
    mongoose.set('debug', (coll, method) => ops.push(`${coll}.${method}`));
    const before = {
      messages: await mongoose.connection.db.collection('messages').countDocuments(),
      chats: await mongoose.connection.db.collection('chats').countDocuments(),
    };
    ops.length = 0;

    const aliceTab1 = await connect(alice);
    const aliceTab2 = await connect(alice);
    const bobSock = await connect(bob);
    const carolSock = await connect(carol);
    const aliceEvents = [...[aliceTab1, aliceTab2].map(collect)];
    const carolEvents = collect(carolSock);

    const got = once(bobSock, 'typing');
    aliceTab1.emit('typing', { chatId, isTyping: true });
    assert.deepEqual(await got, { chatId, userId: alice.user.id, isTyping: true });

    const got2 = once(bobSock, 'typing');
    aliceTab1.emit('typing', { chatId, isTyping: false });
    assert.deepEqual(await got2, { chatId, userId: alice.user.id, isTyping: false });

    // reverse direction
    const back = once(aliceTab2, 'typing');
    bobSock.emit('typing', { chatId, isTyping: true });
    assert.deepEqual(await back, { chatId, userId: bob.user.id, isTyping: true });

    await sleep(100);
    assert.equal(aliceEvents[0].length, 1, 'alice tab1 only gets bob\'s event');
    assert.equal(aliceEvents[0][0].userId, bob.user.id);
    assert.equal(carolEvents.length, 0);

    mongoose.set('debug', false);
    const writes = ops.filter((o) => WRITE_OPS.test(o.split('.').pop()));
    assert.deepEqual(writes, [], 'no DB writes');
    assert.equal(await mongoose.connection.db.collection('messages').countDocuments(), before.messages);
    assert.equal(await mongoose.connection.db.collection('chats').countDocuments(), before.chats);
  });

  it('non-participant typing is dropped', async () => {
    const carolSock = await connect(carol);
    const aliceSock = await connect(alice);
    const bobSock = await connect(bob);
    const a = collect(aliceSock);
    const b = collect(bobSock);
    carolSock.emit('typing', { chatId, isTyping: true });
    await sleep(200);
    assert.equal(a.length + b.length, 0);
  });

  it('bad payloads are dropped silently (no crash, socket stays up)', async () => {
    const aliceSock = await connect(alice);
    const bobSock = await connect(bob);
    const b = collect(bobSock);
    const bad = [
      undefined,
      null,
      'typing',
      42,
      {},
      { chatId },
      { chatId, isTyping: 'true' },
      { chatId, isTyping: 1 },
      { chatId: 'nope', isTyping: true },
      { chatId: 123, isTyping: true },
      { chatId: '0123456789abcdef01234567', isTyping: true }, // unknown chat
    ];
    for (const p of bad) aliceSock.emit('typing', p);
    // a valid one afterwards proves the socket and server are fine
    // (bad events count toward the 10/s guard, so wait out the window first)
    await sleep(1100);
    const ok = once(bobSock, 'typing');
    aliceSock.emit('typing', { chatId, isTyping: true });
    await ok;
    await sleep(100);
    assert.equal(b.length, 1);
    assert.deepEqual(b[0], { chatId, userId: alice.user.id, isTyping: true });
    assert.equal(aliceSock.connected, true);
  });

  it(`drops events beyond ${TYPING_MAX_EVENTS}/s per socket`, async () => {
    const aliceSock = await connect(alice);
    const bobSock = await connect(bob);
    const b = collect(bobSock);
    for (let i = 0; i < 25; i += 1) aliceSock.emit('typing', { chatId, isTyping: i % 2 === 0 });
    await sleep(300);
    assert.equal(b.length, TYPING_MAX_EVENTS);
    // after the window, events flow again
    await sleep(1000);
    const ok = once(bobSock, 'typing');
    aliceSock.emit('typing', { chatId, isTyping: false });
    await ok;
  });
});
