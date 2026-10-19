'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { startServer, signup } = require('./helpers');
const { sendMessage } = require('../src/services/messages');

describe('GET /chats/:id/messages pagination (sorted by _id)', () => {
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
    assert.equal(m.clientId, null, 'legacy sends have clientId null');
    assert.deepEqual(Object.keys(m).sort(), ['chatId', 'clientId', 'createdAt', 'id', 'senderId', 'text']);
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

  it('limit is clamped, never 400 (ruling P3-10)', async () => {
    // parseInt(limit, 10) then clamp (rulings round 2 #3)
    const cases = {
      500: 50, 999: 50, 1000: 50, 51: 50, 50: 50, 0: 1, '-1': 1, '-100': 1,
      abc: 30, '': 30, '1.5': 1, '2.5': 2, '10abc': 10, '7': 7,
    };
    for (const [l, expected] of Object.entries(cases)) {
      const res = await get(alice, `?limit=${encodeURIComponent(l)}`);
      assert.equal(res.status, 200, `limit=${l}`);
      assert.equal(res.body.messages.length, expected, `limit=${l}`);
    }
    const arr = await get(alice, '?limit=5&limit=6').expect(200);
    assert.equal(arr.body.messages.length, 30, 'non-string (repeated) limit → default');
  });

  it('hasMore is exact: limit = remaining count → false (ruling P3-9)', async () => {
    // 65 messages: newest 35 then before=all[30] leaves exactly 30 older
    const res = await get(alice, `?limit=30&before=${all[30]}`).expect(200);
    assert.equal(res.body.messages.length, 30);
    assert.deepEqual(res.body.messages.map((m) => m.id), all.slice(0, 30));
    assert.equal(res.body.hasMore, false);
    const all65 = await get(alice, '?limit=50').expect(200);
    assert.equal(all65.body.hasMore, true);
  });

  it('before = oldest → [] hasMore false', async () => {
    const res = await get(alice, `?before=${all[0]}`).expect(200);
    assert.deepEqual(res.body, { messages: [], hasMore: false });
  });

  it('bad before → 400 field before, incl. id from another chat (ruling P3-11)', async () => {
    const other = await request(srv.app).post('/chats').set(auth(bob)).send({ userId: carol.user.id });
    const { message } = await sendMessage({ userId: carol.user.id, chatId: other.body.chat.id, text: 'secret' });
    for (const b of ['xyz', '0123456789abcdef01234567', message.id]) {
      const r = await get(alice, `?before=${b}`);
      assert.equal(r.status, 400, b);
      assert.equal(r.body.error.code, 'VALIDATION_ERROR');
      assert.equal(r.body.error.field, 'before');
      assert.ok(!JSON.stringify(r.body).includes('secret'));
    }
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
    assert.equal(r.body.error.code, 'VALIDATION_ERROR');
    r = await request(srv.app).get(`/chats/${chatId}/messages`);
    assert.equal(r.status, 401);
  });

  it('empty chat → [] hasMore false', async () => {
    const res = await request(srv.app).post('/chats').set(auth(alice)).send({ userId: carol.user.id });
    const r = await request(srv.app).get(`/chats/${res.body.chat.id}/messages`).set(auth(carol)).expect(200);
    assert.deepEqual(r.body, { messages: [], hasMore: false });
  });
});
