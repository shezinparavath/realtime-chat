'use strict';

/**
 * Cross-origin 429s from the auth limiters must be readable by the web client
 * (#16 countdown): CORS runs before the limiter, so the 429 carries ACAO, and
 * Access-Control-Expose-Headers lists Retry-After.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { startServer } = require('./helpers');

const ORIGIN = 'http://localhost:5173'; // allowed by helpers' CLIENT_ORIGINS
const MAX = 2;
const exposed = (res) =>
  String(res.headers['access-control-expose-headers'] || '')
    .split(',')
    .map((s) => s.trim().toLowerCase());

describe('CORS on rate-limited auth responses', () => {
  let srv;
  before(async () => {
    srv = await startServer({ db: false, rateLimits: { authWindowMs: 60_000, authMax: MAX } });
  });
  after(async () => srv.stop());

  for (const [route, body] of [
    ['/auth/login', { identifier: 'nobody', password: 'password123' }],
    ['/auth/signup', { email: 'a@example.com', username: 'abc', password: 'password123' }],
  ]) {
    it(`${route}: cross-origin 429 has ACAO, Expose-Headers incl. Retry-After, and Retry-After`, async () => {
      let res;
      for (let i = 0; i <= MAX; i += 1) {
        res = await request(srv.app).post(route).set('Origin', ORIGIN).send(body);
        // non-429 responses carry the CORS headers too
        assert.equal(res.headers['access-control-allow-origin'], ORIGIN);
      }
      assert.equal(res.status, 429);
      assert.equal(res.body.error.code, 'RATE_LIMITED');
      assert.equal(res.headers['access-control-allow-origin'], ORIGIN);
      assert.equal(res.headers['access-control-allow-credentials'], 'true');
      assert.ok(exposed(res).includes('retry-after'), `expose-headers=${res.headers['access-control-expose-headers']}`);
      const ra = Number(res.headers['retry-after']);
      assert.ok(Number.isInteger(ra) && ra >= 1, `Retry-After=${res.headers['retry-after']}`);
    });
  }

  it('disallowed origin: 429 still limited but no ACAO / expose headers', async () => {
    const s = await startServer({ db: false, rateLimits: { authWindowMs: 60_000, authMax: 1 } });
    try {
      let res;
      for (let i = 0; i < 2; i += 1) {
        res = await request(s.app).post('/auth/login').set('Origin', 'http://evil.example').send({});
      }
      assert.equal(res.status, 429);
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    } finally {
      await s.stop();
    }
  });

  it('preflight for an allowed origin succeeds (unchanged)', async () => {
    const res = await request(srv.app)
      .options('/auth/login')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], ORIGIN);
  });
});
