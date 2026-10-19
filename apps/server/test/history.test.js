'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { startServer, signup } = require('./helpers');
const { sendMessage } = require('../src/services/messages');

describe('GET /chats/:id/messages pagination', () => {
  let srv;
  let alice;
  let bob;
  let carol;
  let chatId;
  let all; // message ids oldest→newest
  const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

  before(async () => {
    srv = await startServer();
    alice = await signup(request, srv.app, { email: 'alice@example.com', username: 'alice' });
    bob = await signup(request, srv.app, { email: 'bob@example.com', username: 'bob' });
    carol = await signup(request, srv.app, { email: 'carol@example.com', username: 'carol' });
    const res = await request(srv.app).post('/chats').set(auth(alice)).send({ userId: bob.user.id });
    chatId = res.body.chat.id;
    all = [];
    for (let i = 0; i < 65; i += 1) {
      const { message } = await sendMessage({
        userId: i % 2 ? bob.user.id : alice.user.id,
        chatId,
        text: `msg ${i}`,
      });
      all.push(message.id);
    }
  });

  after(async () => {
    await srv.stop();
  });

  const get = (u, qs = '') => request(srv.app).get(`/chats/${chatId}/messages${qs}`).set(auth(u));

  it('default page = newest 30, oldest→newest, hasMore', async () => {
    const res = await get(alice).expect(200);
    assert.equal(res.body.messages.length, 30);
    assert.deepEqual(res.body.messages.map((m) => m.id), all.slice(35));
    assert.equal(res.body.hasMore, true);
    const m = res.body.messages[0];
    assert.deepEqual(Object.keys(m).sort(), ['chatId', 'createdAt', 'id', 'senderId', 'text']);
  });

  it('walks back with before= until hasMore=false, no gaps/dupes', async () => {
    const seen = [];
    let before = '';
    for (;;) {
      const res = await get(bob, `?limit=20${before ? `&before=${before}` : ''}`).expect(200);
      seen.unshift(...res.body.messages.map((m) => m.id));
      if (!res.body.hasMore) break;
      before = res.body.messages[0].id;
    }
    assert.deepEqual(seen, all);
  });

  it('limit clamps to 50; invalid limit → 400', async () => {
    const res = await get(alice, '?limit=500').expect(200);
    assert.equal(res.body.messages.length, 50);
    for (const l of ['0', '-1', 'abc', '1.5']) {
      const r = await get(alice, `?limit=${l}`);
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, 'VALIDATION_ERROR');
      assert.equal(r.body.error.field, 'limit');
    }
  });

  it('before = oldest → [] hasMore false', async () => {
    const res = await get(alice, `?before=${all[0]}`).expect(200);
    assert.deepEqual(res.body, { messages: [], hasMore: false });
  });

  it('bad before → 400', async () => {
    let r = await get(alice, '?before=xyz');
    assert.equal(r.body.error.code, 'VALIDATION_ERROR');
    r = await get(alice, '?before=0123456789abcdef01234567');
    assert.equal(r.status, 400);
    assert.equal(r.body.error.field, 'before');
  });

  it('non-participant → 403 FORBIDDEN; unknown chat → 404; bad id → 400; no token → 401', async () => {
    let r = await get(carol);
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'FORBIDDEN');
    r = await request(srv.app).get('/chats/0123456789abcdef01234567/messages').set(auth(alice));
    assert.equal(r.status, 404);
    assert.equal(r.body.error.code, 'NOT_FOUND');
    r = await request(srv.app).get('/chats/zzz/messages').set(auth(alice));
    assert.equal(r.status, 400);
    r = await request(srv.app).get(`/chats/${chatId}/messages`);
    assert.equal(r.status, 401);
  });

  it('empty chat → [] hasMore false', async () => {
    const res = await request(srv.app).post('/chats').set(auth(alice)).send({ userId: carol.user.id });
    const r = await request(srv.app).get(`/chats/${res.body.chat.id}/messages`).set(auth(carol)).expect(200);
    assert.deepEqual(r.body, { messages: [], hasMore: false });
  });
});
