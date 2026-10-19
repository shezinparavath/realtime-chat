'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { startServer, connectSocket, once, emitAck, TEST_SECRET } = require('./helpers');
const { signToken } = require('../src/lib/jwt');

describe('without MONGODB_URI', () => {
  let srv;
  before(async () => {
    srv = await startServer({ db: false });
  });
  after(async () => {
    await srv.stop();
  });

  it('signup/login answer 500 SERVER_ERROR fast instead of crashing', async () => {
    const t0 = Date.now();
    for (const [path, body] of [
      ['/auth/signup', { email: 'a@b.co', username: 'abc', password: 'password123' }],
      ['/auth/login', { identifier: 'abc', password: 'password123' }],
    ]) {
      const res = await request(srv.app).post(path).send(body);
      assert.equal(res.status, 500);
      assert.equal(res.body.error.code, 'SERVER_ERROR');
    }
    assert.ok(Date.now() - t0 < 3000, 'should not wait for mongoose buffering');
    const health = await request(srv.app).get('/health').expect(200);
    assert.equal(health.body.db, 'not_configured');
  });

  it('message:send acks SERVER_ERROR', async () => {
    const token = signToken({ id: '0123456789abcdef01234567', username: 'a' }, TEST_SECRET);
    const s = connectSocket(srv.url, token);
    await once(s, 'hello');
    const ack = await emitAck(s, 'message:send', { chatId: '0123456789abcdef01234567', text: 'hi' });
    assert.deepEqual(ack.ok, false);
    assert.equal(ack.error.code, 'SERVER_ERROR');
    s.close();
  });
});

describe('without JWT_SECRET', () => {
  let srv;
  before(async () => {
    srv = await startServer({ db: false, env: { JWT_SECRET: '' } });
  });
  after(async () => {
    await srv.stop();
  });

  it('signup → 500 SERVER_ERROR; /auth/me → 401', async () => {
    const res = await request(srv.app)
      .post('/auth/signup')
      .send({ email: 'a@b.co', username: 'abc', password: 'password123' });
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'SERVER_ERROR');
    const me = await request(srv.app).get('/auth/me').set('Authorization', 'Bearer x');
    assert.equal(me.status, 401);
  });
});
