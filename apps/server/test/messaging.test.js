'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { startServer, signup, connectSocket, once, emitAck } = require('./helpers');
const Message = require('../src/models/Message');
const Chat = require('../src/models/Chat');
const { MAX_MESSAGE_LENGTH } = require('../src/constants');

describe('socket message:send / message:new', () => {
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
    await srv.stop();
  });

  it('MAX_MESSAGE_LENGTH is 2000', () => {
    assert.equal(MAX_MESSAGE_LENGTH, 2000);
  });

  it('delivers to both participants (all their sockets), acks sender, persists raw text', async () => {
    const aliceTab1 = await connect(alice);
    const aliceTab2 = await connect(alice);
    const bobSock = await connect(bob);
    const carolSock = await connect(carol);

    let carolGot = false;
    carolSock.on('message:new', () => {
      carolGot = true;
    });

    const text = '  hi bob  ';
    const waits = [aliceTab1, aliceTab2, bobSock].map((s) => once(s, 'message:new'));
    const ack = await emitAck(aliceTab1, 'message:send', { chatId, text });

    assert.equal(ack.ok, true, JSON.stringify(ack));
    const m = ack.message;
    assert.deepEqual(Object.keys(m).sort(), ['chatId', 'clientId', 'createdAt', 'id', 'senderId', 'text']);
    assert.equal(m.chatId, chatId);
    assert.equal(m.senderId, alice.user.id);
    assert.equal(m.text, text, 'stored/returned untrimmed');
    assert.equal(new Date(m.createdAt).toISOString(), m.createdAt);

    const events = await Promise.all(waits);
    for (const ev of events) {
      assert.deepEqual(ev.message, m);
      assert.equal(ev.chat.id, chatId);
      assert.deepEqual(ev.chat.lastMessage, m);
      assert.equal(ev.chat.updatedAt, m.createdAt);
      assert.equal(ev.chat.participants.length, 2);
    }
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(carolGot, false, 'non-participant must not receive');

    const saved = await Message.findById(m.id).lean();
    assert.equal(saved.text, text);
    const chat = await Chat.findById(chatId).lean();
    assert.equal(String(chat.lastMessage._id), m.id);
  });

  it('accepts exactly 2000 chars', async () => {
    const s = await connect(bob);
    const ack = await emitAck(s, 'message:send', { chatId, text: 'x'.repeat(2000) });
    assert.equal(ack.ok, true, JSON.stringify(ack));
  });

  it('rejects 2001 chars → MESSAGE_TOO_LONG, not stored', async () => {
    const s = await connect(bob);
    const before = await Message.countDocuments();
    const ack = await emitAck(s, 'message:send', { chatId, text: 'y'.repeat(2001) });
    assert.deepEqual(ack.ok, false);
    assert.equal(ack.error.code, 'MESSAGE_TOO_LONG');
    assert.equal(typeof ack.error.message, 'string');
    assert.equal(await Message.countDocuments(), before);
  });

  it('rejects empty / whitespace-only → MESSAGE_EMPTY, not stored', async () => {
    const s = await connect(bob);
    const before = await Message.countDocuments();
    for (const text of ['', '   ', '\n\t ']) {
      const ack = await emitAck(s, 'message:send', { chatId, text });
      assert.equal(ack.ok, false);
      assert.equal(ack.error.code, 'MESSAGE_EMPTY');
    }
    assert.equal(await Message.countDocuments(), before);
  });

  it('non-participant → FORBIDDEN', async () => {
    const s = await connect(carol);
    const ack = await emitAck(s, 'message:send', { chatId, text: 'sneaky' });
    assert.equal(ack.ok, false);
    assert.equal(ack.error.code, 'FORBIDDEN');
  });

  it('well-formed unknown chat → FORBIDDEN; malformed chatId → VALIDATION_ERROR (ruling P3-2)', async () => {
    const s = await connect(alice);
    let ack = await emitAck(s, 'message:send', { chatId: '0123456789abcdef01234567', text: 'hi' });
    assert.equal(ack.error.code, 'FORBIDDEN');
    ack = await emitAck(s, 'message:send', { chatId: 'nope', text: 'hi' });
    assert.equal(ack.error.code, 'VALIDATION_ERROR');
    ack = await emitAck(s, 'message:send', null);
    assert.equal(ack.error.code, 'VALIDATION_ERROR');
  });

  it('text missing / null / non-string → VALIDATION_ERROR, nothing stored (ruling P3-3)', async () => {
    const s = await connect(alice);
    const before = await Message.countDocuments();
    for (const payload of [{ chatId }, { chatId, text: null }, { chatId, text: 42 }, { chatId, text: ['a'] }, { chatId, text: { a: 1 } }]) {
      const ack = await emitAck(s, 'message:send', payload);
      assert.equal(ack.ok, false);
      assert.equal(ack.error.code, 'VALIDATION_ERROR', JSON.stringify(payload));
    }
    assert.equal(await Message.countDocuments(), before);
    assert.equal(s.connected, true);
  });

  it('no ack callback: valid send is saved + broadcast, invalid is dropped, no crash (ruling P3-4)', async () => {
    const a = await connect(alice);
    const b = await connect(bob);
    const got = once(b, 'message:new');
    a.emit('message:send', { chatId, text: 'no ack here' });
    const ev = await got;
    assert.equal(ev.message.text, 'no ack here');
    assert.ok(await Message.exists({ _id: ev.message.id }));
    a.emit('message:send', { chatId, text: '   ' });
    a.emit('message:send', 'garbage');
    a.emit('message:send');
    const pong = await emitAck(a, 'ping', 1); // server still alive and responsive
    assert.equal(pong.pong, true);
  });

  it('length is UTF-16 code units: 1000 emoji (2000 units) accepted, 1000 emoji + 1 rejected (ruling P3-5)', async () => {
    const s = await connect(alice);
    const emoji = '😀'.repeat(1000);
    assert.equal(emoji.length, 2000);
    let ack = await emitAck(s, 'message:send', { chatId, text: emoji });
    assert.equal(ack.ok, true, JSON.stringify(ack.error));
    assert.equal(ack.message.text, emoji);
    ack = await emitAck(s, 'message:send', { chatId, text: `${emoji}x` });
    assert.equal(ack.error.code, 'MESSAGE_TOO_LONG');
  });

  it('GET /chats sorted by updatedAt desc with lastMessage; empty list for new user', async () => {
    // alice also has a chat with carol, created after the alice-bob messages
    const created = await request(srv.app)
      .post('/chats')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ userId: carol.user.id })
      .expect(201);
    let res = await request(srv.app).get('/chats').set('Authorization', `Bearer ${alice.token}`).expect(200);
    assert.deepEqual(res.body.chats.map((c) => c.id), [created.body.chat.id, chatId]);
    assert.equal(res.body.chats[0].lastMessage, null);

    // new message in alice-bob moves it to the top
    const s = await connect(bob);
    const ack = await emitAck(s, 'message:send', { chatId, text: 'bump' });
    res = await request(srv.app).get('/chats').set('Authorization', `Bearer ${alice.token}`).expect(200);
    assert.deepEqual(res.body.chats.map((c) => c.id), [chatId, created.body.chat.id]);
    assert.deepEqual(res.body.chats[0].lastMessage, ack.message);
    assert.equal(res.body.chats[0].updatedAt, ack.message.createdAt);

    const dave = await signup(request, srv.app, { email: 'dave@example.com', username: 'dave' });
    res = await request(srv.app).get('/chats').set('Authorization', `Bearer ${dave.token}`).expect(200);
    assert.deepEqual(res.body, { chats: [] });

    const unauth = await request(srv.app).get('/chats');
    assert.equal(unauth.status, 401);
    assert.equal(unauth.body.error.code, 'UNAUTHORIZED');
  });

  describe('idempotent send with clientId (rulings round 2 #1)', () => {
    const { randomUUID } = require('node:crypto');

    it('stores clientId; repeat ack returns the existing message without saving or re-emitting', async () => {
      const a = await connect(alice);
      const b = await connect(bob);
      const clientId = randomUUID();
      let bobEvents = 0;
      b.on('message:new', (ev) => {
        if (ev.message.clientId === clientId) bobEvents += 1;
      });
      const first = await emitAck(a, 'message:send', { chatId, text: 'retry me', clientId });
      assert.equal(first.ok, true, JSON.stringify(first));
      assert.equal(first.message.clientId, clientId);
      const count = await Message.countDocuments();

      const again = await emitAck(a, 'message:send', { chatId, text: 'retry me', clientId });
      assert.equal(again.ok, true);
      assert.deepEqual(again.message, first.message);
      assert.equal(await Message.countDocuments(), count, 'not saved twice');
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(bobEvents, 1, 'message:new emitted once only');

      // lastMessage + GET /chats + history carry clientId
      const list = await request(srv.app).get('/chats').set('Authorization', `Bearer ${bob.token}`).expect(200);
      const c = list.body.chats.find((x) => x.id === chatId);
      assert.equal(c.lastMessage.clientId, clientId);
      const hist = await request(srv.app)
        .get(`/chats/${chatId}/messages?limit=1`)
        .set('Authorization', `Bearer ${bob.token}`)
        .expect(200);
      assert.equal(hist.body.messages[0].clientId, clientId);
    });

    it('same clientId from a different sender is a different message', async () => {
      const clientId = randomUUID();
      const a = await connect(alice);
      const b = await connect(bob);
      const r1 = await emitAck(a, 'message:send', { chatId, text: 'x', clientId });
      const r2 = await emitAck(b, 'message:send', { chatId, text: 'x', clientId });
      assert.equal(r1.ok && r2.ok, true);
      assert.notEqual(r1.message.id, r2.message.id);
    });

    it('concurrent duplicates (E11000 race) → one stored message, all acks identical', async () => {
      const clientId = randomUUID();
      const socks = await Promise.all([connect(alice), connect(alice), connect(alice)]);
      const acks = await Promise.all(
        socks.flatMap((s) => [1, 2].map(() => emitAck(s, 'message:send', { chatId, text: 'race', clientId })))
      );
      for (const ack of acks) assert.equal(ack.ok, true, JSON.stringify(ack));
      assert.equal(new Set(acks.map((x) => x.message.id)).size, 1);
      assert.equal(await Message.countDocuments({ clientId }), 1);
    });

    it('no clientId / null → clientId null, never deduped', async () => {
      const a = await connect(alice);
      const r1 = await emitAck(a, 'message:send', { chatId, text: 'same' });
      const r2 = await emitAck(a, 'message:send', { chatId, text: 'same', clientId: null });
      assert.equal(r1.message.clientId, null);
      assert.equal(r2.message.clientId, null);
      assert.notEqual(r1.message.id, r2.message.id);
    });

    it('invalid clientId → VALIDATION_ERROR, nothing stored', async () => {
      const a = await connect(alice);
      const before = await Message.countDocuments();
      for (const clientId of ['not-a-uuid', 42, '', `${randomUUID()}x`, 'a'.repeat(65), { a: 1 }]) {
        const ack = await emitAck(a, 'message:send', { chatId, text: 'hi', clientId });
        assert.equal(ack.ok, false, JSON.stringify(clientId));
        assert.equal(ack.error.code, 'VALIDATION_ERROR');
      }
      assert.equal(await Message.countDocuments(), before);
    });
  });
});
