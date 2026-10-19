'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { startServer } = require('./helpers');

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
