'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');

describe('GET /health', () => {
  let httpServer;
  let app;

  before(() => {
    const config = loadConfig({
      PORT: '0',
      CLIENT_ORIGINS: 'http://localhost:5173',
      JWT_SECRET: 'test-secret',
    });
    ({ app, httpServer } = createApp(config));
  });

  after(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it('returns 200 with status ok, uptime, and db field', async () => {
    const res = await request(app).get('/health').expect(200);
    assert.equal(res.body.status, 'ok');
    assert.equal(typeof res.body.uptime, 'number');
    assert.ok(res.body.uptime >= 0);
    assert.ok(
      ['connected', 'disconnected', 'not_configured'].includes(res.body.db),
      `unexpected db: ${res.body.db}`
    );
    // No MONGODB_URI in this process → not_configured
    assert.equal(res.body.db, 'not_configured');
  });
});
