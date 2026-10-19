'use strict';

/** TEMP DEF-001 [ipdebug] on /health — remove together with src/middleware/ipdebug.js. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { startServer } = require('./helpers');

const CLIENT = '203.0.113.51';
const FORGED = '198.51.100.77';
const CF = '172.70.9.9';
const LB = '10.201.3.4';
const RENDER_XFF = `${FORGED}, ${CLIENT}, ${CF}, ${LB}`;
const ALL_IPS = [CLIENT, FORGED, CF, LB, '127.0.0.1', '2001:db8::51', '203.0.113.8', '203.0.113.10'];

async function capture(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return lines.filter((l) => l.startsWith('[ipdebug]'));
}
const parse = (line) => JSON.parse(line.slice('[ipdebug] '.length));
const assertNoIps = (text) => {
  for (const ip of ALL_IPS) assert.ok(!text.includes(ip), `leaked ${ip}`);
  assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(text), 'no dotted IPv4');
  assert.ok(!/[0-9a-f]{0,4}::[0-9a-f]/i.test(text), 'no IPv6');
};

describe('[ipdebug] (TEMP DEF-001)', () => {
  it('off by default: ?ipdebug=1 logs nothing without IPDEBUG=1', async () => {
    const srv = await startServer({ db: false });
    const lines = await capture(() => request(srv.app).get('/health?ipdebug=1').set('X-Forwarded-For', RENDER_XFF));
    await srv.stop();
    assert.equal(lines.length, 0);
  });

  it('IPDEBUG=1 but no ?ipdebug=1 → no log', async () => {
    const srv = await startServer({ db: false, env: { IPDEBUG: '1' } });
    const lines = await capture(() => request(srv.app).get('/health').set('X-Forwarded-For', RENDER_XFF));
    await srv.stop();
    assert.equal(lines.length, 0);
  });

  it('Render chain + production defaults: key = real client; log has relations only, no IPs; response unchanged', async () => {
    const srv = await startServer({ db: false, env: { IPDEBUG: '1', NODE_ENV: 'production' } });
    let res;
    let res2;
    const lines = await capture(async () => {
      res = await request(srv.app)
        .get('/health?ipdebug=1')
        .set('X-Forwarded-For', RENDER_XFF)
        .set('CF-Connecting-IP', CLIENT)
        .set('True-Client-IP', '203.0.113.8')
        .set('X-Real-IP', '203.0.113.10')
        .set('X-IPDebug-Expect', CLIENT);
      res2 = await request(srv.app).get('/health?ipdebug=1').set('X-Forwarded-For', `${CLIENT}, ${CF}, ${LB}`).set('CF-Connecting-IP', CLIENT);
    });
    await srv.stop();
    assert.equal(lines.length, 2);
    const d = parse(lines[0]);
    assert.equal(d.trust_proxy, 3);
    assert.equal(d.client_ip_header, 'cf-connecting-ip');
    assert.equal(d.expect_present, true);
    assert.equal(d.xff.entries, 4);
    assert.deepEqual(d.xff.eq_expect, [false, true, false, false], 'tester IP is 3rd from the right');
    assert.deepEqual(d.xff.eq_cfip, [false, true, false, false]);
    assert.equal(d.cfip.present, true);
    assert.equal(d.cfip.eq_expect, true);
    assert.equal(d.cfip.xff_index, 1);
    assert.equal(d.cfip.eq_req_ip, true);
    assert.equal(d.req_ip.xff_index, 1, 'trust proxy 3 skips socket, LB, CF → the real client, not the forged entry');
    assert.equal(d.req_ip.eq_expect, true);
    assert.equal(d.req_ip.is_socket, false);
    assert.equal(d.remote.eq_expect, false);
    assert.equal(d.tcip.present, true);
    assert.equal(d.tcip.eq_expect, false, 'forged True-Client-IP is visible as a mismatch');
    assert.equal(d.xrip.eq_cfip, false);
    assert.equal(d.cfip6.present, false);
    assert.equal(d.key.source, 'header');
    assert.equal(d.key.eq_expect, true);
    assert.match(d.cfip.fp, /^[0-9a-f]{8}$/);
    assert.equal(d.cfip.fp, d.xff.fp[1], 'same value → same fingerprint');
    const d2 = parse(lines[1]);
    assert.equal(d2.expect_present, false);
    assert.equal(d2.cfip.eq_expect, null);
    assert.equal(d2.cfip.fp, d.cfip.fp, 'fingerprint stable within one process');
    assert.equal(d2.req_ip.xff_index, 0);
    assertNoIps(lines.join('\n'));
    for (const r of [res, res2]) {
      assert.equal(r.status, 200);
      assert.deepEqual(Object.keys(r.body).sort(), ['db', 'status', 'uptime']);
      assertNoIps(JSON.stringify(r.body) + JSON.stringify(r.headers));
    }
  });

  it('trust proxy 1 (today on Render): req.ip is the LB entry → shows the DEF-001 symptom', async () => {
    const srv = await startServer({ db: false, env: { IPDEBUG: '1', TRUST_PROXY_HOPS: '1' } });
    const lines = await capture(() =>
      request(srv.app).get('/health?ipdebug=1').set('X-Forwarded-For', `${CLIENT}, ${CF}, ${LB}`).set('X-IPDebug-Expect', CLIENT)
    );
    await srv.stop();
    const d = parse(lines[0]);
    assert.equal(d.req_ip.xff_index, 2, 'rightmost XFF entry = Render LB');
    assert.equal(d.req_ip.eq_expect, false);
    assert.equal(d.key.source, 'req.ip');
    assertNoIps(lines.join('\n'));
  });

  it('IPv6 values and non-IP junk are fingerprinted, never printed', async () => {
    const srv = await startServer({ db: false, env: { IPDEBUG: '1', CLIENT_IP_HEADER: 'CF-Connecting-IP' } });
    const lines = await capture(() =>
      request(srv.app)
        .get('/health?ipdebug=1')
        .set('CF-Connecting-IP', '2001:DB8::51')
        .set('CF-Connecting-IPv6', '2001:db8::51')
        .set('X-Real-IP', 'secret-junk-value')
        .set('X-IPDebug-Expect', '2001:db8::51')
    );
    await srv.stop();
    const d = parse(lines[0]);
    assert.equal(d.cfip.eq_expect, true, 'case-insensitive IPv6 compare');
    assert.equal(d.cfip6.eq_expect, true);
    assert.equal(d.xrip.fp, 'not-ip');
    assert.ok(!lines[0].toLowerCase().includes('2001:db8'));
    assert.ok(!lines[0].includes('secret-junk-value'));
  });
});
