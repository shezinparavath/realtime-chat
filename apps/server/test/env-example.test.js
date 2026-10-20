'use strict';

/** DEF-002: the documented dev/preview web origins must pass CORS with the default .env.example. */
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { startServer } = require('./helpers');

const line = fs
  .readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8')
  .split('\n')
  .find((l) => l.startsWith('CLIENT_ORIGINS='));
const CLIENT_ORIGINS = line.slice('CLIENT_ORIGINS='.length).trim();

it('.env.example CLIENT_ORIGINS allows dev (5173) and preview (4173); others are refused', async () => {
  const srv = await startServer({ db: false, env: { CLIENT_ORIGINS } });
  try {
    for (const origin of ['http://localhost:5173', 'http://localhost:4173']) {
      const r = await request(srv.app).options('/auth/login').set('Origin', origin).set('Access-Control-Request-Method', 'POST');
      assert.equal(r.headers['access-control-allow-origin'], origin, origin);
    }
    const r = await request(srv.app).options('/auth/login').set('Origin', 'http://localhost:9999').set('Access-Control-Request-Method', 'POST');
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  } finally {
    await srv.stop();
  }
});
