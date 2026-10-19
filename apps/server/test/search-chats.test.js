'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { startServer, signup, TEST_SECRET } = require('./helpers');
const Chat = require('../src/models/Chat');

function assertError(res, status, code, field) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.error.code, code);
  if (field) assert.equal(res.body.error.field, field);
}

describe('GET /users/search + POST /chats', () => {
  let srv;
  let app;
  let alice;
  let bob;
  let bobby;
  let carol;
  const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

  before(async () => {
    srv = await startServer();
    app = srv.app;
    alice = await signup(request, app, { email: 'alice@example.com', username: 'alice' });
    bob = await signup(request, app, { email: 'bob@example.com', username: 'bob' });
    bobby = await signup(request, app, { email: 'bobby@example.com', username: 'bob.by' });
    carol = await signup(request, app, { email: 'carol@example.com', username: 'carol_x' });
    // Many "user" names to check the 20 limit
    for (let i = 0; i < 22; i += 1) {
      await signup(request, app, { email: `u${i}@example.com`, username: `user${String(i).padStart(2, '0')}` });
    }
  });

  after(async () => {
    await srv.stop();
  });

  it('requires a JWT', async () => {
    assertError(await request(app).get('/users/search?q=bo'), 401, 'UNAUTHORIZED');
    assertError(await request(app).post('/chats').send({ userId: bob.user.id }), 401, 'UNAUTHORIZED');
  });

  it('prefix match, case-insensitive, trimmed, only { id, username }', async () => {
    const res = await request(app).get('/users/search').query({ q: '  BO ' }).set(auth(alice)).expect(200);
    assert.deepEqual(res.body.users, [
      { id: bob.user.id, username: 'bob' },
      { id: bobby.user.id, username: 'bob.by' },
    ]);
  });

  it('is a prefix match, not contains', async () => {
    const res = await request(app).get('/users/search?q=ob').set(auth(alice)).expect(200);
    assert.deepEqual(res.body.users, []);
  });

  it('excludes self', async () => {
    const res = await request(app).get('/users/search?q=bob').set(auth(bob)).expect(200);
    assert.deepEqual(res.body.users.map((u) => u.username), ['bob.by']);
  });

  it('empty / whitespace / missing q → []', async () => {
    for (const q of ['', '   ']) {
      const res = await request(app).get('/users/search').query({ q }).set(auth(alice)).expect(200);
      assert.deepEqual(res.body, { users: [] });
    }
    const res = await request(app).get('/users/search').set(auth(alice)).expect(200);
    assert.deepEqual(res.body, { users: [] });
  });

  it('escapes regex metacharacters ("." is literal, ".*" matches nothing)', async () => {
    let res = await request(app).get('/users/search').query({ q: 'bob.' }).set(auth(alice)).expect(200);
    assert.deepEqual(res.body.users.map((u) => u.username), ['bob.by']);
    res = await request(app).get('/users/search').query({ q: '.*' }).set(auth(alice)).expect(200);
    assert.deepEqual(res.body.users, []);
    res = await request(app).get('/users/search').query({ q: '(' }).set(auth(alice)).expect(200);
    assert.deepEqual(res.body.users, []);
  });

  it('limits to 20, sorted by username ascending (ruling P2-6)', async () => {
    const res = await request(app).get('/users/search?q=user').set(auth(alice)).expect(200);
    assert.equal(res.body.users.length, 20);
    const names = res.body.users.map((u) => u.username);
    assert.deepEqual(names, [...names].sort());
    assert.equal(names[0], 'user00');
    assert.equal(names[19], 'user19');
  });

  it('regex metacharacters are literal (ruling P2-5)', async () => {
    for (const q of ['^', '$', '[a-z]', 'b+', '\\', '?']) {
      const res = await request(app).get('/users/search').query({ q }).set(auth(alice)).expect(200);
      assert.deepEqual(res.body.users, [], `q=${q}`);
    }
  });

  it('repeated q param → 400 VALIDATION_ERROR', async () => {
    assertError(await request(app).get('/users/search?q=a&q=b').set(auth(alice)), 400, 'VALIDATION_ERROR', 'q');
  });

  let chatId;
  it('POST /chats new pair → 201 { chat } with locked shape', async () => {
    const res = await request(app).post('/chats').set(auth(alice)).send({ userId: bob.user.id }).expect(201);
    const { chat } = res.body;
    assert.deepEqual(Object.keys(chat).sort(), ['id', 'lastMessage', 'participants', 'updatedAt']);
    assert.equal(chat.lastMessage, null);
    assert.ok(!Number.isNaN(Date.parse(chat.updatedAt)));
    assert.deepEqual(
      chat.participants.map((p) => p.id).sort(),
      [alice.user.id, bob.user.id].sort()
    );
    for (const p of chat.participants) assert.deepEqual(Object.keys(p).sort(), ['id', 'username']);
    chatId = chat.id;
  });

  it('same pair again (either direction) → 200 same chat', async () => {
    let res = await request(app).post('/chats').set(auth(alice)).send({ userId: bob.user.id }).expect(200);
    assert.equal(res.body.chat.id, chatId);
    res = await request(app).post('/chats').set(auth(bob)).send({ userId: alice.user.id }).expect(200);
    assert.equal(res.body.chat.id, chatId);
  });

  it('concurrent creates for a new pair → exactly one chat, one 201', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        request(app)
          .post('/chats')
          .set(auth(i % 2 ? carol : bobby))
          .send({ userId: i % 2 ? bobby.user.id : carol.user.id })
      )
    );
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 201).length, 1, JSON.stringify(statuses));
    assert.equal(statuses.filter((s) => s === 200).length, 5);
    assert.equal(new Set(results.map((r) => r.body.chat.id)).size, 1);
    const ids = [bobby.user.id, carol.user.id].sort();
    assert.equal(await Chat.countDocuments({ pairKey: `${ids[0]}:${ids[1]}` }), 1);
  });

  it('self → 400 VALIDATION_ERROR', async () => {
    assertError(
      await request(app).post('/chats').set(auth(alice)).send({ userId: alice.user.id }),
      400,
      'VALIDATION_ERROR',
      'userId'
    );
  });

  it('invalid / missing id → 400 VALIDATION_ERROR', async () => {
    for (const body of [{}, { userId: 'abc' }, { userId: 123 }, { userId: { $gt: '' } }]) {
      assertError(await request(app).post('/chats').set(auth(alice)).send(body), 400, 'VALIDATION_ERROR', 'userId');
    }
  });

  it('unknown user → 404 NOT_FOUND', async () => {
    assertError(
      await request(app).post('/chats').set(auth(alice)).send({ userId: '0123456789abcdef01234567' }),
      404,
      'NOT_FOUND'
    );
  });

  it('token for deleted user → 401 UNAUTHORIZED', async () => {
    const ghost = jwt.sign({ sub: 'aaaaaaaaaaaaaaaaaaaaaaaa', username: 'ghost' }, TEST_SECRET);
    assertError(
      await request(app).post('/chats').set({ Authorization: `Bearer ${ghost}` }).send({ userId: bob.user.id }),
      401,
      'UNAUTHORIZED'
    );
  });
});
