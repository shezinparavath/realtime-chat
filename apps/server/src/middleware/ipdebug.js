'use strict';

/**
 * TEMP DEF-001 [ipdebug]: REMOVE after the one-time Render client-IP check
 * (delete this file, its require + app.use in app.js, test/ipdebug.test.js,
 * and the IPDEBUG env var).
 *
 * Based on Varun's line in handoffs/DEF-001-render-client-ip.md, changed so
 * it NEVER logs or returns an IP address. Instead of raw values it logs:
 *  - which headers are present and how many XFF entries there are,
 *  - where values match each other (cfip vs each XFF entry, req.ip, etc.),
 *  - whether each value equals the tester's own IP, passed in the request
 *    header `X-IPDebug-Expect: <ip>` (compared in memory, never logged),
 *  - an 8-hex HMAC fingerprint per value, keyed with a random per-process
 *    secret: you can tell that two requests saw the same value within one boot,
 *    but it can't be reversed or brute-forced offline.
 * Active only when IPDEBUG=1 AND the request has ?ipdebug=1. The /health
 * response is unchanged either way.
 */
const crypto = require('node:crypto');
const net = require('node:net');
const { clientKey } = require('./rateLimit');

const FP_KEY = crypto.randomBytes(32);

/** Normalize for comparison: trim, lowercase, strip IPv4-mapped IPv6 prefix. Non-IPs → null. */
function norm(v) {
  if (v === undefined || v === null) return null;
  let s = String(v).trim().toLowerCase();
  if (s.startsWith('::ffff:') && net.isIPv4(s.slice(7))) s = s.slice(7);
  return net.isIP(s) ? s : null;
}

function fp(v) {
  const n = norm(v);
  if (n === null) return v === undefined || v === null || v === '' ? null : 'not-ip';
  return crypto.createHmac('sha256', FP_KEY).update(n).digest('hex').slice(0, 8);
}

function eq(a, b) {
  const x = norm(a);
  const y = norm(b);
  return x !== null && y !== null && x === y;
}

/** Index of v in list (0 = leftmost), or -1. */
const indexIn = (list, v) => list.findIndex((e) => eq(e, v));

function buildIpDebug(req, config) {
  const h = (name) => {
    const v = req.get(name);
    return v === undefined ? undefined : String(v);
  };
  const xffRaw = h('x-forwarded-for');
  const xff = xffRaw ? xffRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const cfip = h('cf-connecting-ip');
  const tcip = h('true-client-ip');
  const xrip = h('x-real-ip');
  const cfip6 = h('cf-connecting-ipv6');
  const remote = req.socket.remoteAddress;
  const expectRaw = h('x-ipdebug-expect');
  const expect = norm(expectRaw);
  const key = clientKey(req, config.clientIpHeader);
  const keyValue = key.slice(key.indexOf(':') + 1);
  const ex = (v) => (expect === null ? null : eq(v, expect));

  return {
    trust_proxy: config.trustProxyHops,
    client_ip_header: config.clientIpHeader || 'none',
    expect_present: expect !== null,
    xff: {
      entries: xff.length,
      eq_expect: xff.map((e) => ex(e)), // position of the tester's IP; hops N = entries right of it + 1
      eq_cfip: xff.map((e) => eq(e, cfip)),
      fp: xff.map(fp),
    },
    cfip: { present: cfip !== undefined, eq_expect: ex(cfip), xff_index: indexIn(xff, cfip), eq_req_ip: eq(cfip, req.ip), fp: fp(cfip) },
    tcip: { present: tcip !== undefined, eq_expect: ex(tcip), eq_cfip: eq(tcip, cfip), fp: fp(tcip) },
    xrip: { present: xrip !== undefined, eq_expect: ex(xrip), eq_cfip: eq(xrip, cfip), fp: fp(xrip) },
    cfip6: { present: cfip6 !== undefined, eq_expect: ex(cfip6), fp: fp(cfip6) },
    remote: { eq_expect: ex(remote), xff_index: indexIn(xff, remote), fp: fp(remote) },
    req_ip: { eq_expect: ex(req.ip), xff_index: indexIn(xff, req.ip), is_socket: eq(req.ip, remote), eq_cfip: eq(req.ip, cfip), fp: fp(req.ip) },
    ips_count: req.ips.length,
    key: { source: key.startsWith('h:') ? 'header' : 'req.ip', eq_expect: ex(keyValue), fp: fp(keyValue) },
  };
}

function ipDebugMiddleware(config) {
  return (req, _res, next) => {
    if (req.query.ipdebug === '1') {
      try {
        console.log('[ipdebug]', JSON.stringify(buildIpDebug(req, config)));
      } catch (err) {
        console.log('[ipdebug] error', err && err.name);
      }
    }
    next();
  };
}

module.exports = { ipDebugMiddleware, buildIpDebug };
