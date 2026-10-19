'use strict';

/**
 * DEF-001: the auth limiter must key on the real client IP under every
 * supported config, and a forged X-Forwarded-For must never get around it.
 * supertest connects from 127.0.0.1, which plays the role of the last proxy.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { startServer } = require('./helpers');
const { loadConfig, assertValidConfig } = require('../src/config');
const { createApp } = require('../src/app');

const MAX = 3;
const LIMITS = { authWindowMs: 60_000, authMax: MAX };
const login = (app, headers = {}) =>
  request(app).post('/auth/login').set(headers).send({ identifier: 'nobody', password: 'password123' });
const signupReq = (app, headers = {}) => request(app).post('/auth/signup').set(headers).send({ email: 'bad' });

/** Fire n requests, return statuses. */
async function statuses(fn, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push((await fn(i)).status);
  return out;
}
const limitedAfter = (codes, okCode) =>
  assert.deepEqual(codes, [...Array(MAX).fill(okCode), ...Array(codes.length - MAX).fill(429)], JSON.stringify(codes));

describe('config parsing / validation', () => {
  it('defaults match today: hops 1, no header, debug off', () => {
    const c = loadConfig({});
    assert.equal(c.trustProxyHops, 1);
    assert.equal(c.clientIpHeader, '');
    assert.equal(c.rateLimitDebug, false);
  });

  it('parses valid values', () => {
    const c = loadConfig({ TRUST_PROXY_HOPS: ' 3 ', CLIENT_IP_HEADER: 'CF-Connecting-IP', RATE_LIMIT_DEBUG: '1' });
    assert.equal(c.trustProxyHops, 3);
    assert.equal(c.clientIpHeader, 'cf-connecting-ip');
    assert.equal(c.rateLimitDebug, true);
    assert.equal(loadConfig({ TRUST_PROXY_HOPS: '0' }).trustProxyHops, 0);
  });

  it('malformed values refuse to start', () => {
    for (const env of [
      { TRUST_PROXY_HOPS: 'true' },
      { TRUST_PROXY_HOPS: '-1' },
      { TRUST_PROXY_HOPS: '1.5' },
      { TRUST_PROXY_HOPS: '11' },
      { CLIENT_IP_HEADER: 'bad header!' },
    ]) {
      assert.throws(() => assertValidConfig(loadConfig(env)), /refusing to start/, JSON.stringify(env));
      assert.throws(() => createApp(loadConfig(env)), /refusing to start/);
    }
  });

  it('app uses the configured hop count', async () => {
    const srv = await startServer({ db: false, env: { TRUST_PROXY_HOPS: '3' } });
    assert.equal(srv.app.get('trust proxy'), 3);
    await srv.stop();
  });
});

describe('hop-count mode (TRUST_PROXY_HOPS=2, e.g. Cloudflare → Render LB → app)', () => {
  let srv;
  before(async () => {
    srv = await startServer({ db: false, rateLimits: LIMITS, env: { TRUST_PROXY_HOPS: '2' } });
  });
  after(async () => srv.stop());

  // Real chain as the app sees it: XFF "<client-supplied...>, <client>, <cf edge>", socket = LB.
  const chain = (forged, client) => ({ 'X-Forwarded-For': `${forged ? `${forged}, ` : ''}${client}, 198.51.100.10` });

  it('forged leftmost XFF entry is ignored: same real client → limited after MAX', async () => {
    const codes = await statuses((i) => login(srv.app, chain(`10.0.0.${i}`, '203.0.113.1')), MAX + 2);
    limitedAfter(codes, 500); // no DB → 500 until limited, then 429
  });

  it('rotating XFF values (many forged entries) do not create fresh budgets', async () => {
    const codes = await statuses(
      (i) => login(srv.app, chain(`1.1.1.${i}, 2.2.2.${i}, 3.3.3.${i}`, '203.0.113.2')),
      MAX + 2
    );
    limitedAfter(codes, 500);
  });

  it('different real clients get their own counters (no shared bucket)', async () => {
    for (let c = 0; c < 3; c += 1) {
      const r = await login(srv.app, chain('', `203.0.113.${100 + c}`));
      assert.equal(r.status, 500, `client ${c} must have a fresh budget`);
    }
  });

  it('login and signup have separate budgets per client', async () => {
    const h = chain('', '203.0.113.50');
    limitedAfter(await statuses(() => signupReq(srv.app, h), MAX + 1), 500); // no DB → 500 until limited
    assert.equal((await login(srv.app, h)).status, 500, 'login budget untouched by signup');
    limitedAfter(await statuses(() => login(srv.app, h), MAX).then((s) => [500, ...s]), 500);
  });
});

describe('default mode (TRUST_PROXY_HOPS=1): forged XFF still cannot pick the key', () => {
  let srv;
  before(async () => {
    srv = await startServer({ db: false, rateLimits: LIMITS });
  });
  after(async () => srv.stop());

  it('client-supplied leftmost entries are ignored (key = entry appended by the trusted proxy)', async () => {
    const codes = await statuses(
      (i) => login(srv.app, { 'X-Forwarded-For': `9.9.9.${i}, 203.0.113.7` }),
      MAX + 2
    );
    limitedAfter(codes, 500);
  });
});

describe('TRUST_PROXY_HOPS=0: XFF ignored entirely', () => {
  let srv;
  before(async () => {
    srv = await startServer({ db: false, rateLimits: LIMITS, env: { TRUST_PROXY_HOPS: '0' } });
  });
  after(async () => srv.stop());

  it('rotating XFF → one counter (socket address)', async () => {
    const codes = await statuses((i) => login(srv.app, { 'X-Forwarded-For': `9.9.${i}.1` }), MAX + 2);
    limitedAfter(codes, 500);
  });
});

describe('header mode (CLIENT_IP_HEADER=CF-Connecting-IP)', () => {
  let srv;
  before(async () => {
    srv = await startServer({
      db: false,
      rateLimits: LIMITS,
      env: { TRUST_PROXY_HOPS: '2', CLIENT_IP_HEADER: 'CF-Connecting-IP' },
    });
  });
  after(async () => srv.stop());

  it('key = header; rotating/forged XFF is ignored', async () => {
    const codes = await statuses(
      (i) => login(srv.app, { 'CF-Connecting-IP': '203.0.113.9', 'X-Forwarded-For': `7.7.7.${i}, 8.8.8.${i}` }),
      MAX + 2
    );
    limitedAfter(codes, 500);
  });

  it('different header values → separate counters (IPv6 too)', async () => {
    for (const ip of ['203.0.113.21', '203.0.113.22', '2001:db8::1']) {
      assert.equal((await login(srv.app, { 'CF-Connecting-IP': ip })).status, 500, ip);
    }
  });

  it('missing or invalid header falls back to req.ip (not a free pass)', async () => {
    const xff = { 'X-Forwarded-For': '203.0.113.60, 198.51.100.10' }; // req.ip = 203.0.113.60 with hops 2
    const codes = await statuses(
      (i) => login(srv.app, i % 2 ? { ...xff, 'CF-Connecting-IP': `not-an-ip-${i}` } : xff),
      MAX + 2
    );
    limitedAfter(codes, 500);
  });

  it('login and signup have separate budgets in header mode', async () => {
    const h = { 'CF-Connecting-IP': '203.0.113.70' };
    limitedAfter(await statuses(() => signupReq(srv.app, h), MAX + 1), 500); // no DB → 500 until limited
    assert.equal((await login(srv.app, h)).status, 500);
  });
});

describe('RATE_LIMIT_DEBUG=1 logs only counts, never IPs', () => {
  it('logs xff_entries and key source without addresses', async () => {
    const srv = await startServer({
      db: false,
      rateLimits: LIMITS,
      env: { RATE_LIMIT_DEBUG: '1', CLIENT_IP_HEADER: 'CF-Connecting-IP' },
    });
    const lines = [];
    const orig = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try {
      await login(srv.app, { 'X-Forwarded-For': '203.0.113.88, 198.51.100.10', 'CF-Connecting-IP': '203.0.113.88' });
      await signupReq(srv.app, {});
    } finally {
      console.log = orig;
      await srv.stop();
    }
    const dbg = lines.filter((l) => l.startsWith('[ratelimit-debug]'));
    assert.equal(dbg.length, 2);
    assert.match(dbg[0], /route=\/auth\/login xff_entries=2 ip_header=cf-connecting-ip ip_header_present=true key_source=header/);
    assert.match(dbg[1], /route=\/auth\/signup xff_entries=0 .*ip_header_present=false key_source=req\.ip/);
    assert.ok(!/\d+\.\d+\.\d+\.\d+|::/.test(dbg.join('\n')), 'no IP addresses in debug output');
  });

  it('is off by default', async () => {
    const srv = await startServer({ db: false, rateLimits: LIMITS });
    const lines = [];
    const orig = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try {
      await login(srv.app);
    } finally {
      console.log = orig;
      await srv.stop();
    }
    assert.ok(!lines.some((l) => l.includes('[ratelimit-debug]')));
  });
});

describe('production defaults (Varun Render findings) and explicit-override precedence', () => {
  const PROD = { NODE_ENV: 'production', CLIENT_ORIGINS: 'https://web.example' };

  it('NODE_ENV=production + vars unset → hops 3, CF-Connecting-IP', () => {
    const c = loadConfig(PROD);
    assert.equal(c.trustProxyHops, 3);
    assert.equal(c.clientIpHeader, 'cf-connecting-ip');
    assert.deepEqual(c.clientIpSource, { trustProxyHops: 'production default', clientIpHeader: 'production default' });
    // empty values count as unset
    const e = loadConfig({ ...PROD, TRUST_PROXY_HOPS: '', CLIENT_IP_HEADER: '  ' });
    assert.equal(e.trustProxyHops, 3);
    assert.equal(e.clientIpHeader, 'cf-connecting-ip');
  });

  it('dev / test / unset NODE_ENV → hops 1, no header', () => {
    for (const NODE_ENV of [undefined, 'development', 'test', 'staging']) {
      const c = loadConfig({ NODE_ENV });
      assert.equal(c.trustProxyHops, 1, String(NODE_ENV));
      assert.equal(c.clientIpHeader, '', String(NODE_ENV));
      assert.equal(c.clientIpSource.trustProxyHops, 'dev default');
    }
  });

  it('explicit env values always win', () => {
    let c = loadConfig({ ...PROD, TRUST_PROXY_HOPS: '2' });
    assert.equal(c.trustProxyHops, 2);
    assert.equal(c.clientIpHeader, 'cf-connecting-ip');
    assert.equal(c.clientIpSource.trustProxyHops, 'env');
    c = loadConfig({ ...PROD, TRUST_PROXY_HOPS: '0', CLIENT_IP_HEADER: 'none' });
    assert.equal(c.trustProxyHops, 0);
    assert.equal(c.clientIpHeader, '', 'CLIENT_IP_HEADER=none disables the header in production');
    c = loadConfig({ NODE_ENV: 'development', TRUST_PROXY_HOPS: '3', CLIENT_IP_HEADER: 'CF-Connecting-IP' });
    assert.equal(c.trustProxyHops, 3);
    assert.equal(c.clientIpHeader, 'cf-connecting-ip');
    assert.equal(loadConfig({ CLIENT_IP_HEADER: 'NONE' }).clientIpHeader, '');
  });

  it('True-Client-IP / X-Real-IP (and other forgeable headers) refuse to start, any case, any NODE_ENV', () => {
    for (const h of ['True-Client-IP', 'x-real-ip', 'X-REAL-IP', 'CF-Connecting-IPv6', 'X-Forwarded-For', 'Forwarded']) {
      for (const env of [{ CLIENT_IP_HEADER: h }, { ...PROD, CLIENT_IP_HEADER: h }]) {
        assert.throws(() => assertValidConfig(loadConfig(env)), /client-forgeable.*refusing to start/, h);
      }
    }
  });

  it('production app gets trust proxy 3', async () => {
    const srv = await startServer({ db: false, env: { NODE_ENV: 'production' } });
    assert.equal(srv.app.get('trust proxy'), 3);
    assert.equal(srv.config.clientIpHeader, 'cf-connecting-ip');
    await srv.stop();
  });
});

describe('Render-shaped XFF "forged, client, cf, lb" with trust proxy 3', () => {
  // App sees XFF "<forged>, <client>, <cloudflare>, <render LB>" plus a Render-internal socket peer (here 127.0.0.1).
  const render = (forged, client) => ({
    'X-Forwarded-For': `${forged ? `${forged}, ` : ''}${client}, 172.70.1.1, 10.201.0.5`,
  });

  it('hops 3, no header: key is the real client, never the forged entry', async () => {
    const srv = await startServer({ db: false, rateLimits: LIMITS, env: { TRUST_PROXY_HOPS: '3', CLIENT_IP_HEADER: 'none' } });
    try {
      // Forged entry rotates, real client fixed → one counter. (req.ip itself is asserted in ipdebug.test.js.)
      const codes = await statuses((i) => login(srv.app, render(`198.18.0.${i}`, '203.0.113.31')), MAX + 2);
      limitedAfter(codes, 500);
      assert.equal((await login(srv.app, render('203.0.113.31', '203.0.113.32'))).status, 500, 'forging the limited IP does not borrow its counter');
    } finally {
      await srv.stop();
    }
  });

  it('production defaults: CF-Connecting-IP keys it; without the header the chain falls back to the client', async () => {
    const srv = await startServer({ db: false, rateLimits: LIMITS, env: { NODE_ENV: 'production' } });
    try {
      const codes = await statuses(
        (i) => login(srv.app, { ...render(`198.18.1.${i}`, '203.0.113.41'), 'CF-Connecting-IP': '203.0.113.41' }),
        MAX + 2
      );
      limitedAfter(codes, 500);
      // header missing → req.ip under trust proxy 3 = the client again, same budget would apply to that IP
      const fb = await statuses((i) => login(srv.app, render(`198.18.2.${i}`, '203.0.113.42')), MAX + 1);
      limitedAfter(fb, 500);
    } finally {
      await srv.stop();
    }
  });
});
