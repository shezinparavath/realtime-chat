'use strict';

const net = require('node:net');
const { rateLimit } = require('express-rate-limit');
const { AppError, sendError } = require('../errors');
const { RATE_LIMITED, RATE_LIMITED_MESSAGE } = require('../constants');

/**
 * Per-IP limiter for one auth route (each route gets its own instance/store).
 * Over the limit → 429 { error: { code: 'RATE_LIMITED', message } } plus
 * standard RateLimit-* headers (draft-7) and Retry-After.
 * Key = clientKey(req, clientIpHeader): see below (DEF-001). In production the
 * defaults are CF-Connecting-IP with fallback to req.ip under trust proxy 3.
 */
function authLimiter({ windowMs, max, clientIpHeader = '' }) {
  return rateLimit({
    windowMs,
    limit: max,
    keyGenerator: (req) => clientKey(req, clientIpHeader),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Retry-After (spec): whole seconds until this IP's window resets,
    // ceil((resetTime - now) / 1000), at least 1. Set explicitly here so it
    // doesn't depend on the library's header mode.
    handler: (req, res) => {
      res.set('Retry-After', String(retryAfterSeconds(req.rateLimit && req.rateLimit.resetTime)));
      return sendError(res, new AppError(RATE_LIMITED, RATE_LIMITED_MESSAGE));
    },
  });
}

/**
 * Rate-limit key (DEF-001).
 * - Header mode (CLIENT_IP_HEADER set): the header's value if it is a valid IP
 *   (first comma-separated entry, trimmed); X-Forwarded-For is ignored. Falls
 *   back to req.ip when the header is missing/invalid. Only safe when the edge
 *   proxy rejects/overwrites client-supplied values: on Render, Cloudflare
 *   answers 403 (error 1000) to a client-sent CF-Connecting-IP. True-Client-IP,
 *   X-Real-IP etc. are forgeable there and refused by config.js.
 * - Default: req.ip, which Express derives from X-Forwarded-For using
 *   app.set('trust proxy', TRUST_PROXY_HOPS): it skips exactly that many
 *   trusted hops from the right, so client-supplied (leftmost) entries are
 *   ignored as long as the hop count is not higher than the real one.
 */
function clientKey(req, clientIpHeader) {
  if (clientIpHeader) {
    const raw = req.get(clientIpHeader);
    if (raw) {
      const candidate = String(raw).split(',')[0].trim();
      if (net.isIP(candidate)) return `h:${candidate.toLowerCase()}`;
    }
  }
  return `ip:${req.ip}`;
}

/**
 * Optional debug (RATE_LIMIT_DEBUG=1): logs only the NUMBER of X-Forwarded-For
 * entries, whether the client-IP header is present, and which key source was
 * used — never any IP address.
 */
function rateLimitDebug(route, clientIpHeader) {
  return (req, _res, next) => {
    const xff = req.get('x-forwarded-for');
    const entries = xff ? xff.split(',').filter((s) => s.trim()).length : 0;
    const headerPresent = clientIpHeader ? Boolean(req.get(clientIpHeader)) : false;
    const source = clientKey(req, clientIpHeader).startsWith('h:') ? 'header' : 'req.ip';
    console.log(
      `[ratelimit-debug] route=${route} xff_entries=${entries} ip_header=${clientIpHeader || 'none'} ` +
        `ip_header_present=${headerPresent} key_source=${source}`
    );
    next();
  };
}

function retryAfterSeconds(resetTime, now = Date.now()) {
  const reset = resetTime instanceof Date ? resetTime.getTime() : Number(resetTime);
  if (!Number.isFinite(reset)) return 1;
  return Math.max(1, Math.ceil((reset - now) / 1000));
}

/**
 * Sliding-window counter for per-socket limits.
 * check(now) → { allowed: true } (and records the hit) or
 * { allowed: false, retryAfterMs } where retryAfterMs is the integer ms until
 * the oldest hit in the window expires (i.e. the next attempt would be allowed),
 * ceil, at least 1. Rejected attempts are not recorded.
 */
function createWindowLimiter({ max, windowMs }) {
  const hits = [];
  function check(now = Date.now()) {
    while (hits.length && now - hits[0] >= windowMs) hits.shift();
    if (hits.length >= max) {
      return { allowed: false, retryAfterMs: Math.max(1, Math.ceil(hits[0] + windowMs - now)) };
    }
    hits.push(now);
    return { allowed: true };
  }
  return { check, allow: (now) => check(now).allowed };
}

module.exports = { authLimiter, createWindowLimiter, retryAfterSeconds, clientKey, rateLimitDebug };
